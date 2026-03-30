import { URLSearchParams } from "node:url";

import { decodeJwt } from "jose";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { encrypt, decrypt } from "@/server/crypto/key-vault";
import { DomainError } from "@/server/errors";
import { requestProviderTokens } from "@/server/services/proxy-service";

type ProviderTokenResponse = Record<string, unknown>;

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
  } catch {
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
  const { subject, email } = extractProviderMetadata(params.providerResponse);
  const label = resolveIdentityLabel(params.label, subject, email);
  const accessTokenExpiresAt = extractAccessTokenExpiresAt(params.providerResponse, now);
  const refreshTokenExpiresAt = extractRefreshTokenExpiresAt(params.providerResponse, now);
  const encrypted = encrypt(JSON.stringify(params.providerResponse));

  return prisma.preauthorizedIdentity.create({
    data: {
      tenantId: params.tenantId,
      clientId: params.clientId,
      label,
      providerSubject: subject,
      providerEmail: email,
      providerScope: params.providerScope,
      providerResponseEncrypted: encrypted,
      accessTokenExpiresAt,
      refreshTokenExpiresAt,
    },
  });
};

export const refreshPreauthorizedIdentity = async (params: {
  tenantId: string;
  clientId: string;
  identityId: string;
  now?: Date;
}) => {
  const now = params.now ?? new Date();
  const identity = await getPreauthorizedIdentityWithClient(params.tenantId, params.clientId, params.identityId);
  if (identity.client.oauthClientMode !== "preauthorized") {
    throw new DomainError("Client is not preauthorized", { status: 400 });
  }

  const config = identity.client.proxyConfig;
  if (!config) {
    throw new DomainError("Proxy configuration missing", { status: 500 });
  }

  const storedResponse = JSON.parse(decrypt(identity.providerResponseEncrypted)) as ProviderTokenResponse;
  const refreshToken = extractRefreshToken(storedResponse);
  if (!refreshToken) {
    throw new DomainError("Refresh token missing for preauthorized identity", { status: 400 });
  }

  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", refreshToken);
  body.set("client_id", config.upstreamClientId);
  if (identity.providerScope) {
    body.set("scope", identity.providerScope);
  }

  const response = await requestProviderTokens(config, body);
  if (response.jsonParseError) {
    throw new DomainError("Provider token response was not JSON", { status: 502 });
  }
  if (!response.json) {
    throw new DomainError("Provider token response missing", { status: 502 });
  }
  if (!response.ok) {
    const errorMessage =
      typeof response.json.error_description === "string"
        ? response.json.error_description
        : "Provider rejected refresh_token";
    throw new DomainError(errorMessage, { status: 400 });
  }

  const incomingRefreshToken = extractRefreshToken(response.json);
  const mergedResponse: ProviderTokenResponse = {
    ...response.json,
    refresh_token:
      incomingRefreshToken && incomingRefreshToken.trim().length > 0 ? incomingRefreshToken : refreshToken,
  };
  const { subject, email } = extractProviderMetadata(mergedResponse);
  const accessTokenExpiresAt = extractAccessTokenExpiresAt(mergedResponse, now);
  const refreshTokenExpiresAt = extractRefreshTokenExpiresAt(mergedResponse, now);
  const encrypted = encrypt(JSON.stringify(mergedResponse));

  const updated = await prisma.preauthorizedIdentity.update({
    where: { id: identity.id },
    data: {
      providerResponseEncrypted: encrypted,
      providerSubject: subject,
      providerEmail: email,
      accessTokenExpiresAt,
      refreshTokenExpiresAt,
    },
  });

  return { identity: updated, providerResponse: mergedResponse };
};

export const resolvePreauthorizedIdentityTokens = async (params: {
  tenantId: string;
  clientId: string;
  identityId: string;
  now?: Date;
}): Promise<{ identity: PreauthorizedIdentityWithClient; providerResponse: ProviderTokenResponse }> => {
  const now = params.now ?? new Date();
  const identity = await getPreauthorizedIdentityWithClient(params.tenantId, params.clientId, params.identityId);
  const providerResponse = JSON.parse(decrypt(identity.providerResponseEncrypted)) as ProviderTokenResponse;

  if (identity.accessTokenExpiresAt && identity.accessTokenExpiresAt <= now) {
    const refreshed = await refreshPreauthorizedIdentity({
      tenantId: params.tenantId,
      clientId: params.clientId,
      identityId: params.identityId,
      now,
    });
    const refreshedIdentity = await getPreauthorizedIdentityWithClient(params.tenantId, params.clientId, params.identityId);
    return { identity: refreshedIdentity, providerResponse: refreshed.providerResponse };
  }

  return { identity, providerResponse };
};
