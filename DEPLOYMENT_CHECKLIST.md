# Discord-to-GitHub Issue Bot - Deployment Checklist

Use this checklist to ensure all prerequisites are met before deployment.

---

## Pre-Deployment Checklist

### 1. Discord Bot Application ✅ / ❌

- [ ] Created bot application in Discord Developer Portal
- [ ] Copied bot token (stored securely)
- [ ] Enabled PRESENCE INTENT
- [ ] Enabled MESSAGE CONTENT INTENT
- [ ] Generated OAuth2 invite URL with correct permissions
- [ ] Invited bot to Discord server
- [ ] Bot shows as "Offline" in server (will be online after deployment)

### 2. Discord Forum Channel ✅ / ❌

- [ ] Created forum channel (not text channel) in Discord server
- [ ] Copied channel ID (Developer Mode enabled)
- [ ] Bot has access to channel (channel permissions)

### 3. GitHub Personal Access Token ✅ / ❌

- [ ] Generated fine-grained PAT at https://github.com/settings/tokens?type=beta
- [ ] Set expiration to 90 days
- [ ] Limited to `raustin/osrs-companion` repository only
- [ ] Permissions: Issues (Read and write)
- [ ] Copied token (stored securely)
- [ ] Set calendar reminder to rotate token before expiry

### 4. DigitalOcean Droplet Access ✅ / ❌

- [ ] Can SSH into droplet: `ssh -i ~/.ssh/osrs-companion root@134.209.169.66`
- [ ] Docker is installed and running: `docker --version`
- [ ] Port 5000 is available (not used by other services)

### 5. Configuration Files ✅ / ❌

- [ ] Created `.env` file in `/opt/osrs-companion/discord-bot/`
- [ ] All environment variables set:
  - [ ] `DISCORD_TOKEN`
  - [ ] `DISCORD_CHANNEL_ID`
  - [ ] `GITHUB_ACCESS_TOKEN`
  - [ ] `GITHUB_USERNAME=raustin`
  - [ ] `GITHUB_REPOSITORY=osrs-companion`
  - [ ] `PORT=5000`
- [ ] `.env` file is NOT committed to Git (in `.gitignore`)

---

## Deployment Steps

### Phase 1: SSH and Setup (10 minutes)

```bash
# SSH into droplet
ssh -i ~/.ssh/osrs-companion root@134.209.169.66
cd /opt/osrs-companion

# Clone bot repository
git clone https://github.com/holmityd/GitHub-Issues-Discord-Threads-Bot.git discord-bot
cd discord-bot

# Create .env file
nano .env
# (paste configuration from Prerequisites section)
```

- [ ] SSH successful
- [ ] Bot repository cloned
- [ ] `.env` file created and verified

### Phase 2: nginx Configuration (5 minutes)

```bash
# Edit nginx config
sudo nano /etc/nginx/sites-available/api.theoatrix.app
# (add location block from nginx-webhook.conf)

# Test and reload
sudo nginx -t
sudo systemctl reload nginx
```

- [ ] nginx location block added
- [ ] nginx test passed (`nginx -t`)
- [ ] nginx reloaded successfully

### Phase 3: Bot Deployment (10 minutes)

```bash
# Run deployment script
cd /opt/osrs-companion/discord-bot
chmod +x deploy.sh
./deploy.sh
```

- [ ] Deployment script executed successfully
- [ ] Docker image built
- [ ] Container started
- [ ] Health check passed
- [ ] Bot shows as "Online" in Discord server

### Phase 4: GitHub Webhook (5 minutes)

1. Go to https://github.com/raustin/osrs-companion/settings/hooks
2. Add webhook:
   - Payload URL: `https://api.theoatrix.app/github-webhook`
   - Content type: `application/json`
   - Events: Issues, Issue comments
3. Save webhook

- [ ] Webhook created
- [ ] Webhook shows as active (green checkmark)

---

## Post-Deployment Verification

### Test 1: Discord → GitHub (Issue Creation) ✅ / ❌

1. Go to Discord forum channel `#github-issues`
2. Create new post: "Test issue from Discord"
3. Wait 5-10 seconds

**Expected Result:**
- GitHub issue created: https://github.com/raustin/osrs-companion/issues
- Issue title matches Discord thread title
- Issue body contains Discord message content

- [ ] GitHub issue created successfully
- [ ] Issue title matches thread title
- [ ] Issue body contains correct content

### Test 2: GitHub → Discord (Comment Sync) ✅ / ❌

1. Go to GitHub issue created in Test 1
2. Add comment: "Test comment from GitHub"
3. Wait 5-10 seconds

**Expected Result:**
- Comment appears in Discord forum thread
- Comment shows author as GitHub username
- Comment content matches

- [ ] Comment synced to Discord
- [ ] Content matches
- [ ] Author information correct

### Test 3: GitHub → Discord (Status Sync) ✅ / ❌

1. Close GitHub issue (via web UI)
2. Wait 5-10 seconds
3. Check Discord thread

**Expected Result:**
- Discord thread shows "Closed" status
- Thread may be locked/archived (depends on bot config)

- [ ] Status synced to Discord
- [ ] Thread reflects closed state

### Test 4: Partner Workflow Test ✅ / ❌

**Ask partner to:**
1. Create forum thread in `#github-issues`
2. Describe a real bug or feature request
3. View the created GitHub issue (send them link)

**Verify:**
- [ ] Partner can create GitHub issues without GitHub account
- [ ] Issue quality is acceptable (readable, actionable)
- [ ] Partner understands workflow

---

## Monitoring Setup

### Immediate (First 24 Hours) ✅ / ❌

- [ ] Check bot logs every 4 hours: `docker logs osrs-discord-bot --tail 50`
- [ ] Monitor GitHub webhook deliveries (Settings → Webhooks → Recent Deliveries)
- [ ] Verify no error spikes in bot logs
- [ ] Confirm Docker container health: `docker ps | grep osrs-discord-bot`

### Ongoing (Weekly) ✅ / ❌

- [ ] Review bot logs for errors or warnings
- [ ] Check GitHub webhook delivery success rate (>95%)
- [ ] Verify partner satisfaction with workflow
- [ ] Monitor Docker container uptime

### Token Rotation (Every 90 Days) ✅ / ❌

- [ ] Set calendar reminder 7 days before token expiry
- [ ] Generate new GitHub PAT
- [ ] Update `.env` file
- [ ] Restart bot: `docker restart osrs-discord-bot`
- [ ] Revoke old token

---

## Rollback Plan (If Deployment Fails)

### Immediate Rollback

```bash
# Stop bot container
docker stop osrs-discord-bot
docker rm osrs-discord-bot

# Remove nginx webhook config
sudo nano /etc/nginx/sites-available/api.theoatrix.app
# (delete /github-webhook location block)
sudo systemctl reload nginx

# Disable GitHub webhook
# Go to GitHub → Settings → Webhooks → Delete webhook
```

### Fallback Workflow

- Partner messages you via Discord (current workflow)
- You manually create GitHub issues
- No data loss (GitHub issues remain intact)

---

## Success Criteria

### Gate Criteria (Must Pass) ✅ / ❌

- [ ] Partner can create GitHub issues from Discord (without GitHub account)
- [ ] Partner can view issue status via Discord
- [ ] Bot runs 24/7 with auto-restart (Docker restart policy)
- [ ] Bidirectional sync working (Discord ↔ GitHub)
- [ ] Zero GitHub repo access requests from partner

### Validation Metrics (1 Week After Deployment)

- [ ] Partner creates 3+ issues via Discord (no manual intervention)
- [ ] Bot uptime >99% (minimal downtime)
- [ ] Webhook delivery success rate >95%
- [ ] Partner satisfaction (ask for feedback)

---

## Troubleshooting Reference

| Issue | Solution |
|-------|----------|
| Bot offline in Discord | Check bot logs: `docker logs osrs-discord-bot -f` |
| No GitHub issue created | Verify GitHub PAT permissions, check bot logs |
| Webhook not delivering | Test nginx: `curl -X POST https://api.theoatrix.app/github-webhook` |
| Container keeps restarting | Check health: `docker inspect osrs-discord-bot \| grep -A 10 Health` |
| Forum channel not working | Verify channel type is Forum (not Text Channel) |

**Full troubleshooting guide:** See `README.md`

---

## Post-Deployment Notes

**Deployed by:** _______________

**Date:** _______________

**Deployment time:** _______________

**Issues encountered:** _______________

**Partner feedback:** _______________

**Next review date:** _______________
