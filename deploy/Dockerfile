# syntax=docker/dockerfile:1

# One image, several roles. The role is the container command: api | worker | migrate.
# Build from the repository root:
#   docker build -f deploy/Dockerfile -t skillcdn .
#
# Never pass secrets through ARG or ENV: they end up in image history.
# If a build ever needs a credential, use a BuildKit secret mount.

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm-slim AS build
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    DO_NOT_TRACK=1 \
    TURBO_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

# Dependency layer: invalidated only when the lockfile or workspace settings change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch

COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --offline
RUN pnpm turbo run build --filter=@skillcdn/server...

# Self-contained production tree: built output plus production dependencies only.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm --filter=@skillcdn/server --prod deploy /out

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
LABEL org.opencontainers.image.title="SkillCDN server" \
      org.opencontainers.image.source="https://github.com/skillcdn/skillcdn" \
      org.opencontainers.image.licenses="FSL-1.1-ALv2"
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 8080
ENTRYPOINT ["node", "--enable-source-maps", "dist/main.js"]
CMD ["api"]
