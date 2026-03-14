#!/bin/bash
# Deployment script for Discord GitHub Sync Bot

set -e

echo "=== Discord GitHub Sync Bot Deployment ==="
echo ""

# Configuration — defaults to current directory; override with BOT_DIR env var
BOT_DIR="${BOT_DIR:-$(pwd)}"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Container name — override with BOT_CONTAINER env var
BOT_CONTAINER="${BOT_CONTAINER:-discord-github-sync-bot}"

# Check if running as root or with sudo
if [[ $EUID -eq 0 ]]; then
   echo -e "${YELLOW}Warning: Running as root. Consider using a non-root user with Docker permissions.${NC}"
fi

# Phase 1: Navigate to bot directory
echo -e "${GREEN}Phase 1: Navigating to bot directory...${NC}"
cd "$BOT_DIR"

# Phase 2: Verify environment configuration
echo -e "${GREEN}Phase 2: Verifying environment configuration...${NC}"
if [ ! -f ".env" ]; then
    echo -e "${RED}Error: .env file not found!${NC}"
    echo "Please create .env file with required configuration:"
    echo "  - DISCORD_TOKEN"
    echo "  - DISCORD_CHANNEL_ID"
    echo "  - GITHUB_ACCESS_TOKEN"
    echo "  - GITHUB_USERNAME"
    echo "  - GITHUB_REPOSITORY"
    echo "  - PORT"
    echo ""
    echo "See .env.example for template."
    exit 1
fi

# Check required environment variables
source .env
REQUIRED_VARS=("DISCORD_TOKEN" "DISCORD_CHANNEL_ID" "GITHUB_ACCESS_TOKEN" "GITHUB_USERNAME" "GITHUB_REPOSITORY" "PORT")
for VAR in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!VAR}" ]; then
        echo -e "${RED}Error: $VAR is not set in .env${NC}"
        exit 1
    fi
done
echo "Environment configuration verified ✓"

# Phase 3: Build Docker image
echo -e "${GREEN}Phase 3: Building Docker image...${NC}"
docker build -f Dockerfile.standalone -t "${BOT_CONTAINER}:latest" .
echo "Docker image built ✓"

# Phase 4: Stop existing container (if running)
echo -e "${GREEN}Phase 4: Stopping existing container...${NC}"
if docker ps -a | grep -q "${BOT_CONTAINER}"; then
    docker stop "${BOT_CONTAINER}" || true
    docker rm "${BOT_CONTAINER}" || true
    echo "Existing container stopped ✓"
else
    echo "No existing container found (first deployment)"
fi

# Phase 5: Start bot container
echo -e "${GREEN}Phase 5: Starting bot container...${NC}"
docker run -d \
  --name "${BOT_CONTAINER}" \
  --restart unless-stopped \
  --env-file .env \
  -p "${PORT}:${PORT}" \
  -v "${BOT_CONTAINER}-data:/app/data" \
  "${BOT_CONTAINER}:latest"
echo "Bot container started ✓"

# Phase 6: Wait for container to be healthy
echo -e "${GREEN}Phase 6: Waiting for bot to be healthy...${NC}"
echo "This may take up to 40 seconds (start_period)..."
sleep 5

RETRIES=0
MAX_RETRIES=12
until [ "$(docker inspect -f '{{.State.Health.Status}}' "${BOT_CONTAINER}" 2>/dev/null)" == "healthy" ]; do
    RETRIES=$((RETRIES + 1))
    if [ $RETRIES -ge $MAX_RETRIES ]; then
        echo -e "${RED}Error: Bot did not become healthy within expected time${NC}"
        echo "Check logs: docker logs ${BOT_CONTAINER}"
        exit 1
    fi
    echo "Waiting for health check... ($RETRIES/$MAX_RETRIES)"
    sleep 5
done
echo "Bot is healthy ✓"

# Phase 7: Verify bot is running
echo -e "${GREEN}Phase 7: Verifying bot status...${NC}"
docker ps | grep "${BOT_CONTAINER}"
echo ""

# Display logs (last 20 lines)
echo -e "${GREEN}Recent logs:${NC}"
docker logs "${BOT_CONTAINER}" --tail 20

echo ""
echo -e "${GREEN}=== Deployment Complete ===${NC}"
echo ""
echo "Next steps:"
echo "1. Verify Discord bot is online in your server"
echo "2. Create a test forum thread to trigger GitHub issue creation"
echo "3. Configure GitHub webhook (see README.md — GitHub Webhook Setup)"
echo ""
echo "Monitor logs: docker logs ${BOT_CONTAINER} -f"
echo "Restart bot: docker restart ${BOT_CONTAINER}"
echo "Stop bot: docker stop ${BOT_CONTAINER}"
