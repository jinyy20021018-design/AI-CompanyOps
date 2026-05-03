# syntax=docker/dockerfile:1.6
#
# CoAgent frontend — multi-stage build.
# Stage 1: build the Vite bundle
# Stage 2: serve via nginx
#
# Browser connects to localhost:3001 directly for WS+HTTP since backend runs
# on host during Phase A. nginx in this image only serves static assets and
# does SPA fallback to index.html.

FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json* ./
# Use `npm install` for resilience: `npm ci` fails hard on any lockfile drift,
# and the project's monorepo workspace setup occasionally produces such drift.
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build

FROM nginx:alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
