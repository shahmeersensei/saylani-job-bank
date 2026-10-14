# AI Auto-Matching Engine & UI Improvements

## Overview

This PR adds the AI-powered automatic job matching engine (standalone Python module), fixes multiple UI/UX issues across employer and applicant dashboards, and adds notifications infrastructure.

---

## 1. AI Auto-Matching Engine (`services/matching/`)

Standalone Python FastAPI service with background worker. Scores and shortlists applicants for each OPEN job automatically.

### Architecture

```
Job OPEN → match_outbox → Python worker → eligibility gate → scoring → job_matches + job_match_factors
```

### Pipeline (5 phases)

1. **Eligibility Gate** — required skills/experience/education must pass
2. **Candidate Pool** — PostGIS distance query within job's radius
3. **Scoring** — 9 weighted factors, 0–100 score with per-factor breakdown
4. **Persistence** — results saved to `job_matches` + `job_match_factors` tables
5. **Employer UI** — shortlist displayed at `/employer/jobs/{id}/matches`

### Scoring Factors (v3, weights sum to 100)

| Factor            | Weight | Description                                                                  |
| ----------------- | ------ | ---------------------------------------------------------------------------- |
| required_skills   | 25     | Exact + semantic skill match                                                 |
| preferred_skills  | 13     | Nice-to-have skills                                                          |
| experience        | 14     | Years vs job minimum                                                         |
| education         | 10     | Qualification rank                                                           |
| distance          | 14     | Geodesic km from job site                                                    |
| salary            | 10     | Expectation vs job range                                                     |
| languages         | 5      | Required language match                                                      |
| preferences       | 4      | Shift/type/category fit                                                      |
| **text_fit (AI)** | **5**  | Sentence-transformer cosine similarity (job description ↔ applicant profile) |

### Key Components

- `scoring.py` — factor scoring, text_fit ramp (0.15 floor → 0.45 full)
- `embeddings.py` — all-MiniLM-L6-v2 (384-dim), `ProfileFit` class, pgvector storage
- `weights.py` — `WEIGHTS_VERSION="v2"`, `DEFAULT_WEIGHTS`
- `types.py` — `SCORING_VERSION="v3"`, `CRITERIA_VERSION=1`
- `repository.py` — candidate pool (PostGIS), outbox claim, result persistence
- `service.py` — orchestration: eligibility → scoring → persistence
- `worker.py` — outbox poller + LISTEN/NOTIFY wakeup
- `cache.py` — Redis profile cache (version-keyed, 600s TTL)

### Running

```bash
cd services/matching
.venv\Scripts\python run_worker.py   # Windows (SelectorEventLoop)
uvicorn app.main:app --port 8000     # Linux/Mac
```

---

## 2. Database Migrations

| Migration                  | Purpose                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| `0014_matching.sql`        | `match_runs`, `job_matches`, `job_match_factors`, `match_outbox` tables + pgvector extension            |
| `0015_matching_perf.sql`   | GIN indexes, distance expression index, outbox partial index                                            |
| `0017_match_decisions.sql` | `review_status`, `applicant_response`, `refusal_reason_code`, `reviewed_by/at` columns on `job_matches` |

### Schema additions

- `packages/db/src/schema/matching.ts` — Drizzle schemas for all match tables
- `packages/db/src/schema/notifications.ts` — notifications table
- `packages/db/src/types/vector.ts` — pgvector type helper

---

## 3. Notifications System

### Backend

- `domains/notifications/service.ts` — create, list, markRead, markAllRead (userId-scoped, no role gate)
- `GET /api/v1/notifications` — paginated list with unread count
- `PATCH /api/v1/notifications/[id]` — mark one as read
- `POST /api/v1/notifications/read-all` — mark all as read

### Frontend

- **NotificationBell** (`components/organisms/TopBar/NotificationBell.tsx`) — dropdown with unread badge, click-to-read, "Mark all read", "View all" link
- **Applicant notifications page** (`/applicant/notifications`) — full feed + offer accept/decline modals
- **Shared notifications page** (`/notifications`) — for employer/staff/admin roles

### Fixes

- Removed `assertPermission(actor, 'applicant:self')` gate — any signed-in user can read their own notifications
- TopBar bell was decorative (no onClick) — now a working Radix DropdownMenu

---

## 4. UI/UX Fixes

### Geolocation ("Use my location")

- **Problem**: `enableHighAccuracy: true` fails on desktops (no GPS, only WiFi/IP)
- **Fix**: Changed to `enableHighAccuracy: false` with 8s timeout — fast, works on all devices

### Company Edit Details

- **Problem**: VERIFIED/SUSPENDED status always showed `CompanyStatusPanel`, ignoring `?step=` param — Edit button was dead
- **Fix**: `page.tsx` now shows `CompanyWizard` when `?step=` is present for editable statuses

### Employer Overview Dashboard

- **Problem**: Hardcoded `bg-white`, `#e8eeed` colors — didn't match theme/dark mode
- **Fix**: Replaced with design tokens (`var(--surface)`, `var(--border)`, `var(--surface-muted)`)

### Match Refresh Permission

- **Problem**: Route required `match_case:manage` which EMPLOYER doesn't have
- **Fix**: Removed route-level permission; service-level check allows `job:manage_own`

### Job Location & Reverse Geocode

- **New**: `lib/geocode/reverse.ts` — Nominatim reverse geocode with city matching
- **New**: `GET /api/v1/geocode/reverse` — any signed-in user
- **Updated**: JobWizard location section with MapPinPicker + auto-fill

---

## 5. Employer Matches Shortlist UI

- `/employer/jobs/{id}/matches` — ranked shortlist with score, distance, summary
- `MatchesShortlist.tsx` — factor breakdown, hire/reject modals with reason codes
- Hire → creates notification for applicant + offer row
- Reject → requires reason code, creates notification

---

## 6. Applicant Offer Flow

- `POST /api/v1/offers/{jobId}/response` — accept/decline with reason
- Decline requires a reason code (master-data `REFUSAL_REASON`)
- Notifications sent to employer on both outcomes

---

## 7. Dev Seed Data

- Added VERIFIED company "Hamza Traders (Pvt) Ltd" (NTN 1234567-8) with owner, contact, HQ location
- Company ID: `00000000-0000-4000-8000-00000000c001`
- Employer account: `employer@jobbank.local` / `JobBank-Dev-2026!`
- Seeded via `packages/db/src/seed/dev-data.ts` (idempotent)

---

## 8. Testing

| Suite                                       | Result                            |
| ------------------------------------------- | --------------------------------- |
| Python `pytest` (31 tests)                  | ✅ All pass                       |
| Python `ruff check`                         | ✅ Clean                          |
| Web `tsc --noEmit`                          | ✅ Clean                          |
| Web integration `match-decisions` (8 tests) | ✅ All pass                       |
| E2E smoke (`scripts/smoke.py`)              | ✅ v3 scoring + text_fit verified |

---

## 9. Environment

- Worker needs `MATCHING_DATABASE_URL` and optionally `MATCHING_REDIS_URL`
- Postgres requires `pgvector` extension (see `docker/Dockerfile.postgres`)
- Redis at `localhost:6380` for profile caching
- `sentence-transformers 6.1.0` for embeddings (Windows: SelectorEventLoop required)
