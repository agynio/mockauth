import { NextResponse } from "next/server";

import { env } from "@/server/env";
import { logtoStub } from "@/server/test/logto-stub";

const notFound = NextResponse.json({ error: "Not Found" }, { status: 404 });

export function GET(request: Request) {
  if (!env.ENABLE_TEST_ROUTES) {
    return notFound;
  }

  const url = new URL(request.url);
  const redirectUri = url.searchParams.get("redirect_uri");
  const state = url.searchParams.get("state");
  const codeChallenge = url.searchParams.get("code_challenge");
  const codeChallengeMethod = url.searchParams.get("code_challenge_method");

  if (!redirectUri || !state) {
    return NextResponse.json({ error: "Missing redirect_uri or state" }, { status: 400 });
  }

  if (codeChallengeMethod && codeChallengeMethod !== "S256") {
    return NextResponse.json({ error: "Unsupported code_challenge_method" }, { status: 400 });
  }

  const { code } = logtoStub.issueAuthorization(codeChallengeMethod ? codeChallenge : null);
  const redirectTarget = new URL(redirectUri);
  redirectTarget.searchParams.set("code", code);
  redirectTarget.searchParams.set("state", state);

  const nonce = url.searchParams.get("nonce");
  if (nonce) {
    redirectTarget.searchParams.set("nonce", nonce);
  }

  return NextResponse.redirect(redirectTarget.toString());
}
