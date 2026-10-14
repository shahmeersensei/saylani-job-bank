"""Internal HTTP API called by the Next.js app (and for ops/debug)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from .repository import read_latest_matches
from .service import run_job_match
from .types import MatchRunReport

router = APIRouter(prefix="/internal/matches", tags=["matching"])


class RunRequest(BaseModel):
    job_id: str
    trigger: str = Field(default="MANUAL", pattern="^(PUBLISH|RESUME|PROFILE_UPDATE|MANUAL)$")


def _serialize_report(report: MatchRunReport) -> dict:
    return report.model_dump(mode="json")


@router.post("/runs", summary="Run a match for one job now (sync)")
async def run_now(body: RunRequest, request: Request) -> dict:
    pool = request.app.state.pool
    report = await run_job_match(pool, body.job_id, body.trigger)
    if report.status != "COMPLETED":
        raise HTTPException(status_code=422, detail=_serialize_report(report))
    return _serialize_report(report)


@router.get("/jobs/{job_id}", summary="Latest shortlist for a job (score-sorted)")
async def latest_matches(
    job_id: str,
    request: Request,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
) -> dict:
    pool = request.app.state.pool
    async with pool.connection() as conn:
        data = await read_latest_matches(
            conn, job_id, limit=page_size, offset=(page - 1) * page_size
        )
    if data["run"] is None:
        raise HTTPException(status_code=404, detail="No match run for this job yet")
    return {
        "data": data["matches"],
        "meta": {
            "page": page,
            "pageSize": page_size,
            "total": data["total"],
            "run": data["run"],
        },
    }
