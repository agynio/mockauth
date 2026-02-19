import { NextResponse } from "next/server";

import { env } from "@/server/env";
import { logtoStub } from "@/server/test/logto-stub";

const notFound = NextResponse.json({ error: "Not Found" }, { status: 404 });

export async function POST(request: Request) {
  if (!env.ENABLE_TEST_ROUTES) {
    return notFound;
  }

  const payload = (await request.json().catch(() => ({}))) as Partial<{
    email: string;
    sub: string;
    name: string;
  }>;

  logtoStub.enqueueProfile(payload);
  return NextResponse.json({ status: "queued" });
}

export function DELETE() {
  if (!env.ENABLE_TEST_ROUTES) {
    return notFound;
  }
  logtoStub.clearProfiles();
  return NextResponse.json({ status: "cleared" });
}
