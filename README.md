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

2. Copy `.env.example` → `.env` and update secrets as needed. For automated tests we use `.env.test` (already checked in)
   which targets the `mockauth_db-test` database.

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

## Admin Console

- Accessible at `/admin` and protected via NextAuth + Logto. Provide `LOGTO_*` env vars to point at your Logto instance.
- After signing in, create a tenant, register clients, add redirect URIs (exact, host wildcard, or path suffix wildcard),
  rotate keys, and manage mock users.

## OIDC Endpoints

For tenant `qa`:

| Endpoint | Path |
| --- | --- |
| Issuer | `http(s)://<host>/t/qa/oidc` |
| Discovery | `/t/qa/oidc/.well-known/openid-configuration` |
| JWKS | `/t/qa/oidc/jwks.json` (alias `/t/qa/.well-known/jwks.json`) |
| Authorize | `/t/qa/oidc/authorize` (Authorization Code + PKCE S256 only) |
| Token | `/t/qa/oidc/token` |
| UserInfo | `/t/qa/oidc/userinfo` |
- Username-only login happens under `/t/qa/oidc/login` and stores a dedicated mock-user session cookie (separate from
  NextAuth).

## CI

`.github/workflows/ci.yml` runs lint, typecheck, vitest, Playwright E2E, and Next build on every push/PR. All tests must
pass locally before pushing—CI is a guardrail, not a substitute for local verification.
