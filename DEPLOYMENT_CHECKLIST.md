# Discord GitHub Sync Bot — Deployment Checklist

Use this checklist to ensure all prerequisites are met before deployment.

---

## Pre-Deployment Checklist

### 1. Discord Bot Application

- [ ] Created bot application in Discord Developer Portal
- [ ] Copied bot token (stored securely)
- [ ] Enabled PRESENCE INTENT
- [ ] Enabled MESSAGE CONTENT INTENT
- [ ] Generated OAuth2 invite URL with correct permissions
- [ ] Invited bot to Discord server
- [ ] Bot shows as "Offline" in server (will be online after deployment)

### 2. Discord Forum Channel

- [ ] Created forum channel (not text channel) in Discord server
- [ ] Copied channel ID (Developer Mode enabled)
- [ ] Bot has access to channel (channel permissions)

### 3. GitHub Personal Access Token

- [ ] Generated fine-grained PAT at https://github.com/settings/tokens?type=beta
- [ ] Set expiration (90 days recommended; set a calendar reminder to rotate)
- [ ] Limited to target repository only
- [ ] Permissions: Issues (Read and write)
- [ ] Copied token (stored securely)

### 4. Server / Hosting

- [ ] Server is running and accessible
- [ ] Docker is installed and running: `docker --version`
- [ ] Port 5000 is available (or whichever port you set in `PORT`)

### 5. Configuration Files

- [ ] Created `.env` file from `.env.example`
- [ ] All required environment variables set:
  - [ ] `DISCORD_TOKEN`
  - [ ] `DISCORD_CHANNEL_ID`
  - [ ] `GITHUB_ACCESS_TOKEN`
  - [ ] `GITHUB_USERNAME`
  - [ ] `GITHUB_REPOSITORY`
  - [ ] `PORT`
- [ ] `GITHUB_WEBHOOK_SECRET` set (strongly recommended for production)
- [ ] `.env` file is NOT committed to Git

---

## Deployment Steps

### Phase 1: Build and start the bot (5 minutes)

```bash
# From within the discord-bot/ directory (or your cloned repo root)
docker build -f Dockerfile.standalone -t discord-github-sync-bot .
docker run -d \
  --name discord-github-sync-bot \
  --restart unless-stopped \
  --env-file .env \
  -v discord-bot-data:/app/data \
  discord-github-sync-bot
```

- [ ] Docker image built successfully
- [ ] Container started
- [ ] Health check passed: `docker inspect discord-github-sync-bot | grep -A 5 Health`
- [ ] Bot shows as "Online" in Discord server

### Phase 2: Reverse proxy (if needed)

If you want a clean URL (`https://your-domain.com/github-webhook`) instead of exposing
port 5000 directly, configure a reverse proxy (nginx, Caddy, Traefik, etc.).

Example nginx location block:

```nginx
location /github-webhook {
    proxy_pass http://localhost:5000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

- [ ] Reverse proxy configured
- [ ] TLS certificate in place
- [ ] Test: `curl -X POST https://your-domain.com/github-webhook` → expect a response

### Phase 3: GitHub Webhook (5 minutes)

See [README.md — GitHub Webhook Setup](README.md#github-webhook-setup) for full steps.

Summary:
1. Go to your GitHub repository → Settings → Webhooks → Add webhook
2. Payload URL: `https://your-domain.com/github-webhook`
3. Content type: `application/json`
4. Secret: same value as `GITHUB_WEBHOOK_SECRET` in `.env`
5. Events: Issues + Issue comments

- [ ] Webhook created
- [ ] Webhook shows as active (green checkmark)
- [ ] Ping delivery succeeded (200 response)

---

## Post-Deployment Verification

### Test 1: Discord → GitHub (Issue Creation)

1. Go to your Discord forum channel
2. Create a new post: "Test issue"
3. Wait 5-10 seconds

- [ ] GitHub issue created automatically
- [ ] Issue title matches Discord thread title
- [ ] Issue body contains Discord message content

### Test 2: GitHub → Discord (Comment Sync)

1. Add a comment to the GitHub issue created in Test 1
2. Wait 5-10 seconds
3. Check Discord forum thread

- [ ] Comment appears in Discord thread
- [ ] Content matches

### Test 3: GitHub → Discord (Status Sync)

1. Close the GitHub issue
2. Wait 5-10 seconds
3. Check Discord thread

- [ ] Discord thread reflects the closed status

---

## Ongoing Maintenance

### Token Rotation (Every 90 Days)

- [ ] Set calendar reminder before token expiry
- [ ] Generate new GitHub PAT (same permissions)
- [ ] Update `.env` file with new token
- [ ] Restart bot: `docker restart discord-github-sync-bot`
- [ ] Revoke old token via GitHub Settings

### Monitoring

- View logs: `docker logs discord-github-sync-bot -f`
- Check GitHub webhook delivery history: repo → Settings → Webhooks → Recent Deliveries
- Container health: `docker inspect discord-github-sync-bot | grep -A 5 Health`

---

## Rollback

```bash
# Stop and remove container
docker stop discord-github-sync-bot
docker rm discord-github-sync-bot

# Disable GitHub webhook (repo → Settings → Webhooks → Disable or Delete)
```

---

**Deployed by:** _______________

**Date:** _______________

**Notes:** _______________
