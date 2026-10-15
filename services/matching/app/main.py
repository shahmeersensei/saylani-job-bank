"""Service entrypoint: `uvicorn app.main:app` (API + optional outbox worker)."""

from __future__ import annotations

import asyncio
import logging
import sys
from contextlib import asynccontextmanager

# psycopg async on Windows needs the selector loop (Proactor is unsupported).
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from fastapi import FastAPI
from psycopg_pool import AsyncConnectionPool

from .api import router
from .cache import get_profile_cache
from .config import get_settings
from .worker import worker_loop

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    pool = AsyncConnectionPool(
        conninfo=settings.database_url,
        min_size=1,
        max_size=10,
        open=False,
        kwargs={"row_factory": None},
    )
    await pool.open()
    app.state.pool = pool
    app.state.settings = settings

    worker_task: asyncio.Task | None = None
    if settings.worker_enabled:
        worker_task = asyncio.create_task(worker_loop(pool, settings))

    try:
        yield
    finally:
        if worker_task:
            worker_task.cancel()
            try:
                await worker_task
            except asyncio.CancelledError:
                pass
        await get_profile_cache().close()
        await pool.close()


def create_app() -> FastAPI:
    app = FastAPI(title="Saylani Job Bank — Matching Engine", version="0.1.0", lifespan=lifespan)
    app.include_router(router)

    @app.get("/health", tags=["ops"])
    async def health() -> dict:
        return {"status": "ok", "service": "matching", "version": "0.1.0"}

    return app


app = create_app()
