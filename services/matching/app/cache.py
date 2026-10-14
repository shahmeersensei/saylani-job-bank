"""Redis profile cache: version-keyed entries, fail-open on any error.

Key:    mj:ap:v1:{applicant_id}:{profile_version}   (version = applicants.updated_at μs)
Value:  ApplicantProfile JSON without distance_m (distance is per-job, never cached).

Correctness comes from migration 0015's jobbank_profile_touch trigger: any change
to profile data (skills, languages, education, experience, preferences, address)
bumps applicants.updated_at, so the next run misses the old key immediately.
The TTL only sweeps abandoned entries. Redis trouble never fails a run — the
engine falls back to Postgres and pauses caching for a short cooldown.
"""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime

from redis.asyncio import Redis

from .config import get_settings
from .types import ApplicantProfile

log = logging.getLogger("matching.cache")

_KEY_PREFIX = "mj:ap:v1"

_cache: ProfileCache | None = None


def get_profile_cache() -> ProfileCache:
    global _cache
    if _cache is None:
        _cache = ProfileCache()
    return _cache


class ProfileCache:
    def __init__(self) -> None:
        settings = get_settings()
        self._enabled = settings.cache_enabled and bool(settings.redis_url)
        self._redis_url = settings.redis_url
        self._ttl = settings.cache_ttl_seconds
        self._cooldown = settings.cache_cooldown_seconds
        self._down_until = 0.0
        self._client: Redis | None = None

    def _client_or_none(self) -> Redis | None:
        if not self._enabled or time.monotonic() < self._down_until:
            return None
        if self._client is None:
            self._client = Redis.from_url(
                self._redis_url,
                socket_connect_timeout=1.0,
                socket_timeout=1.0,
                decode_responses=True,
            )
        return self._client

    def _trip(self, exc: Exception) -> None:
        self._down_until = time.monotonic() + self._cooldown
        log.warning("redis profile cache paused for %.0fs: %s", self._cooldown, exc)

    @staticmethod
    def _key(applicant_id: str, version: datetime) -> str:
        return f"{_KEY_PREFIX}:{applicant_id}:{int(version.timestamp() * 1_000_000)}"

    async def get_many(
        self, versions: dict[str, datetime]
    ) -> tuple[dict[str, ApplicantProfile], list[str]]:
        """Lookup profiles by (applicant_id → profile_version).

        Returns (found, missing_ids). Missing also covers corrupt entries and
        any Redis failure — callers then fetch those ids from Postgres.
        """
        if not versions:
            return {}, []
        client = self._client_or_none()
        if client is None:
            return {}, list(versions)

        keyed = {aid: self._key(aid, ver) for aid, ver in versions.items()}
        try:
            raw_values = await client.mget(list(keyed.values()))
        except Exception as exc:  # noqa: BLE001 — fail-open by design
            self._trip(exc)
            return {}, list(versions)

        found: dict[str, ApplicantProfile] = {}
        missing: list[str] = []
        for (aid, _key), raw in zip(keyed.items(), raw_values, strict=False):
            if raw is None:
                missing.append(aid)
                continue
            try:
                found[aid] = ApplicantProfile.model_validate(json.loads(raw))
            except Exception:  # stale schema → refetch from the source of truth
                missing.append(aid)
        return found, missing

    async def set_many(
        self, profiles: dict[str, ApplicantProfile], versions: dict[str, datetime]
    ) -> None:
        if not profiles:
            return
        client = self._client_or_none()
        if client is None:
            return
        try:
            pipe = client.pipeline()
            for aid, profile in profiles.items():
                version = versions.get(aid)
                if version is None:
                    continue
                payload = profile.model_dump(mode="json", exclude={"distance_m"})
                pipe.set(
                    self._key(aid, version),
                    json.dumps(payload, separators=(",", ":")),
                    ex=self._ttl,
                )
            await pipe.execute()
        except Exception as exc:  # noqa: BLE001 — fail-open by design
            self._trip(exc)

    async def close(self) -> None:
        if self._client is not None:
            try:
                await self._client.aclose()
            except Exception:  # noqa: BLE001
                pass
            self._client = None
