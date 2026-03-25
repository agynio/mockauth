import { headers } from "next/headers";
import type { NextRequest } from "next/server";

export type RequestContext = {
  ipAddress: string | null;
  userAgent: string | null;
};

const MAX_USER_AGENT_LENGTH = 256;

const headerValue = (source: Headers | Record<string, string>, name: string): string | null => {
  if (source instanceof Headers) {
    return source.get(name);
  }

  const entry = Object.entries(source).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry ? entry[1] : null;
};

const normalize = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const firstForwardedFor = (forwarded: string | null): string | null => {
  if (!forwarded) {
    return null;
  }

  for (const candidate of forwarded.split(",")) {
    const normalized = normalize(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
};

const truncateUserAgent = (value: string | null): string | null => {
  const normalized = normalize(value);
  if (!normalized) {
    return null;
  }

  return normalized.length > MAX_USER_AGENT_LENGTH ? normalized.slice(0, MAX_USER_AGENT_LENGTH) : normalized;
};

const buildFromHeaders = (
  headerList: Headers | Record<string, string>,
  ipOverride?: string | null,
): RequestContext => {
  const ipAddress =
    normalize(ipOverride) ??
    firstForwardedFor(headerValue(headerList, "x-forwarded-for")) ??
    normalize(headerValue(headerList, "x-real-ip")) ??
    normalize(headerValue(headerList, "cf-connecting-ip")) ??
    null;

  const userAgent = truncateUserAgent(headerValue(headerList, "user-agent"));

  return {
    ipAddress,
    userAgent,
  } satisfies RequestContext;
};

export const buildRequestContext = (
  headerList: Headers | Record<string, string>,
  ipOverride?: string | null,
): RequestContext => {
  if (headerList instanceof Headers && ipOverride === undefined) {
    return buildFromHeaders(headerList);
  }

  return buildFromHeaders(headerList, ipOverride ?? null);
};

export const getRequestContext = async (): Promise<RequestContext> => {
  try {
    const headerList = await headers();
    return buildFromHeaders(headerList);
  } catch (error) {
    const errorPayload =
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { error: String(error) };
    console.error("Failed to read request context", errorPayload);
    throw error;
  }
};

export const getRequestContextFromRequest = (request: Request | NextRequest): RequestContext => {
  const ipOverride = (request as { ip?: string | null }).ip ?? null;
  return buildFromHeaders(request.headers, ipOverride);
};
