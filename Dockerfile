# syntax=docker/dockerfile:1

# Stage 1: dependencies. Only manifests are copied so this layer is reused
# until a package.json or the lockfile changes.
FROM node:24-slim AS deps
RUN npm install -g pnpm@11.13.1
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/engine/package.json packages/engine/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile

# Stage 2: build. Sources land on top of the cached dependency layer.
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/engine packages/engine
COPY packages/server packages/server
COPY packages/web packages/web
RUN pnpm -r build

# Stage 3: runtime. One bundled server file plus the static web build; no
# node_modules, no package manager, no sources.
FROM node:24-slim AS runtime
LABEL org.opencontainers.image.source=https://github.com/myusuf3/lantern
ENV NODE_ENV=production \
    PORT=3000 \
    LANTERN_STATIC_DIR=/app/public \
    LANTERN_LESSONS_DIR=/app/lessons
WORKDIR /app
COPY --from=build --chown=node:node /app/packages/server/dist/main.js ./server/main.js
COPY --from=build --chown=node:node /app/packages/web/dist ./public
COPY --chown=node:node packages/lessons ./lessons
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/main.js"]
