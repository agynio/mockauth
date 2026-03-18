/* @vitest-environment node */

import { describe, expect, it } from "vitest";

import {
  buildAuthorizeReceivedDetails,
  buildProxyCallbackErrorDetails,
  buildProxyCodeIssuedDetails,
  buildTokenAuthCodeReceivedDetails,
  sanitizeAuditDetails,
  type AuditEventInput,
} from "@/server/services/audit-event";

const baseEvent = {
  tenantId: "tenant-1",
  clientId: "client-1",
  traceId: "trace-1",
  actorId: null,
  severity: "INFO",
  message: "Audit",
} satisfies Omit<AuditEventInput, "eventType" | "details">;

const sanitize = (event: AuditEventInput) => sanitizeAuditDetails(event) as Record<string, unknown>;

describe("sanitizeAuditDetails", () => {
  it("returns compacted builder details without sensitive fields", () => {
    const details = buildAuthorizeReceivedDetails({
      responseType: "code",
      scope: "openid profile",
      prompt: "login",
      redirectUri: "https://app.example.com/callback",
      state: "state-123",
      nonce: "nonce-123",
      codeChallenge: "challenge-123",
      codeChallengeMethod: "S256",
      loginHint: "user@example.com",
      freshLoginRequested: true,
      includeSensitive: false,
    });
    const event: AuditEventInput = {
      ...baseEvent,
      eventType: "AUTHORIZE_RECEIVED",
      details,
    };

    const sanitized = sanitize(event);
    expect(sanitized).toMatchObject({
      responseType: "code",
      scope: "openid profile",
      codeChallengeMethod: "S256",
      loginHintProvided: true,
      nonceProvided: true,
      freshLoginRequested: true,
    });
    expect(sanitized).not.toHaveProperty("redirectUri");
    expect(sanitized).not.toHaveProperty("state");
  });

  it("returns builder details with sensitive fields", () => {
    const details = buildAuthorizeReceivedDetails({
      responseType: "code",
      scope: "openid profile",
      prompt: "login",
      redirectUri: "https://app.example.com/callback",
      state: "state-123",
      nonce: "nonce-123",
      codeChallenge: "challenge-123",
      codeChallengeMethod: "S256",
      loginHint: "user@example.com",
      freshLoginRequested: true,
      includeSensitive: true,
    });
    const event: AuditEventInput = {
      ...baseEvent,
      eventType: "AUTHORIZE_RECEIVED",
      details,
    };

    const sanitized = sanitize(event);
    expect(sanitized).toMatchObject({
      redirectUri: "https://app.example.com/callback",
      state: "state-123",
      nonce: "nonce-123",
      codeChallenge: "challenge-123",
      codeChallengeMethod: "S256",
      loginHint: "user@example.com",
    });
  });

  it("prefers raw provider errors when includeSensitive is true", () => {
    const details = buildProxyCallbackErrorDetails({
      error: "provider_error",
      errorDescription: "Provider error",
      providerType: "oidc",
      code: "provider-code",
      rawError: "invalid_grant",
      rawErrorDescription: "Invalid grant description",
      includeSensitive: true,
    });
    const event: AuditEventInput = {
      ...baseEvent,
      eventType: "PROXY_CALLBACK_ERROR",
      details,
    };

    const sanitized = sanitize(event);
    expect(sanitized).toMatchObject({
      error: "invalid_grant",
      errorDescription: "Invalid grant description",
      providerType: "oidc",
      code: "provider-code",
    });
    expect(sanitized).not.toHaveProperty("rawError");
  });

  it("captures redirect host for proxy codes", () => {
    const details = buildProxyCodeIssuedDetails({
      scope: "openid",
      redirectUri: "https://proxy.example.com/callback",
    });
    const event: AuditEventInput = {
      ...baseEvent,
      eventType: "PROXY_CODE_ISSUED",
      details,
    };

    const sanitized = sanitize(event);
    expect(sanitized).toMatchObject({
      scope: "openid",
      redirectUriHost: "proxy.example.com",
    });
    expect(sanitized).not.toHaveProperty("redirectUri");
  });

  it("omits sensitive fields when includeSensitive is false", () => {
    const details = buildAuthorizeReceivedDetails({
      responseType: "code",
      scope: "openid",
      prompt: "login",
      redirectUri: "https://app.example.com/callback",
      state: "state-123",
      nonce: "nonce-123",
      codeChallenge: "challenge-123",
      codeChallengeMethod: "S256",
      loginHint: "user@example.com",
      freshLoginRequested: true,
      includeSensitive: false,
    });

    expect(details).toMatchObject({
      responseType: "code",
      scope: "openid",
      codeChallengeMethod: "S256",
      loginHintProvided: true,
    });
    expect(details).not.toHaveProperty("redirectUri");
    expect(details).not.toHaveProperty("loginHint");

    const tokenDetails = buildTokenAuthCodeReceivedDetails({
      authMethod: "client_secret_post",
      clientSecretInBody: true,
      clientIdProvided: true,
      clientId: "client-id",
      clientSecret: "secret",
      grantType: "authorization_code",
      redirectUri: "https://app.example.com/callback",
      authorizationCode: "auth-code",
      includeAuthHeader: true,
      includeSensitive: false,
    });

    expect(tokenDetails).toMatchObject({
      authMethod: "client_secret_post",
      clientSecretInBody: true,
      clientIdProvided: true,
    });
    expect(tokenDetails).not.toHaveProperty("clientSecret");
    expect(tokenDetails).not.toHaveProperty("authorizationCode");
  });
});
