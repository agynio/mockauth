Mockauth is a multi-tenant mock OpenID Connect provider for QA and ephemeral environments. Each tenant is exposed under
`https://<host>/t/<tenant>/oidc` with per-tenant JWKS, username-only login, and an admin console (NextAuth + Logto) for
managing tenants, clients, redirect URIs, and RSA signing keys.

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

## OIDC Endpoints

For the seeded tenant `tenant_qa`:

| Endpoint | Path |
| --- | --- |
| Issuer | `http(s)://<host>/t/tenant_qa/oidc` |
| Discovery | `/t/tenant_qa/oidc/.well-known/openid-configuration` |
| JWKS | `/t/tenant_qa/oidc/jwks.json` (alias `/t/tenant_qa/.well-known/jwks.json`) |
| Authorize | `/t/tenant_qa/oidc/authorize` (Authorization Code + PKCE S256 only) |
| Token | `/t/tenant_qa/oidc/token` |
| UserInfo | `/t/tenant_qa/oidc/userinfo` |
- Username-only login lives at `/t/<tenantId>/oidc/login` and stores a tenant-scoped mock-user session cookie (separate
  from NextAuth).

## CI

`.github/workflows/ci.yml` runs lint, typecheck, vitest, Playwright E2E, and Next build on every push/PR. All tests must
pass locally before pushing—CI is a guardrail, not a substitute for local verification.
