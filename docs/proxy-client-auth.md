## Proxy client token auth enforcement

- Proxy client detail pages surface the stored upstream secret with reveal/copy controls. The decrypted value never
  leaves the browser; a caution hint reminds operators to handle revealed secrets carefully.
- The **Token endpoint auth** dropdown now dictates credential placement. Choose HTTP Basic to send
  `Authorization: Basic ...`, or POST body to populate `client_id` and `client_secret` in the form body. Both
  `authorization_code` and `refresh_token` exchanges honor the selection.
- QA automation can call `POST /api/test/proxy/request-tokens` (behind `ENABLE_TEST_ROUTES`) to trigger proxied token
  requests without wiring a real upstream provider. Pass `{ clientId, tenantId, parameters }` where `parameters`
  mirrors the upstream form-encoded grant payload.
- Upstream expectations differ by provider. For example, LinkedIn commonly insists on `client_secret_post` for token
  requests, so select that method in the admin UI when configuring LinkedIn-backed proxies.
