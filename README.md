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

### Local services

| Service | Address |
entials |
| ------------------- | --------------------------------------------------------- | -------------------------------------------- |
| App | http://localhost:3000 | — |
| Health check | http://localhost:3000/api/v1/health | — |
| PostgreSQL | `localhost:5433`, db `jobbank` (tests use `jobbank_test`) | owner `jobbank/jobbank`, app `app_rw/app_rw` |
| S3 (SeaweedFS) | http://localhost:8333, bucket `jobbank-documents` | `jobbank` / `jobbank-dev-secret` |
| Redis | `localhost:6380` | — |
| Mailpit (dev inbox) | http://localhost:8025 | — |

The ports are 5433 and 6380 rather than the defaults, so they don't clash with a local Postgres or Redis.

## Signing in locally

`pnpm db:seed` creates two branches (Karachi Gulshan and Lahore Johar Town) and one account per role. These are development-only accounts and are never seeded in production.

- **Staff and employers** sign in at http://localhost:3000/login under **Staff & employers**. The emails and the shared development password are in [`packages/db/src/seed/dev-data.ts`](packages/db/src/seed/dev-data.ts).
- **Applicants** use the **Job seekers** tab with a mobile number. In development, the SMS code is printed in the `pnpm dev` terminal (look for `📱 [dev SMS …]`). Any new Pakistani mobile number registers a new applicant.

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

## Troubleshooting

**Docker containers stay in "Created" or "Starting" on macOS.** Docker Desktop may be waiting on a macOS privacy prompt for folder access. The compose file avoids bind mounts for this reason. If it still happens, run `docker desktop restart`. Also check that Docker Desktop has access under System Settings → Privacy & Security → Files and Folders.

## Commit conventions

[Conventional Commits](https://www.conventionalcommits.org/) are enforced by commitlint, for example `feat(company): add verification queue`. Staged files are formatted by lint-staged on commit.
