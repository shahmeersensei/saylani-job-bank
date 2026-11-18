# Saylani Job Bank

This is a multi-branch Job Bank and employment matchmaking platform. It is a responsive web app plus a PWA.

- Requirements: [project_PRD.md](project_PRD.md)
- Build plan, module by module: [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)

## Stack

| Layer         | Choice                                                                  |
| ------------- | ----------------------------------------------------------------------- |
| App           | Next.js 15 (App Router), React 19, TypeScript (strict), Tailwind CSS v4 |
| Data          | PostgreSQL 16 + PostGIS 3.4, Drizzle ORM                                |
| Storage       | S3-compatible: SeaweedFS locally, Cloudflare R2 / AWS S3 in production  |
| Cache / queue | Redis (optional until Phase 4)                                          |
| Tooling       | pnpm workspaces, Turborepo, Vitest, ESLint, Prettier, Husky, commitlint |

## Repository layout

```
apps/web/            Next.js app — UI + /api/v1 (PRD §9 structure under src/)
packages/db/         Drizzle schema, SQL migrations, seed, PostGIS geography type
packages/shared/     zod contracts shared by UI and API
packages/config/     tsconfig + ESLint presets
docker-compose.yml   postgres+postgis, seaweedfs (S3), redis, mailpit
```

## Getting started

Prerequisites: Node ≥ 22, pnpm (`corepack enable`), and Docker Desktop.

```bash
cp .env.example .env      # defaults work for local development
pnpm install
pnpm infra:up             # start postgres, s3, redis, mailpit and wait until healthy
pnpm db:migrate           # apply migrations (owner role)
pnpm db:seed              # idempotent seed
pnpm dev                  # http://localhost:3000
```

> Migrating a database that already has applicant tokens (it ran 0028–0030 before 0031)? Run the 0031 duplicate pre-check first — `scripts/ci/precheck-0031-duplicates.sql`. It must return 0 rows before 0031 is applied; the file carries the resolution steps if it does not.

### Build-time environment

`pnpm build` (`next build`) validates environment variables at build time
(`apps/web/src/lib/env.ts`): `DATABASE_URL`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `NEXT_PUBLIC_APP_URL`, and
`BETTER_AUTH_SECRET` (≥ 32 chars). With `.env` copied from `.env.example`
and filled in, the build passes; CI sets these explicitly (see
`.github/workflows/ci.yml`). On a fresh checkout without any env, the build
fails at "Collect page data" with `Error: Invalid environment variables` —
use `SKIP_ENV_VALIDATION=1 pnpm build` for a compile-only check instead.

Never set `SKIP_ENV_VALIDATION` in production (audit 2026-11-11, L-19): it
bypasses validation including the secret-length rule, so a missing
`DATABASE_URL` or S3 key becomes a confusing runtime failure instead of a
fast boot error. The deploy checklist must assert it is unset. `secret.ts`
still throws at startup unless the auth secret exists and is ≥ 32 chars,
with no fallback secret anywhere.

`CRON_SECRET` (audit 2026-11-11, L-05) is optional: the shared secret an
unattended scheduler sends as the `x-cron-secret` header to
`POST /api/v1/admin/maintenance/expire-jobs`. Generate with
`openssl rand -base64 32`. Leave it unset and only a signed-in Super Admin
may expire jobs — no cron bypass exists.

### Job expiry (daily, automatic)

OPEN/PAUSED jobs whose `closesAt` has passed are closed automatically by an
in-process scheduler: `apps/web/src/instrumentation.ts` fires
`expirePastCloseJobs` daily at **19:05 UTC** (`5 19 * * *`, just after
midnight PKT), production only. It needs no external cron, URL or secret —
the timer runs inside the web server and the sweep is audited with
actorRole `SYSTEM`. A failed sweep is logged and retried at the next run.

> The Super Admin manual path still works: `POST
/api/v1/admin/maintenance/expire-jobs` (session cookie, or the
> `x-cron-secret` / `Authorization: Bearer <CRON_SECRET>` header for an
> external caller — the `CRON_SECRET` gate above). A future external
> scheduler can call the same route; the in-process timer and the route
> share the same sweep, which is idempotent under concurrency.

### Local services

| Service | Address |
entials |
| ------------------- | --------------------------------------------------------- | -------------------------------------------- |
| App | http://localhost:3000 | — |
| Health check | http://localhost:3000/api/v1/health | — |
| PostgreSQL | `localhost:5434`, db `jobbank` (tests use `jobbank_test`) | owner `jobbank/jobbank`, app `app_rw/app_rw` |
| S3 (SeaweedFS) | http://localhost:8333, bucket `jobbank-documents` | `jobbank` / `jobbank-dev-secret` |
| Redis | `localhost:6380` | — |
| Mailpit (dev inbox) | http://localhost:8025 | — |

The ports are 5434 and 6380 rather than the defaults, so they don't clash with a local Postgres or Redis.
Local service connections in `.env.example` use `127.0.0.1` rather than `localhost`
to avoid IPv6 forwarding timeouts with Docker Desktop on Windows. If an existing
`.env` uses `localhost` for PostgreSQL, Redis, S3, or SMTP, change those service
hosts to `127.0.0.1` and restart the affected apps.
When starting the matching service from `services/matching`, export
`MATCHING_DATABASE_URL` and `MATCHING_REDIS_URL` from the root `.env` or set them
in a `services/matching/.env` file; it does not automatically load the root file.

The matching service's `/internal/matches` endpoints require an `Authorization: Bearer <token>`
header matching `MATCHING_INTERNAL_API_TOKEN` (a random secret of at least 32 characters).
If it is unset or too short, these endpoints return 503; the worker and `/health` continue to
operate. Keep the service on a private network and store the token in a secrets manager in
production. Restart the matching service after changing its configuration.

## Signing in locally

`pnpm db:seed` seeds reference and master data. Development accounts (two branches — Karachi Gulshan and Lahore Johar Town — and one account per role) are included only with `SEED_DEV_DATA=true`. These are development-only accounts and are never seeded in production.

- **Staff and employers** sign in at http://localhost:3000/login under **Staff & employers**. The emails and the shared development password are in [`packages/db/src/seed/dev-data.ts`](packages/db/src/seed/dev-data.ts).
- **Applicants** use the **Job seekers** tab with a mobile number. In development, the SMS code is printed in the `pnpm dev` terminal (look for `📱 [dev SMS …]`). Any new Pakistani mobile number registers a new applicant.

Branch Admins can view applicants, companies, and jobs in their assigned branches. They can transfer
applicants from those branches to an active branch, but cannot otherwise create or manage those
records. Their staff-management and branch-settings access is unchanged.
Users with multiple roles retain the combined permissions of those roles.
Company listings default to Verified and can also be filtered by Suspended, Under Review
(`UNDER_VERIFICATION`), Info needed (`INFO_REQUESTED`), or Rejected. Branch Admin transfer requests include the applicant's
current branch as `expectedBranchId`; stale requests are rejected and must be refreshed.

Applicant registration-source statistics are not shown: migration 0018 assigned the self-service
source to pre-existing records, so historical manual registrations cannot be distinguished reliably.
New staff-assisted records do record their source, but counting the default as definitive for all
legacy records would produce misleading totals.

### Two-factor and email in development

- **Super Admin and Branch Admin** must set up an authenticator app (Google Authenticator, Authy, etc.) the first time they sign in. Scan the QR code shown at `/account/security`.
- **Email:** invitations, password resets and employer sign-in codes go to **Mailpit** at http://localhost:8025. Nothing leaves your machine.
- **If you lose the authenticator for a seeded admin:** run `pnpm infra:reset`, then `pnpm db:migrate && pnpm db:seed`, to start fresh.

## Database roles

The database uses two roles:

- `jobbank` owns the schema. Only migrations and seeds connect as it, through `DATABASE_MIGRATOR_URL`.
- `app_rw` is what the running app uses, through `DATABASE_URL`.

Append-only tables are created with `SELECT jobbank_make_append_only('<table>')`. These are audit logs and the employer and applicant decision tables (PRD §7.2). That call adds two separate guards:

- a trigger that rejects UPDATE, DELETE and TRUNCATE for everyone with SQLSTATE `JB001`
- revoked UPDATE and DELETE privileges for `app_rw`

## Common scripts

| Command                                      | What it does                                         |
| -------------------------------------------- | ---------------------------------------------------- |
| `pnpm dev`                                   | Run the app in dev mode                              |
| `pnpm build`                                 | Production build                                     |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | Quality gates (cached by Turborepo)                  |
| `pnpm format`                                | Prettier write                                       |
| `pnpm db:generate`                           | Generate a migration from schema changes             |
| `pnpm db:studio`                             | Drizzle Studio                                       |
| `pnpm infra:down` / `pnpm infra:reset`       | Stop the services / wipe the volumes and start again |

## Deploy checklist

Before promoting a build to production, confirm every item. The app fails
fast at boot on a missing secret, but these are deployment-time values the
build cannot know.

- `SKIP_ENV_VALIDATION` is unset (audit 2026-11-11, L-19). It bypasses
  validation including the secret-length rule; the deploy must assert it is
  unset, never set it in production.
- `TRUSTED_PROXY_HOPS` is set to the real number of reverse proxies in front
  of the app (audit 2026-11-11, M-18). Count the proxies in the actual chain
  — do not guess:

  | Deployment                              | Value         |
  | --------------------------------------- | ------------- |
  | Local dev / laptop (no proxy)           | `1` (default) |
  | One reverse proxy (e.g. a single nginx) | `1`           |
  | Cloudflare + nginx                      | `2`           |
  | Vercel (its edge is the single proxy)   | `1`           |

  Set it wrong and the failure is silent but safe: too high, and every IP
  reads as null, so all users share one strict `untrusted` rate-limit bucket
  (plus a loud production log naming `TRUSTED_PROXY_HOPS`); too low, and the
  app may trust a client-written `X-Forwarded-For` entry.

- `CRON_SECRET` is set (see "Job expiry") if a scheduler expires jobs;
  unset means only a signed-in Super Admin can.

### Why null-IP sign-ins are not rejected

Phone sign-in over LAN (a phone on `http://192.168.0.150:3000`) legitimately
has no trustworthy IP — there is no proxy in front of the app on the local
network, and the LAN sign-in fix of 2026-11-09 depends on that path working.
Rejecting null-IP auth requests outright would break it. Instead, a null IP
fails closed into the shared `untrusted` rate-limit bucket (strict, one
bucket for all such users) and logs an error in production. Once the
production proxies are confirmed, outright rejection is a deployment
decision to revisit — not a code change to make blind.

## Troubleshooting

**Docker containers stay in "Created" or "Starting" on macOS.** Docker Desktop may be waiting on a macOS privacy prompt for folder access. The compose file avoids bind mounts for this reason. If it still happens, run `docker desktop restart`. Also check that Docker Desktop has access under System Settings → Privacy & Security → Files and Folders.

## Commit conventions

[Conventional Commits](https://www.conventionalcommits.org/) are enforced by commitlint, for example `feat(company): add verification queue`. Staged files are formatted by lint-staged on commit.
