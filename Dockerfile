# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS pnpm-installer

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm/bin:$PATH

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl openssl \
  && curl -fsSL https://get.pnpm.io/install.sh | env PNPM_VERSION=12.0.0-rc.7 ENV=/root/.shrc SHELL=/bin/sh sh - \
  && pnpm_package="$(find "$PNPM_HOME" -path '*/node_modules/@pnpm/exe/pnpm' -type f -print -quit)" \
  && cp -a "$(dirname "$pnpm_package")" /opt/pnpm

FROM node:22-bookworm-slim AS pnpm-base

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl libatomic1 \
  && rm -rf /var/lib/apt/lists/*

COPY --from=pnpm-installer /opt/pnpm /opt/pnpm
ENV PATH=/opt/pnpm:$PATH

FROM pnpm-base AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY vendor ./vendor
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM pnpm-base AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

WORKDIR /app

RUN pnpm config set --global verifyDepsBeforeRun false

COPY package.json ./
COPY --from=build /app/.output ./.output

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", ".output/server/index.mjs"]
