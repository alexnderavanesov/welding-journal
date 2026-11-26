# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS pnpm-installer

WORKDIR /installer
COPY package.json pnpm-lock.yaml ./
# Verify the standalone archive against the committed platform-specific integrity.
RUN node --input-type=module <<'JS'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
const version = JSON.parse(readFileSync('package.json')).packageManager.slice('pnpm@'.length)
const name = 'exe.linux-' + process.arch
const lock = readFileSync('pnpm-lock.yaml', 'utf8').split('\n')
const i = lock.indexOf("  '@pnpm/" + name + "@" + version + "':")
const integrity = i >= 0 && lock[i + 1]?.match(/integrity: (sha512-[A-Za-z0-9+/=]+)/)?.[1]
if (!integrity) throw new Error('Missing pinned pnpm archive integrity')
const url = 'https://registry.npmjs.org/@pnpm/' + name + '/-/' + name + '-' + version + '.tgz'
const response = await fetch(url)
if (!response.ok) throw new Error('Could not download pinned pnpm archive')
const archive = Buffer.from(await response.arrayBuffer())
if ('sha512-' + createHash('sha512').update(archive).digest('base64') !== integrity) throw new Error('pnpm archive integrity mismatch')
writeFileSync('pnpm.tgz', archive)
JS
RUN mkdir -p /opt/pnpm && tar -xzf pnpm.tgz -C /opt/pnpm --strip-components=1

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
COPY patches ./patches
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

COPY . .
# Vite embeds the browser license during the build; a runtime variable is too late.
ARG VITE_AG_GRID_LICENSE_KEY
RUN pnpm build

FROM pnpm-base AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DISPATCHER_PREWARM_ENABLED=1

WORKDIR /app

RUN mkdir -p /app/data/document-templates /app/data/line-schemes \
  && chown -R node:node /app/data
USER node
RUN pnpm config set --global verifyDepsBeforeRun false

COPY package.json ./
COPY --from=build /app/.output ./.output
COPY --from=build /app/scripts/prewarm-dispatcher.mjs ./scripts/prewarm-dispatcher.mjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", ".output/server/index.mjs"]
