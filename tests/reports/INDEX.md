# Test Reports — `test/api-and-ui-test-suites`

> Sab kuch ek jagah. Testing only — developers fix karte hain, QA product code nahi badalta.

## 📊 Overall report (HTML)

**[`index.html`](./index.html)** — Playwright-style consolidated HTML: QA defects + API/Web/DB load + security, ek page me.

Ya: `pnpm test:reports` se regenerate karo.

## 📋 Reports by type

| Type                | Report                                                                   | Command                          | Result                                    |
| ------------------- | ------------------------------------------------------------------------ | -------------------------------- | ----------------------------------------- |
| **QA (functional)** | [`QA_REPORT.md`](../../QA_REPORT.md)                                     | `pnpm test:e2e` + lint/typecheck | 13 defects (3 crit / 8 major / 2 minor)   |
| **Visual**          | [`visual-ux.spec.ts-snapshots/`](../../e2e/visual-ux.spec.ts-snapshots/) | `pnpm test:visual-verify`        | PASS — 5/5 baselines                      |
| **Cross-browser**   | Playwright report                                                        | `pnpm test:cross-browser`        | PASS — 12/12 (Chromium/FF/WebKit)         |
| **Load — API**      | [`load-api.html`](./load-api.html) · [`load-api.json`](./load-api.json)  | `pnpm test:api-load`             | PASS — 700 req, p95 ~33ms                 |
| **Load — Web**      | [`load-web.html`](./load-web.html) · [`load-web.json`](./load-web.json)  | `pnpm test:web-load`             | PASS — 480 vusers, p95 ~82ms              |
| **Load — DB**       | [`db-stress.txt`](./db-stress.txt)                                       | `pnpm test:db-load`              | PASS — reads p95 8.4ms, writes p95 15.7ms |
| **Security**        | [`security-audit.txt`](./security-audit.txt)                             | `pnpm test:security`             | FAIL — 9 advisories (audit-ci)            |

## 🧩 Files in this folder

- `index.html` — consolidated interactive HTML report (open in browser)
- `REPORT.md` — same summary in markdown
- `load-api.json` / `load-web.json` — raw Artillery results
- `db-stress.txt` — DB stress percentiles
- `security-audit.txt` — audit-ci output (advisory list at bottom)

## ▶️ How to run everything

```bash
pnpm infra:up && pnpm db:migrate && pnpm db:seed     # once
pnpm --filter @jobbank/web build
pnpm --filter @jobbank/web start &                    # server for load/visual/cross tests
pnpm test:e2e              # functional E2E (chromium)
pnpm test:visual-verify    # visual regression (compare)
pnpm test:visual-update    # visual regression (regen baselines after UI change)
pnpm test:cross-browser    # chromium + firefox + webkit smoke
pnpm test:api-load         # API load
pnpm test:web-load         # Web load
pnpm test:db-load          # DB stress
pnpm test:security         # audit-ci
pnpm test:reports          # regenerate index.html + REPORT.md
```

> Note: `retire` (extra SCA scanner) node_modules par hang hota hai is repo me, isliye
> `test:security` sirf `audit-ci --moderate` chalata hai. Advisory list
> `security-audit.txt` ke end me hai.
