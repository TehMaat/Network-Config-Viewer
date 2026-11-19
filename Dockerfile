# syntax=docker/dockerfile:1

# Network Config Viewer, local use: see compose.yaml and the README.

# 1. Build the static files of the app with Node.js (only inside Docker: no Node.js needed on the PC).
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/web/package.json packages/web/
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY packages/web packages/web
RUN npm run build

# 2. Serve them with nginx: no root privileges and no server-side code.
FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/packages/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
