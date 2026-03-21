type CorsHeaderMap = Record<string, string>;

export const buildCorsHeaders = (request: Request): CorsHeaderMap => {
  const origin = request.headers.get("origin");
  if (!origin) {
    return {};
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
  };
};

export const preflightResponse = (request: Request): Response => {
  return new Response(null, { status: 204, headers: buildCorsHeaders(request) });
};

export const withCorsHeaders = (response: Response, request: Request): Response => {
  const corsHeaders = buildCorsHeaders(request);
  for (const [key, value] of Object.entries(corsHeaders)) {
    response.headers.set(key, value);
  }
  return response;
};
