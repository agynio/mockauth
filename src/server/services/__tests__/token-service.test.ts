import { randomUUID } from "crypto";

import { decodeJwt } from "jose";
import { describe, expect, it } from "vitest";

import { $Enums } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { hashOpaqueToken } from "@/server/crypto/opaque-token";
import { DEFAULT_CLIENT_AUTH_STRATEGIES, type ClientAuthStrategies } from "@/server/oidc/auth-strategy";
import { DEFAULT_PROXY_AUTH_STRATEGIES, type ProxyAuthStrategies } from "@/server/oidc/proxy-auth-strategy";
import { createClient } from "@/server/services/client-service";
import { issueTokensFromPassword, issueTokensFromRefreshToken } from "@/server/services/token-service";

const ORIGIN = "https://mockauth.test";

const createTenant = async () => {
  const tenant = await prisma.tenant.create({
    data: {
      name: `Token Service Tenant ${randomUUID()}`,
    },
  });
  const apiResource = await prisma.apiResource.create({
    data: {
      tenantId: tenant.id,
      name: "Default",
    },
  });
  await prisma.tenant.update({ where: { id: tenant.id }, data: { defaultApiResourceId: apiResource.id } });
  return { tenant, apiResource };
};

type StrategyOverrides = {
  username?: Partial<ClientAuthStrategies["username"]>;
  email?: Partial<ClientAuthStrategies["email"]>;
};

const buildAuthStrategies = (overrides: StrategyOverrides = {}): ClientAuthStrategies => ({
  username: { ...DEFAULT_CLIENT_AUTH_STRATEGIES.username, ...overrides.username },
  email: { ...DEFAULT_CLIENT_AUTH_STRATEGIES.email, ...overrides.email },
});

const updateAuthStrategies = async (clientId: string, overrides: StrategyOverrides) => {
  await prisma.client.update({
    where: { id: clientId },
    data: {
      authStrategies: buildAuthStrategies(overrides),
    },
  });
};

const createPasswordClient = async (input: {
  tenantId: string;
  allowedGrantTypes?: string[];
  allowedScopes?: string[];
  oauthClientMode?: "regular" | "proxy";
  proxyAuthStrategies?: ProxyAuthStrategies;
  proxyConfig?: {
    providerType: "oidc" | "oauth2";
    authorizationEndpoint: string;
    tokenEndpoint: string;
    upstreamClientId: string;
  };
}) => {
  const { tenantId, allowedGrantTypes, allowedScopes, oauthClientMode, proxyAuthStrategies, proxyConfig } = input;
  const resolvedProxyAuthStrategies =
    oauthClientMode === "proxy" ? (proxyAuthStrategies ?? DEFAULT_PROXY_AUTH_STRATEGIES) : undefined;
  const created = await createClient(tenantId, {
    name: `Password Client ${randomUUID()}`,
    tokenEndpointAuthMethods: ["client_secret_post"],
    allowedGrantTypes,
    allowedScopes,
    oauthClientMode,
    proxyAuthStrategies: resolvedProxyAuthStrategies,
    proxyConfig,
  });
  if (!created.clientSecret) {
    throw new Error("Expected client secret for password client");
  }
  return created;
};

describe("token service password grant", () => {
  it("issues tokens for email strategy", async () => {
    const { tenant, apiResource } = await createTenant();
    const { client, clientSecret } = await createPasswordClient({
      tenantId: tenant.id,
      allowedGrantTypes: ["password"],
      allowedScopes: ["openid", "email", "profile"],
    });

    await updateAuthStrategies(client.id, {
      username: { enabled: false },
      email: { enabled: true },
    });

    const response = await issueTokensFromPassword({
      apiResourceId: apiResource.id,
      clientId: client.clientId,
      username: "user@example.com",
      scope: "openid email profile",
      origin: ORIGIN,
      authMethod: "client_secret_post",
      clientSecret,
    });

    expect(response.access_token).toBeTruthy();
    expect(response.id_token).toBeTruthy();

    const idToken = decodeJwt(response.id_token!);
    expect(idToken.sub).toBe("user@example.com");
    expect(idToken.email).toBe("user@example.com");
    expect(idToken.email_verified).toBe(false);
    expect(idToken.preferred_username).toBeUndefined();
  });

  it("issues tokens when email subject is generated", async () => {
    const { tenant, apiResource } = await createTenant();
    const { client, clientSecret } = await createPasswordClient({
      tenantId: tenant.id,
      allowedGrantTypes: ["password"],
      allowedScopes: ["openid", "email"],
    });

    await updateAuthStrategies(client.id, {
      username: { enabled: false },
      email: { enabled: true, subSource: "generated_uuid" },
    });

    const response = await issueTokensFromPassword({
      apiResourceId: apiResource.id,
      clientId: client.clientId,
      username: "user@example.com",
      scope: "openid email",
      origin: ORIGIN,
      authMethod: "client_secret_post",
      clientSecret,
    });

    const idToken = decodeJwt(response.id_token!);
    const identity = await prisma.mockIdentity.findFirstOrThrow({
      where: {
        tenantId: tenant.id,
        strategy: $Enums.LoginStrategy.EMAIL,
        identifier: "user@example.com",
      },
    });

    expect(idToken.sub).toBe(identity.sub);
    expect(idToken.sub).not.toBe("user@example.com");
  });

  it("marks email as verified when configured", async () => {
    const { tenant, apiResource } = await createTenant();
    const { client, clientSecret } = await createPasswordClient({
      tenantId: tenant.id,
      allowedGrantTypes: ["password"],
      allowedScopes: ["openid", "email"],
    });

    await updateAuthStrategies(client.id, {
      username: { enabled: false },
      email: { enabled: true, emailVerifiedMode: "true" },
    });

    const response = await issueTokensFromPassword({
      apiResourceId: apiResource.id,
      clientId: client.clientId,
      username: "user@example.com",
      scope: "openid email",
      origin: ORIGIN,
      authMethod: "client_secret_post",
      clientSecret,
    });

    const idToken = decodeJwt(response.id_token!);
    expect(idToken.email_verified).toBe(true);
  });

  it("defaults email verification to false for user choice", async () => {
    const { tenant, apiResource } = await createTenant();
    const { client, clientSecret } = await createPasswordClient({
      tenantId: tenant.id,
      allowedGrantTypes: ["password"],
      allowedScopes: ["openid", "email"],
    });

    await updateAuthStrategies(client.id, {
      username: { enabled: false },
      email: { enabled: true, emailVerifiedMode: "user_choice" },
    });

    const response = await issueTokensFromPassword({
      apiResourceId: apiResource.id,
      clientId: client.clientId,
      username: "user@example.com",
      scope: "openid email",
      origin: ORIGIN,
      authMethod: "client_secret_post",
      clientSecret,
    });

    const idToken = decodeJwt(response.id_token!);
    expect(idToken.email_verified).toBe(false);
  });

  it("prefers email strategy when identifier includes @", async () => {
    const { tenant, apiResource } = await createTenant();
    const { client, clientSecret } = await createPasswordClient({
      tenantId: tenant.id,
      allowedGrantTypes: ["password"],
      allowedScopes: ["openid", "email", "profile"],
    });

    await updateAuthStrategies(client.id, {
      username: { enabled: true },
      email: { enabled: true },
    });

    const response = await issueTokensFromPassword({
      apiResourceId: apiResource.id,
      clientId: client.clientId,
      username: "user@example.com",
      scope: "openid email profile",
      origin: ORIGIN,
      authMethod: "client_secret_post",
      clientSecret,
    });

    const idToken = decodeJwt(response.id_token!);
    expect(idToken.email).toBe("user@example.com");
    expect(idToken.preferred_username).toBeUndefined();
  });

  it("selects username strategy when identifier is not an email", async () => {
    const { tenant, apiResource } = await createTenant();
    const { client, clientSecret } = await createPasswordClient({
      tenantId: tenant.id,
      allowedGrantTypes: ["password"],
      allowedScopes: ["openid", "email", "profile"],
    });

    await updateAuthStrategies(client.id, {
      username: { enabled: true },
      email: { enabled: true },
    });

    const response = await issueTokensFromPassword({
      apiResourceId: apiResource.id,
      clientId: client.clientId,
      username: "demo-user",
      scope: "openid email profile",
      origin: ORIGIN,
      authMethod: "client_secret_post",
      clientSecret,
    });

    expect(response.access_token).toBeTruthy();
    expect(response.id_token).toBeTruthy();

    const idToken = decodeJwt(response.id_token!);
    expect(idToken.sub).toBe("demo-user");
    expect(idToken.preferred_username).toBe("demo-user");
    expect(idToken.email).toBeUndefined();
  });

  it("treats email-like identifiers as username when only username is enabled", async () => {
    const { tenant, apiResource } = await createTenant();
    const { client, clientSecret } = await createPasswordClient({
      tenantId: tenant.id,
      allowedGrantTypes: ["password"],
      allowedScopes: ["openid", "email", "profile"],
    });

    await updateAuthStrategies(client.id, {
      username: { enabled: true },
      email: { enabled: false },
    });

    const response = await issueTokensFromPassword({
      apiResourceId: apiResource.id,
      clientId: client.clientId,
      username: "user@example.com",
      scope: "openid email profile",
      origin: ORIGIN,
      authMethod: "client_secret_post",
      clientSecret,
    });

    const idToken = decodeJwt(response.id_token!);
    expect(idToken.preferred_username).toBe("user@example.com");
    expect(idToken.email).toBeUndefined();
  });

  it("rejects password grants when only email is enabled and identifier is not an email", async () => {
    const { tenant, apiResource } = await createTenant();
    const { client, clientSecret } = await createPasswordClient({
      tenantId: tenant.id,
      allowedGrantTypes: ["password"],
      allowedScopes: ["openid", "email"],
    });

    await updateAuthStrategies(client.id, {
      username: { enabled: false },
      email: { enabled: true },
    });

    await expect(
      issueTokensFromPassword({
        apiResourceId: apiResource.id,
        clientId: client.clientId,
        username: "demo-user",
        scope: "openid email",
        origin: ORIGIN,
        authMethod: "client_secret_post",
        clientSecret,
      }),
    ).rejects.toThrowError("Username authentication is disabled");
  });

  it("rejects password grants when client disallows the grant type", async () => {
    const { tenant, apiResource } = await createTenant();
    const { client, clientSecret } = await createPasswordClient({
      tenantId: tenant.id,
      allowedGrantTypes: ["authorization_code"],
      allowedScopes: ["openid", "profile"],
    });

    await expect(
      issueTokensFromPassword({
        apiResourceId: apiResource.id,
        clientId: client.clientId,
        username: "demo-user",
        scope: "openid profile",
        origin: ORIGIN,
        authMethod: "client_secret_post",
        clientSecret,
      }),
    ).rejects.toThrowError("Client does not support password grant");
  });

  it("rejects password grants when no auth strategy is enabled", async () => {
    const { tenant, apiResource } = await createTenant();
    const { client, clientSecret } = await createPasswordClient({
      tenantId: tenant.id,
      allowedGrantTypes: ["password"],
      allowedScopes: ["openid", "profile"],
    });

    await updateAuthStrategies(client.id, {
      username: { enabled: false },
      email: { enabled: false },
    });

    await expect(
      issueTokensFromPassword({
        apiResourceId: apiResource.id,
        clientId: client.clientId,
        username: "demo-user",
        scope: "openid profile",
        origin: ORIGIN,
        authMethod: "client_secret_post",
        clientSecret,
      }),
    ).rejects.toThrowError("No authentication strategy is enabled");
  });

  it("rejects password grants for proxy clients", async () => {
    const { tenant, apiResource } = await createTenant();
    const { client, clientSecret } = await createPasswordClient({
      tenantId: tenant.id,
      allowedGrantTypes: ["password"],
      allowedScopes: ["openid", "profile"],
      oauthClientMode: "proxy",
      proxyAuthStrategies: DEFAULT_PROXY_AUTH_STRATEGIES,
      proxyConfig: {
        providerType: "oidc",
        authorizationEndpoint: "https://proxy.example/auth",
        tokenEndpoint: "https://proxy.example/token",
        upstreamClientId: "proxy-client",
      },
    });

    await expect(
      issueTokensFromPassword({
        apiResourceId: apiResource.id,
        clientId: client.clientId,
        username: "demo-user",
        scope: "openid profile",
        origin: ORIGIN,
        authMethod: "client_secret_post",
        clientSecret,
      }),
    ).rejects.toThrowError("Client does not support password grant");
  });

  it("rejects password grants for preauthorized proxy clients", async () => {
    const { tenant, apiResource } = await createTenant();
    const { client, clientSecret } = await createPasswordClient({
      tenantId: tenant.id,
      allowedGrantTypes: ["password"],
      allowedScopes: ["openid", "profile"],
      oauthClientMode: "proxy",
      proxyAuthStrategies: {
        redirect: { enabled: false },
        preauthorized: { enabled: true },
      },
      proxyConfig: {
        providerType: "oidc",
        authorizationEndpoint: "https://proxy.example/auth",
        tokenEndpoint: "https://proxy.example/token",
        upstreamClientId: "proxy-client",
      },
    });

    await expect(
      issueTokensFromPassword({
        apiResourceId: apiResource.id,
        clientId: client.clientId,
        username: "demo-user",
        scope: "openid profile",
        origin: ORIGIN,
        authMethod: "client_secret_post",
        clientSecret,
      }),
    ).rejects.toThrowError("Client does not support password grant");
  });

  it("rejects password grants when scope is missing openid", async () => {
    const { tenant, apiResource } = await createTenant();
    const { client, clientSecret } = await createPasswordClient({
      tenantId: tenant.id,
      allowedGrantTypes: ["password"],
      allowedScopes: ["openid", "profile"],
    });

    await expect(
      issueTokensFromPassword({
        apiResourceId: apiResource.id,
        clientId: client.clientId,
        username: "demo-user",
        scope: "profile",
        origin: ORIGIN,
        authMethod: "client_secret_post",
        clientSecret,
      }),
    ).rejects.toThrowError("scope must include openid");
  });

  it("rejects password grants with disallowed scopes", async () => {
    const { tenant, apiResource } = await createTenant();
    const { client, clientSecret } = await createPasswordClient({
      tenantId: tenant.id,
      allowedGrantTypes: ["password"],
      allowedScopes: ["openid"],
    });

    await expect(
      issueTokensFromPassword({
        apiResourceId: apiResource.id,
        clientId: client.clientId,
        username: "demo-user",
        scope: "openid profile",
        origin: ORIGIN,
        authMethod: "client_secret_post",
        clientSecret,
      }),
    ).rejects.toThrowError("Client does not allow scopes: profile");
  });

  it("rejects password grants when issuer mismatches the client", async () => {
    const { tenant, apiResource } = await createTenant();
    const secondaryResource = await prisma.apiResource.create({
      data: {
        tenantId: tenant.id,
        name: "Secondary",
      },
    });
    const { client, clientSecret } = await createPasswordClient({
      tenantId: tenant.id,
      allowedGrantTypes: ["password"],
      allowedScopes: ["openid", "profile"],
    });

    await expect(
      issueTokensFromPassword({
        apiResourceId: secondaryResource.id,
        clientId: client.clientId,
        username: "demo-user",
        scope: "openid profile",
        origin: ORIGIN,
        authMethod: "client_secret_post",
        clientSecret,
      }),
    ).rejects.toThrowError("Client is not configured for this issuer");
  });
});

describe("token service refresh grant", () => {
  it("issues refresh tokens for offline access scopes", async () => {
    const { tenant, apiResource } = await createTenant();
    const { client, clientSecret } = await createPasswordClient({
      tenantId: tenant.id,
      allowedGrantTypes: ["password", "refresh_token"],
      allowedScopes: ["openid", "profile", "offline_access"],
    });

    const response = await issueTokensFromPassword({
      apiResourceId: apiResource.id,
      clientId: client.clientId,
      username: "offline-user",
      scope: "openid profile offline_access",
      origin: ORIGIN,
      authMethod: "client_secret_post",
      clientSecret,
    });

    expect(response.refresh_token).toBeTruthy();
    const record = await prisma.refreshToken.findFirstOrThrow({
      where: { tokenHash: hashOpaqueToken(response.refresh_token!) },
    });
    expect(record.clientId).toBe(client.id);
  });

  it("rotates refresh tokens and narrows scopes", async () => {
    const { tenant, apiResource } = await createTenant();
    const { client, clientSecret } = await createPasswordClient({
      tenantId: tenant.id,
      allowedGrantTypes: ["password", "refresh_token"],
      allowedScopes: ["openid", "profile", "offline_access"],
    });

    const initial = await issueTokensFromPassword({
      apiResourceId: apiResource.id,
      clientId: client.clientId,
      username: "rotate-user",
      scope: "openid profile offline_access",
      origin: ORIGIN,
      authMethod: "client_secret_post",
      clientSecret,
    });

    const refreshed = await issueTokensFromRefreshToken({
      apiResourceId: apiResource.id,
      clientId: client.clientId,
      refreshToken: initial.refresh_token!,
      scope: "openid profile",
      origin: ORIGIN,
      authMethod: "client_secret_post",
      clientSecret,
    });

    expect(refreshed.refresh_token).toBeTruthy();
    expect(refreshed.refresh_token).not.toBe(initial.refresh_token);

    const accessToken = decodeJwt(refreshed.access_token!);
    expect(accessToken.scope).toBe("openid profile");

    const previousRecord = await prisma.refreshToken.findFirstOrThrow({
      where: { tokenHash: hashOpaqueToken(initial.refresh_token!) },
    });
    const newRecord = await prisma.refreshToken.findFirstOrThrow({
      where: { tokenHash: hashOpaqueToken(refreshed.refresh_token!) },
    });
    expect(previousRecord.rotatedAt).not.toBeNull();
    expect(newRecord.familyId).toBe(previousRecord.familyId);
    expect(newRecord.scope).toContain("offline_access");
  });

  it("revokes refresh tokens when reuse is detected", async () => {
    const { tenant, apiResource } = await createTenant();
    const { client, clientSecret } = await createPasswordClient({
      tenantId: tenant.id,
      allowedGrantTypes: ["password", "refresh_token"],
      allowedScopes: ["openid", "profile", "offline_access"],
    });

    const initial = await issueTokensFromPassword({
      apiResourceId: apiResource.id,
      clientId: client.clientId,
      username: "reuse-user",
      scope: "openid profile offline_access",
      origin: ORIGIN,
      authMethod: "client_secret_post",
      clientSecret,
    });

    await issueTokensFromRefreshToken({
      apiResourceId: apiResource.id,
      clientId: client.clientId,
      refreshToken: initial.refresh_token!,
      origin: ORIGIN,
      authMethod: "client_secret_post",
      clientSecret,
    });

    await expect(
      issueTokensFromRefreshToken({
        apiResourceId: apiResource.id,
        clientId: client.clientId,
        refreshToken: initial.refresh_token!,
        origin: ORIGIN,
        authMethod: "client_secret_post",
        clientSecret,
      }),
    ).rejects.toThrowError("Refresh token reuse detected");

    const originalRecord = await prisma.refreshToken.findFirstOrThrow({
      where: { tokenHash: hashOpaqueToken(initial.refresh_token!) },
    });
    const family = await prisma.refreshToken.findMany({
      where: { familyId: originalRecord.familyId },
    });
    expect(family.length).toBeGreaterThan(0);
    expect(family.every((token) => token.revokedAt !== null)).toBe(true);
  });
});
