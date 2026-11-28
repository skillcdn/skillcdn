# syntax=docker/dockerfile:1

# One image, several roles. The role is the container command: api | worker | migrate | check.
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
# The few files of .git that .dockerignore lets through say which commit this is, and the last
# step of this stage reads them from the build context. They do not stay in the tree: what finds
# .git there takes the tree for a whole checkout, as the build of the pages does, which then
# fails on every link to a file the context left out.
RUN rm -rf .git
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --offline
RUN pnpm turbo run build --filter=@skillcdn/server... --filter=@skillcdn/web...

# Self-contained production tree: built output plus production dependencies only.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm --filter=@skillcdn/server --prod deploy /out

# What the server of the image says of itself (ADR-0134). The release workflow names the release
# with VERSION. A build that names none says the version of the packages with the commit it is
# built from (1.2.3+abc1234), read from the build context as it was given, or 1.2.3+source when
# the context does not say which. Declared after the build, so that naming a version rebuilds
# nothing.
ARG VERSION=
RUN --mount=type=bind,target=/checkout \
    cd /checkout && node /repo/apps/server/dist/print-image-version.js "${VERSION}" > /out/version

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
LABEL org.opencontainers.image.title="SkillCDN server" \
      org.opencontainers.image.source="https://github.com/skillcdn/skillcdn" \
      org.opencontainers.image.licenses="FSL-1.1-ALv2"
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
# The web UI is static files next to the server. Unset WEB_ROOT to run without it.
COPY --from=build --chown=node:node /repo/apps/web/dist ./web
# What the image is distributed under, and what it carries of others: the notices travel with it.
COPY --from=build --chown=node:node /repo/LICENSE.md /repo/THIRD-PARTY-NOTICES.md /repo/TRADEMARKS.md ./
ENV WEB_ROOT=/app/web
# What the build stage wrote for the server to say of itself (the MCP server info, the user agent
# of its calls). A deployment that sets SERVER_VERSION says that instead.
ENV SERVER_VERSION_FILE=/app/version
USER node
EXPOSE 11188
ENTRYPOINT ["node", "--enable-source-maps", "dist/main.js"]
CMD ["api"]
