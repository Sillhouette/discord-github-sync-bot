# Multi-stage build for Discord-to-GitHub Issue Bot
# Based on holmityd/GitHub-Issues-Discord-Threads-Bot

FROM node:20-alpine AS builder

WORKDIR /app

# Install git (needed for cloning) and pnpm
RUN apk add --no-cache git && npm install -g pnpm

# Clone holmityd bot repository
RUN git clone https://github.com/holmityd/GitHub-Issues-Discord-Threads-Bot.git bot-source

# Move into cloned directory
WORKDIR /app/bot-source

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build TypeScript
RUN pnpm run build

# Production image
FROM node:20-alpine

WORKDIR /app

# Install pnpm and wget (for health check)
RUN apk add --no-cache wget && npm install -g pnpm

# Copy package files from builder
COPY --from=builder /app/bot-source/package.json /app/bot-source/pnpm-lock.yaml ./

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts from builder
COPY --from=builder /app/bot-source/dist ./dist

# Expose webhook port
EXPOSE 5000

# Run bot
CMD ["node", "dist/index.js"]
