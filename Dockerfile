# Multi-stage build for Discord-to-GitHub Issue Bot
# Based on https://github.com/holmityd/GitHub-Issues-Discord-Threads-Bot with local patches
#
# Build context: repo root (docker-compose.yml uses context: ..)
# This lets us copy the root pnpm-lock.yaml for reproducible installs.

FROM node:20-alpine AS builder

WORKDIR /app

# Pin pnpm to the same major version used across the monorepo
RUN npm install -g pnpm@9

# Copy workspace manifests from repo root — provides the pinned lockfile
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY discord-bot/package.json ./discord-bot/
COPY discord-bot/tsconfig.json discord-bot/tsup.config.ts ./discord-bot/
COPY discord-bot/src ./discord-bot/src

# Install discord-bot dependencies using the root lockfile
# --ignore-scripts skips the root prepare script (lefthook install) which
# requires git — not present in Alpine and not needed in a Docker build.
# Package name is "discord-github-sync-bot" (discord-bot/package.json "name" field)
RUN pnpm install --frozen-lockfile --ignore-scripts --filter discord-github-sync-bot

# Build TypeScript
RUN cd discord-bot && pnpm run build

# Production image
FROM node:20-alpine

WORKDIR /app

# Install system deps and pnpm as separate layers for better cache granularity
RUN apk add --no-cache wget
RUN npm install -g pnpm@9

# Non-root user for hardening
RUN addgroup -S botuser && adduser -S botuser -G botuser

# Copy workspace manifests from builder for frozen prod install
COPY --from=builder /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/package.json ./
COPY --from=builder /app/discord-bot/package.json ./discord-bot/

# Install production dependencies only using pinned lockfile
# --ignore-scripts: same rationale as builder stage (no git in Alpine)
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter discord-github-sync-bot

# Copy built artifacts from builder
COPY --from=builder /app/discord-bot/dist ./discord-bot/dist

# Create data directory for persistent runtime state (commentMap.json)
# process.cwd() = /app, so commentMap resolves to /app/data — matches the Docker volume
RUN mkdir -p /app/data && chown -R botuser:botuser /app/data

USER botuser

# Expose webhook port
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
  CMD wget -qO- http://localhost:5000/health || exit 1

# Run bot
CMD ["node", "discord-bot/dist/index.js"]
