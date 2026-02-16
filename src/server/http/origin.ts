import type { NextRequest } from "next/server";

type RequestWithNextUrl = Request | (NextRequest & { nextUrl: URL });

const ensureProtocol = (protocol: string) => (protocol.endsWith(":") ? protocol : `${protocol}:`);

const cloneUrl = (request: RequestWithNextUrl) => {
  if ("nextUrl" in request) {
    return new URL(request.nextUrl.toString());
  }
  return new URL(request.url);
};

const firstHeaderValue = (value: string | null) => value?.split(",")[0]?.trim();

const parseForwardedHeader = (value: string | null) => {
  if (!value) {
    return {} as { proto?: string; host?: string };
  }
  const [first] = value.split(",");
  return first.split(";").reduce<{ proto?: string; host?: string }>((acc, part) => {
    const [rawKey, rawVal] = part.split("=");
    if (!rawKey || !rawVal) {
      return acc;
    }
    const key = rawKey.trim().toLowerCase();
    const normalized = rawVal.trim().replace(/^"|"$/g, "");
    if (key === "proto") {
      acc.proto = normalized;
    }
    if (key === "host") {
      acc.host = normalized;
    }
    return acc;
  }, {});
};

export const resolveUrl = (request: RequestWithNextUrl) => {
  const url = cloneUrl(request);
  const headers = request.headers;
  const forwarded = parseForwardedHeader(headers.get("forwarded"));
  const forwardedProto = firstHeaderValue(headers.get("x-forwarded-proto")) ?? forwarded.proto;
  const forwardedHost = firstHeaderValue(headers.get("x-forwarded-host")) ?? forwarded.host;

  if (forwardedProto) {
    url.protocol = ensureProtocol(forwardedProto);
  }

  if (forwardedHost) {
    url.host = forwardedHost;
    if (!forwardedHost.includes(":")) {
      url.port = "";
    }
  } else {
    const fallbackHost = headers.get("host");
    if (fallbackHost) {
      url.host = fallbackHost;
    }
  }

  return url;
};

export const resolveOrigin = (request: RequestWithNextUrl) => {
  return resolveUrl(request).origin;
};
