# Discord-to-GitHub Issue Bot

Bidirectional sync between Discord forum threads and GitHub issues for partner collaboration without repo access.

**Based on:** [holmityd/GitHub-Issues-Discord-Threads-Bot](https://github.com/holmityd/GitHub-Issues-Discord-Threads-Bot)

**Deployment:** Automated via GitHub Actions CI/CD pipeline

---

## Deployment Options

### Option 1: Automated CI/CD (Recommended)

**Deploys automatically on push to main** when `discord-bot/` files change.

**Setup:** See [GITHUB_SECRETS_SETUP.md](GITHUB_SECRETS_SETUP.md) for configuring GitHub Secrets.

**Workflow:** `.github/workflows/ci.yml` handles deployment to DigitalOcean Droplet.

**Status:** View at https://github.com/raustin/osrs-companion/actions

### Option 2: Manual Deployment

**Use when:** CI/CD is not configured yet or manual deploy needed.

**Steps:** Follow deployment instructions below.

---

## Features

- ✅ **Create GitHub issues** from Discord forum threads
- ✅ **View GitHub issues** in Discord (bidirectional sync)
- ✅ **Comment sync** (Discord ↔ GitHub)
- ✅ **Status sync** (open/closed/reopened)
- ✅ **Label mapping** (Discord tags → GitHub labels)
- ✅ **Partner collaboration** (no GitHub repo access needed)

---

## Architecture

```
Discord Forum (#github-issues)
         ↕ Discord API
    Discord Bot (Node.js 20)
    • Forum event listener
    • Webhook server (:5000)
         ↕ Octokit API  ↕ Webhooks
      GitHub Issues
```

**Hosting:** Docker container on DigitalOcean Droplet

**Webhook:** nginx reverse proxy (`/github-webhook` → `:5000`)

---

## Prerequisites

### 1. Discord Bot Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" → Name: "OSRS Companion Issue Bot"
3. Bot tab → "Add Bot" → Copy token (save for `.env`)
4. Enable Privileged Gateway Intents:
   - ✅ PRESENCE INTENT
   - ✅ MESSAGE CONTENT INTENT
5. OAuth2 → URL Generator:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions:
     - ✅ Send Messages
     - ✅ Manage Threads
     - ✅ Manage Messages
     - ✅ Read Message History
6. Copy generated URL → Invite bot to your Discord server

### 2. Discord Forum Channel

1. In your Discord server, create a new channel
2. Channel Type: **Forum** (not Text Channel)
3. Name: `#github-issues` (or any name you prefer)
4. Right-click channel → Copy ID (save for `.env`)
   - **Note:** Enable Developer Mode in User Settings → App Settings → Advanced → Developer Mode

### 3. GitHub Fine-Grained Personal Access Token (PAT)

1. Go to [GitHub Settings → Personal Access Tokens](https://github.com/settings/tokens?type=beta)
2. Click "Generate new token" (Fine-grained token)
3. Token name: "OSRS Companion Discord Bot"
4. Expiration: 90 days (set calendar reminder to rotate)
5. Repository access: **Only select repositories** → `osrs-companion`
6. Permissions:
   - Repository permissions → **Issues**: Read and write
   - Repository permissions → **Metadata**: Read-only (automatic)
7. Click "Generate token" → Copy token (save for `.env`)
   - ⚠️ **Important:** Token is shown only once. Store securely.

### 4. GitHub Webhook

**Do this AFTER bot is deployed and running:**

1. Go to `https://github.com/raustin/osrs-companion/settings/hooks`
2. Click "Add webhook"
3. Payload URL: `https://api.theoatrix.app/github-webhook`
4. Content type: `application/json`
5. Secret: (leave empty for MVP; can add later)
6. Events:
   - ✅ Issues
   - ✅ Issue comments
   - ❌ Uncheck "Pushes" (not needed)
7. Active: ✅ Enabled
8. Click "Add webhook"

---

## Deployment

### Step 1: SSH into DigitalOcean Droplet

```bash
ssh -i ~/.ssh/osrs-companion root@134.209.169.66
cd /opt/osrs-companion
```

### Step 2: Clone Bot Repository

```bash
# Clone holmityd bot repo to discord-bot directory
git clone https://github.com/holmityd/GitHub-Issues-Discord-Threads-Bot.git discord-bot
cd discord-bot

# Copy configuration files from this repo
# (Dockerfile, docker-compose.yml, .env.example are already in discord-bot/ directory)
```

### Step 3: Create `.env` File

```bash
cp .env.example .env
nano .env
```

Fill in the values:

```bash
DISCORD_TOKEN=<your_discord_bot_token>
DISCORD_CHANNEL_ID=<your_forum_channel_id>
GITHUB_ACCESS_TOKEN=<your_github_pat>
GITHUB_USERNAME=raustin
GITHUB_REPOSITORY=osrs-companion
PORT=5000
```

Save and exit (`Ctrl+X`, `Y`, `Enter`).

### Step 4: Configure nginx Reverse Proxy

```bash
# Edit nginx config for api.theoatrix.app
sudo nano /etc/nginx/sites-available/api.theoatrix.app
```

Add this location block inside the existing `server` block:

```nginx
location /github-webhook {
    proxy_pass http://localhost:5000/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-GitHub-Event $http_x_github_event;
    proxy_set_header X-GitHub-Delivery $http_x_github_delivery;
    proxy_set_header X-Hub-Signature-256 $http_x_hub_signature_256;
    proxy_read_timeout 30s;
    proxy_connect_timeout 10s;
    proxy_buffering off;
    limit_except POST {
        deny all;
    }
}
```

Test and reload nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### Step 5: Run Deployment Script

```bash
chmod +x deploy.sh
./deploy.sh
```

The script will:

1. Clone/update bot repository
2. Verify `.env` configuration
3. Build Docker image
4. Stop existing container (if running)
5. Start new container
6. Wait for health check
7. Display logs

### Step 6: Verify Deployment

**Check bot status:**

```bash
docker ps | grep osrs-discord-bot
```

**View logs:**

```bash
docker logs osrs-discord-bot -f
```

**Verify Discord bot is online:**

- Check your Discord server members list
- Bot should show as "Online" (green dot)

### Step 7: Configure GitHub Webhook

Follow instructions in Prerequisites section (#4 above).

---

## Testing

### Test 1: Discord → GitHub (Issue Creation)

1. Go to Discord forum channel `#github-issues`
2. Create a new post:
   - Title: "Test issue from Discord"
   - Message: "This is a test to verify bot functionality."
3. Bot should auto-create GitHub issue within seconds
4. Verify issue appears at: `https://github.com/raustin/osrs-companion/issues`

### Test 2: GitHub → Discord (Comment Sync)

1. Go to the GitHub issue created in Test 1
2. Add a comment: "Test comment from GitHub"
3. Check Discord forum thread
4. Bot should post comment to Discord thread within seconds

### Test 3: GitHub → Discord (Status Sync)

1. Close the GitHub issue (via GitHub web UI)
2. Check Discord forum thread
3. Thread should update to show "Closed" status

### Test 4: Discord → GitHub (Comment Sync)

1. Reply to the Discord forum thread
2. Check GitHub issue
3. Comment should appear in GitHub issue

---

## Monitoring

### View Logs

```bash
# Follow logs in real-time
docker logs osrs-discord-bot -f

# View last 50 lines
docker logs osrs-discord-bot --tail 50
```

### Check Container Health

```bash
# Container status
docker ps | grep osrs-discord-bot

# Health status
docker inspect osrs-discord-bot | grep -A 10 Health
```

### Check GitHub Webhook Delivery

1. Go to `https://github.com/raustin/osrs-companion/settings/hooks`
2. Click on webhook (https://api.theoatrix.app/github-webhook)
3. Scroll to "Recent Deliveries"
4. Should see 2xx response codes (success)
5. If 4xx/5xx, check bot logs and nginx config

---

## Maintenance

### Restart Bot

```bash
docker restart osrs-discord-bot
```

### Stop Bot

```bash
docker stop osrs-discord-bot
```

### Update Bot (Pull Latest Changes)

```bash
cd /opt/osrs-companion/discord-bot
git pull
docker build -t osrs-discord-bot:latest .
docker restart osrs-discord-bot
```

### Rotate Tokens (Every 90 Days)

**GitHub PAT:**

1. Generate new fine-grained PAT (same permissions)
2. Update `.env` file: `GITHUB_ACCESS_TOKEN=<new_token>`
3. Restart bot: `docker restart osrs-discord-bot`
4. Revoke old token via GitHub Settings

**Discord Bot Token:**

1. Discord Developer Portal → Bot → Reset Token
2. Update `.env` file: `DISCORD_TOKEN=<new_token>`
3. Restart bot: `docker restart osrs-discord-bot`

---

## Troubleshooting

### Bot Not Creating GitHub Issues

**Check:**

1. Bot logs: `docker logs osrs-discord-bot -f`
2. GitHub PAT permissions (Issues: Read and write)
3. Discord forum channel ID in `.env` is correct
4. Bot has permissions in Discord (Send Messages, Manage Threads)

**Solution:**

- Verify `.env` configuration
- Restart bot: `docker restart osrs-discord-bot`
- Check logs for specific error messages

### GitHub Webhook Not Delivering

**Check:**

1. nginx config for `/github-webhook` location block
2. nginx status: `sudo systemctl status nginx`
3. GitHub webhook Recent Deliveries (response codes)
4. Bot container is running and healthy

**Solution:**

- Test webhook endpoint: `curl -X POST https://api.theoatrix.app/github-webhook`
- Reload nginx: `sudo systemctl reload nginx`
- Check bot logs for webhook receive messages

### Bot Container Keeps Restarting

**Check:**

1. Container logs: `docker logs osrs-discord-bot --tail 100`
2. Health check status: `docker inspect osrs-discord-bot | grep -A 10 Health`
3. `.env` file has all required variables

**Solution:**

- Fix errors shown in logs
- Verify Discord token and GitHub PAT are valid
- Ensure port 5000 is not already in use

### Discord Forum Channel Requirement

**Error:** Bot doesn't work with text channels

**Solution:**

- This bot requires Discord **forum channels** (not text channels)
- If your server doesn't support forums, check server boost level
- Alternative: Use different bot that supports text channels (not recommended)

---

## Security Notes

### Current Posture (MVP-Acceptable)

- ✅ Fine-grained PAT (repo-scoped, issues only)
- ✅ Discord token in `.env` (not committed to Git)
- ✅ nginx reverse proxy with TLS (Cloudflare SSL)
- ✅ Docker container isolation
- ⚠️ No webhook signature validation (acceptable for MVP)

### Post-MVP Hardening (Future)

1. **Webhook Signature Validation**
   - Add GitHub webhook secret
   - Verify HMAC signature in bot code
   - Prevents unauthorized webhook requests

2. **Rate Limiting**
   - Add express-rate-limit to webhook endpoint
   - Prevents abuse if URL leaks

3. **Token Rotation**
   - Set calendar reminder for 90-day rotation
   - Document rotation procedure in ops runbook

---

## Support

**Documentation:**

- Original bot: https://github.com/holmityd/GitHub-Issues-Discord-Threads-Bot
- Discord.js: https://discord.js.org/
- Octokit: https://octokit.github.io/rest.js/

**Logs:**

```bash
docker logs osrs-discord-bot -f
```

**Configuration:**

- Backlog item: `docs/backlog/tooling/P2-discord-github-issue-bot.md`
- Discovery: `docs/analysis/20260201_discover_discord-github-integration.md`

**Force Redeploy**
.
