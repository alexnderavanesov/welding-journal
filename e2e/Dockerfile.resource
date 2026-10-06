# Local resource rehearsal only. Build with .output as the context, never the
# repository: no environment files, sources or working database enter this image.
FROM node:22-bookworm-slim
WORKDIR /app
COPY . ./.output
CMD ["node", ".output/server/index.mjs"]
