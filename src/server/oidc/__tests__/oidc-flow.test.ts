import { randomUUID } from "node:crypto";
import { vi } from "vitest";

import { $Enums } from "@/generated/prisma/client";
import type { JwtSigningAlg, Prisma } from "@/generated/prisma/client";
import { decodeJwt, decodeProtectedHeader } from "jose";

import { prisma } from "@/server/db/client";
import { computeS256Challenge } from "@/server/crypto/pkce";
import { hashOpaqueToken } from "@/server/crypto/opaque-token";
import { createFreshLoginCookieValue, createReauthCookieValue } from "@/server/oidc/reauth-cookie";
import { handleAuthorize } from "@/server/services/authorize-service";
import { consumeAuthorizationCode } from "@/server/services/authorization-code-service";
import { createSession, clearSession } from "@/server/services/mock-session-service";
import { issueTokensFromCode } from "@/server/services/token-service";
import { getUserInfo } from "@/server/services/userinfo-service";

const DEFAULT_TENANT_ID = "tenant_qa";
const CLIENT_ID = "qa-client";
const CLIENT_SECRET = "qa-secret";
const DEFAULT_REAUTH_TTL_SECONDS = 600;

describe("OIDC flow", () => {
  let tenantId: string;
  let apiResourceId: string;
  let sessionToken: string;
  let codeVerifier: string;
  let clientInternalId: string;
  let originalStrategies: Prisma.JsonValue;
  let originalReauthTtlSeconds: number;
  let originalAllowedScopes: string[];
  let originalIdTokenAlg: JwtSigningAlg | null | undefined;
  let originalAccessTokenAlg: JwtSigningAlg | null | undefined;

  const buildReauthCookie = (token: string, ttlSeconds = DEFAULT_REAUTH_TTL_SECONDS, clientId = CLIENT_ID) => {
    const cookie = createReauthCookieValue({
      tenantId,
      apiResourceId,
      clientId,
      sessionHash: hashOpaqueToken(token),
      ttlSeconds,
    });
    if (!cookie) {
      throw new Error("Unable to create reauth cookie");
    }
    return cookie;
  };

  const buildFreshLoginCookie = (token: string, clientId = CLIENT_ID) =>
    createFreshLoginCookieValue({
      tenantId,
      apiResourceId,
      clientId,
      sessionHash: hashOpaqueToken(token),
    });

  beforeAll(async () => {
    const tenant = await prisma.tenant.findFirstOrThrow({ where: { id: DEFAULT_TENANT_ID }, include: { mockUsers: true } });
    tenantId = tenant.id;
    apiResourceId = tenant.defaultApiResourceId!;
    const user = tenant.mockUsers[0];
    sessionToken = await createSession(tenant.id, user.id, {
      strategy: $Enums.LoginStrategy.USERNAME,
      subject: user.username,
    });
    codeVerifier = "verifier-1234567890123456789012345678901234567890";
    const client = await prisma.client.findFirstOrThrow({ where: { tenantId: tenant.id, clientId: CLIENT_ID } });
    clientInternalId = client.id;
    originalStrategies = client.authStrategies as Prisma.JsonValue;
    originalReauthTtlSeconds = client.reauthTtlSeconds;
    originalAllowedScopes = client.allowedScopes;
    originalIdTokenAlg = client.idTokenSignedResponseAlg;
    originalAccessTokenAlg = client.accessTokenSigningAlg;
    await prisma.client.update({
      where: { id: client.id },
      data: { reauthTtlSeconds: DEFAULT_REAUTH_TTL_SECONDS },
    });
  });

  beforeEach(async () => {
    if (clientInternalId) {
      await prisma.client.update({
        where: { id: clientInternalId },
        data: { allowedScopes: originalAllowedScopes },
      });
    }
  });

  afterAll(async () => {
    const tenant = await prisma.tenant.findFirst({ where: { id: tenantId } });
    if (tenant) {
      await clearSession(tenant.id, sessionToken);
    }
    if (clientInternalId) {
      await prisma.client.update({
        where: { id: clientInternalId },
        data: {
          ...(originalStrategies ? { authStrategies: originalStrategies } : {}),
          ...(typeof originalReauthTtlSeconds === "number" ? { reauthTtlSeconds: originalReauthTtlSeconds } : {}),
          ...(originalAllowedScopes ? { allowedScopes: originalAllowedScopes } : {}),
          idTokenSignedResponseAlg: originalIdTokenAlg ?? null,
          accessTokenSigningAlg: originalAccessTokenAlg ?? null,
        },
      });
    }
  });

  it("issues id_token and access_token", async () => {
    const challenge = computeS256Challenge(codeVerifier);
    const authorize = await handleAuthorize(
      {
        apiResourceId,
        clientId: CLIENT_ID,
        redirectUri: "https://client.example.test/callback",
        responseType: "code",
        scope: "openid profile email",
        state: "abc",
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
        sessionToken,
        reauthCookie: buildReauthCookie(sessionToken),
      },
      "https://mockauth.test",
      `https://mockauth.test/r/${apiResourceId}/oidc/authorize?client_id=${CLIENT_ID}`,
    );

    expect(authorize.type).toBe("redirect");
    const redirected = new URL(authorize.redirectTo);
    const code = redirected.searchParams.get("code");
    expect(code).toBeTruthy();

    const consumed = await consumeAuthorizationCode(code!);
    const tokenResponse = await issueTokensFromCode({
      code: consumed,
      codeVerifier,
      redirectUri: "https://client.example.test/callback",
      origin: "https://mockauth.test",
      clientSecret: CLIENT_SECRET,
    });

    expect(tokenResponse.access_token).toBeTruthy();
    expect(tokenResponse.id_token).toBeTruthy();

    const userinfo = await getUserInfo(`Bearer ${tokenResponse.access_token}`, "https://mockauth.test", apiResourceId);
    expect(userinfo.sub).toBe("demo");
    const idToken = decodeJwt(tokenResponse.id_token);
    expect(idToken.sub).toBe("demo");
    expect(idToken.preferred_username).toBe("demo");
    expect(idToken.email).toBeUndefined();
  });

  it("requires an explicit login step before issuing codes", async () => {
    const challenge = computeS256Challenge(codeVerifier);
    const returnTo = `https://mockauth.test/r/${apiResourceId}/oidc/authorize?client_id=${CLIENT_ID}`;
    const authorize = await handleAuthorize(
      {
        apiResourceId,
        clientId: CLIENT_ID,
        redirectUri: "https://client.example.test/callback",
        responseType: "code",
        scope: "openid profile email",
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
        sessionToken,
        reauthCookie: undefined,
      },
      "https://mockauth.test",
      returnTo,
    );

    expect(authorize.type).toBe("login");
    expect(authorize.redirectTo).toContain("return_to=");
    expect(decodeURIComponent(authorize.redirectTo.split("return_to=")[1]!)).toBe(returnTo);
  });

  it("rejects authorize requests that omit openid", async () => {
    const challenge = computeS256Challenge(codeVerifier);
    await expect(
      handleAuthorize(
        {
          apiResourceId,
          clientId: CLIENT_ID,
          redirectUri: "https://client.example.test/callback",
          responseType: "code",
          scope: "profile email",
          codeChallenge: challenge,
          codeChallengeMethod: "S256",
          sessionToken,
          reauthCookie: buildReauthCookie(sessionToken),
        },
        "https://mockauth.test",
        `https://mockauth.test/r/${apiResourceId}/oidc/authorize?client_id=${CLIENT_ID}`,
      ),
    ).rejects.toThrowError("scope must include openid");
  });

  it("rejects authorize requests with scopes outside the client allowlist", async () => {
    const challenge = computeS256Challenge(codeVerifier);
    await expect(
      handleAuthorize(
        {
          apiResourceId,
          clientId: CLIENT_ID,
          redirectUri: "https://client.example.test/callback",
          responseType: "code",
          scope: "openid profile offline_access",
          codeChallenge: challenge,
          codeChallengeMethod: "S256",
          sessionToken,
          reauthCookie: buildReauthCookie(sessionToken),
        },
        "https://mockauth.test",
        `https://mockauth.test/r/${apiResourceId}/oidc/authorize?client_id=${CLIENT_ID}`,
      ),
    ).rejects.toThrowError("Client does not allow scopes: offline_access");
  });

  it("rejects scopes disabled for the client", async () => {
    await prisma.client.update({
      where: { id: clientInternalId },
      data: { allowedScopes: ["openid"] },
    });
    const challenge = computeS256Challenge(codeVerifier);
    await expect(
      handleAuthorize(
        {
          apiResourceId,
          clientId: CLIENT_ID,
          redirectUri: "https://client.example.test/callback",
          responseType: "code",
          scope: "openid profile",
          codeChallenge: challenge,
          codeChallengeMethod: "S256",
          sessionToken,
          reauthCookie: buildReauthCookie(sessionToken),
        },
        "https://mockauth.test",
        `https://mockauth.test/r/${apiResourceId}/oidc/authorize?client_id=${CLIENT_ID}`,
      ),
    ).rejects.toThrowError("Client does not allow scopes: profile");
  });

  it("does not trust reauth query parameters without the cookie handshake", async () => {
    const challenge = computeS256Challenge(codeVerifier);
    const forgedReturnTo = new URL(
      `https://mockauth.test/r/${apiResourceId}/oidc/authorize?client_id=${CLIENT_ID}&state=manual`,
    );
    forgedReturnTo.searchParams.set("reauth", "1");
    const authorize = await handleAuthorize(
      {
        apiResourceId,
        clientId: CLIENT_ID,
        redirectUri: "https://client.example.test/callback",
        responseType: "code",
        scope: "openid profile email",
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
        sessionToken,
        reauthCookie: "forged-cookie",
      },
      "https://mockauth.test",
      forgedReturnTo.toString(),
    );

    expect(authorize.type).toBe("login");
    const decodedReturn = decodeURIComponent(authorize.redirectTo.split("return_to=")[1]!);
    expect(decodedReturn).toBe(forgedReturnTo.toString());
  });

  it("completes authorize immediately after a fresh login even when TTL is zero", async () => {
    await prisma.client.update({ where: { id: clientInternalId }, data: { reauthTtlSeconds: 0 } });
    try {
      const challenge = computeS256Challenge(codeVerifier);
      const authorize = await handleAuthorize(
        {
          apiResourceId,
          clientId: CLIENT_ID,
          redirectUri: "https://client.example.test/callback",
          responseType: "code",
          scope: "openid profile",
          state: "fresh-login",
          codeChallenge: challenge,
          codeChallengeMethod: "S256",
          sessionToken,
          reauthCookie: undefined,
          freshLoginCookie: buildFreshLoginCookie(sessionToken),
          freshLoginRequested: true,
        },
        "https://mockauth.test",
        `https://mockauth.test/r/${apiResourceId}/oidc/authorize?client_id=${CLIENT_ID}&fresh_login=1`,
      );

      expect(authorize.type).toBe("redirect");
      expect(authorize.consumeFreshLoginCookie).toBe(true);
      const redirected = new URL(authorize.redirectTo);
      expect(redirected.searchParams.get("code")).toBeTruthy();
      expect(redirected.searchParams.get("state")).toBe("fresh-login");
    } finally {
      await prisma.client.update({ where: { id: clientInternalId }, data: { reauthTtlSeconds: DEFAULT_REAUTH_TTL_SECONDS } });
    }
  });

  it("ignores forged fresh_login flags when the cookie is missing", async () => {
    await prisma.client.update({ where: { id: clientInternalId }, data: { reauthTtlSeconds: 0 } });
    try {
      const challenge = computeS256Challenge(codeVerifier);
      const forgedReturnTo = `https://mockauth.test/r/${apiResourceId}/oidc/authorize?client_id=${CLIENT_ID}&fresh_login=1`;
      const authorize = await handleAuthorize(
        {
          apiResourceId,
          clientId: CLIENT_ID,
          redirectUri: "https://client.example.test/callback",
          responseType: "code",
          scope: "openid profile",
          codeChallenge: challenge,
          codeChallengeMethod: "S256",
          sessionToken,
          reauthCookie: undefined,
          freshLoginRequested: true,
        },
        "https://mockauth.test",
        forgedReturnTo,
      );

      expect(authorize.type).toBe("login");
      expect(authorize.consumeFreshLoginCookie).toBeUndefined();
    } finally {
      await prisma.client.update({ where: { id: clientInternalId }, data: { reauthTtlSeconds: DEFAULT_REAUTH_TTL_SECONDS } });
    }
  });

  it("redirects with login_required when prompt=none", async () => {
    const challenge = computeS256Challenge(codeVerifier);
    const authorize = await handleAuthorize(
      {
        apiResourceId,
        clientId: CLIENT_ID,
        redirectUri: "https://client.example.test/callback",
        responseType: "code",
        scope: "openid profile",
        state: "prompt-none",
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
        prompt: "none",
      },
      "https://mockauth.test",
      `https://mockauth.test/r/${apiResourceId}/oidc/authorize?client_id=${CLIENT_ID}`,
    );

    expect(authorize.type).toBe("redirect");
    const redirected = new URL(authorize.redirectTo);
    expect(redirected.origin).toBe("https://client.example.test");
    expect(redirected.searchParams.get("error")).toBe("login_required");
    expect(redirected.searchParams.get("state")).toBe("prompt-none");
  });

  it("satisfies prompt=none when the reauth cookie is valid", async () => {
    const challenge = computeS256Challenge(codeVerifier);
    const authorize = await handleAuthorize(
      {
        apiResourceId,
        clientId: CLIENT_ID,
        redirectUri: "https://client.example.test/callback",
        responseType: "code",
        scope: "openid profile",
        state: "prompt-none-success",
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
        prompt: "none",
        sessionToken,
        reauthCookie: buildReauthCookie(sessionToken),
      },
      "https://mockauth.test",
      `https://mockauth.test/r/${apiResourceId}/oidc/authorize?client_id=${CLIENT_ID}`,
    );

    expect(authorize.type).toBe("redirect");
    const redirected = new URL(authorize.redirectTo);
    expect(redirected.searchParams.get("code")).toBeTruthy();
    expect(redirected.searchParams.get("state")).toBe("prompt-none-success");
  });

  it("forces login when prompt=login is requested", async () => {
    const challenge = computeS256Challenge(codeVerifier);
    const authorize = await handleAuthorize(
      {
        apiResourceId,
        clientId: CLIENT_ID,
        redirectUri: "https://client.example.test/callback",
        responseType: "code",
        scope: "openid profile",
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
        prompt: "login",
        sessionToken,
        reauthCookie: buildReauthCookie(sessionToken),
      },
      "https://mockauth.test",
      `https://mockauth.test/r/${apiResourceId}/oidc/authorize?client_id=${CLIENT_ID}`,
    );

    expect(authorize.type).toBe("login");
  });

  it("requires login when the cookie is expired", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
      const cookie = buildReauthCookie(sessionToken, 1);
      vi.setSystemTime(new Date("2024-01-01T00:00:02.000Z"));
      const challenge = computeS256Challenge(codeVerifier);
      const authorize = await handleAuthorize(
        {
          apiResourceId,
          clientId: CLIENT_ID,
          redirectUri: "https://client.example.test/callback",
          responseType: "code",
          scope: "openid profile",
          codeChallenge: challenge,
          codeChallengeMethod: "S256",
          sessionToken,
          reauthCookie: cookie,
        },
        "https://mockauth.test",
        `https://mockauth.test/r/${apiResourceId}/oidc/authorize?client_id=${CLIENT_ID}`,
      );

      expect(authorize.type).toBe("login");
    } finally {
      vi.useRealTimers();
    }
  });

  it("issues email-specific claims when email strategy is enabled", async () => {
    await prisma.client.update({
      where: { id: clientInternalId },
      data: {
        authStrategies: {
          username: { enabled: false, subSource: "entered" },
          email: { enabled: true, subSource: "entered" },
        },
      },
    });
    const emailUser = await prisma.mockUser.upsert({
      where: { tenantId_username: { tenantId, username: "email-user" } },
      update: { email: "email-user@example.test", displayName: "Email User" },
      create: {
        tenantId,
        username: "email-user",
        displayName: "Email User",
        email: "email-user@example.test",
      },
    });
    const emailSessionToken = await createSession(tenantId, emailUser.id, {
      strategy: $Enums.LoginStrategy.EMAIL,
      subject: "email-user@example.test",
    });
    const challenge = computeS256Challenge(codeVerifier);
    const authorize = await handleAuthorize(
      {
        apiResourceId,
        clientId: CLIENT_ID,
        redirectUri: "https://client.example.test/callback",
        responseType: "code",
        scope: "openid profile email",
        state: "email-flow",
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
        sessionToken: emailSessionToken,
        reauthCookie: buildReauthCookie(emailSessionToken),
      },
      "https://mockauth.test",
      `https://mockauth.test/r/${apiResourceId}/oidc/authorize?client_id=${CLIENT_ID}`,
    );

    expect(authorize.type).toBe("redirect");
    const code = new URL(authorize.redirectTo).searchParams.get("code");
    const consumed = await consumeAuthorizationCode(code!);
    const tokenResponse = await issueTokensFromCode({
      code: consumed,
      codeVerifier,
      redirectUri: "https://client.example.test/callback",
      origin: "https://mockauth.test",
      clientSecret: CLIENT_SECRET,
    });

    const idToken = decodeJwt(tokenResponse.id_token);
    expect(idToken.sub).toBe("email-user@example.test");
    expect(idToken.email).toBe("email-user@example.test");
    expect(idToken.email_verified).toBe(false);
    expect(idToken.preferred_username).toBeUndefined();

    const userinfo = await getUserInfo(`Bearer ${tokenResponse.access_token}`, "https://mockauth.test", apiResourceId);
    expect(userinfo.email).toBe("email-user@example.test");
    await clearSession(tenantId, emailSessionToken);
  });

  it("persists subject source selection and uses stored subjects in tokens", async () => {
    await prisma.client.update({
      where: { id: clientInternalId },
      data: {
        authStrategies: {
          username: { enabled: true, subSource: "generated_uuid" },
          email: { enabled: false, subSource: "entered" },
        },
      },
    });
    const updatedClient = await prisma.client.findUniqueOrThrow({
      where: { id: clientInternalId },
      select: { authStrategies: true },
    });
    expect(updatedClient.authStrategies).toMatchObject({
      username: { subSource: "generated_uuid" },
    });

    const tenant = await prisma.tenant.findFirstOrThrow({ where: { id: tenantId }, include: { mockUsers: true } });
    const subject = randomUUID();
    const sessionTokenOverride = await createSession(tenant.id, tenant.mockUsers[0]!.id, {
      strategy: $Enums.LoginStrategy.USERNAME,
      subject,
    });
    const challenge = computeS256Challenge(codeVerifier);
    const authorize = await handleAuthorize(
      {
        apiResourceId,
        clientId: CLIENT_ID,
        redirectUri: "https://client.example.test/callback",
        responseType: "code",
        scope: "openid profile email",
        state: "generated-uuid",
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
        sessionToken: sessionTokenOverride,
        reauthCookie: buildReauthCookie(sessionTokenOverride),
      },
      "https://mockauth.test",
      `https://mockauth.test/r/${apiResourceId}/oidc/authorize?client_id=${CLIENT_ID}`,
    );

    expect(authorize.type).toBe("redirect");
    const code = new URL(authorize.redirectTo).searchParams.get("code");
    const consumed = await consumeAuthorizationCode(code!);
    const tokenResponse = await issueTokensFromCode({
      code: consumed,
      codeVerifier,
      redirectUri: "https://client.example.test/callback",
      origin: "https://mockauth.test",
      clientSecret: CLIENT_SECRET,
    });

    const idToken = decodeJwt(tokenResponse.id_token);
    expect(idToken.sub).toBe(subject);

    const userinfo = await getUserInfo(`Bearer ${tokenResponse.access_token}`, "https://mockauth.test", apiResourceId);
    expect(userinfo.sub).toBe(subject);
    await clearSession(tenantId, sessionTokenOverride);
  });

  it("issues email_verified=true when configured", async () => {
    await prisma.client.update({
      where: { id: clientInternalId },
      data: {
        authStrategies: {
          username: { enabled: false, subSource: "entered" },
          email: { enabled: true, subSource: "entered", emailVerifiedMode: "true" },
        },
      },
    });
    const user = await prisma.mockUser.upsert({
      where: { tenantId_username: { tenantId, username: "email-verified" } },
      update: { email: "email-verified@example.test", displayName: "Email Verified" },
      create: { tenantId, username: "email-verified", email: "email-verified@example.test", displayName: "Email Verified" },
    });
    const verifiedSession = await createSession(tenantId, user.id, {
      strategy: $Enums.LoginStrategy.EMAIL,
      subject: "email-verified@example.test",
    });
    const authorize = await handleAuthorize(
      {
        apiResourceId,
        clientId: CLIENT_ID,
        redirectUri: "https://client.example.test/callback",
        responseType: "code",
        scope: "openid email",
        state: "email-verified",
        codeChallenge: computeS256Challenge(codeVerifier),
        codeChallengeMethod: "S256",
        sessionToken: verifiedSession,
        reauthCookie: buildReauthCookie(verifiedSession),
      },
      "https://mockauth.test",
      `https://mockauth.test/r/${apiResourceId}/oidc/authorize?client_id=${CLIENT_ID}`,
    );
    const code = new URL(authorize.redirectTo).searchParams.get("code");
    const consumed = await consumeAuthorizationCode(code!);
    const tokens = await issueTokensFromCode({
      code: consumed,
      codeVerifier,
      redirectUri: "https://client.example.test/callback",
      origin: "https://mockauth.test",
      clientSecret: CLIENT_SECRET,
    });
    const idToken = decodeJwt(tokens.id_token);
    expect(idToken.email_verified).toBe(true);
    await clearSession(tenantId, verifiedSession);
  });

  it("respects user choice for email_verified", async () => {
    await prisma.client.update({
      where: { id: clientInternalId },
      data: {
        authStrategies: {
          username: { enabled: false, subSource: "entered" },
          email: { enabled: true, subSource: "entered", emailVerifiedMode: "user_choice" },
        },
      },
    });
    const user = await prisma.mockUser.upsert({
      where: { tenantId_username: { tenantId, username: "email-choice" } },
      update: { email: "email-choice@example.test", displayName: "Email Choice" },
      create: { tenantId, username: "email-choice", email: "email-choice@example.test", displayName: "Email Choice" },
    });

    const authorizeFlow = async (override: boolean) => {
      const sessionTokenChoice = await createSession(tenantId, user.id, {
        strategy: $Enums.LoginStrategy.EMAIL,
        subject: "email-choice@example.test",
        emailVerifiedOverride: override,
      });
      const authorize = await handleAuthorize(
        {
          apiResourceId,
          clientId: CLIENT_ID,
          redirectUri: "https://client.example.test/callback",
          responseType: "code",
          scope: "openid email",
          state: override ? "choice-true" : "choice-false",
          codeChallenge: computeS256Challenge(codeVerifier),
          codeChallengeMethod: "S256",
          sessionToken: sessionTokenChoice,
          reauthCookie: buildReauthCookie(sessionTokenChoice),
        },
        "https://mockauth.test",
        `https://mockauth.test/r/${apiResourceId}/oidc/authorize?client_id=${CLIENT_ID}`,
      );
      const code = new URL(authorize.redirectTo).searchParams.get("code");
      const consumed = await consumeAuthorizationCode(code!);
      const tokens = await issueTokensFromCode({
        code: consumed,
        codeVerifier,
        redirectUri: "https://client.example.test/callback",
        origin: "https://mockauth.test",
        clientSecret: CLIENT_SECRET,
      });
      await clearSession(tenantId, sessionTokenChoice);
      return decodeJwt(tokens.id_token).email_verified;
    };

    await expect(authorizeFlow(true)).resolves.toBe(true);
    await expect(authorizeFlow(false)).resolves.toBe(false);
  });

  it("signs tokens with configured algorithms", async () => {
    await prisma.client.update({
      where: { id: clientInternalId },
      data: { authStrategies: originalStrategies as Prisma.InputJsonValue },
    });
    await prisma.client.update({
      where: { id: clientInternalId },
      data: { idTokenSignedResponseAlg: "ES384", accessTokenSigningAlg: "PS256" },
    });

    const challenge = computeS256Challenge(codeVerifier);
    const authorize = await handleAuthorize(
      {
        apiResourceId,
        clientId: CLIENT_ID,
        redirectUri: "https://client.example.test/callback",
        responseType: "code",
        scope: "openid profile",
        state: "alg-test",
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
        sessionToken,
        reauthCookie: buildReauthCookie(sessionToken, DEFAULT_REAUTH_TTL_SECONDS, CLIENT_ID),
      },
      "https://mockauth.test",
      `https://mockauth.test/r/${apiResourceId}/oidc/authorize?client_id=${CLIENT_ID}`,
    );

    const code = new URL(authorize.redirectTo).searchParams.get("code");
    const consumed = await consumeAuthorizationCode(code!);
    const tokens = await issueTokensFromCode({
      code: consumed,
      codeVerifier,
      redirectUri: "https://client.example.test/callback",
      origin: "https://mockauth.test",
      clientSecret: CLIENT_SECRET,
    });

    const idHeader = decodeProtectedHeader(tokens.id_token);
    const accessHeader = decodeProtectedHeader(tokens.access_token);

    expect(idHeader.alg).toBe("ES384");
    expect(accessHeader.alg).toBe("PS256");
    expect(idHeader.kid).toBeTruthy();
    expect(accessHeader.kid).toBeTruthy();

    const idKey = await prisma.tenantKey.findFirstOrThrow({ where: { tenantId, kid: idHeader.kid as string } });
    const accessKey = await prisma.tenantKey.findFirstOrThrow({ where: { tenantId, kid: accessHeader.kid as string } });
    expect(idKey.alg).toBe("ES384");
    expect(accessKey.alg).toBe("PS256");
  });

  it("supports multiple clients with distinct signing algorithms", async () => {
    await prisma.client.update({
      where: { id: clientInternalId },
      data: { authStrategies: originalStrategies as Prisma.InputJsonValue },
    });
    const alternateClientId = `client_${randomUUID().slice(0, 12)}`;
    const alternateRedirect = `https://${alternateClientId}.example.test/callback`;

    const alternateClient = await prisma.client.create({
      data: {
        tenantId,
        name: "Alternate signing client",
        clientId: alternateClientId,
        clientType: "PUBLIC",
        tokenEndpointAuthMethod: "none",
        idTokenSignedResponseAlg: "ES256",
        accessTokenSigningAlg: "ES256",
        redirectUris: {
          create: {
            uri: alternateRedirect,
          },
        },
      },
    });

    try {
      await prisma.client.update({
        where: { id: clientInternalId },
        data: { idTokenSignedResponseAlg: "PS256", accessTokenSigningAlg: null },
      });

      const challenge = computeS256Challenge(codeVerifier);

      const primaryAuthorize = await handleAuthorize(
        {
          apiResourceId,
          clientId: CLIENT_ID,
          redirectUri: "https://client.example.test/callback",
          responseType: "code",
          scope: "openid profile",
          state: "primary-client",
          codeChallenge: challenge,
          codeChallengeMethod: "S256",
          sessionToken,
          reauthCookie: buildReauthCookie(sessionToken, DEFAULT_REAUTH_TTL_SECONDS, CLIENT_ID),
          freshLoginRequested: true,
          freshLoginCookie: buildFreshLoginCookie(sessionToken, CLIENT_ID),
        },
        "https://mockauth.test",
        `https://mockauth.test/r/${apiResourceId}/oidc/authorize?client_id=${CLIENT_ID}`,
      );

      const altAuthorize = await handleAuthorize(
        {
          apiResourceId,
          clientId: alternateClient.clientId,
          redirectUri: alternateRedirect,
          responseType: "code",
          scope: "openid profile",
          state: "alternate-client",
          codeChallenge: challenge,
          codeChallengeMethod: "S256",
          sessionToken,
          reauthCookie: buildReauthCookie(sessionToken, DEFAULT_REAUTH_TTL_SECONDS, alternateClient.clientId),
          freshLoginRequested: true,
          freshLoginCookie: buildFreshLoginCookie(sessionToken, alternateClient.clientId),
        },
        "https://mockauth.test",
        `https://mockauth.test/r/${apiResourceId}/oidc/authorize?client_id=${alternateClient.clientId}`,
      );

      expect(primaryAuthorize.type).toBe("redirect");
      expect(altAuthorize.type).toBe("redirect");
      const primaryCode = new URL(primaryAuthorize.redirectTo).searchParams.get("code");
      const alternateCode = new URL(altAuthorize.redirectTo).searchParams.get("code");

      const [primaryConsumed, alternateConsumed] = await Promise.all([
        consumeAuthorizationCode(primaryCode!),
        consumeAuthorizationCode(alternateCode!),
      ]);

      const [primaryTokens, alternateTokens] = await Promise.all([
        issueTokensFromCode({
          code: primaryConsumed,
          codeVerifier,
          redirectUri: "https://client.example.test/callback",
          origin: "https://mockauth.test",
          clientSecret: CLIENT_SECRET,
        }),
        issueTokensFromCode({
          code: alternateConsumed,
          codeVerifier,
          redirectUri: alternateRedirect,
          origin: "https://mockauth.test",
          clientSecret: null,
        }),
      ]);

      const primaryHeader = decodeProtectedHeader(primaryTokens.id_token);
      const alternateHeader = decodeProtectedHeader(alternateTokens.id_token);

      expect(primaryHeader.alg).toBe("PS256");
      expect(alternateHeader.alg).toBe("ES256");
      expect(primaryHeader.kid).not.toBe(alternateHeader.kid);

      const activeKeys = await prisma.tenantKey.findMany({ where: { tenantId, status: "ACTIVE" } });
      expect(activeKeys.some((key) => key.alg === "PS256")).toBe(true);
      expect(activeKeys.some((key) => key.alg === "ES256")).toBe(true);
    } finally {
      await prisma.redirectUri.deleteMany({ where: { clientId: alternateClient.id } });
      await prisma.client.delete({ where: { id: alternateClient.id } });
    }
  });
});
