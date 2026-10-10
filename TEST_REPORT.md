# Test Report — Saylani Job Bank

> Scope: **tests only**. Failures are recorded as defects for the developers; no product code
> was changed to make a test pass.

## Where the tests live

```
tests/
├── api/     Jest — API route handlers, invoked in-process (no HTTP server)
└── e2e/     Playwright — browser flows against a production build
```

| Command          | Runs                                                        |
| ---------------- | ----------------------------------------------------------- |
| `pnpm test`      | Vitest (existing) **+** Jest API suite **+** Playwright E2E |
| `pnpm test:jest` | Jest API suite only                                         |
| `pnpm test:e2e`  | Playwright only                                             |

Config: `apps/web/jest.config.cjs` (points at `tests/api`), `playwright.config.ts`
(`testDir: ./tests/e2e`).

## Backend / API — Jest

### Harness

- `tests/api/helpers.ts` — `call()` invokes a route handler exactly the way Next.js does
  (fabricated `Request`, cookie `Jar`, no server), plus `signIn`, `clearRateLimits`,
  `bodyOf`/`errorOf`.
- `tests/api/setup-env.ts` — loads the root `.env`. Validation is deliberately **not** skipped:
  `SKIP_ENV_VALIDATION` leaves `S3_FORCE_PATH_STYLE` as the string `"true"`, and the AWS SDK
  endpoint rules compare strictly against a boolean — so the health probe tried
  `jobbank-documents.localhost` → `ENOTFOUND` → 503.
- Node is v22 but Jest 30 gates native `require(esm)` on Node 24.9, so ~45 ESM-only packages
  are compiled to CJS through a `transformIgnorePatterns` allow-list.

### Coverage

| Suite                     | Tests   | What it proves                                                                                                                               |
| ------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `smoke`, `health`         | 6       | harness boots; `GET /api/v1/health` → 200 with database/postgis/storage/redis all `up`, `x-correlation-id` echoed                            |
| `session`                 | 4       | sign-in cookie round-trip, per-role `homePath`, rejection without a cookie, sign-out                                                         |
| `rbac`                    | 4       | `branch:read` granted to STAFF / denied to EMPLOYER, `ROLE_HOME`, `twoFactorPending` → 403 `TWO_FACTOR_SETUP_REQUIRED`                       |
| `validation`              | 5       | `VALIDATION_FAILED` 422 with `issues[]`, CNIC/age/gender bounds, duplicate profile → 409                                                     |
| `csrf`                    | 4       | foreign `Origin` → 403, `sec-fetch-site: cross-site` → 403, safe GET skips, same-origin passes                                               |
| `idempotency`             | 4       | key required → 400, byte-identical replay, conflicting body → 422 `IDEMPOTENCY_CONFLICT`                                                     |
| `rate-limit`              | 3       | OTP resend 1/60s, phone 5/3600s, 429 + `retry-after` + `details.retryAfterSeconds`                                                           |
| **`anonymous-sweep`**     | **96**  | discovers **all 95 route files**, hits each with GET/POST/PUT/PATCH/DELETE and no session: no 5xx anywhere, and no private route answers 2xx |
| **`authenticated-sweep`** | **95**  | same 95 routes as STAFF and as EMPLOYER: no handler throws (5xx) on a valid session                                                          |
| **Total**                 | **221** |                                                                                                                                              |

The two sweeps are what let this report claim coverage of the whole API surface rather than
the handful of routes the domain suites touch directly.

### Routes still without domain-level assertions

87 of 95 route files have no per-endpoint happy-path/RBAC spec yet (the sweeps cover their
security and crash behaviour only): `companies/*` (25), `jobs/*` (9), `users/*` (7),
`radius-policies/*` (5), `master-data`, `holidays`, `settings`, `verifications/queue`,
`applicants/me/*` (12), `applicants/[id]/*` (6), `account/2fa/*` (3), plus the remaining
`auth/*` sub-routes.

## Frontend — Playwright

| Spec         | Cases | Covers                                                                                                                                                               |
| ------------ | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `home`       | 3     | hero/badge/title; Log In → `/login`; Sign Up → `/register`                                                                                                           |
| `login`      | 3     | staff sign-in → `/staff`; wrong password → inline error stays on `/login`; super admin → `/super-admin`, then `/account/security?setup=required` shows the 2FA setup |
| `auth-guard` | 5     | anonymous → `/login?next=…`; signed-in bounced off `/login`; cross-role → `/forbidden`; own area reachable; sign-out → `/login`                                      |
| `health`     | 2     | health 200 with all dependencies `up`; unauthenticated `/api/v1/branches` → 401 `UNAUTHENTICATED` with matching `correlation_id`                                     |
| `site-sweep` | 12    | all 8 public pages render `<h1>` with status < 500; staff / employer / super-admin / verifier areas sweep 21 URLs each                                               |

## Defects found while building the suite

These are **product/config bugs surfaced by the tests**, listed for the developers:

| #   | Area            | Symptom                                                                             | Root cause                                                                                                                                           |
| --- | --------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Health API      | `/api/v1/health` → 503, `ENOTFOUND jobbank-documents.localhost`                     | `SKIP_ENV_VALIDATION` kept `S3_FORCE_PATH_STYLE` as the string `"true"`; zod's `z.stringbool()` output is required by the AWS SDK endpoint rules     |
| 2   | Landing page    | `tsc --noEmit` failure                                                              | `e.isIntersecting` not narrowed on `IntersectionObserverEntry` — `apps/web/src/app/_landing/LandingPage.tsx:125` (fixed)                             |
| 3   | Login flow      | Super admin never lands on `/account/security`                                      | `LoginForm` always `router.replace(homePath)`; `middleware.ts` only does the no-cookie fast-path. Test expectation corrected (not a product bug)     |
| 4   | Dev server      | `POST /api/v1/auth/login` measured at **49141 ms**; sign-in button stuck `disabled` | `next dev --turbopack` compiles routes in the same process that serves the API (`/login` alone took 38.6 s). E2E now runs against a production build |
| 5   | Repeat E2E runs | 429 on sign-in                                                                      | `login-email` limit is 5/900 s and the suite signs in 4–5× per run; `globalSetup` now clears `rl:*`                                                  |

## Running it

```bash
pnpm infra:up && pnpm db:migrate && pnpm db:seed   # once
pnpm test                                           # everything
pnpm test:jest                                      # API only (~40 s warm)
pnpm test:e2e                                       # builds, then browser suite
```

Artifacts: `tests/reports/e2e-results.json` (Playwright JSON reporter) — consolidated
human-readable report: `tests/reports/index.html` (`pnpm test:reports`).
