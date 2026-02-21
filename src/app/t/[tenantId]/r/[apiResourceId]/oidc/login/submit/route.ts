import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { toResponse } from "@/server/errors";
import { findOrCreateMockUser } from "@/server/services/mock-user-service";
import { createSession, MOCK_SESSION_COOKIE } from "@/server/services/mock-session-service";
import { getActiveTenantById } from "@/server/services/tenant-service";
import { resolveUrl } from "@/server/http/origin";
import type { TenantResourceRouteContext } from "@/types/tenant-route";
import { getClientForTenant } from "@/server/services/client-service";
import {
  DEFAULT_CLIENT_AUTH_STRATEGIES,
  hasEnabledStrategy,
  parseClientAuthStrategies,
  toPrismaLoginStrategy,
} from "@/server/oidc/auth-strategy";
import type { ClientAuthStrategies } from "@/server/oidc/auth-strategy";

const loginSchema = z.object({
  strategy: z.enum(["username", "email"]).default("username"),
  username: z.string().optional(),
  email: z.string().email().optional(),
  return_to: z.string().optional(),
  email_verified_preference: z.enum(["true", "false"]).optional(),
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

export async function POST(request: NextRequest, context: TenantResourceRouteContext) {
  const { tenantId, apiResourceId } = await context.params;
  const tenant = await getActiveTenantById(tenantId);
  const currentUrl = resolveUrl(request);
  const form = await request.formData();
  const data = loginSchema.safeParse({
    strategy: form.get("strategy")?.toString(),
    username: form.get("username")?.toString(),
    email: form.get("email")?.toString(),
    return_to: form.get("return_to")?.toString(),
    email_verified_preference: form.get("email_verified_preference")?.toString(),
  });

  if (!data.success) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const authorizeUrl = data.data.return_to ? new URL(data.data.return_to, currentUrl.origin) : null;
  const clientId = authorizeUrl?.searchParams.get("client_id");
  if (!clientId) {
    return Response.json({ error: "invalid_client" }, { status: 400 });
  }

  try {
    const client = await getClientForTenant(tenant.id, clientId);
    const strategies = parseClientAuthStrategies(client.authStrategies ?? DEFAULT_CLIENT_AUTH_STRATEGIES);
    if (!hasEnabledStrategy(strategies)) {
      return Response.json({ error: "strategy_disabled" }, { status: 400 });
    }

    const selectedConfig = strategies[data.data.strategy];
    if (!selectedConfig?.enabled) {
      return Response.json({ error: "invalid_strategy" }, { status: 400 });
    }

    const rawIdentifier = data.data.strategy === "username" ? data.data.username : data.data.email;
    const trimmedIdentifier = rawIdentifier?.trim();
    if (!trimmedIdentifier) {
      return Response.json({ error: "missing_identifier" }, { status: 400 });
    }

    const normalizedIdentifier =
      data.data.strategy === "email" ? trimmedIdentifier.toLowerCase() : trimmedIdentifier;
    let emailVerifiedOverride: boolean | undefined;
    if (data.data.strategy === "email") {
      const emailConfig = selectedConfig as ClientAuthStrategies["email"];
      if (emailConfig.emailVerifiedMode === "user_choice") {
        if (!data.data.email_verified_preference) {
          return Response.json({ error: "missing_email_verified_choice" }, { status: 400 });
        }
        emailVerifiedOverride = data.data.email_verified_preference === "true";
      }
    }
    const subject = selectedConfig.subSource === "entered" ? trimmedIdentifier : randomUUID();
    const user = await findOrCreateMockUser(tenant.id, normalizedIdentifier, {
      displayName: trimmedIdentifier,
      email: data.data.strategy === "email" ? normalizedIdentifier : null,
    });
    const token = await createSession(tenant.id, user.id, {
      strategy: toPrismaLoginStrategy(data.data.strategy),
      subject,
      emailVerifiedOverride,
    });
    const fallback = new URL(`/t/${tenant.id}/r/${apiResourceId}/oidc/authorize`, currentUrl.origin);
    const redirectUrl = sanitizeReturnTo(data.data.return_to, fallback, currentUrl);
    const response = NextResponse.redirect(redirectUrl, 303);
    const isSecure = currentUrl.protocol === "https:";
    response.cookies.set({
      name: MOCK_SESSION_COOKIE,
      value: token,
      path: `/t/${tenant.id}`,
      httpOnly: true,
      sameSite: "lax",
      secure: isSecure,
      maxAge: 60 * 60 * 12,
    });
    return response;
  } catch (error) {
    return toResponse(error);
  }
}
