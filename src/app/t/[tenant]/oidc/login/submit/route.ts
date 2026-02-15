import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { toResponse } from "@/server/errors";
import { findOrCreateMockUser } from "@/server/services/mock-user-service";
import { createSession, MOCK_SESSION_COOKIE } from "@/server/services/mock-session-service";
import { getActiveTenantBySlug } from "@/server/services/tenant-service";
import { resolveUrl } from "@/server/http/origin";
import type { TenantRouteContext } from "@/types/tenant-route";

const loginSchema = z.object({
  username: z.string().min(1),
  return_to: z.string().optional(),
});

const sanitizeReturnTo = (value: string | undefined, fallback: URL, currentUrl: URL) => {
  if (!value) {
    return fallback;
  }

  try {
    const parsed = new URL(value);
    if (parsed.origin !== currentUrl.origin) {
      return fallback;
    }
    return parsed;
  } catch {
    return fallback;
  }
};

export async function POST(request: NextRequest, context: TenantRouteContext) {
  const { tenant: tenantSlug } = await context.params;
  const tenant = await getActiveTenantBySlug(tenantSlug);
  const currentUrl = resolveUrl(request);
  const form = await request.formData();
  const data = loginSchema.safeParse({
    username: form.get("username"),
    return_to: form.get("return_to")?.toString(),
  });

  if (!data.success) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const user = await findOrCreateMockUser(tenant.id, data.data.username);
    const token = await createSession(tenant.id, user.id);
    const fallback = new URL(`/t/${tenant.slug}/oidc/authorize`, currentUrl.origin);
    const redirectUrl = sanitizeReturnTo(data.data.return_to, fallback, currentUrl);
    const response = NextResponse.redirect(redirectUrl, 303);
    response.cookies.set({
      name: MOCK_SESSION_COOKIE,
      value: token,
      path: `/t/${tenant.slug}`,
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      maxAge: 60 * 60 * 12,
    });
    return response;
  } catch (error) {
    return toResponse(error);
  }
}
