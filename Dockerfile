# Multi-stage build for Discord-to-GitHub Issue Bot
# Vendored from holmityd/GitHub-Issues-Discord-Threads-Bot with local patches

FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy vendored source
COPY package.json pnpm-lock.yaml tsconfig.json webpack.config.js ./
COPY src ./src

# Install dependencies
RUN pnpm install

# Build TypeScript
RUN pnpm run build

# Production image
FROM node:20-alpine

WORKDIR /app

# Install pnpm and wget (for health check)
RUN apk add --no-cache wget && npm install -g pnpm

# Copy package files from builder
COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./

# Install production dependencies only
RUN pnpm install --prod

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist

# Create data directory for persistent runtime state (commentMap.json)
RUN mkdir -p /app/data

# Expose webhook port
EXPOSE 5000

# Run bot
CMD ["node", "dist/index.js"]
