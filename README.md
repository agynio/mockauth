Mockauth is a multi-tenant mock OpenID Connect provider for QA and ephemeral environments. Each tenant issues tokens
through resource-scoped paths like `https://<host>/t/<tenantId>/r/<apiResourceId>/oidc`, exposing per-resource JWKS,
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

## Common Commands

| Command | Description |
| --- | --- |
| `pnpm dev` | Start Next.js dev server on <http://127.0.0.1:3000>. |
| `pnpm lint` | ESLint (Next flat config). |
| `pnpm typecheck` | TypeScript `--noEmit`. |
| `pnpm test` | Prepares test DB, seeds fixtures, runs Vitest suite. |
| `pnpm test:e2e` | Rebuilds test DB and runs Playwright (uses `openid-client` to complete Auth Code + PKCE). |
| `pnpm test:e2e:dev` | Same as above but keeps a dev server running via `start-server-and-test`. |
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
  detailed client pages (copy helpers, redirect management, secret rotation, metadata). Mock login remains
  username-only—no whitelist or user records to manage.

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

### Breaking Change — Stage 2 (tenantId + apiResource issuers)

- Tenant slugs are removed. Every OIDC URL now uses the tenant ID (e.g. `tenant_qa`).
- Each tenant has a default API resource (visible in the Admin sidebar) and issuers follow the
  `https://<host>/t/<tenantId>/r/<apiResourceId>/oidc` pattern. Copy both IDs directly from the Admin UI before updating
  relying parties.

## OIDC Endpoints

For the seeded tenant `tenant_qa` (default resource `tenant_qa_default_resource`):

| Endpoint | Path |
| --- | --- |
| Issuer | `http(s)://<host>/t/tenant_qa/r/tenant_qa_default_resource/oidc` |
| Discovery | `/t/tenant_qa/r/tenant_qa_default_resource/oidc/.well-known/openid-configuration` |
| JWKS | `/t/tenant_qa/r/tenant_qa_default_resource/oidc/jwks.json` (alias `/t/tenant_qa/.well-known/jwks.json`) |
| Authorize | `/t/tenant_qa/r/tenant_qa_default_resource/oidc/authorize` (Authorization Code + PKCE S256 only) |
| Token | `/t/tenant_qa/r/tenant_qa_default_resource/oidc/token` |
| UserInfo | `/t/tenant_qa/r/tenant_qa_default_resource/oidc/userinfo` |
- Username-only login lives at `/t/<tenantId>/r/<apiResourceId>/oidc/login` and stores a tenant-scoped mock-user session cookie (separate
  from NextAuth).

## CI

`.github/workflows/ci.yml` runs lint, typecheck, vitest, Playwright E2E, and Next build on every push/PR. All tests must
pass locally before pushing—CI is a guardrail, not a substitute for local verification.
