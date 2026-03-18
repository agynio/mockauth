import { headers } from "next/headers";
import type { NextRequest } from "next/server";

export type RequestContext = {
  ipAddress: string | null;
  userAgent: string | null;
};

const MAX_USER_AGENT_LENGTH = 256;

const extractIpAddress = (headerList: Headers) => {
  const forwarded = headerList.get("x-forwarded-for");
  if (forwarded) {
    const [first] = forwarded.split(",");
    const trimmed = first?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  const realIp = headerList.get("x-real-ip");
  if (realIp?.trim()) {
    return realIp.trim();
  }
  const cfIp = headerList.get("cf-connecting-ip");
  if (cfIp?.trim()) {
    return cfIp.trim();
  }
  return null;
};

const extractUserAgent = (headerList: Headers) => {
  const raw = headerList.get("user-agent");
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.length > MAX_USER_AGENT_LENGTH ? trimmed.slice(0, MAX_USER_AGENT_LENGTH) : trimmed;
};

const buildContext = (headerList: Headers): RequestContext => ({
  ipAddress: extractIpAddress(headerList),
  userAgent: extractUserAgent(headerList),
});

export const getRequestContext = async (): Promise<RequestContext> => {
  try {
    const headerList = await headers();
    return buildContext(headerList);
  } catch {
    return { ipAddress: null, userAgent: null };
  }
};

export const getRequestContextFromRequest = (request: Request | NextRequest): RequestContext => {
  return buildContext(request.headers);
};
