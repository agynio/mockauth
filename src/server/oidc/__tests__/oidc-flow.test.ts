import { prisma } from "@/server/db/client";
import { computeS256Challenge } from "@/server/crypto/pkce";
import { handleAuthorize } from "@/server/services/authorize-service";
import { consumeAuthorizationCode } from "@/server/services/authorization-code-service";
import { createSession, clearSession } from "@/server/services/mock-session-service";
import { issueTokensFromCode } from "@/server/services/token-service";
import { getUserInfo } from "@/server/services/userinfo-service";

describe("OIDC flow", () => {
  let tenantSlug: string;
  let sessionToken: string;
  let codeVerifier: string;

  beforeAll(async () => {
    const tenant = await prisma.tenant.findFirstOrThrow({ where: { slug: "qa" }, include: { mockUsers: true } });
    tenantSlug = tenant.slug;
    const user = tenant.mockUsers[0];
    sessionToken = await createSession(tenant.id, user.id);
    codeVerifier = "verifier-1234567890123456789012345678901234567890";
  });

  afterAll(async () => {
    const tenant = await prisma.tenant.findFirst({ where: { slug: tenantSlug } });
    if (tenant) {
      await clearSession(tenant.id, sessionToken);
    }
  });

  it("issues id_token and access_token", async () => {
    const challenge = computeS256Challenge(codeVerifier);
    const authorize = await handleAuthorize(
      {
        tenantSlug,
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
      "https://mockauth.test/t/qa/oidc/authorize?client_id=qa-client",
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

    const userinfo = await getUserInfo(`Bearer ${tokenResponse.access_token}`, "https://mockauth.test", tenantSlug);
    expect(userinfo.sub).toBeDefined();
  });
});
