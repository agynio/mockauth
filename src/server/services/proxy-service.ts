import { addMinutes } from "date-fns";

import { Prisma, type ProxyProviderConfig } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { generateOpaqueToken, hashOpaqueToken } from "@/server/crypto/opaque-token";
import { DomainError } from "@/server/errors";
import { encrypt, decrypt } from "@/server/crypto/key-vault";
import { isLinkedInTokenEndpoint } from "@/lib/upstream-provider";

const PROXY_TRANSACTION_TTL_MINUTES = 5;
const PROXY_TOKEN_EXCHANGE_TTL_MINUTES = 5;
const PROXY_AUTH_CODE_TTL_MINUTES = 10;

export const PROXY_TRANSACTION_TTL_SECONDS = PROXY_TRANSACTION_TTL_MINUTES * 60;
export const PROXY_AUTH_CODE_TTL_SECONDS = PROXY_AUTH_CODE_TTL_MINUTES * 60;

type StartProxyAuthTransactionArgs = {
  tenantId: string;
  apiResourceId: string;
  clientId: string;
  redirectUri: string;
  appState?: string | null;
  appNonce?: string | null;
  appScope: string;
  appCodeChallenge: string;
  appCodeChallengeMethod: string;
  providerScope: string;
  providerCodeVerifier?: string | null;
  providerPkceEnabled: boolean;
  prompt?: string | null;
  loginHint?: string | null;
  now?: Date;
};

export const startProxyAuthTransaction = async (args: StartProxyAuthTransactionArgs) => {
  const now = args.now ?? new Date();
  return prisma.proxyAuthTransaction.create({
    data: {
      tenantId: args.tenantId,
      apiResourceId: args.apiResourceId,
      clientId: args.clientId,
      redirectUri: args.redirectUri,
      appState: args.appState ?? null,
      appNonce: args.appNonce ?? null,
      appScope: args.appScope,
      appCodeChallenge: args.appCodeChallenge,
      appCodeChallengeMethod: args.appCodeChallengeMethod,
      providerScope: args.providerScope,
      providerCodeVerifier: args.providerCodeVerifier ?? null,
      providerPkceEnabled: args.providerPkceEnabled,
      prompt: args.prompt ?? null,
      loginHint: args.loginHint ?? null,
      expiresAt: addMinutes(now, PROXY_TRANSACTION_TTL_MINUTES),
    },
  });
};

const proxyTransactionInclude = {
  client: { include: { proxyConfig: true } },
  tenant: true,
  apiResource: true,
} satisfies Prisma.ProxyAuthTransactionInclude;

export type ProxyAuthTransactionWithRelations = Prisma.ProxyAuthTransactionGetPayload<{ include: typeof proxyTransactionInclude }>;

export const getProxyAuthTransaction = async (id: string): Promise<ProxyAuthTransactionWithRelations | null> => {
  return prisma.proxyAuthTransaction.findUnique({
    where: { id },
    include: proxyTransactionInclude,
  });
};

export const markProxyTransactionCompleted = async (id: string) => {
  await prisma.proxyAuthTransaction.update({
    where: { id },
    data: { expiresAt: new Date() },
  });
};

type StoreProxyTokenExchangeArgs = {
  tenantId: string;
  apiResourceId: string;
  clientId: string;
  transactionId: string | null;
  providerResponse: Record<string, unknown>;
  now?: Date;
};

const proxyTokenExchangeInclude = {
  transaction: true,
} satisfies Prisma.ProxyTokenExchangeInclude;

export type ProxyTokenExchangeRecord = Prisma.ProxyTokenExchangeGetPayload<{ include: typeof proxyTokenExchangeInclude }>;

export const storeProxyTokenExchange = async (args: StoreProxyTokenExchangeArgs): Promise<ProxyTokenExchangeRecord> => {
  const now = args.now ?? new Date();
  const payload = encrypt(JSON.stringify(args.providerResponse));
  return prisma.proxyTokenExchange.create({
    data: {
      tenantId: args.tenantId,
      apiResourceId: args.apiResourceId,
      clientId: args.clientId,
      transactionId: args.transactionId,
      providerResponseEncrypted: payload,
      expiresAt: addMinutes(now, PROXY_TOKEN_EXCHANGE_TTL_MINUTES),
    },
    include: proxyTokenExchangeInclude,
  });
};

type CreateProxyAuthorizationCodeArgs = {
  tenantId: string;
  apiResourceId: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  nonce?: string | null;
  state?: string | null;
  codeChallenge: string;
  codeChallengeMethod: string;
  tokenExchangeId: string;
  now?: Date;
};

export const createProxyAuthorizationCode = async (args: CreateProxyAuthorizationCodeArgs) => {
  const code = generateOpaqueToken();
  const now = args.now ?? new Date();
  await prisma.proxyAuthorizationCode.create({
    data: {
      tenantId: args.tenantId,
      apiResourceId: args.apiResourceId,
      clientId: args.clientId,
      redirectUri: args.redirectUri,
      scope: args.scope,
      nonce: args.nonce ?? null,
      state: args.state ?? null,
      codeChallenge: args.codeChallenge,
      codeChallengeMethod: args.codeChallengeMethod,
      tokenExchangeId: args.tokenExchangeId,
      expiresAt: addMinutes(now, PROXY_AUTH_CODE_TTL_MINUTES),
      codeHash: hashOpaqueToken(code),
    },
  });

  return code;
};

const proxyAuthorizationCodeInclude = {
  tenant: true,
  apiResource: true,
  client: { include: { proxyConfig: true, redirectUris: true } },
  tokenExchange: { include: { transaction: true } },
} satisfies Prisma.ProxyAuthorizationCodeInclude;

export type ProxyAuthorizationCodeWithRelations = Prisma.ProxyAuthorizationCodeGetPayload<{
  include: typeof proxyAuthorizationCodeInclude;
}>;

export type ConsumedProxyAuthorizationCode = {
  record: ProxyAuthorizationCodeWithRelations;
  providerResponse: Record<string, unknown>;
};

export const consumeProxyAuthorizationCode = async (code: string): Promise<ConsumedProxyAuthorizationCode> => {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const record = await tx.proxyAuthorizationCode.findUnique({
      where: { codeHash: hashOpaqueToken(code) },
      include: proxyAuthorizationCodeInclude,
    });

    if (!record) {
      throw new DomainError("Invalid authorization code", { status: 400, code: "invalid_grant" });
    }

    if (record.consumedAt || record.expiresAt < now) {
      throw new DomainError("Authorization code expired", { status: 400, code: "invalid_grant" });
    }

    if (!record.tokenExchange || record.tokenExchange.consumedAt || record.tokenExchange.expiresAt < now) {
      throw new DomainError("Token exchange expired", { status: 400, code: "invalid_grant" });
    }

    await tx.proxyAuthorizationCode.update({
      where: { id: record.id },
      data: { consumedAt: now },
    });

    await tx.proxyTokenExchange.update({
      where: { id: record.tokenExchangeId },
      data: { consumedAt: now },
    });

    const providerResponse = JSON.parse(decrypt(record.tokenExchange.providerResponseEncrypted)) as Record<string, unknown>;

    return { record, providerResponse } satisfies ConsumedProxyAuthorizationCode;
  });
};

export const deleteProxyAuthTransaction = async (id: string) => {
  await prisma.proxyAuthTransaction.delete({ where: { id } }).catch((error) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return;
    }
    throw error;
  });
};

export const isProxyAuthorizationCode = async (code: string): Promise<boolean> => {
  const record = await prisma.proxyAuthorizationCode.findUnique({
    where: { codeHash: hashOpaqueToken(code) },
    select: { id: true },
  });

  return Boolean(record);
};

type ProviderTokenResponse = {
  ok: boolean;
  status: number;
  json: Record<string, unknown>;
};

export const requestProviderTokens = async (
  config: ProxyProviderConfig,
  body: URLSearchParams,
): Promise<ProviderTokenResponse> => {
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };

  const params = new URLSearchParams(body);
  params.set("client_id", config.upstreamClientId);

  const isLinkedInEndpoint = isLinkedInTokenEndpoint(config.tokenEndpoint);
  const configuredAuthMethod = config.upstreamTokenEndpointAuthMethod ?? "client_secret_basic";
  const authMethod = isLinkedInEndpoint ? "client_secret_post" : configuredAuthMethod;
  let authorization: string | null = null;

  const readUpstreamSecret = (method: "client_secret_basic" | "client_secret_post") => {
    if (!config.upstreamClientSecretEncrypted) {
      throw new DomainError(`Provider client secret is required for ${method}`, { status: 500 });
    }
    return decrypt(config.upstreamClientSecretEncrypted);
  };

  params.delete("client_secret");

  if (authMethod === "client_secret_basic") {
    const secret = readUpstreamSecret("client_secret_basic");
    authorization = `Basic ${Buffer.from(`${config.upstreamClientId}:${secret}`).toString("base64")}`;
  } else if (authMethod === "client_secret_post") {
    const secret = readUpstreamSecret("client_secret_post");
    params.set("client_secret", secret);
  }

  if (isLinkedInEndpoint) {
    authorization = null;
    if (!params.has("client_secret")) {
      const secret = readUpstreamSecret("client_secret_post");
      params.set("client_secret", secret);
    }
    console.debug("proxy_provider_token_request_override", {
      upstreamProvider: "linkedin",
      enforcedAuthMethod: "client_secret_post",
    });
  }

  const includeAuthHeader = Boolean(authorization);
  const includeClientSecretInBody = params.has("client_secret");
  const hasClientId = params.has("client_id");
  const grantType = params.get("grant_type");
  const includesRedirectUri = params.has("redirect_uri");
  const includesCode = params.has("code");
  const includesRefreshToken = params.has("refresh_token");
  const upstreamProvider = isLinkedInEndpoint ? "linkedin" : config.providerType;
  const enforcedAuthMethod = isLinkedInEndpoint ? "client_secret_post" : null;

  console.debug("proxy_provider_token_request", {
    provider: config.providerType,
    authMethod,
    includeAuthHeader,
    includeClientSecretInBody,
    hasClientId,
    grantType,
    includesRedirectUri,
    includesCode,
    includesRefreshToken,
    upstreamProvider,
    enforcedAuthMethod,
  });

  const response = await fetch(config.tokenEndpoint, {
    method: "POST",
    headers: authorization ? { ...headers, authorization } : headers,
    body: params,
  });

  const json = (await response.json().catch(() => {
    throw new DomainError("Provider token response was not JSON", { status: 502 });
  })) as Record<string, unknown>;

  return { ok: response.ok, status: response.status, json };
};
