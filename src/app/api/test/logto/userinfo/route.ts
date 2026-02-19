import { NextResponse } from "next/server";

import { env } from "@/server/env";
import { logtoStub } from "@/server/test/logto-stub";

const notFound = NextResponse.json({ error: "Not Found" }, { status: 404 });

export function GET(request: Request) {
  if (!env.ENABLE_TEST_ROUTES) {
    return notFound;
  }

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }

  const token = authorization.slice("Bearer ".length).trim();
  const profile = logtoStub.getProfileFromAccessToken(token);
  if (!profile) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }

  return NextResponse.json({
    sub: profile.sub,
    email: profile.email,
    name: profile.name,
  });
}
