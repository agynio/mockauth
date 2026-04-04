import { randomUUID } from "crypto";

import { decodeJwt } from "jose";
import { describe, expect, it } from "vitest";

import { $Enums } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { DEFAULT_CLIENT_AUTH_STRATEGIES, type ClientAuthStrategies } from "@/server/oidc/auth-strategy";
import { DEFAULT_PROXY_AUTH_STRATEGIES, type ProxyAuthStrategies } from "@/server/oidc/proxy-auth-strategy";
import { createClient } from "@/server/services/client-service";
import { issueTokensFromPassword } from "@/server/services/token-service";

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
  it("issues tokens when subject is entered", async () => {
    const { tenant, apiResource } = await createTenant();
    const { client, clientSecret } = await createPasswordClient({
      tenantId: tenant.id,
      allowedGrantTypes: ["password"],
      allowedScopes: ["openid", "profile"],
    });

    const response = await issueTokensFromPassword({
      apiResourceId: apiResource.id,
      clientId: client.clientId,
      username: "demo-user",
      scope: "openid profile",
      origin: ORIGIN,
      authMethod: "client_secret_post",
      clientSecret,
    });

    expect(response.access_token).toBeTruthy();
    expect(response.id_token).toBeTruthy();

    const idToken = decodeJwt(response.id_token!);
    expect(idToken.sub).toBe("demo-user");
    expect(idToken.preferred_username).toBe("demo-user");
  });

  it("issues tokens when subject is generated", async () => {
    const { tenant, apiResource } = await createTenant();
    const { client, clientSecret } = await createPasswordClient({
      tenantId: tenant.id,
      allowedGrantTypes: ["password"],
      allowedScopes: ["openid", "profile"],
    });

    await prisma.client.update({
      where: { id: client.id },
      data: {
        authStrategies: buildAuthStrategies({
          username: { subSource: "generated_uuid" },
        }),
      },
    });

    const response = await issueTokensFromPassword({
      apiResourceId: apiResource.id,
      clientId: client.clientId,
      username: "demo-user",
      scope: "openid profile",
      origin: ORIGIN,
      authMethod: "client_secret_post",
      clientSecret,
    });

    const idToken = decodeJwt(response.id_token!);
    const identity = await prisma.mockIdentity.findFirstOrThrow({
      where: {
        tenantId: tenant.id,
        strategy: $Enums.LoginStrategy.USERNAME,
        identifier: "demo-user",
      },
    });

    expect(idToken.sub).toBe(identity.sub);
    expect(idToken.sub).not.toBe("demo-user");
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

  it("rejects password grants when username strategy is disabled", async () => {
    const { tenant, apiResource } = await createTenant();
    const { client, clientSecret } = await createPasswordClient({
      tenantId: tenant.id,
      allowedGrantTypes: ["password"],
      allowedScopes: ["openid", "profile"],
    });

    await prisma.client.update({
      where: { id: client.id },
      data: {
        authStrategies: buildAuthStrategies({
          username: { enabled: false },
        }),
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
    ).rejects.toThrowError("Username authentication is disabled");
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
