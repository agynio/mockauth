import type { NextRequest } from "next/server";

type RequestWithNextUrl = Request | (NextRequest & { nextUrl: URL });

const ensureProtocol = (protocol: string) => (protocol.endsWith(":") ? protocol : `${protocol}:`);

const cloneUrl = (request: RequestWithNextUrl) => {
  if ("nextUrl" in request) {
    return new URL(request.nextUrl.toString());
  }
  return new URL(request.url);
};

const maybeApplyPublicOrigin = (url: URL) => {
  const fallback = process.env.NEXTAUTH_URL;
  if (!fallback) {
    return url;
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") {
    try {
      const fallbackUrl = new URL(fallback);
      url.protocol = fallbackUrl.protocol;
      url.host = fallbackUrl.host;
      url.port = fallbackUrl.port;
    } catch {
      return url;
    }
  }
  return url;
};

export const resolveUrl = (request: RequestWithNextUrl) => {
  const url = cloneUrl(request);
  const headers = request.headers;
  const forwardedProto = headers.get("x-forwarded-proto");
  const forwardedHostHeader = headers.get("x-forwarded-host") ?? headers.get("host");

  if (forwardedProto) {
    url.protocol = ensureProtocol(forwardedProto);
  }
  if (forwardedHostHeader) {
    const [rawHost] = forwardedHostHeader.split(",");
    const host = rawHost.trim();
    url.host = host;
    const hasExplicitPort = host.includes(":") && !host.endsWith("]");
    if (!hasExplicitPort) {
      url.port = "";
    }
  }

  return maybeApplyPublicOrigin(url);
};

export const resolveOrigin = (request: RequestWithNextUrl) => {
  return resolveUrl(request).origin;
};
