# Multi-stage build for Discord-to-GitHub Issue Bot
# Based on holmityd/GitHub-Issues-Discord-Threads-Bot

FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy dependency manifests
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build TypeScript
RUN pnpm run build

# Production image
FROM node:20-alpine

WORKDIR /app

# Install pnpm in production image
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist

# Expose webhook port
EXPOSE 5000

# Run bot
CMD ["node", "dist/index.js"]
