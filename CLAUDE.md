# Raccoon CRM — Agent Orientation

Production CRM for Raccoon Cleaning Inc. pnpm monorepo. Next 15 web, Fastify 5 API, Prisma 6, Postgres 16.

## Layout

```
apps/api            Fastify API — port 4000
apps/web            Next App Router UI — port 3100 (not 3000: beta CRM occupies it)
packages/shared     Zod schemas + DTOs + error codes (single source of truth for types)
packages/db         Prisma schema + client + seed (+ seed:demo)
packages/recurrence Recurrence engine — generateOccurrenceDates, computeHorizonDate, describeRecurrenceRule
```

## Dev

- Install: `pnpm install` (corepack pnpm@9)
- Full reset: `pnpm dev:reset` → `db:up` (docker) + `db:reset` + `seed:demo` + `dev`
- DB only: `pnpm db:up` / `db:reset` / `db:seed` / `seed:demo`
- Checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`
- Login: `admin@raccooncrm.local` / `admin`
- **Prisma migrate reset from agent** requires `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=<user's consent text>`

## Module → file map

### Jobs
- Create form: `apps/web/src/app/(app)/jobs/new/page.tsx`
- Edit form: `apps/web/src/app/(app)/jobs/[id]/edit/page.tsx` (has recurring scope dialog)
- Detail: `apps/web/src/app/(app)/jobs/[id]/page.tsx`
- API routes: `apps/api/src/modules/scheduling/jobs.ts`
- Schemas/DTOs: `packages/shared/src/schemas/jobs.ts`
- Endpoints: `POST /api/customers/:customerId/jobs`, `PATCH /api/jobs/:id`, `POST /api/jobs/:id/schedule`, `POST /api/jobs/:id/occurrence-edit`

### Recurring series
- API + materialization: `apps/api/src/modules/scheduling/recurring.ts`
- Schemas (incl. `scope: 'this' | 'this_and_future'`): `packages/shared/src/schemas/recurring.ts`
- UI editor: `apps/web/src/components/common/recurrence-editor.tsx`
- Engine: `packages/recurrence/src/index.ts`
- Prisma: `RecurringSeries`, `Job.recurringSeriesId`, `Job.isExceptionInstance`, `Job.generatedFromRuleVersion`, `Job.deletedFromSeriesAt`
- `scope: 'this'` → marks job as exception; `scope: 'this_and_future'` → bumps ruleVersion, rematerializes tail if schedule/rule changed

### Scheduler (calendar)
- Page: `apps/web/src/app/(app)/scheduler/page.tsx` (day/month, team lanes, job + event popovers with Edit buttons)
- API: `apps/api/src/modules/scheduling/schedule.ts`
- Edit button on job popover → `/jobs/:id/edit`

### Customers
- List: `apps/web/src/app/(app)/customers/page.tsx`
- Detail/edit: `apps/web/src/app/(app)/customers/[id]/`
- API: `apps/api/src/modules/customers/`
- Schemas: `packages/shared/src/schemas/customers.ts`

### Events (standalone calendar events)
- API: `apps/api/src/modules/scheduling/events.ts`
- Edit: `apps/web/src/app/(app)/events/[id]/edit/page.tsx`

### Billing
- Invoice auto-created on job finish. Lifecycle: draft → sent → paid → void.
- API: `apps/api/src/modules/billing/`

### Auth
- API: `apps/api/src/modules/auth/`
- Layout guard: `apps/web/src/app/(app)/layout.tsx`
- Session hook: `apps/web/src/lib/session.ts`
- Argon2id password hash. JWT access + refresh, cookies.

### Settings
- Services, team members, org — `apps/web/src/app/(app)/settings/`, `apps/api/src/modules/settings/`

## Shared conventions

- **Money:** always cents (integer) on the wire and in DB. Display as `(cents/100).toFixed(2)`.
- **Timestamps:** ISO-8601 UTC on the wire. `datetime-local` inputs use local time — convert via `new Date(local).toISOString()`.
- **Zod schemas in `packages/shared`** are the contract. API validates requests against them, web infers types from them.
- **UI primitives:** `apps/web/src/components/ui/{button,input,label}.tsx` — use these, not raw HTML.
- **Data fetching:** TanStack Query. Invalidate `['job', id]`, `['jobs']`, `['schedule']`, `['series-for-job', id]` after job mutations.
- **Soft delete:** `deletedFromSeriesAt` on jobs. Filter it out when reading live data.

## Compaction / summary rules (CRITICAL — read before any session ends)

When Claude Code compacts this session into a summary, follow these rules to prevent context bloat in future sessions:
- **Summary ≤ 400 words total.** No exceptions.
- **No code snippets** — reference file paths and line numbers only.
- **No repeating the module→file map** — it's already in this CLAUDE.md.
- **Only list files that were actually modified** (not read), with one-line description of what changed.
- **Do not include command output** (npm/docker logs, typecheck output, etc.).
- **Pending tasks:** max 2 sentences each.

## Gotchas

- Web dev port is **3100**, not 3000.
- Postgres is on **5433** externally (5432 in container).
- `packages/db/src/seed-demo.ts` currently has pre-existing typecheck errors (possibly-undefined vars) — not yet fixed.
- `mustResetPassword` flag and related dialog were removed on 2026-04-17; endpoint `/api/auth/change-password` still exists for voluntary changes.
- Customer is display-only on job edit (can't reassign a job to a different customer).
