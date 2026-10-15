# syntax=docker/dockerfile:1
# ── Build stage: monorepo install + Next production build ────────────────────
FROM node:22-alpine AS build
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    HUSKY=0 \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@12.8.1 --activate
WORKDIR /repo

# Manifests first so this layer caches across source-only changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @jobbank/web...

COPY . .
RUN pnpm --filter @jobbank/web build

# ── Runtime stage: traced standalone bundle only ─────────────────────────────
# Layout mirrors the monorepo: server.js lives at apps/web/server.js inside
# .next/standalone (outputFileTracingRoot = repo root).
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
WORKDIR /app/apps/web
USER node
EXPOSE 3000
CMD ["node", "server.js"]
