#!/bin/bash
# Deployment script for Discord-to-GitHub Issue Bot
# Run on DigitalOcean Droplet: /opt/osrs-companion/discord-bot/deploy.sh

set -e

echo "=== Discord-to-GitHub Issue Bot Deployment ==="
echo ""

# Configuration
BOT_DIR="/opt/osrs-companion/discord-bot"
REPO_URL="https://github.com/holmityd/GitHub-Issues-Discord-Threads-Bot.git"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if running as root or with sudo
if [[ $EUID -eq 0 ]]; then
   echo -e "${YELLOW}Warning: Running as root. Consider using a non-root user with Docker permissions.${NC}"
fi

# Phase 1: Clone bot repository
echo -e "${GREEN}Phase 1: Cloning holmityd bot repository...${NC}"
if [ -d "$BOT_DIR/src" ]; then
    echo "Bot source already exists. Pulling latest changes..."
    cd "$BOT_DIR"
    git pull
else
    echo "Cloning bot repository..."
    git clone "$REPO_URL" "$BOT_DIR/temp"
    # Move contents to bot directory
    mv "$BOT_DIR/temp/"* "$BOT_DIR/"
    mv "$BOT_DIR/temp/".* "$BOT_DIR/" 2>/dev/null || true
    rm -rf "$BOT_DIR/temp"
fi

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
docker build -t osrs-discord-bot:latest .
echo "Docker image built ✓"

# Phase 4: Stop existing container (if running)
echo -e "${GREEN}Phase 4: Stopping existing container...${NC}"
if docker ps -a | grep -q osrs-discord-bot; then
    docker stop osrs-discord-bot || true
    docker rm osrs-discord-bot || true
    echo "Existing container stopped ✓"
else
    echo "No existing container found (first deployment)"
fi

# Phase 5: Start bot container
echo -e "${GREEN}Phase 5: Starting bot container...${NC}"
docker compose up -d
echo "Bot container started ✓"

# Phase 6: Wait for container to be healthy
echo -e "${GREEN}Phase 6: Waiting for bot to be healthy...${NC}"
echo "This may take up to 40 seconds (start_period)..."
sleep 5

RETRIES=0
MAX_RETRIES=12
until [ "$(docker inspect -f '{{.State.Health.Status}}' osrs-discord-bot 2>/dev/null)" == "healthy" ]; do
    RETRIES=$((RETRIES + 1))
    if [ $RETRIES -ge $MAX_RETRIES ]; then
        echo -e "${RED}Error: Bot did not become healthy within expected time${NC}"
        echo "Check logs: docker logs osrs-discord-bot"
        exit 1
    fi
    echo "Waiting for health check... ($RETRIES/$MAX_RETRIES)"
    sleep 5
done
echo "Bot is healthy ✓"

# Phase 7: Verify bot is running
echo -e "${GREEN}Phase 7: Verifying bot status...${NC}"
docker ps | grep osrs-discord-bot
echo ""

# Display logs (last 20 lines)
echo -e "${GREEN}Recent logs:${NC}"
docker logs osrs-discord-bot --tail 20

echo ""
echo -e "${GREEN}=== Deployment Complete ===${NC}"
echo ""
echo "Next steps:"
echo "1. Verify Discord bot is online in your server"
echo "2. Create a test forum thread to trigger GitHub issue creation"
echo "3. Configure GitHub webhook: https://github.com/$GITHUB_USERNAME/$GITHUB_REPOSITORY/settings/hooks"
echo "   - Payload URL: https://api.theoatrix.app/github-webhook"
echo "   - Content type: application/json"
echo "   - Events: Issues, Issue comments"
echo ""
echo "Monitor logs: docker logs osrs-discord-bot -f"
echo "Restart bot: docker restart osrs-discord-bot"
echo "Stop bot: docker stop osrs-discord-bot"
