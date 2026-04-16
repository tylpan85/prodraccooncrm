# Raccoon CRM (prodraccooncrm)

Production rewrite of the legacy beta CRM for Raccoon Cleaning Inc.
Next 15 + React 19 on the web, Fastify 5 + Prisma 6 + Postgres 16 on the API.

Architecture and specs live in the sibling `/home/developer/.openclaw/workspace/docs/`
folder (not committed to this repo):
- `docs/architecture-v2/*` — stack, data model, module boundaries, recurrence,
  API contract, frontend architecture, deployment, open questions
- `docs/spec-v2/*` — per-module specs and acceptance criteria
- `docs/plan/2026-04-16-migration-plan-v2.md` — phased migration plan

## Prerequisites

- **Node 22** LTS (`.nvmrc` pins it)
- **pnpm 9** (via `corepack enable`)
- **Docker** (for local Postgres)

## First-time setup

```bash
# 1. Install deps
pnpm install

# 2. Copy env and fill secrets (any 32+ char random strings work locally)
cp .env.example .env

# 3. Start Postgres
pnpm db:up

# 4. (Phase 1+) Run migrations and seed
# pnpm db:reset
```

## Running dev

```bash
pnpm dev
```

That launches:
- API on `http://localhost:4000`
- Web on `http://localhost:3100`

Health check: http://localhost:4000/health.

> **Port choice:** Web dev runs on **3100** (not 3000) because the legacy
> beta CRM runs on 3000. When the beta is retired, change `apps/web/package.json`
> `dev`/`start` scripts back to `3000`.

## Scripts

| Script | What |
|---|---|
| `pnpm dev` | Web + API concurrently |
| `pnpm build` | Build every workspace |
| `pnpm test` | Run all tests |
| `pnpm typecheck` | Typecheck every workspace |
| `pnpm lint` | Biome lint |
| `pnpm lint:fix` | Biome lint + autofix |
| `pnpm format` | Biome format |
| `pnpm db:up` | Start Postgres in Docker |
| `pnpm db:down` | Stop Postgres |
| `pnpm db:reset` | Drop, migrate, and seed DB (Phase 1+) |

## Workspace layout

```
apps/
  api/        Fastify 5 API
  web/        Next 15 App Router UI
packages/
  shared/     Zod schemas + error codes (frontend + backend)
  db/         Prisma schema + client + seed
  recurrence/ Recurrence engine (ported from beta in Phase 9)
```

## Deployment

Local only for now. AWS EC2 + RDS deployment plan in
`docs/architecture-v2/deployment.md`.
