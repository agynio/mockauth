import { NextResponse } from "next/server";

import { env } from "@/server/env";
import { logtoStub } from "@/server/test/logto-stub";

const notFound = NextResponse.json({ error: "Not Found" }, { status: 404 });

export function GET() {
  if (!env.ENABLE_TEST_ROUTES) {
    return notFound;
  }

  return NextResponse.json(logtoStub.getJwks());
}
