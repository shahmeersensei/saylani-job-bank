"""Background worker: polls match_outbox, runs matches, retries with backoff.

Listens on LISTEN match_outbox (pg_notify from migration 0015) so events start
in milliseconds; the poll interval stays as a safety net.
"""

from __future__ import annotations

import asyncio
import logging

from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool

from .config import Settings
from .repository import (
    DuplicateActiveRun,
    claim_outbox_item,
    mark_outbox_processed,
    mark_outbox_retry,
)
from .service import run_job_match

log = logging.getLogger("matching.worker")

NOTIFY_CHANNEL = "match_outbox"
NOTIFY_POLL_SECONDS = 0.25


async def notify_listener(dsn: str, wakeup: asyncio.Event) -> None:
    """Hold a dedicated LISTEN connection; set `wakeup` on every outbox insert.

    A tiny SELECT pump reads the socket every NOTIFY_POLL_SECONDS: incoming
    NotificationResponse messages are dispatched to the notify handler during
    any read (conn.notifies() async wait never wakes on some Windows loops).
    Still ~8x faster than the 2s worker poll.
    """

    def on_notify(_notify) -> None:  # noqa: ANN001 — psycopg Notify
        wakeup.set()

    while True:
        try:
            async with await AsyncConnection.connect(dsn) as conn:
                conn.add_notify_handler(on_notify)
                # LISTEN must run outside a transaction: an idle-in-transaction
                # session never dispatches NotificationResponse to handlers.
                await conn.set_autocommit(True)
                await conn.execute(f"LISTEN {NOTIFY_CHANNEL}")
                log.info("LISTEN %s active (pump every %.2fs)", NOTIFY_CHANNEL, NOTIFY_POLL_SECONDS)
                while True:
                    await asyncio.sleep(NOTIFY_POLL_SECONDS)
                    await conn.execute("SELECT 1")
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("notify listener lost; reconnecting in 2s")
            await asyncio.sleep(2)


async def process_one(pool: AsyncConnectionPool, settings: Settings) -> bool:
    """Claim and process a single outbox item. Returns True if one was handled."""
    async with pool.connection() as conn:
        async with conn.transaction():
            item = await claim_outbox_item(conn)
            if item is None:
                return False
            outbox_id = str(item["id"])
            attempts = item["attempts"] + 1
            payload = item["payload"] or {}
            job_id = payload.get("job_id")
            trigger = payload.get("trigger", item["event_type"])

        if not job_id:
            async with pool.connection() as conn, conn.transaction():
                await mark_outbox_retry(
                    conn, outbox_id, attempts, "payload missing job_id",
                    backoff_seconds=0, failed=True,
                )
            return True

        try:
            report = await run_job_match(pool, str(job_id), str(trigger))
            async with pool.connection() as conn, conn.transaction():
                await mark_outbox_processed(conn, outbox_id)
            if report.status == "FAILED":
                log.warning("job %s match failed: %s", job_id, report.error)
            return True
        except DuplicateActiveRun as exc:
            # Another run is already in flight for this job; the event is redundant.
            async with pool.connection() as conn, conn.transaction():
                await mark_outbox_processed(conn, outbox_id)
            log.info("job %s already has an active run (%s)", job_id, exc)
            return True
        except Exception as exc:
            exhausted = attempts >= settings.worker_max_attempts
            backoff = min(
                settings.worker_backoff_base_seconds * (2 ** (attempts - 1)),
                300.0,
            )
            async with pool.connection() as conn, conn.transaction():
                await mark_outbox_retry(
                    conn, outbox_id, attempts,
                    f"{type(exc).__name__}: {exc}",
                    backoff_seconds=0 if exhausted else backoff,
                    failed=exhausted,
                )
            log.exception(
                "outbox %s attempt %d failed%s",
                outbox_id, attempts, " (giving up)" if exhausted else "",
            )
            return True


async def worker_loop(pool: AsyncConnectionPool, settings: Settings) -> None:
    log.info(
        "matching worker started (poll every %ss, notify listener %s)",
        settings.worker_poll_seconds,
        "on" if settings.worker_notify_enabled else "off",
    )
    wakeup = asyncio.Event()
    listener: asyncio.Task | None = None
    if settings.worker_notify_enabled:
        listener = asyncio.create_task(notify_listener(settings.database_url, wakeup))
    try:
        while True:
            try:
                handled = await process_one(pool, settings)
            except Exception:
                log.exception("worker loop error")
                handled = False
            if not handled:
                try:
                    await asyncio.wait_for(wakeup.wait(), timeout=settings.worker_poll_seconds)
                except TimeoutError:
                    pass
                wakeup.clear()
    finally:
        if listener:
            listener.cancel()
            try:
                await listener
            except asyncio.CancelledError:
                pass
