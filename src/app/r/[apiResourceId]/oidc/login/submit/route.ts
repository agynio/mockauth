import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { env } from "@/server/env";
import { toResponse } from "@/server/errors";
import { findOrCreateMockUser } from "@/server/services/mock-user-service";
import { createSession, MOCK_SESSION_COOKIE } from "@/server/services/mock-session-service";
import { resolveUrl } from "@/server/http/origin";
import type { ApiResourceRouteContext } from "@/types/api-resource-route";
import { getClientForTenant } from "@/server/services/client-service";
import {
  DEFAULT_CLIENT_AUTH_STRATEGIES,
  hasEnabledStrategy,
  parseClientAuthStrategies,
  toPrismaLoginStrategy,
} from "@/server/oidc/auth-strategy";
import type { ClientAuthStrategies } from "@/server/oidc/auth-strategy";
import { getApiResourceWithTenant } from "@/server/services/api-resource-service";
import { resolveStableSubject } from "@/server/services/mock-identity-service";
import { hashOpaqueToken } from "@/server/crypto/opaque-token";
import {
  buildReauthCookiePath,
  createFreshLoginCookieValue,
  createReauthCookieValue,
  FRESH_LOGIN_COOKIE_TTL_SECONDS,
  MOCK_FRESH_LOGIN_COOKIE,
  MOCK_REAUTH_COOKIE,
} from "@/server/oidc/reauth-cookie";
import { parseAuthorizeReturnTo, resolveAuthorizeReturnTo } from "@/server/oidc/return-to";

const loginSchema = z.object({
  strategy: z.enum(["username", "email"]).default("username"),
  username: z.string().optional(),
  email: z.string().email().optional(),
  return_to: z.string().optional(),
  email_verified_preference: z.enum(["true", "false"]).optional(),
});

export async function POST(request: NextRequest, context: ApiResourceRouteContext) {
  const { apiResourceId } = await context.params;
  const { tenant, resource } = await getApiResourceWithTenant(apiResourceId);
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

  const authorizeUrl = parseAuthorizeReturnTo(data.data.return_to, {
    apiResourceId: resource.id,
    origin: currentUrl.origin,
  });
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
    const subject =
      selectedConfig.subSource === "entered"
        ? trimmedIdentifier
        : await resolveStableSubject({
            tenantId: tenant.id,
            strategy: data.data.strategy,
            identifier: normalizedIdentifier,
            email: data.data.strategy === "email" ? normalizedIdentifier : undefined,
          });
    const user = await findOrCreateMockUser(tenant.id, normalizedIdentifier, {
      displayName: trimmedIdentifier,
      email: data.data.strategy === "email" ? normalizedIdentifier : null,
    });
    const token = await createSession(tenant.id, user.id, {
      strategy: toPrismaLoginStrategy(data.data.strategy),
      subject,
      emailVerifiedOverride,
    });
    const sessionHash = hashOpaqueToken(token);
    const reauthTtlSeconds = client.reauthTtlSeconds ?? 0;
    const redirectUrl = resolveAuthorizeReturnTo(data.data.return_to, {
      apiResourceId: resource.id,
      origin: currentUrl.origin,
    });
    redirectUrl.searchParams.set("fresh_login", "1");
    const response = NextResponse.redirect(redirectUrl, 303);
    const isSecure = currentUrl.protocol === "https:";
    response.cookies.set({
      name: MOCK_SESSION_COOKIE,
      value: token,
      path: "/r",
      httpOnly: true,
      sameSite: "lax",
      secure: isSecure,
      maxAge: env.MOCKAUTH_SESSION_TTL_SECONDS,
    });
    const reauthCookieValue = createReauthCookieValue({
      tenantId: tenant.id,
      apiResourceId: resource.id,
      clientId: client.clientId,
      sessionHash,
      ttlSeconds: reauthTtlSeconds,
    });
    response.cookies.set({
      name: MOCK_REAUTH_COOKIE,
      value: reauthCookieValue ?? "",
      path: buildReauthCookiePath(resource.id),
      httpOnly: true,
      sameSite: "lax",
      secure: isSecure,
      maxAge: reauthCookieValue ? reauthTtlSeconds : 0,
    });
    const freshLoginCookieValue = createFreshLoginCookieValue({
      tenantId: tenant.id,
      apiResourceId: resource.id,
      clientId: client.clientId,
      sessionHash,
    });
    response.cookies.set({
      name: MOCK_FRESH_LOGIN_COOKIE,
      value: freshLoginCookieValue,
      path: buildReauthCookiePath(resource.id),
      httpOnly: true,
      sameSite: "lax",
      secure: isSecure,
      maxAge: FRESH_LOGIN_COOKIE_TTL_SECONDS,
    });
    return response;
  } catch (error) {
    return toResponse(error);
  }
}
