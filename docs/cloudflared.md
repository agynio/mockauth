## Cloudflared quick tunnel

1. Start the dev server locally (`pnpm dev`).
2. In another shell run `cloudflared tunnel --loglevel debug --url http://localhost:3000`.
   - Any recent binary works: `brew install cloudflared`, the official `.deb`, or the standalone tarball.
3. Copy the `https://*.trycloudflare.com` URL printed after the tunnel connects. Requests to that host proxy directly to
   your local dev server.
   - `curl https://<tunnel>/api/health` should return `200`.
4. Always include the tenant slug when validating discovery:
   `curl https://<tunnel>/t/qa/oidc/.well-known/openid-configuration`.
5. Share the URL in Issue #3 (or the relevant task) and restart `cloudflared` whenever you need a fresh link.

### NextAuth base URL & tunnels

- Leave `NEXTAUTH_URL` unset while tunneling so NextAuth derives callback URLs from `X-Forwarded-Proto/Host`.
- If you must pin it, set `NEXTAUTH_URL=https://<tunnel>` before starting `pnpm dev`, then restart both `pnpm dev` and
  `cloudflared` to pick up the change.

### Running Logto admin E2E locally

- Provide the shared credentials via `LOGTO_E2E_USERNAME` and `LOGTO_E2E_PASSWORD` when invoking `pnpm test:e2e` so the
  new admin login test can complete the Logto form.
- Example:
  ```bash
  LOGTO_E2E_USERNAME=vitaliitest LOGTO_E2E_PASSWORD=b2w6etXc pnpm test:e2e
  ```

Quick tunnels are best-effort and short-lived; do not treat them as production-ready endpoints.
