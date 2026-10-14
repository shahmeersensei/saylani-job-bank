"""Environment-driven configuration for the matching engine."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MATCHING_", env_file=".env", extra="ignore")

    database_url: str = "postgresql://jobbank:jobbank@localhost:5433/jobbank"
    host: str = "0.0.0.0"
    port: int = 8000
    log_level: str = "info"

    # Worker
    worker_enabled: bool = True
    worker_poll_seconds: float = 2.0
    worker_max_attempts: int = 5
    worker_backoff_base_seconds: float = 5.0
    # LISTEN/NOTIFY wakeup on match_outbox (poll above stays as fallback).
    worker_notify_enabled: bool = True

    # Profile cache (Redis). Empty url disables caching; failures never fail a run.
    redis_url: str = "redis://localhost:6380/0"
    cache_enabled: bool = True
    cache_ttl_seconds: int = 600
    # Pause caching for this long after a Redis error (circuit breaker).
    cache_cooldown_seconds: float = 30.0

    # Hard policy ceiling (PRD: never above 10 km, DB CHECK enforces it too).
    max_radius_m: int = 10_000

    # Phase 3: semantic skill matching via pgvector embeddings (backfill first).
    semantic_enabled: bool = True

    # Phase 3 (unused in MVP): local embedding model name.
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"


@lru_cache
def get_settings() -> Settings:
    return Settings()
