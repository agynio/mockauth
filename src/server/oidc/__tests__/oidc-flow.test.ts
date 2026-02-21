import { $Enums } from "@/generated/prisma/client";
import { decodeJwt } from "jose";

import { prisma } from "@/server/db/client";
import { computeS256Challenge } from "@/server/crypto/pkce";
import { handleAuthorize } from "@/server/services/authorize-service";
import { consumeAuthorizationCode } from "@/server/services/authorization-code-service";
import { createSession, clearSession } from "@/server/services/mock-session-service";
import { issueTokensFromCode } from "@/server/services/token-service";
import { getUserInfo } from "@/server/services/userinfo-service";

const DEFAULT_TENANT_ID = "tenant_qa";

describe("OIDC flow", () => {
  let tenantId: string;
  let apiResourceId: string;
  let sessionToken: string;
  let codeVerifier: string;
  let clientInternalId: string;
  let originalStrategies: unknown;

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
    const client = await prisma.client.findFirstOrThrow({ where: { tenantId: tenant.id, clientId: "qa-client" } });
    clientInternalId = client.id;
    originalStrategies = client.authStrategies;
  });

  afterAll(async () => {
    const tenant = await prisma.tenant.findFirst({ where: { id: tenantId } });
    if (tenant) {
      await clearSession(tenant.id, sessionToken);
    }
    if (clientInternalId && originalStrategies) {
      await prisma.client.update({ where: { id: clientInternalId }, data: { authStrategies: originalStrategies } });
    }
  });

  it("issues id_token and access_token", async () => {
    const challenge = computeS256Challenge(codeVerifier);
    const authorize = await handleAuthorize(
      {
        tenantId,
        apiResourceId,
        clientId: "qa-client",
        redirectUri: "https://client.example.test/callback",
        responseType: "code",
        scope: "openid profile email",
        state: "abc",
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
        sessionToken,
      },
      "https://mockauth.test",
      `https://mockauth.test/t/${DEFAULT_TENANT_ID}/r/${apiResourceId}/oidc/authorize?client_id=qa-client`,
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
      clientSecret: "qa-secret",
    });

    expect(tokenResponse.access_token).toBeTruthy();
    expect(tokenResponse.id_token).toBeTruthy();

    const userinfo = await getUserInfo(
      `Bearer ${tokenResponse.access_token}`,
      "https://mockauth.test",
      tenantId,
      apiResourceId,
    );
    expect(userinfo.sub).toBe("demo");
    const idToken = decodeJwt(tokenResponse.id_token);
    expect(idToken.sub).toBe("demo");
    expect(idToken.preferred_username).toBe("demo");
    expect(idToken.email).toBeUndefined();
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
        tenantId,
        apiResourceId,
        clientId: "qa-client",
        redirectUri: "https://client.example.test/callback",
        responseType: "code",
        scope: "openid profile email",
        state: "email-flow",
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
        sessionToken: emailSessionToken,
      },
      "https://mockauth.test",
      `https://mockauth.test/t/${DEFAULT_TENANT_ID}/r/${apiResourceId}/oidc/authorize?client_id=qa-client`,
    );

    expect(authorize.type).toBe("redirect");
    const code = new URL(authorize.redirectTo).searchParams.get("code");
    const consumed = await consumeAuthorizationCode(code!);
    const tokenResponse = await issueTokensFromCode({
      code: consumed,
      codeVerifier,
      redirectUri: "https://client.example.test/callback",
      origin: "https://mockauth.test",
      clientSecret: "qa-secret",
    });

    const idToken = decodeJwt(tokenResponse.id_token);
    expect(idToken.sub).toBe("email-user@example.test");
    expect(idToken.email).toBe("email-user@example.test");
    expect(idToken.email_verified).toBe(false);
    expect(idToken.preferred_username).toBeUndefined();

    const userinfo = await getUserInfo(
      `Bearer ${tokenResponse.access_token}`,
      "https://mockauth.test",
      tenantId,
      apiResourceId,
    );
    expect(userinfo.email).toBe("email-user@example.test");
    await clearSession(tenantId, emailSessionToken);
  });
});
