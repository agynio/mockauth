import { describe, expect, it } from "vitest";

import { buildCorsHeaders, preflightResponse, withCorsHeaders } from "@/server/http/cors";

describe("cors", () => {
  it("reflects the origin header", () => {
    const origin = "https://app.example";
    const headers = buildCorsHeaders(new Request("https://mockauth.dev", { headers: { origin } }));

    expect(headers).toEqual({
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Max-Age": "86400",
    });
  });

  it("returns no headers without an origin", () => {
    const headers = buildCorsHeaders(new Request("https://mockauth.dev"));

    expect(headers).toEqual({});
  });

  it("returns a 204 response for preflight", () => {
    const origin = "https://app.example";
    const response = preflightResponse(new Request("https://mockauth.dev", { headers: { origin } }));

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
  });

  it("merges cors headers onto responses", () => {
    const origin = "https://app.example";
    const response = new Response("ok", { headers: { "content-type": "text/plain", "x-original": "value" } });

    const wrapped = withCorsHeaders(response, new Request("https://mockauth.dev", { headers: { origin } }));

    expect(wrapped.headers.get("x-original")).toBe("value");
    expect(wrapped.headers.get("Access-Control-Allow-Origin")).toBe(origin);
  });
});
