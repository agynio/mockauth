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

Quick tunnels are best-effort and short-lived; do not treat them as production-ready endpoints.
