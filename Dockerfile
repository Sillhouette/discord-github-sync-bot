# Multi-stage build for Discord-to-GitHub Issue Bot
# Vendored from holmityd/GitHub-Issues-Discord-Threads-Bot with local patches
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
# Package name is "gitbot" (discord-bot/package.json "name" field)
RUN pnpm install --frozen-lockfile --filter gitbot

# Build TypeScript
RUN cd discord-bot && pnpm run build

# Production image
FROM node:20-alpine

WORKDIR /app

# Install pnpm and wget (for health check)
RUN apk add --no-cache wget && npm install -g pnpm@9

# Copy workspace manifests from builder for frozen prod install
COPY --from=builder /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/package.json ./
COPY --from=builder /app/discord-bot/package.json ./discord-bot/

# Install production dependencies only using pinned lockfile
RUN pnpm install --frozen-lockfile --prod --filter gitbot

# Copy built artifacts from builder
COPY --from=builder /app/discord-bot/dist ./discord-bot/dist

# Create data directory for persistent runtime state (commentMap.json)
# process.cwd() = /app, so commentMap resolves to /app/data — matches the Docker volume
RUN mkdir -p /app/data

# Expose webhook port
EXPOSE 5000

# Run bot
CMD ["node", "discord-bot/dist/index.js"]
