import { URLSearchParams } from "node:url";

import { decodeJwt } from "jose";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { encrypt, decrypt } from "@/server/crypto/key-vault";
import { DomainError } from "@/server/errors";
import { resolveUpstreamAuthMethod } from "@/server/oidc/token-auth-method";
import { emitAuditEvent } from "@/server/services/audit-service";
import {
  buildPreauthorizedIdentityDetails,
  buildProxyCallbackErrorDetails,
  buildProxyCallbackSuccessDetails,
  buildProxyFlowDiagnostics,
  buildProviderTokenExchangeDiagnostics,
  toTokenResponsePayload,
} from "@/server/services/audit-event";
import { requestProviderTokens } from "@/server/services/proxy-service";
import { sanitizeProviderError, sanitizeProviderErrorDescription } from "@/server/services/proxy-utils";
import type { RequestContext } from "@/server/utils/request-context";
import { searchParamsToRecord } from "@/server/utils/search-params";

type ProviderTokenResponse = Record<string, unknown>;

const PREAUTHORIZED_TOKEN_REFRESH_BUFFER_SECONDS = 60;

const parseExpiresIn = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 ? Math.floor(value) : null;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
};

const resolveExpiresAt = (expiresIn: number | null, now: Date) => {
  if (!expiresIn) {
    return null;
  }
  return new Date(now.getTime() + expiresIn * 1000);
};

const extractIdTokenClaims = (idToken: string) => {
  try {
    const decoded = decodeJwt(idToken);
    const subject = typeof decoded.sub === "string" ? decoded.sub : null;
    const email = typeof decoded.email === "string" ? decoded.email : null;
    return { subject, email };
  } catch (error) {
    const errorPayload =
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { error: String(error) };
    console.warn("Failed to decode provider id_token", errorPayload);
    return { subject: null, email: null };
  }
};

const resolveIdentityLabel = (label: string | null | undefined, subject: string | null, email: string | null) => {
  const normalized = label?.trim();
  if (normalized) {
    return normalized;
  }
  if (email) {
    return email;
  }
  if (subject) {
    return subject;
  }
  return null;
};

const extractRefreshToken = (response: ProviderTokenResponse) => {
  return typeof response.refresh_token === "string" ? response.refresh_token : null;
};

const extractProviderMetadata = (response: ProviderTokenResponse) => {
  const idToken = typeof response.id_token === "string" ? response.id_token : null;
  if (!idToken) {
    return { subject: null, email: null };
  }
  return extractIdTokenClaims(idToken);
};

const resolveProviderMetadata = (
  response: ProviderTokenResponse,
  fallback?: { subject: string; email: string | null },
) => {
  const { subject, email } = extractProviderMetadata(response);
  return {
    subject: subject ?? fallback?.subject ?? null,
    email: email ?? fallback?.email ?? null,
  };
};

const requireProviderSubject = (subject: string | null) => {
  if (!subject) {
    throw new DomainError("Provider id_token subject missing", { status: 502 });
  }
  return subject;
};

const extractAccessTokenExpiresAt = (response: ProviderTokenResponse, now: Date) => {
  const expiresIn = parseExpiresIn(response.expires_in);
  return resolveExpiresAt(expiresIn, now);
};

const extractRefreshTokenExpiresAt = (response: ProviderTokenResponse, now: Date) => {
  const refreshExpiresIn = parseExpiresIn(response.refresh_token_expires_in ?? response.refresh_expires_in);
  return resolveExpiresAt(refreshExpiresIn, now);
};

const preauthorizedIdentityInclude = {
  client: { include: { proxyConfig: true } },
} satisfies Prisma.PreauthorizedIdentityInclude;

export type PreauthorizedIdentityWithClient = Prisma.PreauthorizedIdentityGetPayload<{
  include: typeof preauthorizedIdentityInclude;
}>;

export const listPreauthorizedIdentities = async (tenantId: string, clientId: string) => {
  return prisma.preauthorizedIdentity.findMany({
    where: { tenantId, clientId },
    orderBy: { createdAt: "desc" },
  });
};

export const getPreauthorizedIdentityWithClient = async (
  tenantId: string,
  clientId: string,
  identityId: string,
): Promise<PreauthorizedIdentityWithClient> => {
  const identity = await prisma.preauthorizedIdentity.findFirst({
    where: { id: identityId, tenantId, clientId },
    include: preauthorizedIdentityInclude,
  });
  if (!identity) {
    throw new DomainError("Preauthorized identity not found", { status: 404 });
  }
  return identity;
};

export const createPreauthorizedIdentity = async (params: {
  tenantId: string;
  clientId: string;
  label?: string | null;
  providerScope: string;
  providerResponse: ProviderTokenResponse;
  now?: Date;
}) => {
  const now = params.now ?? new Date();
  const { subject, email } = resolveProviderMetadata(params.providerResponse);
  const providerSubject = requireProviderSubject(subject);
  const label = resolveIdentityLabel(params.label, providerSubject, email);
  const accessTokenExpiresAt = extractAccessTokenExpiresAt(params.providerResponse, now);
  const refreshTokenExpiresAt = extractRefreshTokenExpiresAt(params.providerResponse, now);
  const encrypted = encrypt(JSON.stringify(params.providerResponse));

  const existing = await prisma.preauthorizedIdentity.findFirst({
    where: { clientId: params.clientId, providerSubject },
    select: { id: true },
  });
  if (existing) {
    throw new DomainError("Preauthorized identity already exists", { status: 409 });
  }

  return prisma.preauthorizedIdentity.create({
    data: {
      tenantId: params.tenantId,
      clientId: params.clientId,
      label,
      providerSubject,
      providerEmail: email,
      providerScope: params.providerScope,
      providerResponseEncrypted: encrypted,
      accessTokenExpiresAt,
      refreshTokenExpiresAt,
    },
  });
};

export const deletePreauthorizedIdentity = async (params: {
  identity: {
    id: string;
    tenantId: string;
    clientId: string;
    label: string | null;
    providerSubject: string;
    providerEmail: string | null;
    providerScope: string;
  };
  actorId?: string | null;
  requestContext?: RequestContext;
}) => {
  await prisma.preauthorizedIdentity.delete({ where: { id: params.identity.id } });
  await emitAuditEvent({
    tenantId: params.identity.tenantId,
    clientId: params.identity.clientId,
    traceId: params.identity.id,
    actorId: params.actorId ?? null,
    eventType: "PREAUTHORIZED_IDENTITY_DELETED",
    severity: "INFO",
    message: "Preauthorized identity deleted",
    details: buildPreauthorizedIdentityDetails({
      identityId: params.identity.id,
      label: params.identity.label,
      providerSubject: params.identity.providerSubject,
      providerEmail: params.identity.providerEmail,
      providerScope: params.identity.providerScope,
    }),
    requestContext: params.requestContext ?? null,
  });
};

export const refreshPreauthorizedIdentity = async (params: {
  tenantId: string;
  clientId: string;
  identityId: string;
  now?: Date;
  actorId?: string | null;
  requestContext?: RequestContext;
}): Promise<{ identity: PreauthorizedIdentityWithClient; providerResponse: ProviderTokenResponse }> => {
  const now = params.now ?? new Date();
  const identity = await getPreauthorizedIdentityWithClient(params.tenantId, params.clientId, params.identityId);
  const proxyConfig = identity.client.proxyConfig;
  const exchangeDiagnostics = proxyConfig
    ? buildProviderTokenExchangeDiagnostics({
        tokenEndpoint: proxyConfig.tokenEndpoint,
        authMethod: resolveUpstreamAuthMethod(proxyConfig.upstreamTokenEndpointAuthMethod),
        clientId: proxyConfig.upstreamClientId,
        grantType: "refresh_token",
      })
    : null;

  const failRefresh = async (options: {
    message: string;
    error: string;
    errorDescription?: string | null;
    status: number;
    code?: string;
    rawError?: string | null;
    rawErrorDescription?: string | null;
    diagnostics?: ReturnType<typeof buildProxyFlowDiagnostics> | null;
  }): Promise<never> => {
    await emitAuditEvent({
      tenantId: identity.tenantId,
      clientId: identity.clientId,
      traceId: identity.id,
      actorId: params.actorId ?? null,
      eventType: "PREAUTHORIZED_TOKEN_REFRESH_FAILED",
      severity: "ERROR",
      message: options.message,
      details: buildProxyCallbackErrorDetails({
        error: options.error,
        errorDescription: options.errorDescription ?? undefined,
        providerType: proxyConfig?.providerType,
        rawError: options.rawError ?? undefined,
        rawErrorDescription: options.rawErrorDescription ?? undefined,
        diagnostics: options.diagnostics ?? undefined,
        ...(exchangeDiagnostics ?? {}),
      }),
      requestContext: params.requestContext ?? null,
    });

    throw new DomainError(options.errorDescription ?? options.message, {
      status: options.status,
      code: options.code,
    });
  };

  if (identity.client.oauthClientMode !== "preauthorized") {
    return failRefresh({
      message: "Client is not preauthorized",
      error: "client_not_preauthorized",
      status: 400,
    });
  }

  if (!proxyConfig) {
    return failRefresh({
      message: "Proxy configuration missing",
      error: "config_missing",
      status: 500,
    });
  }

  const storedResponse = JSON.parse(decrypt(identity.providerResponseEncrypted)) as ProviderTokenResponse;
  const refreshToken = extractRefreshToken(storedResponse);
  if (!refreshToken) {
    return failRefresh({
      message: "Refresh token missing for preauthorized identity",
      error: "missing_refresh_token",
      status: 400,
      code: "invalid_request",
    });
  }

  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", refreshToken);
  body.set("client_id", proxyConfig.upstreamClientId);
  if (identity.providerScope) {
    body.set("scope", identity.providerScope);
  }
  const requestParams = searchParamsToRecord(body);

  let response;
  try {
    response = await requestProviderTokens(proxyConfig, body);
  } catch (error) {
    const errorCode = error instanceof DomainError && error.options.code ? error.options.code : "server_error";
    const description = sanitizeProviderErrorDescription(
      error instanceof Error ? error.message : typeof error === "string" ? error : String(error),
    );
    return failRefresh({
      message: "Provider token exchange failed",
      error: sanitizeProviderError(errorCode),
      errorDescription: description,
      status: error instanceof DomainError ? error.options.status ?? 502 : 502,
      code: error instanceof DomainError ? error.options.code : undefined,
    });
  }

  const diagnostics = buildProxyFlowDiagnostics({
    stage: "token",
    request: response.request,
    response: {
      status: response.status,
      headers: response.headers,
      body: response.rawBody,
    },
    params: requestParams,
    meta: { clientId: identity.client.clientId, traceId: identity.id },
  });

  if (response.jsonParseError) {
    return failRefresh({
      message: "Provider token response was not JSON",
      error: "invalid_token_response",
      status: 502,
      diagnostics,
    });
  }

  if (!response.json) {
    return failRefresh({
      message: "Provider token response missing",
      error: "missing_token_response",
      status: 502,
      diagnostics,
    });
  }

  if (!response.ok) {
    const rawError = typeof response.json.error === "string" ? response.json.error : undefined;
    const rawDescription =
      typeof response.json.error_description === "string" ? response.json.error_description : undefined;
    const providerError = sanitizeProviderError(rawError);
    const description = sanitizeProviderErrorDescription(rawDescription);
    return failRefresh({
      message: "Provider rejected refresh_token",
      error: providerError,
      errorDescription: description,
      status: 400,
      code: providerError,
      rawError,
      rawErrorDescription: rawDescription,
      diagnostics,
    });
  }

  const incomingRefreshToken = extractRefreshToken(response.json);
  const mergedResponse: ProviderTokenResponse = {
    ...response.json,
    refresh_token:
      incomingRefreshToken && incomingRefreshToken.trim().length > 0 ? incomingRefreshToken : refreshToken,
  };
  const { subject, email } = resolveProviderMetadata(mergedResponse, {
    subject: identity.providerSubject,
    email: identity.providerEmail,
  });
  const providerSubject = requireProviderSubject(subject);
  const accessTokenExpiresAt = extractAccessTokenExpiresAt(mergedResponse, now);
  const refreshTokenExpiresAt = extractRefreshTokenExpiresAt(mergedResponse, now);
  const encrypted = encrypt(JSON.stringify(mergedResponse));

  const updated = await prisma.preauthorizedIdentity.update({
    where: { id: identity.id },
    data: {
      providerResponseEncrypted: encrypted,
      providerSubject,
      providerEmail: email,
      accessTokenExpiresAt,
      refreshTokenExpiresAt,
    },
    include: preauthorizedIdentityInclude,
  });

  await emitAuditEvent({
    tenantId: identity.tenantId,
    clientId: identity.clientId,
    traceId: identity.id,
    actorId: params.actorId ?? null,
    eventType: "PREAUTHORIZED_TOKEN_REFRESH_SUCCESS",
    severity: "INFO",
    message: "Preauthorized tokens refreshed",
    details: buildProxyCallbackSuccessDetails({
      providerType: proxyConfig.providerType,
      providerResponse: toTokenResponsePayload(mergedResponse),
      diagnostics,
    }),
    requestContext: params.requestContext ?? null,
  });

  return { identity: updated, providerResponse: mergedResponse };
};

export const resolvePreauthorizedIdentityTokens = async (params: {
  tenantId: string;
  clientId: string;
  identityId: string;
  now?: Date;
  actorId?: string | null;
  requestContext?: RequestContext;
}): Promise<{ identity: PreauthorizedIdentityWithClient; providerResponse: ProviderTokenResponse }> => {
  const now = params.now ?? new Date();
  const identity = await getPreauthorizedIdentityWithClient(params.tenantId, params.clientId, params.identityId);

  const refreshDeadline = new Date(
    now.getTime() + PREAUTHORIZED_TOKEN_REFRESH_BUFFER_SECONDS * 1000,
  );
  if (identity.accessTokenExpiresAt && identity.accessTokenExpiresAt <= refreshDeadline) {
    return refreshPreauthorizedIdentity({
      tenantId: params.tenantId,
      clientId: params.clientId,
      identityId: params.identityId,
      now,
      actorId: params.actorId ?? null,
      requestContext: params.requestContext,
    });
  }

  const providerResponse = JSON.parse(decrypt(identity.providerResponseEncrypted)) as ProviderTokenResponse;
  return { identity, providerResponse };
};
