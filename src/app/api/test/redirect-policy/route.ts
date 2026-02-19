import { NextResponse } from "next/server";

import { env } from "@/server/env";
import { allowAnyRedirects, setAllowAnyRedirectOverride } from "@/server/oidc/redirect-policy";

export async function POST(request: Request) {
  if (!env.ENABLE_TEST_ROUTES) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const payload = ((await request.json().catch(() => ({}))) ?? {}) as { allowAny?: boolean | null };
  if (typeof payload.allowAny === "boolean") {
    setAllowAnyRedirectOverride(payload.allowAny);
  } else {
    setAllowAnyRedirectOverride(null);
  }

  return NextResponse.json({ allowAny: allowAnyRedirects() });
}
