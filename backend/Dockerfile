# syntax=docker/dockerfile:1.6
#
# Orchestrator (formerly "backend") image.
# Runs in COAGENT_MODE=container and uses dockerode against docker-socket-proxy
# to spawn agent containers.

FROM node:22-bookworm-slim AS build
WORKDIR /app

# Build deps for node-pty (kept installed so legacy COAGENT_MODE=pty still works
# inside the container if anyone needs to debug; ContainerManager doesn't use it).
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 build-essential \
    && rm -rf /var/lib/apt/lists/*

# Workspace install — root has the lockfile; deps hoist to /app/node_modules.
COPY package.json package-lock.json* ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm install --no-audit --no-fund

# Source + compile.
COPY backend ./backend
RUN npm run build -w backend

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend ./backend
COPY --from=build /app/package.json ./

ENV NODE_ENV=production \
    PORT=3001 \
    COAGENT_MODE=container

EXPOSE 3001

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "backend/dist/index.js"]
