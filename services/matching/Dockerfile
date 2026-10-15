# syntax=docker/dockerfile:1
# ── Slim image: core matching engine only (semantic/torch stays opt-in) ──────
FROM python:3.12-slim AS build
ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /build
COPY pyproject.toml ./
COPY app ./app
RUN pip install --prefix=/install .

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1
WORKDIR /srv/matching
COPY --from=build /install /usr/local
COPY app ./app
COPY scripts ./scripts
COPY run_worker.py ./
RUN useradd --system --create-home --uid 10001 matching
USER matching
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
