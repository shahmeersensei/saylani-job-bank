# Saylani Job Bank — Project Handoff

> Last updated: **3 Oct 2026** · Status: **M0–M7 complete + UI polish** · Next: **M8 — Jobs & Postings** (awaiting owner "go")

This document hands the project over between Claude sessions. It covers:

- what was discussed and decided
- the full plan, with each module's status
- what is done and what is not
- exactly where to continue
- a ready-to-paste prompt for a new session

Related documents:

- [`project_PRD.md`](project_PRD.md): the original requirements (PRD v3.0)
- [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md): the detailed module-by-module plan, with "as built" notes added per module
- [`README.md`](README.md): setup, local services, sign-in notes and scripts

---

## 1. How we work (agreed with the project owner)

- **One module at a time.** Build a module, test it fully, then stop and wait for the owner to test. Start the next module only after an explicit "go". Never build several modules at once.
- **Each module ends with:**
  - lint, typecheck and tests (unit, component, integration) all passing
  - a production build
  - checks in the real browser
  - a short "how to test it" list for the owner
- **Product decisions are asked, not assumed.** Defaults are proposed with a recommendation, and the owner picks.

---

## 2. Conversation summary (what happened, in order)

1. **Planning.** The PRD (`project_PRD.md`) was analysed and a detailed module plan was written in `IMPLEMENTATION_PLAN.md`. The owner chose:
   - **Repo:** a pnpm + Turborepo monorepo.
   - **Database:** Drizzle ORM on PostgreSQL + PostGIS.
   - **Auth:** Better Auth (Lucia is deprecated).
2. **M0 Infrastructure.**
   - **Monorepo and Docker:** the monorepo, Docker services, env validation, health endpoint, CI, git hooks.
   - **Docker issues:**
     - `minio/minio` images are no longer published, so we switched to **SeaweedFS** for local S3.
     - Docker Desktop hung on a macOS folder-permission prompt, so all config files are now **inlined** in `docker-compose.yml` (no bind mounts).
     - Ports: **Postgres 5433** and **Redis 6380**, because the owner has a local Redis on 6379.
   - **The `!` command box:** it couldn't find `pnpm`. pnpm was then installed globally (`npm i -g pnpm`) at `/usr/local/bin`; the Terminal panel always worked.
3. **M1 Design system.**
   - **Built:** tokens, light/dark/system theme, 16 atoms, 15 molecules, 7 organisms, 4 templates, and a dev-only gallery at `/dev/components`.
   - **Moved to later modules:** the domain organisms (MaskedCandidateCard → M10, InterviewCard → M11, DecisionPanel → M12, DocumentList → M6/M7).
   - **Fixed:**
     - horizontal overflow, caused by `sr-only` text inside unpositioned scroll containers
     - a stepper overflow, solved with container queries
     - a select that looked disabled
     - the OTP input dropping digits (stale state, then `maxLength` truncating iOS autofill)
4. **M2 Shared kernel.**
   - **Built:** errors mapped to the HTTP error envelope, the state-machine helper, audited `runCommand`, idempotency, list queries, masking, branch scope, the event bus, and the `apiHandler` pipeline.
   - **Fixed:**
     - the AWS SDK checksum bug that broke presigned uploads (`requestChecksumCalculation: 'WHEN_REQUIRED'`)
     - domain-event typing (the events module is a single file, so declaration merging works)
     - `cache-control: no-store` lost on raw responses
5. **M3 Auth, RBAC and scoping.**
   - **Built:**
     - Better Auth, with our own **HMAC-hashed SMS OTP table** (the plugin stores codes in plain text)
     - password login for staff and employers
     - 6 roles and 29 permissions (`packages/shared/src/permissions.ts`), with tests locking in the PRD rules
     - branch scoping, plus audit rows for scope violations
     - CSRF Origin checks, Redis-backed rate limits, guarded role dashboards, and seeded dev accounts
   - **Fixed:**
     - Better Auth's `APIError` exists in two bundled copies, so `instanceof` failed; errors are now matched by name
     - the OTP autofill bug
     - drizzle-kit quoting the `geography` type; a guard test now catches it
6. **M4 Branch and user management.** The owner decided:
   - **2FA (authenticator app) is REQUIRED for Super Admin and Branch Admin**, and optional for everyone else.
   - **Employers can sign in with an emailed one-time code** (they keep password sign-in as well).

   Built: branch create/edit/deactivate (map pin, radius ≤ 10 km), staff directory, email invitations, role grant/revoke, disable/enable with a reason, 2FA reset, forgot/reset password, the security page, mailer + Mailpit, and a Modal component.

   Fixed:
   - a Zod `.default()` leaking into PATCH, which reset the branch radius
   - a dev hot-reload issue with a stale drizzle casing cache (only the connection pool is global now, and Better Auth is cached per module)
   - Better Auth logs now go through our redacting logger

7. **Owner verified M4** (`pnpm test`: 241 web + 17 db tests passing). The owner asked for this handoff file before continuing.
8. **M5 Master data and settings.** The owner decided:
   - **One radius source:** the branch radius moved into `match_radius_policies`, and `branches.service_radius_m` was dropped.
   - **Hard 10 km cap:** no override, enforced by a database CHECK.
   - **Branch Admin overrides the radius only**, within the global max.
   - **Weekend is Sunday only**, stored as a setting.

   Built:
   - master data CRUD (12 lists, Pakistan seed) and holidays
   - typed global settings
   - radius policies with job → category → branch → global resolution, capped by the global max
   - the working-day SLA calendar
   - Super Admin Master data and Settings pages, and the Branch Admin Branch settings page

   Fixed along the way:
   - The branch form's Save button stayed stuck after a save on the same page.
   - A branch save audited unchanged fields.

9. **M6 Applicant domain.** The owner accepted every recommended default (details in `IMPLEMENTATION_PLAN.md`, "M6 decisions"):
   - profiles **activate automatically** once personal details, home pin + branch and both CNIC images are in; staff identity verification is a separate check (M10 should require it before referral)
   - any active branch may be chosen (nearest pre-selected); after activation only Branch Admin / Super Admin can transfer
   - a duplicate CNIC gets a 409 naming the branch to contact; staff can move a profile to a new mobile number
   - CNIC, names and DOB lock once verified; staff corrections (with a reason) reset the identity check
   - minimum age 18; gender Male / Female / Prefer not to say; father's/husband's name required; CNIC stored in full, never shown to employers
   - applicants pause/resume their own profile; staff deactivate with a reason

   Built: 10 applicant tables, 22 API routes, the 7-step profile wizard, applicant overview and Documents page, and staff/Branch Admin/Super Admin applicant search and detail pages (identity check, audited document views, corrections, mobile change, deactivate, transfer). Also: the `DocumentList` organism, a compact Stepper for long wizards, and an `isUniqueViolation` kernel helper.

   The owner accepted M6 on 2 Oct 2026.

   Fixed along the way:
   - A server page imported a constant from a `'use client'` module (it arrives as a client reference, not the value). Constants needed by server pages now live in plain modules.
   - A `useEffect(() => fn())` shorthand turned `fn`'s return value into the effect cleanup, which looped. Use a block body.
   - ESLint now ignores alternate Next build folders (`.next-*/`), e.g. `.next-build`.

---

## 3. Tech stack (final)

| Area           | Choice                                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo       | pnpm 12 workspaces + Turborepo 2 (`apps/web`, `packages/{db,shared,config}`)                                                      |
| App            | Next.js **15.5** (App Router, Turbopack dev), React 19, TypeScript 5.9 strict                                                     |
| Styling        | Tailwind v4 (CSS-first `@theme`), semantic CSS-variable tokens, Radix UI primitives, lucide icons                                 |
| Database       | PostgreSQL 16 + PostGIS 3.4, **Drizzle ORM 0.45** (`casing: 'snake_case'`), postgres.js                                           |
| Auth           | **Better Auth 1.7.6**: `phoneNumber` (custom HMAC OTP), `emailOTP` (hashed), `twoFactor` (TOTP)                                   |
| Storage        | S3-compatible: **SeaweedFS** locally, R2/S3 in production (presigned PUT/GET)                                                     |
| Cache / limits | Redis (`ioredis`), fixed-window rate limiter with in-memory fallback                                                              |
| Email          | nodemailer → **Mailpit** locally (http://localhost:8025); `MAIL_TRANSPORT=memory` in tests                                        |
| Maps           | Leaflet + react-leaflet (OSM tiles in dev; set `NEXT_PUBLIC_MAP_TILE_URL` for production)                                         |
| Tests          | Vitest 5 projects: `unit` (node), `components` (jsdom + Testing Library + axe-core), `integration` (real DB/S3 on `jobbank_test`) |

---

## 4. Module status (full plan)

The full plan is in `IMPLEMENTATION_PLAN.md`. The status of each module:

| #      | Module                                                                         | Phase | Status                                                       |
| ------ | ------------------------------------------------------------------------------ | ----- | ------------------------------------------------------------ |
| M0     | Infrastructure & Tooling                                                       | 0     | ✅ Done                                                      |
| M1     | Design System & Atomic Components                                              | 0     | ✅ Done (4 domain organisms moved to M6/7/10/11/12)          |
| M2     | Shared Kernel                                                                  | 0     | ✅ Done (also built the `audit_logs` table early)            |
| M3     | Auth, RBAC & Branch Scoping                                                    | 1     | ✅ Done                                                      |
| M4     | Branch & User Management (+ 2FA, employer email codes, password reset)         | 1     | ✅ Done                                                      |
| M5     | Master Data & System Settings                                                  | 1     | ✅ Done                                                      |
| **M6** | **Applicant domain (profile wizard, location pin, documents, identity check)** | 1     | ✅ Done                                                      |
| M7     | Company & Verification (verifier queue, SLA, state machine)                    | 1     | ⏭️ **NEXT**                                                  |
| M18    | Role dashboards: basic Super Admin and Branch Admin (KPI tiles)                | 1     | 🟡 Shells only (welcome pages)                               |
| M8     | Jobs                                                                           | 2     | ⬜                                                           |
| M9     | Geospatial matching engine                                                     | 2     | ⬜ (PostGIS helpers exist in `lib/geospatial`)               |
| M10    | Match Case & Referral (+ masked candidate view)                                | 2     | ⬜                                                           |
| M11    | Interviews (physical only)                                                     | 2–3   | ⬜                                                           |
| M12    | Decisions & Counteroffers (append-only)                                        | 3     | ⬜                                                           |
| M13    | Placement & Follow-ups (Day 7/30/90/180)                                       | 3–4   | ⬜                                                           |
| M14    | Blacklist & Restrictions                                                       | 4     | ⬜                                                           |
| M15    | Audit (explorer UI, partitioning)                                              | 4     | 🟡 Table + writers done in M2; UI not started                |
| M16    | Notifications (in-app, SMS, email, push)                                       | 4     | 🟡 Mailer + dev SMS sender exist; no notification system yet |
| M17    | Reporting & Analytics                                                          | 4     | ⬜                                                           |
| M19    | PWA & Performance                                                              | 4     | ⬜                                                           |

### What M7 must deliver (from the plan)

See `IMPLEMENTATION_PLAN.md` § M7: companies, contacts, locations (geography), documents and per-type requirements, verifications with SLA (`slaDueDate` from M5), append-only verification history, the verifier queue (claim, request info, verify, reject with reason code), the employer registration wizard, and the rule that Branch Admin sees only VERIFIED companies. Reuse the `DocumentList` organism, `DOCUMENT_TYPE` meta (`appliesTo: COMPANY`) and the presign → confirm upload pattern from M6.

---

## 5. What exists today (inventory)

### Database (migrations `0000`–`0010`)

| Area      | Tables                                                                                                                                                                                                                                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bootstrap | Extensions `postgis`, `pgcrypto`, `citext`. Role `app_rw`. Helpers `jobbank_make_append_only(regclass)` and `jobbank_attach_updated_at(regclass)`. SQLSTATE `JB001` = append-only violation.                                                                                                                                                           |
| System    | `audit_logs` (append-only: trigger + revoked privileges), `idempotency_keys`                                                                                                                                                                                                                                                                           |
| Identity  | `users` (status ACTIVE/DISABLED/INVITED, `title`, `two_factor_enabled`), `sessions`, `accounts`, `verifications`, `otp_challenges` (HMAC codes), `two_factors` (encrypted TOTP), `account_tokens` (invite/reset, SHA-256)                                                                                                                              |
| RBAC      | `roles`, `permissions`, `role_permissions` (synced from `packages/shared`), `user_roles` (branch required exactly for BRANCH_ADMIN/VERIFIER/STAFF; enforced by CHECK; unique NULLS NOT DISTINCT)                                                                                                                                                       |
| Branches  | `branches` (code immutable, `geography(Point,4326)` location with GiST index). The matching radius lives in `match_radius_policies` since M5.                                                                                                                                                                                                          |
| Settings  | `master_data` (12 types, `(type, code)` unique, per-type `meta`), `holidays`, `system_settings` (`key`, nullable `branch_id`), `match_radius_policies` (GLOBAL/BRANCH/CATEGORY, CHECK ≤ 10 km)                                                                                                                                                         |
| Applicant | `applicants` (CNIC unique, status DRAFT/ACTIVE/INACTIVE/RESTRICTED, identity status, completeness; ACTIVE needs a branch), `applicant_addresses` (one pin, GiST), education, experience, skills, languages, certifications, preferences (radius ≤ 10 km), `applicant_documents` (never deleted; `replaced_at`), `identity_verifications` (append-only) |

### API (`/api/v1`, all through `apiHandler`)

- **Health:** `GET /health`
- **Auth, staff:**
  - `POST /auth/login` (returns `two_factor_required` when needed)
  - `POST /auth/2fa/verify`
  - `POST /auth/logout`
  - `GET /auth/me`
  - `PUT /auth/scope` (Super Admin branch switcher)
- **Auth, applicants:** `POST /auth/otp/request`, `POST /auth/otp/verify`
- **Auth, employers:** `POST /auth/email-otp/request`, `POST /auth/email-otp/verify`
- **Auth, links:**
  - `GET /auth/invitations/lookup`
  - `POST /auth/invitations/accept`
  - `POST /auth/password/forgot`
  - `POST /auth/password/reset`
- **Account:** `POST /account/2fa/enroll`, `POST /account/2fa/confirm`, `POST /account/2fa/disable`
- **Branches:**
  - `GET` and `POST /branches` (POST needs an `Idempotency-Key`)
  - `GET` and `PATCH /branches/{id}`
- **Master data (M5):**
  - `GET /master-data?type=` (any signed-in user)
  - `POST /master-data` (needs an `Idempotency-Key`)
  - `PATCH /master-data/{id}`
  - `GET` and `POST /holidays`
  - `PATCH /holidays/{id}`
- **Settings (M5):**
  - `GET /settings`
  - `PUT /settings/{key}`
  - `GET /radius-policies`
  - `PUT /radius-policies/global`
  - `PUT` and `DELETE /radius-policies/branches/{branchId}` and `/radius-policies/categories/{categoryId}`
  - `GET /radius-policies/resolve`
- **Applicants, self-service (M6):**
  - `POST /applicants/register` (needs an `Idempotency-Key`)
  - `GET` and `PATCH /applicants/me`
  - `PUT /applicants/me/{location|education|experience|skills|languages|certifications|preferences}`
  - `GET /applicants/me/branch-options?lat&lng`
  - `PATCH /applicants/me/status` (pause/resume)
  - `GET` and `POST /applicants/me/documents` (types; presign), `POST /applicants/me/documents/{id}/confirm`, `DELETE /applicants/me/documents/{id}`, `GET /applicants/me/documents/{id}/url`
- **Applicants, staff (M6):**
  - `GET /applicants` (branch-scoped search: name, CNIC or mobile; status, identity, skill, area, branch)
  - `GET` and `PATCH /applicants/{id}` (PATCH = correction with reason)
  - `POST /applicants/{id}/identity-verification`
  - `PUT /applicants/{id}/phone`, `PATCH /applicants/{id}/status`, `POST /applicants/{id}/transfer`
  - `GET /applicants/{id}/documents/{docId}/url` (every view is audited)
- **Users (staff):**
  - `GET` and `POST /users` (POST needs an `Idempotency-Key`)
  - `GET` and `PATCH /users/{id}`
  - `POST /users/{id}/roles`
  - `DELETE /users/{id}/roles/{assignmentId}`
  - `PATCH /users/{id}/status`
  - `POST /users/{id}/invitation`
  - `POST /users/{id}/two-factor/reset`

### Pages

- **Public and auth:**
  - `/` (home)
  - `/login` (phone OTP tab; staff tab with password + 2FA step, forgot-password link, employer email code)
  - `/forgot-password`, `/reset-password`, `/accept-invite`
  - `/account-disabled`, `/forbidden`
- **Shared:** `/account/security`, for 2FA setup and status (admins are forced here until they enroll).
- **Super Admin:** `/super-admin`, `/super-admin/applicants` (+ `/[id]`), `/super-admin/branches` (+ `/new`, `/[id]`), `/super-admin/staff` (+ `/[id]`), `/super-admin/master-data`, `/super-admin/settings`
- **Branch Admin:** `/branch-admin`, `/branch-admin/applicants` (+ `/[id]`), `/branch-admin/staff` (+ `/[id]`), `/branch-admin/settings`
- **Staff:** `/staff` (welcome shell), `/staff/applicants` (+ `/[id]`)
- **Applicant:** `/applicant` (overview), `/applicant/profile` (wizard, `?step=`), `/applicant/documents`
- **Welcome shells:** `/verifier`, `/employer`
- **Dev only:** `/dev/components` (gallery, plus dashboard, auth and wizard demos). These routes return 404 in production.

### Key code locations

| Path                                                            | What lives there                                                                                                                                                                                                |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/domains/shared/`                                  | The kernel: `http/handler.ts` (apiHandler), `audit/` (runCommand, recordAudit), `errors/`, `state-machine/`, `scope/` (Actor, branchScope), `pagination/`, `idempotency/`, `events/`, `masking/`, `rate-limit/` |
| `apps/web/src/domains/auth/`                                    | Better Auth config (`auth.ts`), `otp.ts`, `actor.ts`, `service.ts`, `account-tokens.ts`, `two-factor.ts`, `server-session.ts` (`requireRole` / `requireSignedIn`)                                               |
| `apps/web/src/domains/branch/`, `apps/web/src/domains/user/`    | Branch and staff management; staff rules in `user/policy.ts`                                                                                                                                                    |
| `apps/web/src/domains/settings/`                                | Master data, holidays, typed settings, radius policies (`resolveMatchRadius` for M9/M10), working-day calendar (`slaDueDate` for M7)                                                                            |
| `apps/web/src/domains/applicant/`                               | `profile.ts` (self-service), `documents.ts` (presign/confirm/links), `staff.ts` (search, identity check, corrections, transfer), `repository.ts` (views, completeness, auto-activation), `machine.ts`           |
| `apps/web/src/app/(dashboard)/applicant/_components/`           | Profile wizard steps (`step.ts` contract), `DocumentsManager`; shared applicant UI in `_components/applicants/`                                                                                                 |
| `apps/web/src/components/{atoms,molecules,organisms,templates}` | The design system                                                                                                                                                                                               |
| `apps/web/src/app/(dashboard)/_components/`                     | Role shell, navigation (`navigation.ts`, add new pages here), staff and branch UI                                                                                                                               |
| `apps/web/src/test/`                                            | Test helpers: `api-client.ts` (cookie jar, 2FA-aware `signIn` / `signInAdmin`), `factories.ts` (`makeActor`), DOM setup, axe helper                                                                             |
| `packages/db/src/schema/`                                       | Drizzle tables                                                                                                                                                                                                  |
| `packages/db/src/seed/`                                         | `reference-data.ts` (roles and permissions), `master-data.ts` (Pakistan lists and holidays; insert-only, safe in production), `dev-data.ts` (dev branches and users, plus the dev password)                     |
| `packages/shared/src/`                                          | Roles, permissions matrix, API envelope, password policy, master-data types and `meta` schemas, setting definitions, radius limits                                                                              |

### Conventions to keep following

- **Writes:** every state-changing use case runs in `runCommand(ctx, …)` and must call `audit(...)`. Otherwise it throws `MissingAuditError` and rolls back.
- **Scoping:** every list or read query is branch-scoped via `branchScope(actor, column)` or `assertBranchAccess(...)`. A scope violation is audited automatically: by `apiHandler`, or by `loadForPage` in server pages.
- **Imports:** domains import each other only through `index.ts`. ESLint enforces this; shared-kernel modules are reached via `@/domains/shared/<module>`.
- **Migrations:** after `drizzle-kit generate`, check for quoted `"geography(...)"` and unquote it (a test guards this). Add triggers with a custom migration (`drizzle-kit generate --custom`). Append-only tables call `jobbank_make_append_only`.
- **Routes:** use `apiHandler({ permission, body, query, params, idempotent, output, handler })`. Employer-facing responses must use **strict** `output` schemas, so personal data can't leak.
- **Tests:** unit tests are `*.test.ts`, component tests `*.test.tsx`, integration tests `*.integration.test.ts`. The test database persists between runs, so use unique emails and codes, and don't assert exact global counts. `signInApplicant(randomPhone())` in `test/api-client.ts` signs up/in an applicant.
- **Client modules:** never import a constant from a `'use client'` file into a server component; put shared constants in a plain module.
- **Uploads:** presign → browser PUT → server confirm (HEAD check + scan). Document rows are never deleted.

---

## 6. What is NOT done / open items

- **Modules M7–M19.** Not started, apart from the partial pieces listed in §4.
- **Production SMS gateway (decision needed).** `SMS_PROVIDER=console` only prints codes to the dev log, and production refuses to start with it.
- **Open product questions** (defaults chosen; still to confirm with stakeholders):
  - whether employers ever see applicant contact details after placement (default: no)
  - whether new jobs need staff approval (default: off)
  - Urdu localisation in v1 or later
- **Placeholders:**
  - The brand mark is a placeholder until official Saylani assets arrive.
  - The malware scanner is stubbed (`skipped`); ClamAV is planned for Phase 4.
- **Not configured yet:**
  - **CORS** on the production R2/S3 bucket: allow `PUT` and `GET` from the app origin with the `content-type` header. Local SeaweedFS already allows it.
  - **Clean-up job** for presigned uploads that were never confirmed (`applicant_documents.status = PENDING_UPLOAD`), planned with the Phase 4 queues.
  - **Production map tiles:** `NEXT_PUBLIC_MAP_TILE_URL` (OSM's public tiles are for development only).
- **Git:** M0–M5 are committed on `main` and pushed. M6 is not committed yet; commit it with the owner's approval before starting M7.
- **Security clean-up (owner to do):** `creds.txt` is committed and pushed (rotate anything in it and remove it from the repo); `jobbank-backup-codes*.txt` files sit untracked in the repo root; `apps/web/src/domains/auth/otp.ts` has an uncommitted `console.log` that prints every OTP code (should be reverted).
- **Not wired into CI yet:** Playwright end-to-end tests are planned but not added.

---

## 7. How to run and verify

```bash
pnpm infra:up                 # Postgres :5433, SeaweedFS S3 :8333, Redis :6380, Mailpit :8025
pnpm db:migrate && pnpm db:seed
pnpm dev                      # http://localhost:3000
pnpm test                     # unit + component + integration (Docker must be running)
pnpm turbo run lint typecheck
NEXT_DIST_DIR=.next-build pnpm --filter @jobbank/web build   # build without clobbering the dev server
```

- **Dev accounts:**
  - **Staff and employer accounts:** the emails and the shared dev password are in `packages/db/src/seed/dev-data.ts`.
  - **Applicant:** sign in by phone, e.g. `0300 1234567`. The SMS code is printed in the dev-server log.
  - **Super Admin and Branch Admin:** they must enroll an authenticator app at first sign-in. The local dev admin's 2FA was reset, so the owner enrolls their own phone.
- **Email:** all email goes to Mailpit at http://localhost:8025.
- **Last verified state:**
  - **Tests:** 312 web tests (51 files) and 34 db tests pass (after M6).
  - **Quality gates:** lint, typecheck and format are clean, and the production build is clean.
- **Environment notes:**
  - Node runs from `/usr/local/bin` (v26). pnpm 12.8.1 is installed globally.
  - If Docker containers hang at "Starting", run `docker desktop restart`.

---

## 8. Where to continue

**M6 is done and the owner accepted it.** Start **M7: Company & Verification** (see `IMPLEMENTATION_PLAN.md`), following §1: propose the M7 schema and ask the product questions first.

M7 should reuse M5 and M6:

- **Upload rules:** `DOCUMENT_TYPE` meta with `appliesTo: COMPANY` (`mimeTypes`, `maxSizeMb`, `required`, `multiple`).
- **Upload flow and UI:** the presign → confirm pattern and the `DocumentList` organism from M6.
- **SLA:** `slaDueDate` / working-day calendar from M5.

## 9. Prompt to continue in a new Claude session

Copy and paste this into a new session opened in this project folder:

```text
Hi! I'm continuing the Saylani Job Bank project (Next.js 15 + Drizzle/PostGIS + Better Auth monorepo).
Please read these files first, in this order:
1. PROJECT_HANDOFF.md  (current status, decisions, conventions, where to continue)
2. IMPLEMENTATION_PLAN.md  (full module plan; look at M7 and the "as built" notes)
3. README.md  (how to run)

Modules M0–M6 are complete and verified. Continue with M7 — Company & Verification,
following the working agreement in PROJECT_HANDOFF.md §1: build ONE module, verify it fully
(lint, typecheck, unit/component/integration tests, production build, browser check), then stop
and give me a short "how to test" list, and wait for my "go" before starting the next module.
Ask me before making product decisions. Start by checking that Docker services are up
(pnpm infra:up) and that `pnpm test` passes, then propose the M7 schema before writing code.
```
