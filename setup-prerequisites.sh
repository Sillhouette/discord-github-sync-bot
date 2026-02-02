#!/bin/bash
# Prerequisites setup script for Discord-to-GitHub Issue Bot
# Automates GitHub webhook creation and validates configuration

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Discord-to-GitHub Issue Bot - Prerequisites Setup ===${NC}"
echo ""

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo -e "${RED}Error: .env file not found!${NC}"
    echo ""
    echo "Please create .env file with the following variables:"
    echo "  DISCORD_TOKEN=<your_discord_bot_token>"
    echo "  DISCORD_CHANNEL_ID=<your_forum_channel_id>"
    echo "  GITHUB_ACCESS_TOKEN=<your_github_pat>"
    echo "  GITHUB_USERNAME=raustin"
    echo "  GITHUB_REPOSITORY=osrs-companion"
    echo "  PORT=5000"
    echo ""
    echo "See .env.example for template."
    exit 1
fi

# Load environment variables
source .env

# Verify required variables
echo -e "${GREEN}Step 1: Validating environment configuration...${NC}"
REQUIRED_VARS=("DISCORD_TOKEN" "DISCORD_CHANNEL_ID" "GITHUB_ACCESS_TOKEN" "GITHUB_USERNAME" "GITHUB_REPOSITORY" "PORT")
MISSING_VARS=()

for VAR in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!VAR}" ]; then
        MISSING_VARS+=("$VAR")
    fi
done

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    echo -e "${RED}Error: Missing required environment variables:${NC}"
    for VAR in "${MISSING_VARS[@]}"; do
        echo "  - $VAR"
    done
    exit 1
fi

echo -e "${GREEN}✓ All required environment variables are set${NC}"
echo ""

# Check if gh CLI is installed
echo -e "${GREEN}Step 2: Checking GitHub CLI installation...${NC}"
if ! command -v gh &> /dev/null; then
    echo -e "${YELLOW}Warning: GitHub CLI (gh) not installed${NC}"
    echo "GitHub webhook will need to be created manually."
    echo ""
    echo "To install GitHub CLI:"
    echo "  Ubuntu/Debian: sudo apt install gh"
    echo "  macOS: brew install gh"
    echo ""
    SKIP_WEBHOOK=true
else
    echo -e "${GREEN}✓ GitHub CLI is installed${NC}"
    SKIP_WEBHOOK=false
fi
echo ""

# Authenticate GitHub CLI if needed
if [ "$SKIP_WEBHOOK" = false ]; then
    echo -e "${GREEN}Step 3: Authenticating GitHub CLI...${NC}"

    # Check if already authenticated
    if gh auth status &> /dev/null; then
        echo -e "${GREEN}✓ Already authenticated with GitHub${NC}"
    else
        echo "Authenticating with GitHub using PAT from .env..."
        echo "$GITHUB_ACCESS_TOKEN" | gh auth login --with-token

        if gh auth status &> /dev/null; then
            echo -e "${GREEN}✓ Successfully authenticated with GitHub${NC}"
        else
            echo -e "${RED}Error: Failed to authenticate with GitHub${NC}"
            SKIP_WEBHOOK=true
        fi
    fi
    echo ""
fi

# Create GitHub webhook
if [ "$SKIP_WEBHOOK" = false ]; then
    echo -e "${GREEN}Step 4: Creating GitHub webhook...${NC}"

    WEBHOOK_URL="https://api.theoatrix.app/github-webhook"
    REPO="${GITHUB_USERNAME}/${GITHUB_REPOSITORY}"

    # Check if webhook already exists
    EXISTING_WEBHOOK=$(gh api "repos/${REPO}/hooks" --jq ".[] | select(.config.url == \"${WEBHOOK_URL}\") | .id" 2>/dev/null || echo "")

    if [ -n "$EXISTING_WEBHOOK" ]; then
        echo -e "${YELLOW}Webhook already exists (ID: $EXISTING_WEBHOOK)${NC}"
        echo "Do you want to recreate it? (y/N)"
        read -r RECREATE

        if [[ "$RECREATE" =~ ^[Yy]$ ]]; then
            echo "Deleting existing webhook..."
            gh api -X DELETE "repos/${REPO}/hooks/${EXISTING_WEBHOOK}"
            echo -e "${GREEN}✓ Deleted existing webhook${NC}"
        else
            echo "Keeping existing webhook"
            echo ""
            echo -e "${GREEN}=== Prerequisites Setup Complete ===${NC}"
            exit 0
        fi
    fi

    echo "Creating webhook at ${WEBHOOK_URL}..."

    # Create webhook via GitHub API
    WEBHOOK_ID=$(gh api "repos/${REPO}/hooks" \
        -X POST \
        -f name='web' \
        -f config[url]="${WEBHOOK_URL}" \
        -f config[content_type]='json' \
        -f config[insecure_ssl]='0' \
        -F events[]='issues' \
        -F events[]='issue_comment' \
        -F active=true \
        --jq '.id' 2>&1)

    if [ $? -eq 0 ] && [ -n "$WEBHOOK_ID" ]; then
        echo -e "${GREEN}✓ Webhook created successfully (ID: $WEBHOOK_ID)${NC}"
        echo ""
        echo "Webhook details:"
        echo "  URL: ${WEBHOOK_URL}"
        echo "  Events: issues, issue_comment"
        echo "  Status: Active"
        echo ""
        echo "Verify webhook at: https://github.com/${REPO}/settings/hooks/${WEBHOOK_ID}"
    else
        echo -e "${RED}Error: Failed to create webhook${NC}"
        echo "Response: $WEBHOOK_ID"
        echo ""
        echo "Please create webhook manually:"
        echo "1. Go to: https://github.com/${REPO}/settings/hooks"
        echo "2. Click 'Add webhook'"
        echo "3. Payload URL: ${WEBHOOK_URL}"
        echo "4. Content type: application/json"
        echo "5. Events: Issues, Issue comments"
        echo "6. Active: Yes"
    fi
else
    echo -e "${YELLOW}Step 4: Skipping GitHub webhook creation (manual setup required)${NC}"
    echo ""
    echo "Please create webhook manually:"
    echo "1. Go to: https://github.com/${GITHUB_USERNAME}/${GITHUB_REPOSITORY}/settings/hooks"
    echo "2. Click 'Add webhook'"
    echo "3. Payload URL: https://api.theoatrix.app/github-webhook"
    echo "4. Content type: application/json"
    echo "5. Events: Issues, Issue comments"
    echo "6. Active: Yes"
fi

echo ""
echo -e "${GREEN}=== Prerequisites Setup Complete ===${NC}"
echo ""
echo "Next steps:"
echo "1. Verify Discord bot is created and invited to server"
echo "2. Verify Discord forum channel exists and bot has access"
echo "3. Run deployment: ./deploy.sh"
