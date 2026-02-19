import { NextResponse } from "next/server";

import { env } from "@/server/env";
import { resolvePublicOrigin } from "@/server/http/origin";

const notFound = NextResponse.json({ error: "Not Found" }, { status: 404 });

export function GET(request: Request) {
  if (!env.ENABLE_TEST_ROUTES) {
    return notFound;
  }

  const origin = resolvePublicOrigin(request);
  const issuer = new URL("/api/test/logto", origin).toString();

  return NextResponse.json({
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    userinfo_endpoint: `${issuer}/userinfo`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["client_secret_basic"],
    id_token_signing_alg_values_supported: ["ES384"],
    subject_types_supported: ["public"],
    code_challenge_methods_supported: ["S256"],
  });
}
