import type { NextRequest } from "next/server";

type RequestWithNextUrl = Request | (NextRequest & { nextUrl: URL });

const ensureProtocol = (protocol: string) => (protocol.endsWith(":") ? protocol : `${protocol}:`);

const cloneUrl = (request: RequestWithNextUrl) => {
  if ("nextUrl" in request) {
    return new URL(request.nextUrl.toString());
  }
  return new URL(request.url);
};

export const resolveUrl = (request: RequestWithNextUrl) => {
  const url = cloneUrl(request);
  const headers = request.headers;
  const forwardedProto = headers.get("x-forwarded-proto");
  const forwardedHost = headers.get("x-forwarded-host") ?? headers.get("host");

  if (forwardedProto) {
    url.protocol = ensureProtocol(forwardedProto);
  }
  if (forwardedHost) {
    url.host = forwardedHost;
  }

  return url;
};

export const resolveOrigin = (request: RequestWithNextUrl) => {
  return resolveUrl(request).origin;
};
