# Auterva images: web (Next.js), ws (WebSocket), worker (jobs/mail), media-worker (image processing).
# One build, four targets: docker build --target <web|ws|worker|media-worker> .
# Nothing here deploys anything and no secret is baked in: all configuration arrives as runtime environment
# variables (see .env.example and docs/development/CI.md). Node and pnpm match package.json.
# Base image is pinned by tag; pin by digest (docker buildx imagetools inspect) when a registry is chosen.
FROM node:24.20.0-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install --global --ignore-scripts pnpm@12.6.0
WORKDIR /app

FROM base AS deps
# Only manifests and the Prisma schema first, so the layer is reused until dependencies change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# Next validates server configuration while collecting page data. These are inert placeholders used only for
# this command (not persisted in an ENV layer); real values are supplied at runtime.
RUN DATABASE_URL=postgresql://build@127.0.0.1:5432/build_placeholder \
    BETTER_AUTH_SECRET=docker-build-placeholder-secret-0123456789 \
    BETTER_AUTH_URL=http://127.0.0.1:3000 \
    pnpm build

# Next.js production server. Port from PORT (default 3000); WWW host routing is decided by the app, not the image.
FROM base AS web
ENV NODE_ENV=production PORT=3000
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
CMD ["sh", "-c", "exec node node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port ${PORT}"]

# The three Node processes below run TypeScript through tsx, as in the local scripts (dev:ws, dev:worker, dev:media-worker).
FROM base AS runtime-ts
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app /app
USER node

FROM runtime-ts AS ws
# Listens on every interface of the container; WS_ALLOWED_HOSTS (the Host values the trusted proxy forwards) is
# required at runtime and the process refuses to start without it. There is no any-host mode.
ENV WS_PORT=3101 WS_HOST=0.0.0.0
EXPOSE 3101
CMD ["node_modules/.bin/tsx", "src/server/realtime.ts"]

FROM runtime-ts AS worker
CMD ["node_modules/.bin/tsx", "src/server/worker.ts"]

FROM runtime-ts AS media-worker
CMD ["node_modules/.bin/tsx", "src/server/media-worker.ts"]
