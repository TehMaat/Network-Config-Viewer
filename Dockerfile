# syntax=docker/dockerfile:1

# Network Config Viewer, local use: see compose.yaml and the README.

# 1. Build the app and the server with Node.js (only inside Docker: no Node.js needed on the PC).
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/web/package.json packages/web/
COPY packages/server/package.json packages/server/
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY packages/web packages/web
COPY packages/server packages/server
RUN npm run build

# 2. Only what the server needs to run: no development tools in the image.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/web/package.json packages/web/
COPY packages/server/package.json packages/server/
RUN npm ci --omit=dev --workspace=@ncv/server --no-audit --no-fund

# 3. The server: it serves the app and keeps the archive of the clients in /data,
#    the volume of compose.yaml. It runs without root privileges.
FROM node:24-alpine
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    NCV_DATA_DIR=/data \
    NCV_WEB_DIR=/app/web
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/packages/server/package.json ./server/package.json
COPY --from=build /app/packages/server/dist ./server
COPY --from=build /app/packages/web/dist ./web
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "server/main.js"]
