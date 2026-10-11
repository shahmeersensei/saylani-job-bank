# QA Report — `test/api-and-ui-test-suites`

> Branch: `test/api-and-ui-test-suites` · Commit: `4ef8206` · Date: 2026-10-10
> Sirf **test + QA**, product code change nahi. Har failure ko defect ke taur par record kiya gaya hai.

---

## 1. Test Runs ka Natija

| Suite                                 | Command                           | Result                                    | Time  |
| ------------------------------------- | --------------------------------- | ----------------------------------------- | ----- |
| Typecheck                             | `pnpm typecheck`                  | **PASS** — 3/3 packages                   | 2m    |
| Lint                                  | `pnpm lint`                       | **FAIL** — 39 errors (38 web + 1 shared)  | 1m37s |
| Unit (Vitest)                         | `pnpm --filter @jobbank/web test` | **PASS** — 315 passed / 53 files          | 267s  |
| API (Jest)                            | `pnpm test:jest`                  | **PASS** — 351 passed / 13 suites         | 177s  |
| E2E (Playwright, prod build, `:3001`) | `pnpm test:e2e`                   | **44 passed / 10 failed**                 | 7.1m  |
| Visual regression (Playwright)        | `pnpm test:visual-verify`         | **PASS** — 5/5 baselines                  | 17s   |
| Cross-browser (Chromium/FF/WebKit)    | `pnpm test:cross-browser`         | **PASS** — 12/12                          | 1.8m  |
| Load — API (Artillery)                | `pnpm test:api-load`              | **PASS** — 700 req, p95 33ms              | ~1m   |
| Load — Web (Artillery)                | `pnpm test:web-load`              | **PASS** — 480 vusers, p95 82ms           | ~1m   |
| Load — DB (direct Postgres)           | `pnpm test:db-load`               | **PASS** — reads p95 8ms, writes p95 16ms | ~10s  |
| Security (audit-ci)                   | `pnpm test:security`              | **FAIL** — 9 advisories                   | ~10s  |

### E2E ke 10 failures — breakdown

| Root cause                                             | Count | Tests                                               |
| ------------------------------------------------------ | ----- | --------------------------------------------------- |
| 2FA gate redirect → `/account/security?setup=required` | 4     | `branch-admin.spec:24,32,48`, `super-admin.spec:24` |
| Login rate-limit **429**                               | 4     | `super-admin.spec:40,56,68`, `verifier.spec:46`     |
| `SMS_PROVIDER=console` → prod 500                      | 1     | `login.spec:45`                                     |
| `/forbidden` page par `<h1>` hi nahi                   | 1     | `site-sweep.spec` (public sweep)                    |

> Note: Pehla E2E run **52/54 fail** hua kyunke machine par Playwright browsers
> (`chromium_headless_shell`) install hi nahi the. `pnpm exec playwright install chromium`
> ke baad ye numbers aaye. Ye environment issue hai, product defect nahi — lekin isi wajah se
> CI me bhi E2E kabhi pass nahi hoga (D-12 dekho).

---

## 2. Defects

**Total: 13** — 3 Critical · 8 Major · 2 Minor (D-11 purana/known, baaki 12 naye)

| ID   | Severity | Area           | One-liner                                                            |
| ---- | -------- | -------------- | -------------------------------------------------------------------- |
| D-01 | Critical | Backend/Config | Prod server har request 500 (`BETTER_AUTH_SECRET` khaali)            |
| D-02 | Critical | Backend/Auth   | SMS login prod me broken + OTP logs me leak                          |
| D-03 | Critical | Auth/Seed      | Seeded admin 2FA gate me phansta, dashboard nahi khulta              |
| D-04 | Major    | Tooling        | Lint 39 errors, CI block                                             |
| D-05 | Major    | API            | Unknown route HTML 404, JSON envelope nahi                           |
| D-06 | Major    | Security       | Koi security header nahi (CSP/HSTS/X-Frame-Options)                  |
| D-07 | Major    | Security       | Repo me creds.txt + 2FA backup codes commit                          |
| D-08 | Major    | UX/Backend     | Login rate-limit tight, UI me cooldown feedback nahi                 |
| D-09 | Major    | A11y/UI        | `/forbidden` par `<h1>` nahi                                         |
| D-12 | Major    | CI             | E2E kabhi pass nahi hoga (browser install step nahi) + lint CI block |
| D-13 | Major    | Security/Dep   | 9 vulnerable npm advisories (audit-ci --moderate)                    |
| D-10 | Minor    | UI             | Select restyle Input/Textarea se mismatch                            |
| D-11 | Minor    | Perf           | `next dev` login 49s (known)                                         |

### CRITICAL

**D-01 · Production server har request par 500 deta hai**
`.env` me `BETTER_AUTH_SECRET=` khaali hai. `next.config.ts:12` `loadEnvConfig(repoRoot, …)` root
`.env` ko production me bhi load karta hai, isliye `pnpm build && pnpm start` ke baad **har route**
(including `/api/v1/health`) yeh mar-ta hai:

```
BETTER_AUTH_SECRET must be set in production (openssl rand -base64 32)
→ 500 {"error":{"code":"INTERNAL",…}}
```

Reproduce:

```
set PORT=3001 && pnpm --filter @jobbank/web start
curl localhost:3001/api/v1/health   # 500
```

Playwright config isse work around karta hai (`playwright.config.ts:26` ek dummy secret inject
karta hai) — isliye tests green ho sakte hain par **real deployment dead on arrival hai**.
Fix: deploy config me secret set karo, aur boot par hi fail-fast karo (request ke bajaye).

---

**D-02 · Job-seeker SMS login production me poora broken + OTP logs me leak**

`.env:36` → `SMS_PROVIDER=console`. Production me ye **jaan-bujh kar** 500 deta hai:

```
POST /api/v1/auth/otp/request → 500
"SMS_PROVIDER=console cannot be used in production; configure a real SMS gateway"
```

Iska matlab: **signup / login ka poora applicant funnel production me kaam nahi karta.**

Aur usse pehle OTP stdout par chhap jata hai:

```
Issuing OTP for +923009991234: 750222 (expires in 300s)
```

Production logs me live OTP = **secret leak**. Console provider ko prod me sirf allow hi mat karo
ya log se redact karo.

E2E proof: `login.spec:45` — form par raha "Something went wrong on our side", code-step kabhi
nahi aaya.

---

**D-03 · Seeded SUPER_ADMIN / BRANCH_ADMIN apna dashboard kabhi nahi dekh sakte**

`packages/shared/src/roles.ts:26`:

```ts
export const TWO_FACTOR_REQUIRED_ROLES: readonly Role[] = ['SUPER_ADMIN', 'BRANCH_ADMIN'];
```

`server-session.ts:26` in roles ko seed-every-time `/account/security?setup=required` par bhej
deta hai. Lekin `packages/db` seed **koi TOTP secret enroll nahi karta** — result: in accounts ke
liye `/super-admin` aur `/branch-admin` **hamesha** redirect hota hai, dashboard kabhi render
nahi hota. 4 E2E tests isi se gaye.

Ye product bug hai, test bug nahi: naya admin signup karke 2FA set kiye bagair trapped ho jata hai.
Fix options: seed me TOTP enroll karo, ya setup-required flow ko pehle complete karne do aur uske
baad hi gate lagao.

---

### MAJOR

**D-04 · `pnpm lint` red hai — 39 errors, CI blocking**

```
@jobbank/shared  1 error   packages/shared/src/job.ts:46  'optText' unused
@jobbank/web    38 errors  apps/web (19 files)
```

Error categories:

- `@typescript-eslint/no-unused-vars` — ~25 (`LoginForm.tsx:8 Tabs`, `WelcomePanel.tsx`,
  `verifier.ts` me 9 dead imports, `staff.ts`, `job/repository.ts`, `TopBar.tsx:12`, …)
- `no-restricted-imports` — 7: `@/domains/*/repository` aur `@/domains/job/rules` directly
  import kiye gaye hain jabke rule kehta hai public entry point (`@/domains/job`) se aao.
  Files: `StaffCompanyPanel.tsx`, `CompanyStatusPanel.tsx`, `CompanyWizard.tsx`,
  `JobDetailPanel.tsx`, `JobWizard.tsx`, `companies/me/documents/route.ts`, `job/profile.ts`
- `@typescript-eslint/no-explicit-any` — `company/staff.ts:246`
- `consistent-type-imports` — `import()` type annotation 2 test files me

`next.config.ts` me `eslint.ignoreDuringBuilds: true` hai, isliye **build to green hai par lint
kisi CI step me todega**.

---

**D-05 · Unknown API route JSON ki jagah HTML 404 deta hai**

```
GET /api/v1/branches     → 401 {"error":{"code":"UNAUTHENTICATED",…}}   ✅ envelope
GET /api/v1/nope         → 404 <!DOCTYPE html>… (Next.js ka default page)  ❌
```

Client jo `error.code` parse karta hai wo toot jata hai. Har API 404 par bhi standard envelope
chahiye.

---

**D-06 · Koi security header nahi**

`next.config.ts` + `middleware.ts` me:

- `Content-Security-Policy` — absent
- `Strict-Transport-Security` — absent
- `X-Frame-Options` / `frame-ancestors` — absent (clickjacking open)
- `X-Content-Type-Options` — absent
- `Referrer-Policy`, `Permissions-Policy` — absent

Sirf `poweredByHeader: false` set hai. Middleware sirf correlation-id lagata hai
(`middleware.ts:27-31`). Ye sab ek custom header layer me 5 min ka kaam hai.

---

**D-07 · Repo me credentials aur live 2FA backup codes commit hue hain**

`git ls-files` se confirmed:

```
creds.txt                              # dev passwords (superadmin / branchadmin / staff / employer)
jobbank-backup-codes.txt               # 10 backup codes
jobbank-backup-codes (1).txt           # duplicate copy
```

`.env` gitignored hai (sahi) lekin ye teen files tracked hain. Koi bhi jo repo clone kare wo
dev credentials + 2FA backup codes le lega. `git rm --cached` + `.gitignore` me add karo, aur
agar repo public hai to passwords rotate karo.

---

**D-08 · Login rate limit bahut tight hai aur UI me koi cooldown feedback nahi**

Limit: `login-email` = **5 / 900s** (15 min). 5 galat passwords = 15 min lockout, aur login form
par koi countdown / "try again in Xs" nahi dikhata — sirf 429 aata hai. E2E me bhi isi wajah se
4 tests gaye (super-admin + verifier ek hi email par baar baar sign-in karte hain; globalSetup
counters clear karta hai lekin 2 workers parallel me same account use karte hain).

Real user ke liye: 5 attempt bahut kam hai, aur cooldown feedback ka absence confusing hai.

---

**D-09 · `/forbidden` page par koi `<h1>` nahi**

```
GET /forbidden → 200, <h1> count: 0, <h2> count: 0
```

Sirf `<p>` hai. Baaki saari public pages `<h1>` rakhti hain (site-sweep yahi assert karta hai)
aur screen-reader users ke liye page ka naam hi missing hai. A11y defect.

---

**D-12 · CI me E2E kabhi pass nahi hoga + lint CI ko pehle hi block karta hai**

`.github/workflows/ci.yml` `push` (main) aur har `pull_request` par `pnpm test` chalata hai,
jisme Vitest + Jest + **Playwright E2E** shamil hain. Do problems hain:

**a) Playwright browsers CI me install hi nahi hote.** `ci.yml` me koi
`playwright install` step nahi hai. Isliye `pnpm test` → `pnpm test:e2e` step browser missing
par crash hoga (wahi "Executable doesn't exist" error jo locally pehla aaya tha). Matlab **CI ka
E2E suite practically kabhi green nahi ho sakta.**

Fix — `pnpm test` se pehle:

```yaml
- name: Install Playwright browsers
  run: pnpm exec playwright install --with-deps chromium
```

**b) `pnpm lint` step pe hi 39 errors (D-04) hain**, isliye CI **lint par fail hoke ruk jayega**
aur aage `typecheck` / `test` / `build` kabhi chalenge hi nahi. Matlab CI abhi red hai aur uske
baad bhi rahega jab tak D-04 fix na ho.

---

**D-13 · 9 vulnerable npm dependencies (`audit-ci --moderate`)**

`pnpm test:security` (audit-ci) **9 unique advisories** report karta hai — high + moderate.
Inme se zyada tar **transitive** hain (next → postcss, jest → js-yaml → sprintf-js,
better-auth → next, artillery → braces). Full list `tests/reports/security-audit.txt` ke end me
hai, har advisory ka link `https://github.com/advisories/GHSA-…`.

Fix path: `pnpm update` / `overrides` se vulnerable leaf packages bump karo. Note: kuch
(next/postcss, jest chain) app ke core me hain — inhe upgrade karne se regression ka risk hai,
isliye fix karte waqt E2E + unit dobara chalana zaroori.

---

### MINOR / UI

**D-10 · `Select` ka naya restyle `Input`/`Textarea` se mismatch ho gaya** _(uncommitted working-tree change)_

`apps/web/src/components/atoms/Select/Select.tsx` ab `controlBase` chhod kar apna
`selectShell` use karta hai:

|            | Input / Textarea       | Select (naya)                  |
| ---------- | ---------------------- | ------------------------------ |
| background | `bg-surface` (neutral) | `bg-primary-soft` (green tint) |
| text       | `text-fg`              | `text-primary-soft-fg`         |
| border     | `border-border-strong` | `border-primary/25`            |

Ek hi form me agar email (Input) aur country (Select) side-by-side hain to **dono alag rang ke
dikhenge** — ek neutral, ek green. Ye design-system ka breakup hai. Ya Input bhi green karo, ya
Select ko wapas neutral rakho.

Saath hi `Select` ne `controlBase` ka shared path chhod diya — ab do atoms ka styling drift
karega jabki `Input.tsx:10` ka comment abhi bhi kehta hai _"Shared look for text-like controls
(Input, Select, Textarea)"_. Comment aur reality me mismatch.

---

**D-11 · `next dev` ke under login 49s leta hai** _(known, TEST_REPORT defect #4 — abhi bhi valid)_

`next dev --turbopack` route compile karta hai usi process me jo API serve karta hai. E2E ko
hamesha production build ke against chalana chahiye (`E2E_PROD=1`). Dev par koi bhi manual QA
karte waqt ye slowness false "hang" lagegi.

---

## 3. Kya theek chal raha hai

- **Typecheck clean** — `tsc --noEmit` teeno packages me pass.
- **API surface secure hai** — `anonymous-sweep` (96 tests) ne saare 95 route files GET/POST/PUT/
  PATCH/DELETE ke saath bina session hit kiye: **koi 5xx nahi**, aur koi bhi private route 2xx
  nahi deta. `authenticated-sweep` (95) me STAFF + EMPLOYER valid session par koi handler crash
  nahi karta.
- **Error envelope** protected routes par consistent: `{"error":{"code","message","correlation_id"}}`.
- **CSRF, idempotency, RBAC, rate-limit headers** — Jest me sab covered aur passing.
- **Health endpoint** saare dependencies (DB / PostGIS / storage / redis) report karta hai, `up`.
- **Vitest 315 + Jest 351 = 666 tests green.**

---

## 4. Ye load / security / visual tests kyun add kiye? (need)

Sawal yeh hai: **"unit + E2E toh hain, load/api/db test ki zaroorat kya thi?"** — jawab:

| Suite                                    | Kyun add kiya                                                                                                                                                                                                         | Kya pakdata hai jo baaki tests nahi pakadte                                        |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **API load** (`test:api-load`)           | Unit/E2E me **sirf 1 request** chalti hai. Asli user load par pata chalta hai ke NPM route **p95 latency** kitni hai, **rate-limit** sahi trigger hota hai ya nahi, aur **DB connection pool** exhaust toh nahi hota. | Real concurrency ke neeche slowdown, timeouts, pool exhaustion, rate-limit bypass  |
| **Web load** (`test:web-load`)           | Landing/login/register **cache/CDN ke bagair** kitne concurrent users handle karte hain — SSR render time load ke saath badhta hai (single-request test me zero dikhta hai).                                          | SSR degrade hona, session-store/redis saturation, p95 burst ke waqt badhna         |
| **DB load** (`test:db-load`)             | Jest migrations/CRUD ek-ek row par chalte hain. Bulk inserts/reads par **indexes missing** hain ya nahi, lock contention hai ya nahi — sirf stress se dikhta hai.                                                     | Missing indexes, lock contention, query plans jo scale par slow hote hain          |
| **Security** (`test:security`)           | Code review me dependency vulns pakadna impossible hai (9 advisories is branch par mile). `audit-ci` PR ke waqt vulnerable dependency pehle leta hai.                                                                 | Known CVEs in transitive deps                                                      |
| **Visual** (`test:visual-verify`)        | UI refactor (Select/CardActionMenu restyle) ke baad bina test ke **unknowingly 5 pages badal** sakte the — screenshot diff instantly pakadta hai.                                                                     | Unintended UI regressions                                                          |
| **Cross-browser** (`test:cross-browser`) | Sab se bada incident **browser-specific** tha: role selector Chromium me click karta tha par Firefox/WebKit me state mismatch dikha. Chromium-only E2E ye **kabhi nahi pakadta**.                                     | Browser-specific JS/CSS breaks (jabki app users Firefox/Safari bhi use karte hain) |

**Kya yeh "extra" hai?** Nahi — yeh **production risk** cover karta hai. Is app par public
signup hota hai (job seekers) + branch staff login, matlab load spike real hai. Aur login/2FA/RBAC
me browser differences real (defect investigation me sabse zyada time isi par laga).

**CI me yeh tests nahi chalte (by design):**

```text
pnpm test  →  turbo test (Vitest unit) + pnpm test:jest (API) + pnpm test:e2e (chromium)
```

Load + security + visual + cross-browser sab **alag scripts** hain (`package.json` me
`test:api-load`, `test:web-load`, `test:db-load`, `test:security`, `test:visual-verify`,
`test:cross-browser`) jo CI ka `test` step call **hi nahi** karta. Kyun:

1. **Load tests local/integration environment** maante hain (postgres + redis + object storage
   up + prod build chalu). CI me docker-in-docker + Artillery = flaky aur slow.
2. **Visual baselines OS-specific** hain (Windows + Chromium) — Linux CI runner par mismatch
   hoga, isi liye CI me alag baselines chahiye honge (ye abhi tak decide nahi).
3. **audit-ci `--moderate`** abhi FAIL hai (D-13) — CI me daalte hi pipeline hamesha red ho
   jaati, developers fix karein toh CI me add karenge.

**Recommended:** abhi manual/local (`pnpm test:api-load` etc.), baad me staging pipeline me
opt-in. Poori repo me CI ke `test` step me load tests **deliberately nahi** rakhe.

---

## 5. Fix ki pehli 6 cheezein

1. **D-01** — `.env` me `BETTER_AUTH_SECRET` bharo (`openssl rand -base64 32`) + boot-time fail-fast.
2. **D-02** — Production ke liye asli SMS gateway configure karo; console OTP ko prod logs se hatao.
3. **D-03** — Seed me SUPER_ADMIN/BRANCH_ADMIN ke liye TOTP enroll karo (ya gate onboarding ke
   baad lagao).
4. **D-04** — Lint 39 errors saaf karo (unused imports + `no-restricted-imports` + ek `any`).
5. **D-07** — `creds.txt` + backup-codes files ko git se hatao aur `.gitignore` me add karo.
6. **D-12** — `ci.yml` me `pnpm exec playwright install --with-deps chromium` step add karo
   (warna E2E CI me kabhi pass nahi hoga).
7. **D-13** — `pnpm test:security` (audit-ci) ke 9 advisories fix karo — leaf deps bump /
   overrides; core upgrades ke baad E2E + unit dobara chalao.

---

## 6. Reproduce karne ke commands

```bash
pnpm infra:up && pnpm db:migrate && pnpm db:seed      # once
pnpm typecheck && pnpm lint
pnpm --filter @jobbank/web test                        # unit
pnpm test:jest                                         # API
pnpm exec playwright install chromium                  # pehli baar
pnpm test:e2e                                          # prod build + browser
```

Artifacts: `tests/reports/e2e-results.json` (Playwright JSON reporter). Consolidated
report (E2E + load + security): `tests/reports/index.html` (`pnpm test:reports`).
