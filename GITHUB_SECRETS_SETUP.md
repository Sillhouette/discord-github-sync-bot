# GitHub Secrets Setup for Discord Bot CI/CD

This document explains how to configure GitHub Secrets for automated Discord bot deployment via GitHub Actions.

---

## Required Secrets

The Discord bot deployment requires 4 new GitHub repository secrets to be added:

| Secret Name | Description | How to Obtain |
|-------------|-------------|---------------|
| `DISCORD_TOKEN` | Discord bot authentication token | Discord Developer Portal |
| `DISCORD_CHANNEL_ID` | Discord forum channel ID where bot listens | Discord (Developer Mode) |
| `DISCORD_GITHUB_PAT` | GitHub Personal Access Token for bot | GitHub Settings |
| `GITHUB_WEBHOOK_SECRET` | HMAC secret for webhook signature verification | Generate with `openssl rand -hex 32` |

**Existing Secrets (Already Configured):**
- `DROPLET_HOST` - DigitalOcean Droplet IP address
- `DROPLET_SSH_KEY` - SSH private key for Droplet access

---

## Step-by-Step Setup

### 1. Create Discord Bot Application

**Where:** [Discord Developer Portal](https://discord.com/developers/applications)

**Steps:**
1. Click "New Application"
2. Name: "OSRS Companion Issue Bot"
3. Navigate to "Bot" tab
4. Click "Add Bot"
5. **Copy Bot Token** → This becomes `DISCORD_TOKEN` secret
6. Enable Privileged Gateway Intents:
   - ✅ PRESENCE INTENT
   - ✅ MESSAGE CONTENT INTENT
7. Navigate to "OAuth2" → "URL Generator"
8. Scopes: `bot`, `applications.commands`
9. Bot Permissions:
   - ✅ Send Messages
   - ✅ Manage Threads
   - ✅ Manage Messages
   - ✅ Read Message History
10. Copy generated URL → Invite bot to your Discord server

---

### 2. Create Discord Forum Channel

**Where:** Your Discord Server

**Steps:**
1. Create new channel
2. Channel Type: **Forum** (not Text Channel)
3. Name: `#github-issues` (or any name you prefer)
4. Ensure bot has access to channel
5. Enable Developer Mode (if not already):
   - User Settings → App Settings → Advanced → Developer Mode
6. Right-click forum channel → Copy ID
7. **Copy Channel ID** → This becomes `DISCORD_CHANNEL_ID` secret

---

### 3. Generate GitHub Personal Access Token (Fine-Grained)

**Where:** [GitHub Settings → Personal Access Tokens](https://github.com/settings/tokens?type=beta)

**Steps:**
1. Click "Generate new token" (Fine-grained token)
2. Token name: "OSRS Companion Discord Bot"
3. Expiration: 90 days (set calendar reminder to rotate)
4. Repository access: **Only select repositories** → `osrs-companion`
5. Repository permissions:
   - **Issues**: Read and write
   - **Metadata**: Read-only (automatic)
6. Click "Generate token"
7. **Copy Token** → This becomes `DISCORD_GITHUB_PAT` secret
   - ⚠️ **Important:** Token is shown only once. Store securely.

---

### 4. Add Secrets to GitHub Repository

**Where:** https://github.com/Sillhouette/osrs-companion/settings/secrets/actions

**Steps:**
1. Navigate to repository → Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Add each secret:

**Secret 1: DISCORD_TOKEN**
```
Name: DISCORD_TOKEN
Value: <paste_discord_bot_token>
```

**Secret 2: DISCORD_CHANNEL_ID**
```
Name: DISCORD_CHANNEL_ID
Value: <paste_forum_channel_id>
```

**Secret 3: DISCORD_GITHUB_PAT**
```
Name: DISCORD_GITHUB_PAT
Value: <paste_github_pat>
```

**Secret 4: GITHUB_WEBHOOK_SECRET**
```
Name: GITHUB_WEBHOOK_SECRET
Value: <output of: openssl rand -hex 32>
```

> ⚠️ **Coordinated deploy required:** The same secret must be set in both the
> bot's `.env` AND the GitHub webhook settings at the same time, or the bot
> will reject all incoming webhooks until both match.
>
> After adding this secret:
> 1. Go to: https://github.com/{owner}/{repo}/settings/hooks
> 2. Edit the existing webhook
> 3. Paste the same secret value into the **Secret** field
> 4. Save the webhook
> 5. Redeploy the bot (or restart the container)

4. Click "Add secret" for each

---

## Verification

After adding secrets, verify they are configured:

1. Go to: https://github.com/Sillhouette/osrs-companion/settings/secrets/actions
2. Confirm all 6 secrets are listed:
   - ✅ DISCORD_TOKEN
   - ✅ DISCORD_CHANNEL_ID
   - ✅ DISCORD_GITHUB_PAT
   - ✅ GITHUB_WEBHOOK_SECRET
   - ✅ DROPLET_HOST (existing)
   - ✅ DROPLET_SSH_KEY (existing)

**Note:** Secret values are never shown after creation (security feature).

---

## CI/CD Workflow

### Automatic Deployment

Once secrets are configured, the bot deploys automatically:

**Trigger:** Push to `main` branch with changes to `discord-bot/` directory

**Workflow:**
1. Path-based change detection (`discord-bot/**`)
2. Quality gate: Validate configuration files exist
3. If PR: Quality gate only (no deployment)
4. If Push to Main: Quality gate + deployment

**Deployment Steps (Automated):**
1. SSH into DigitalOcean Droplet
2. Clone holmityd bot repo (if first deployment)
3. Pull latest configuration files from main repo
4. Copy Dockerfile, docker-compose.yml, deploy scripts
5. Create `.env` file from GitHub Secrets
6. Build Docker image
7. Stop existing container (if running)
8. Start new container
9. Wait for health check (up to 60 seconds)
10. Report deployment status

**View Workflow:**
- https://github.com/Sillhouette/osrs-companion/actions/workflows/ci.yml

---

## Manual Deployment (If Needed)

If CI/CD fails or you need to deploy manually:

```bash
# SSH into Droplet
ssh -i ~/.ssh/osrs-companion root@<DROPLET_IP>

# Navigate to bot directory
cd /opt/osrs-companion/discord-bot

# Pull latest changes
git pull origin main

# Run deployment script
./deploy.sh
```

---

## Updating Secrets

### Rotate Discord Bot Token (Every 90 Days)

1. Discord Developer Portal → Your Application → Bot → Reset Token
2. Copy new token
3. GitHub Repo → Settings → Secrets → DISCORD_TOKEN → Update
4. Bot will automatically redeploy on next push to main with discord-bot/ changes

**Or manually restart:**
```bash
ssh -i ~/.ssh/osrs-companion root@<DROPLET_IP>
cd /opt/osrs-companion/discord-bot
docker restart osrs-discord-bot
```

### Rotate GitHub PAT (Every 90 Days)

1. GitHub Settings → Personal Access Tokens → Generate new token (same permissions)
2. Copy new token
3. GitHub Repo → Settings → Secrets → DISCORD_GITHUB_PAT → Update
4. Bot will automatically redeploy on next push to main with discord-bot/ changes
5. Revoke old PAT via GitHub Settings

---

## Testing CI/CD Deployment

### Test 1: Trigger Deployment

1. Make a minor change to any file in `discord-bot/` directory:
   ```bash
   echo "# Test deployment" >> discord-bot/README.md
   git add discord-bot/README.md
   git commit -m "test: trigger Discord bot deployment"
   git push origin main
   ```

2. Watch GitHub Actions:
   - Go to: https://github.com/Sillhouette/osrs-companion/actions
   - Should see "CI" workflow running
   - Click on workflow to view logs

3. Verify deployment succeeded:
   - Check workflow logs show "✓ Bot is healthy"
   - SSH into Droplet: `docker ps | grep osrs-discord-bot`
   - Check bot is "Online" in Discord server

### Test 2: Verify Bot Functionality

1. Create forum thread in Discord `#github-issues`
2. Verify GitHub issue created within 10 seconds
3. Add comment to GitHub issue
4. Verify comment appears in Discord thread

---

## Troubleshooting

### Deployment Failed in GitHub Actions

**Check:**
1. GitHub Actions logs: https://github.com/Sillhouette/osrs-companion/actions
2. Look for error message in "Deploy to Droplet" step
3. Common issues:
   - Missing secret (check all 5 secrets configured)
   - Invalid Discord token (regenerate and update secret)
   - Invalid GitHub PAT (regenerate and update secret)
   - Droplet SSH key expired (update DROPLET_SSH_KEY secret)

**Solution:**
- Fix the issue
- Push another change to `discord-bot/` to re-trigger deployment
- Or manually deploy via SSH (see Manual Deployment section)

### Bot Not Starting After Deployment

**Check:**
1. SSH into Droplet: `docker logs osrs-discord-bot -f`
2. Look for error messages

**Common Issues:**
- Invalid Discord token: Update DISCORD_TOKEN secret, redeploy
- Invalid forum channel ID: Update DISCORD_CHANNEL_ID secret, redeploy
- Invalid GitHub PAT: Update DISCORD_GITHUB_PAT secret, redeploy

### Deployment Successful But Bot Offline in Discord

**Check:**
1. Bot logs: `docker logs osrs-discord-bot -f`
2. Discord Developer Portal → Bot → Token (ensure not regenerated)

**Solution:**
- If token regenerated: Update DISCORD_TOKEN secret, redeploy
- If bot permissions issue: Check bot has access to forum channel

---

## Security Notes

### Secret Protection

- ✅ Secrets are encrypted at rest in GitHub
- ✅ Secrets are never logged in workflow output
- ✅ Secrets are injected as environment variables at runtime
- ✅ `.env` file on Droplet is not committed to Git (in `.gitignore`)

### Access Control

- Only repository admins can view/modify secrets
- Secrets are not accessible in pull requests from forks
- Deployment only triggered on push to main (not PRs)

### Token Rotation

- Set calendar reminders for 90-day rotation:
  - Discord bot token
  - GitHub PAT
- Old tokens should be revoked after new ones are deployed

---

## Additional Resources

- **GitHub Actions Documentation:** https://docs.github.com/en/actions
- **GitHub Encrypted Secrets:** https://docs.github.com/en/actions/security-guides/encrypted-secrets
- **Discord Developer Portal:** https://discord.com/developers/applications
- **GitHub Fine-Grained PATs:** https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens

---

## Quick Reference

### GitHub Secrets Location
https://github.com/Sillhouette/osrs-companion/settings/secrets/actions

### GitHub Actions Workflows
https://github.com/Sillhouette/osrs-companion/actions/workflows/ci.yml

### Discord Developer Portal
https://discord.com/developers/applications

### GitHub PAT Settings
https://github.com/settings/tokens?type=beta

### Droplet SSH Command
```bash
ssh -i ~/.ssh/osrs-companion root@<DROPLET_IP>
```

### Bot Logs Command
```bash
docker logs osrs-discord-bot -f
```

### Restart Bot Command
```bash
docker restart osrs-discord-bot
```
