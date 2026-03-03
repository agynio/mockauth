Mockauth is a multi-tenant mock OpenID Connect provider for QA and ephemeral environments. Each tenant issues tokens
through resource-scoped paths like `https://<host>/r/<apiResourceId>/oidc`, exposing per-resource JWKS,
username-only login, and an admin console (NextAuth + Logto) for managing tenants, API resources, redirect URIs, and RSA
signing keys.

## Stack

- Next.js App Router (TypeScript, Tailwind)
- NextAuth (Logto provider) for admin console auth
- Prisma + PostgreSQL (Supabase-compatible)
- jose + openid-client for OIDC primitives
- Vitest + Playwright for unit/integration/E2E coverage

## Prerequisites

- Node.js 20+
- pnpm 10+
- Docker (for local PostgreSQL)

> **Package manager note:** Mockauth is pnpm-only. The `packageManager` field and `.npmrc` enforce pnpm 10.29.3, and the
> checked-in `pnpm-lock.yaml` is the single source of truth. Avoid running `npm` or `yarn install` to keep dependencies
> in sync across environments.

## Environment & Database

1. Start the local Postgres containers (one for app data, one for tests):
   ```bash
   docker run -d --name mockauth-db -p 5432:5432 \
     -e POSTGRES_USER=mockauth -e POSTGRES_PASSWORD=mockauth -e POSTGRES_DB=mockauth postgres:16
   docker run -d --name mockauth-db-test -p 5433:5432 \
     -e POSTGRES_USER=mockauth -e POSTGRES_PASSWORD=mockauth -e POSTGRES_DB=mockauth_test postgres:16
   ```
   (Alternatively use `docker-compose.dev.yml`.)

2. Copy `.env.example` → `.env` and update secrets as needed. For local dev you can also use the provided
   `.env.development`, which is pre-wired to our shared Logto sandbox. Automated tests read from `.env.test`
   (already checked in) and point at the `mockauth_db-test` database.

3. Install dependencies and run the initial migration + seed:
   ```bash
   pnpm install
   pnpm prisma:migrate
   pnpm prisma:seed
   ```
   (`pnpm prisma:migrate` targets the local dev database via `prisma migrate dev`. For deploys, use
   `pnpm db:migrate`, which wraps `prisma migrate deploy`.)

### Supabase configuration

- `DATABASE_URL` should point at the Supabase **pooler** (port `6543`) so the runtime benefits from connection
  multiplexing. Example:
  ```
  DATABASE_URL=postgres://<user>:<password>@db.<hash>.supabase.co:6543/postgres?sslmode=require
  ```
- `DATABASE_DIRECT_URL` should point at the direct Postgres instance (port `5432`) so Prisma migrations bypass the
  pooler. Example:
  ```
  DATABASE_DIRECT_URL=postgres://<user>:<password>@db.<hash>.supabase.co:5432/postgres?sslmode=require
  ```
- Always include `sslmode=require` for hosted Supabase projects; Vercel builds read both variables (Prisma prefers
  `directUrl` for `prisma migrate deploy`).

## Common Commands

| Command | Description |
| --- | --- |
| `pnpm dev` | Start Next.js dev server on <http://127.0.0.1:3000>. |
| `pnpm lint` | ESLint (Next flat config). |
| `pnpm typecheck` | TypeScript `--noEmit`. |
| `pnpm test` | Prepares test DB, seeds fixtures, runs Vitest suite. |
| `pnpm test:e2e` | Rebuilds test DB and runs Playwright (uses `openid-client` to complete Auth Code + PKCE). |
| `pnpm test:e2e:dev` | Same as above but keeps a dev server running via `start-server-and-test`. |
| `pnpm db:generate` | Runs `prisma generate` (no migrations). Used by `postinstall` and Vercel builds. |
| `pnpm db:migrate` | Runs `prisma migrate deploy` for production/provisioned databases. |
| `pnpm prisma:migrate` | `prisma migrate dev` for the dev database. |
| `pnpm prisma:seed` | Seeds tenants/clients/mock users for manual testing. |

Playwright browsers are installed separately via `pnpm playwright:install` (run once per workstation or after dependency
updates). CI runs this script automatically before executing E2E specs.

## Logto dev/test configuration

- `tests/fixtures/logto.dev.config.ts` contains the Logto dev tenant details provided by Rowan. These credentials are for
  **local development and automated testing only**—never deploy them to production.
- `.env.development` and `.env.test` already set `LOGTO_ISSUER=https://hdjvaa.logto.app/oidc` along with the matching
  client ID/secret so NextAuth can talk to the Logto sandbox out of the box.
- If you create your own Logto tenant, update the `LOGTO_*` env vars (and never commit proprietary secrets; `.env` stays
  local-only per `.gitignore`).

## Admin Console

- Accessible at `/admin` and protected via NextAuth + Logto. Provide `LOGTO_*` env vars to point at your Logto instance.
- The Stage 2 UI introduces a sidebar with tenant switching, per-tenant client lists, a focused create form, and
  detailed client pages (copy helpers, redirect management, secret rotation, metadata). Each client now includes an
  **Auth strategies** card so you can toggle username/email flows and decide how the OIDC `sub` claim is derived. The
  mock login screen mirrors the configured strategies automatically—no whitelist or per-user setup required.

### QA sign-in + account linking

- NextAuth blocks linking multiple OAuth accounts to the same email by default. In QA we seed `owner@example.test`
  (and other roles) ahead of time, so the first Logto sign-in must be allowed to link automatically. Toggle this with
  `ALLOW_EMAIL_LINKING=true` (enabled in `.env.development` and `.env.test`, left `false` elsewhere by default).
- `NEXTAUTH_URL` **must** match the public tunnel URL (e.g., the Cloudflare tunnel hostname) and stay stable. If the
  tunnel rotates, update `NEXTAUTH_URL` immediately, re-add the tunnel callback URL inside Logto (Applications → your
  client → **Sign-in redirect URIs**), and keep `NEXTAUTH_SECRET` unchanged to avoid forcing users to re-authorize.
- For automated tests we rely on a built-in mock Logto server that lives under
  `http://127.0.0.1:3000/api/test/logto`. Enable it via `ENABLE_TEST_ROUTES=true` and set `LOGTO_ISSUER` to the same
  URL. You can POST to `/api/test/logto/profile` with `{ email, sub, name }` to queue the next identity when simulating
  edge cases.
- Client-side sign-in buttons should always point to the relative path
  `/api/auth/signin/logto?callbackUrl=/admin` so they inherit the current host; reserve `NEXTAUTH_URL` for server-side
  NextAuth configuration only.

### Redirect wildcard policy

- Redirect entries must be absolute URLs and use `https` unless they target `localhost`, `127.0.0.1`, or `::1` over
  `http` for local testing.
- Supported shapes:
  - Exact URL: `https://app.example.com/callback`
  - Host wildcard (single left-most label only): `https://*.example.com/callback`
  - Path wildcard (trailing `/*` suffix): `https://app.example.com/callback/*`
- Host and path wildcards are intended for QA only. The Admin form surfaces muted warnings whenever one is entered.
- A full catch-all (`*`) exists strictly for QA automation and is gated by the `MOCKAUTH_ALLOW_ANY_REDIRECT` env flag
  (disabled by default). When you type `*` in the Admin UI, a destructive warning reminds you that this must never be
  enabled in production.

### Per-client auth strategies

- Username and email sign-in flows are configured per client. Both are enabled/disabled independently and expose their
  own subject-source selector (`entered` reuses the typed identifier, `generated_uuid` ("Generate UUID (stable per identity)")
  stores a persistent UUID per tenant + strategy + identifier).
- Username strategy returns `preferred_username` when `profile` is requested. Email strategy requires the `email` scope
  and emits `email` + `email_verified` according to the configured mode (always true, always false, or QA-selected at
  login). It never exposes `preferred_username`.
- All subject decisions are stored on the session + authorization code so every token and `userinfo` response reflects
  the strategy that was used during login.

### Per-client scopes

- Mockauth seeds clients with the OIDC defaults `openid`, `profile`, and `email`, but you can add any custom scope that
  matches `^[a-z0-9:_-]{1,64}$`. `openid` remains mandatory and cannot be removed.
- The Admin UI exposes a tags-based **Scopes** card on each client. Use the suggestions for standard OIDC scopes or type
  custom values; duplicates are ignored automatically.
- Discovery advertises only the platform-wide OIDC defaults via `scopes_supported`. Custom scopes stay per-client and
  opaque to discovery.
- The authorize endpoint validates that every requested scope is allowed for the client and still requires `openid`.

### Proxy clients (upstream delegation)

- Set `ENABLE_PROXY_CLIENTS=true` to expose a **Proxy client** mode in the admin create dialog. Regular clients remain
  the default. Proxy mode brokers OAuth/OIDC against an upstream identity provider while preserving Mockauth’s tenant
  boundary and redirect validation.
- The create/edit forms collect upstream authorization/token/userinfo/JWKS endpoints, provider client credentials, and
  optional scope mappings. Default provider scopes cover the fallback when an app requests nothing; scope mappings
  translate app scopes (left-hand column) into upstream scopes (right-hand column). When no mapping applies, Mockauth
  forwards the original scope verbatim.
- Toggle the advanced flags to match the upstream provider:
  - **Provider supports PKCE** stores a verifier on the transaction and sends `code_challenge` when redirecting.
  - **Provider issues ID tokens** forwards the app’s `nonce` and expects an upstream `id_token`.
  - **Passthrough prompt/login_hint** forwards those request parameters when present.
  - **Passthrough token payload** returns the upstream JSON verbatim; otherwise Mockauth emits a minimal compliant
    access token response derived from the provider payload.
- Proxy clients display a “proxy mode” badge on the detail page. The new **Proxy provider** card lets you rotate
  upstream secrets, edit endpoints, and adjust mappings without recreating the client. Leaving the secret blank keeps
  the existing encrypted value.
- Callback handling lives at `/r/<apiResourceId>/oidc/proxy/callback`. Authorization requests set a short-lived
  transaction cookie; the callback matches it, trades the upstream code for tokens, and issues a Mockauth authorization
  code referencing the stored upstream response. The regular token endpoint then serves proxied access/refresh tokens
  (and ID tokens when provided) while enforcing the client’s token auth method and PKCE requirements.

### Breaking Change — Stage 2 (resource-scoped issuers)

- Tenant slugs have been removed from OIDC URLs. Issuers are now scoped purely by API resource.
- Each tenant still exposes its default API resource in the Admin sidebar, and issuers follow the
  `https://<host>/r/<apiResourceId>/oidc` pattern. Copy the resource ID directly from the Admin UI before updating
  relying parties.

## OIDC Endpoints

For the seeded tenant `tenant_qa` (default resource `tenant_qa_default_resource`):

| Endpoint | Path |
| --- | --- |
| Issuer | `http(s)://<host>/r/tenant_qa_default_resource/oidc` |
| Discovery | `/r/tenant_qa_default_resource/oidc/.well-known/openid-configuration` |
| JWKS | `/r/tenant_qa_default_resource/oidc/jwks.json` |
| Authorize | `/r/tenant_qa_default_resource/oidc/authorize` (Authorization Code + PKCE S256 only) |
| Token | `/r/tenant_qa_default_resource/oidc/token` |
| UserInfo | `/r/tenant_qa_default_resource/oidc/userinfo` |
- The QA login form lives at `/r/<apiResourceId>/oidc/login` and renders whichever strategies the client
  has enabled. Sessions are tenant-scoped and stored separately from NextAuth admin auth.

## Vercel deploys

- `vercel.json` pins the install command to `pnpm install --frozen-lockfile` so deploys stay in lockstep with the repo.
- The build command always runs `pnpm prisma:generate` and only executes `pnpm db:migrate` when `VERCEL_ENV=production`
  (preview deployments stay read-only, production applies migrations before `next build`).
- Local `postinstall` still calls `pnpm prisma:generate` and never attempts to run migrations, keeping `pnpm install`
  safe on contributor machines.

## CI

`.github/workflows/ci.yml` runs lint, typecheck, vitest, Playwright E2E, and Next build on every push/PR. All tests must
pass locally before pushing—CI is a guardrail, not a substitute for local verification.
