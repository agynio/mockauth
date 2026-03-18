/* @vitest-environment node */

import { describe, expect, it } from "vitest";

import {
  buildAuthorizeReceivedDetails,
  buildConfigChangedDetails,
  buildProxyCallbackErrorDetails,
  buildProxyRedirectOutDetails,
  buildSecurityViolationDetails,
  buildTokenAuthCodeReceivedDetails,
  buildTokenRefreshReceivedDetails,
  sanitizeAuditDetails,
  type AuditEventInput,
  type ProxyProviderConfigSnapshot,
} from "@/server/services/audit-event";

const baseEvent = {
  tenantId: "tenant-1",
  clientId: "client-1",
  traceId: "trace-1",
  actorId: null,
  severity: "INFO",
  message: "Audit",
} satisfies Omit<AuditEventInput, "eventType" | "details">;

const sanitize = (event: AuditEventInput, redactionEnabled: boolean) =>
  sanitizeAuditDetails(event, { redactionEnabled }) as Record<string, unknown>;

describe("sanitizeAuditDetails", () => {
  it("redacts authorize request params when enabled", () => {
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
    });
    const event: AuditEventInput = {
      ...baseEvent,
      eventType: "AUTHORIZE_RECEIVED",
      details,
    };

    const redacted = sanitize(event, true);
    expect(redacted).toMatchObject({
      responseType: "code",
      scope: "openid profile",
      codeChallengeMethod: "S256",
      loginHintProvided: true,
      nonceProvided: true,
      freshLoginRequested: true,
    });
    expect(redacted).not.toHaveProperty("redirectUri");
    expect(redacted).not.toHaveProperty("state");
    expect(redacted).not.toHaveProperty("nonce");
    expect(redacted).not.toHaveProperty("codeChallenge");

    const unredacted = sanitize(event, false);
    expect(unredacted).toMatchObject({
      redirectUri: "https://app.example.com/callback",
      state: "state-123",
      nonce: "nonce-123",
      codeChallenge: "challenge-123",
      codeChallengeMethod: "S256",
      loginHint: "user@example.com",
    });
  });

  it("redacts proxy redirects when enabled", () => {
    const details = buildProxyRedirectOutDetails({
      providerType: "oidc",
      providerScope: "openid profile",
      providerPkceEnabled: true,
      prompt: "login",
      loginHint: "user@example.com",
      redirectUri: "https://provider.example.com/callback",
      state: "tx-123",
      nonce: "nonce-456",
      codeChallenge: "provider-challenge",
      codeChallengeMethod: "S256",
      codeVerifier: "verifier-789",
    });
    const event: AuditEventInput = {
      ...baseEvent,
      eventType: "PROXY_REDIRECT_OUT",
      details,
    };

    const redacted = sanitize(event, true);
    expect(redacted).toMatchObject({
      providerType: "oidc",
      providerScope: "openid profile",
      providerPkceEnabled: true,
      loginHintProvided: true,
    });
    expect(redacted).not.toHaveProperty("redirectUri");
    expect(redacted).not.toHaveProperty("state");
    expect(redacted).not.toHaveProperty("codeVerifier");

    const unredacted = sanitize(event, false);
    expect(unredacted).toMatchObject({
      redirectUri: "https://provider.example.com/callback",
      state: "tx-123",
      nonce: "nonce-456",
      codeChallenge: "provider-challenge",
      codeChallengeMethod: "S256",
      codeVerifier: "verifier-789",
      loginHint: "user@example.com",
    });
  });

  it("redacts token request payloads when enabled", () => {
    const authCodeDetails = buildTokenAuthCodeReceivedDetails({
      authMethod: "client_secret_basic",
      clientSecretInBody: false,
      clientIdProvided: true,
      clientId: "client-id",
      clientSecret: "client-secret",
      grantType: "authorization_code",
      redirectUri: "https://app.example.com/callback",
      authorizationCode: "auth-code",
      includeAuthHeader: true,
    });
    const authCodeEvent: AuditEventInput = {
      ...baseEvent,
      eventType: "TOKEN_AUTHCODE_RECEIVED",
      details: authCodeDetails,
    };

    const redacted = sanitize(authCodeEvent, true);
    expect(redacted).toMatchObject({
      authMethod: "client_secret_basic",
      clientSecretInBody: false,
      clientIdProvided: true,
    });
    expect(redacted).not.toHaveProperty("clientSecret");
    expect(redacted).not.toHaveProperty("authorizationCode");
    expect(redacted).not.toHaveProperty("redirectUri");

    const unredacted = sanitize(authCodeEvent, false);
    expect(unredacted).toMatchObject({
      clientId: "client-id",
      clientSecret: "client-secret",
      grantType: "authorization_code",
      redirectUri: "https://app.example.com/callback",
      authorizationCode: "auth-code",
      includeAuthHeader: true,
    });

    const refreshDetails = buildTokenRefreshReceivedDetails({
      authMethod: "client_secret_post",
      clientSecretInBody: true,
      scope: "openid",
      clientId: "client-id",
      clientSecret: "client-secret",
      grantType: "refresh_token",
      refreshToken: "refresh-token",
      includeAuthHeader: false,
    });
    const refreshEvent: AuditEventInput = {
      ...baseEvent,
      eventType: "TOKEN_REFRESH_RECEIVED",
      details: refreshDetails,
    };

    const redactedRefresh = sanitize(refreshEvent, true);
    expect(redactedRefresh).toMatchObject({
      authMethod: "client_secret_post",
      clientSecretInBody: true,
      scope: "openid",
    });
    expect(redactedRefresh).not.toHaveProperty("refreshToken");

    const unredactedRefresh = sanitize(refreshEvent, false);
    expect(unredactedRefresh).toMatchObject({
      clientId: "client-id",
      clientSecret: "client-secret",
      grantType: "refresh_token",
      refreshToken: "refresh-token",
      includeAuthHeader: false,
    });
  });

  it("redacts provider callback errors when enabled", () => {
    const details = buildProxyCallbackErrorDetails({
      error: "provider_error",
      errorDescription: "Provider error",
      providerType: "oidc",
      code: "provider-code",
      rawError: "invalid_grant",
      rawErrorDescription: "Invalid grant description",
    });
    const event: AuditEventInput = {
      ...baseEvent,
      eventType: "PROXY_CALLBACK_ERROR",
      details,
    };

    const redacted = sanitize(event, true);
    expect(redacted).toMatchObject({
      error: "provider_error",
      errorDescription: "Provider error",
      providerType: "oidc",
    });
    expect(redacted).not.toHaveProperty("code");

    const unredacted = sanitize(event, false);
    expect(unredacted).toMatchObject({
      error: "invalid_grant",
      errorDescription: "Invalid grant description",
      providerType: "oidc",
      code: "provider-code",
    });
  });

  it("redacts security violations when enabled", () => {
    const details = buildSecurityViolationDetails({
      reason: "redirect_uri_mismatch",
      authMethod: "client_secret_post",
      clientSecretInBody: true,
      expectedRedirectUri: "https://expected.example.com",
      receivedRedirectUri: "https://received.example.com",
    });
    const event: AuditEventInput = {
      ...baseEvent,
      eventType: "SECURITY_VIOLATION",
      details,
    };

    const redacted = sanitize(event, true);
    expect(redacted).toMatchObject({
      reason: "redirect_uri_mismatch",
      authMethod: "client_secret_post",
      clientSecretInBody: true,
    });
    expect(redacted).not.toHaveProperty("expectedRedirectUri");

    const unredacted = sanitize(event, false);
    expect(unredacted).toMatchObject({
      expectedRedirectUri: "https://expected.example.com",
      receivedRedirectUri: "https://received.example.com",
    });
  });

  it("redacts config snapshots when enabled", () => {
    const before: ProxyProviderConfigSnapshot = {
      providerType: "oidc",
      authorizationEndpoint: "https://provider.example.com/authorize",
      tokenEndpoint: "https://provider.example.com/token",
      userinfoEndpoint: "https://provider.example.com/userinfo",
      jwksUri: "https://provider.example.com/jwks",
      upstreamClientId: "upstream-id",
      upstreamClientSecret: "before-secret",
      upstreamTokenEndpointAuthMethod: "client_secret_basic",
      defaultScopes: ["openid"],
      scopeMapping: { email: ["email"] },
      pkceSupported: true,
      oidcEnabled: true,
      promptPassthroughEnabled: true,
      loginHintPassthroughEnabled: false,
      passthroughTokenResponse: false,
    };
    const after: ProxyProviderConfigSnapshot = {
      ...before,
      tokenEndpoint: "https://provider.example.com/token2",
      upstreamClientSecret: "after-secret",
      upstreamTokenEndpointAuthMethod: "client_secret_post",
    };
    const details = buildConfigChangedDetails({
      action: "update",
      resource: "proxy_config",
      resourceId: "client-1",
      proxyConfigBefore: before,
      proxyConfigAfter: after,
      authMethodBefore: "client_secret_basic",
      authMethodAfter: "client_secret_post",
    });
    const event: AuditEventInput = {
      ...baseEvent,
      eventType: "CONFIG_CHANGED",
      details,
    };

    const redacted = sanitize(event, true);
    expect(redacted).toMatchObject({ action: "update", resource: "proxy_config" });
    expect(redacted).not.toHaveProperty("proxyConfigBefore");

    const unredacted = sanitize(event, false);
    expect(unredacted).toMatchObject({
      proxyConfigBefore: before,
      proxyConfigAfter: after,
      authMethodBefore: "client_secret_basic",
      authMethodAfter: "client_secret_post",
    });
  });
});
