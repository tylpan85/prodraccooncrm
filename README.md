# Raccoon CRM

Production CRM for Raccoon Cleaning Inc.
Next 15 + React 19 on the web, Fastify 5 + Prisma 6 + Postgres 16 on the API.

## Prerequisites

- **Node 22** LTS (`.nvmrc` pins it — `nvm use` if you have nvm)
- **pnpm 9** (`corepack enable` to activate)
- **Docker** (for local Postgres)

## Quick start

```bash
# 1. Clone and install
git clone <repo-url> && cd prodraccooncrm
pnpm install

# 2. Environment — defaults work out of the box for local dev
cp .env.example .env

# 3. One command: start Postgres, reset DB, seed demo data, launch dev servers
pnpm dev:reset
```

Once it's running:

| Service | URL |
|---|---|
| Web (UI) | http://localhost:3100 |
| API | http://localhost:4000 |
| Health check | http://localhost:4000/health |

**Login:** `admin@raccooncrm.local` / `admin` (you'll be prompted to change the password on first login).

The demo seed populates 5 customers, 10 jobs in various states, 2 recurring series, and a week of events so the scheduler looks alive on first open.

## Scripts

| Script | What it does |
|---|---|
| `pnpm dev:reset` | Full reset: start Postgres, drop + migrate + seed DB, load demo data, launch dev servers |
| `pnpm dev` | Start API + Web dev servers (assumes DB is already running and seeded) |
| `pnpm build` | Build every workspace |
| `pnpm test` | Run all tests |
| `pnpm typecheck` | Typecheck every workspace |
| `pnpm lint` | Biome lint |
| `pnpm lint:fix` | Biome lint + autofix |
| `pnpm format` | Biome format |
| `pnpm db:up` | Start Postgres in Docker |
| `pnpm db:down` | Stop Postgres |
| `pnpm db:reset` | Drop, migrate, and seed DB (base data only) |
| `pnpm db:seed` | Run base seed (org + admin + team + services) |
| `pnpm seed:demo` | Add demo data (customers, jobs, events, recurring) on top of base seed |

## Workspace layout

```
apps/
  api/          Fastify 5 API server (port 4000)
  web/          Next 15 App Router UI (port 3100)
packages/
  shared/       Zod schemas + error codes (frontend + backend)
  db/           Prisma schema + client + seed
  recurrence/   Recurrence engine (TypeScript port from beta)
```

## Modules

- **Customers** — CRUD with nested addresses, phones, emails, tags; deduplication on phone/email
- **Jobs** — Create, schedule, assign, finish, reopen; job numbers start at 1001
- **Scheduler** — Day view and month view with team lanes and event rendering
- **Events** — Standalone calendar events on the scheduler
- **Recurring** — Weekly/biweekly/monthly series with `this` and `this_and_future` scope edits
- **Billing** — Auto-create invoice on finish; draft/sent/paid/void lifecycle
- **Settings** — Services, team members, organization

## Troubleshooting

**Port 5433 in use** — Another Postgres or the container from a previous run.
Stop it: `pnpm db:down` then retry.

**Port 3100 or 4000 in use** — The legacy beta CRM may be running on 3000.
Kill the process on the conflicting port: `lsof -ti:3100 | xargs kill -9`

**Prisma migration fails** — If schema drifted, do a full reset: `pnpm db:reset`

**`argon2` build error** — Needs a C compiler. On Ubuntu: `sudo apt install build-essential`

**Docker not running** — Start Docker Desktop or `sudo systemctl start docker`

## Port choice

Web runs on **3100** (not 3000) because the legacy beta CRM occupies 3000 during the migration period. When the beta is retired, change `apps/web/package.json` dev/start scripts back to 3000.

## Deployment

Local only for V1. AWS EC2 + RDS deployment plan is documented separately.
