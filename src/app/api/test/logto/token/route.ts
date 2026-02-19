import { NextResponse } from "next/server";

import { env } from "@/server/env";
import { resolvePublicOrigin } from "@/server/http/origin";
import { logtoStub } from "@/server/test/logto-stub";

const notFound = NextResponse.json({ error: "Not Found" }, { status: 404 });

export async function POST(request: Request) {
  if (!env.ENABLE_TEST_ROUTES) {
    return notFound;
  }

  const formData = await request.formData();
  const grantType = formData.get("grant_type");
  if (grantType !== "authorization_code") {
    return NextResponse.json({ error: "unsupported_grant_type" }, { status: 400 });
  }

  const code = formData.get("code")?.toString();
  const codeVerifier = formData.get("code_verifier")?.toString();
  if (!code) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const profile = logtoStub.exchangeCode(code, codeVerifier ?? null);
  if (!profile) {
    return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
  }

  const authorizationHeader = request.headers.get("authorization");
  let clientId = formData.get("client_id")?.toString() ?? "";
  if (authorizationHeader?.startsWith("Basic ")) {
    const [id] = Buffer.from(authorizationHeader.slice(6), "base64").toString("utf8").split(":");
    if (id) {
      clientId = id;
    }
  }

  if (!clientId) {
    return NextResponse.json({ error: "invalid_client" }, { status: 401 });
  }

  const origin = resolvePublicOrigin(request);
  const issuer = new URL("/api/test/logto", origin).toString();
  const tokens = await logtoStub.createTokens(profile, { issuer, audience: clientId });

  return NextResponse.json({
    token_type: "Bearer",
    scope: "openid profile email",
    expires_in: tokens.expiresIn,
    access_token: tokens.accessToken,
    id_token: tokens.idToken,
  });
}
