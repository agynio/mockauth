import { randomUUID } from "node:crypto";

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
        apiResourceId,
        clientId: "qa-client",
        redirectUri: "https://client.example.test/callback",
        responseType: "code",
        scope: "openid profile email",
        state: "abc",
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
        sessionToken,
        reauthenticated: true,
      },
      "https://mockauth.test",
      `https://mockauth.test/r/${apiResourceId}/oidc/authorize?client_id=qa-client`,
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

    const userinfo = await getUserInfo(`Bearer ${tokenResponse.access_token}`, "https://mockauth.test", apiResourceId);
    expect(userinfo.sub).toBe("demo");
    const idToken = decodeJwt(tokenResponse.id_token);
    expect(idToken.sub).toBe("demo");
    expect(idToken.preferred_username).toBe("demo");
    expect(idToken.email).toBeUndefined();
  });

  it("requires an explicit login step before issuing codes", async () => {
    const challenge = computeS256Challenge(codeVerifier);
    const returnTo = `https://mockauth.test/r/${apiResourceId}/oidc/authorize?client_id=qa-client`;
    const authorize = await handleAuthorize(
      {
        apiResourceId,
        clientId: "qa-client",
        redirectUri: "https://client.example.test/callback",
        responseType: "code",
        scope: "openid profile email",
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
        sessionToken,
        reauthenticated: false,
      },
      "https://mockauth.test",
      returnTo,
    );

    expect(authorize.type).toBe("login");
    expect(authorize.redirectTo).toContain("return_to=");
    expect(decodeURIComponent(authorize.redirectTo.split("return_to=")[1]!)).toBe(returnTo);
  });

  it("does not trust reauth query parameters without the cookie handshake", async () => {
    const challenge = computeS256Challenge(codeVerifier);
    const forgedReturnTo = new URL(
      `https://mockauth.test/r/${apiResourceId}/oidc/authorize?client_id=qa-client&state=manual`,
    );
    forgedReturnTo.searchParams.set("reauth", "1");
    const authorize = await handleAuthorize(
      {
        apiResourceId,
        clientId: "qa-client",
        redirectUri: "https://client.example.test/callback",
        responseType: "code",
        scope: "openid profile email",
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
        sessionToken,
        reauthenticated: false,
      },
      "https://mockauth.test",
      forgedReturnTo.toString(),
    );

    expect(authorize.type).toBe("login");
    const decodedReturn = decodeURIComponent(authorize.redirectTo.split("return_to=")[1]!);
    expect(decodedReturn).toBe(forgedReturnTo.toString());
  });

  it("redirects with login_required when prompt=none", async () => {
    const challenge = computeS256Challenge(codeVerifier);
    const authorize = await handleAuthorize(
      {
        apiResourceId,
        clientId: "qa-client",
        redirectUri: "https://client.example.test/callback",
        responseType: "code",
        scope: "openid profile",
        state: "prompt-none",
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
        prompt: "none",
      },
      "https://mockauth.test",
      `https://mockauth.test/r/${apiResourceId}/oidc/authorize?client_id=qa-client`,
    );

    expect(authorize.type).toBe("redirect");
    const redirected = new URL(authorize.redirectTo);
    expect(redirected.origin).toBe("https://client.example.test");
    expect(redirected.searchParams.get("error")).toBe("login_required");
    expect(redirected.searchParams.get("state")).toBe("prompt-none");
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
        clientId: "qa-client",
        redirectUri: "https://client.example.test/callback",
        responseType: "code",
        scope: "openid profile email",
        state: "email-flow",
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
        sessionToken: emailSessionToken,
        reauthenticated: true,
      },
      "https://mockauth.test",
      `https://mockauth.test/r/${apiResourceId}/oidc/authorize?client_id=qa-client`,
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
        clientId: "qa-client",
        redirectUri: "https://client.example.test/callback",
        responseType: "code",
        scope: "openid profile email",
        state: "generated-uuid",
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
        sessionToken: sessionTokenOverride,
        reauthenticated: true,
      },
      "https://mockauth.test",
      `https://mockauth.test/r/${apiResourceId}/oidc/authorize?client_id=qa-client`,
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
        clientId: "qa-client",
        redirectUri: "https://client.example.test/callback",
        responseType: "code",
        scope: "openid email",
        state: "email-verified",
        codeChallenge: computeS256Challenge(codeVerifier),
        codeChallengeMethod: "S256",
        sessionToken: verifiedSession,
        reauthenticated: true,
      },
      "https://mockauth.test",
      `https://mockauth.test/r/${apiResourceId}/oidc/authorize?client_id=qa-client`,
    );
    const code = new URL(authorize.redirectTo).searchParams.get("code");
    const consumed = await consumeAuthorizationCode(code!);
    const tokens = await issueTokensFromCode({
      code: consumed,
      codeVerifier,
      redirectUri: "https://client.example.test/callback",
      origin: "https://mockauth.test",
      clientSecret: "qa-secret",
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
          clientId: "qa-client",
          redirectUri: "https://client.example.test/callback",
          responseType: "code",
          scope: "openid email",
          state: override ? "choice-true" : "choice-false",
          codeChallenge: computeS256Challenge(codeVerifier),
          codeChallengeMethod: "S256",
          sessionToken: sessionTokenChoice,
          reauthenticated: true,
        },
        "https://mockauth.test",
        `https://mockauth.test/r/${apiResourceId}/oidc/authorize?client_id=qa-client`,
      );
      const code = new URL(authorize.redirectTo).searchParams.get("code");
      const consumed = await consumeAuthorizationCode(code!);
      const tokens = await issueTokensFromCode({
        code: consumed,
        codeVerifier,
        redirectUri: "https://client.example.test/callback",
        origin: "https://mockauth.test",
        clientSecret: "qa-secret",
      });
      await clearSession(tenantId, sessionTokenChoice);
      return decodeJwt(tokens.id_token).email_verified;
    };

    await expect(authorizeFlow(true)).resolves.toBe(true);
    await expect(authorizeFlow(false)).resolves.toBe(false);
  });
});
