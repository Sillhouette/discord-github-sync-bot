# discord-github-sync-bot

> Let your Discord community report bugs and request features — without ever touching GitHub.

Bidirectional sync between Discord forum threads and GitHub issues.
Built for Discord-native communities: gaming studios, creator tools, indie projects.

---

## How it works

```
Discord Forum Thread  ←→  Bot (Node.js)  ←→  GitHub Issues
      ↑                         ↑
 your community            webhook server
 (no GitHub needed)          port :5000
```

Users post in a Discord forum channel. The bot automatically creates a GitHub issue.
From that point on, everything stays in sync — comments, status changes, and labels
flow in both directions. Your community never needs to visit GitHub.

---

## Features

- **Discord → GitHub:** New forum thread creates a GitHub issue
- **GitHub → Discord:** Comments and status changes posted back to the Discord thread
- **Bidirectional comments:** Replies sync in both directions
- **Status sync:** Closing/reopening an issue archives/unarchives the Discord thread
- **Tag → label mapping:** Discord forum tags map to GitHub issue labels
- **Webhook signature verification:** HMAC-SHA256 verification (recommended for production)
- **R2 image re-hosting:** Prevents Discord CDN image expiry in GitHub issues (optional)

---

## Prerequisites

Before you start, you need three things:

1. **A server to run the bot on** — a VPS, home server, or any machine with a public IP.
   The bot needs to be reachable from the internet so GitHub can send it webhook events.
   For local testing, a tunnel tool like [ngrok](https://ngrok.com) works fine.

2. **A Discord bot token** — created in the Discord Developer Portal (step-by-step below).

3. **A GitHub fine-grained personal access token** — for creating and updating issues (step-by-step below).

---

## Setup

### Step 1 — Create your Discord bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**.
2. Give it a name (e.g. `Issue Tracker`) and click **Create**.
3. In the left sidebar, click **Bot**.
4. Click **Add Bot** → **Yes, do it!**
5. Under **Token**, click **Reset Token** and copy the token. **Save this — you won't see it again.**
6. Scroll down to **Privileged Gateway Intents** and enable:
   - **Message Content Intent**
7. In the left sidebar, click **OAuth2** → **URL Generator**.
8. Under **Scopes**, check: `bot`
9. Under **Bot Permissions**, check:
   - Send Messages
   - Manage Threads
   - Manage Messages
   - Read Message History
10. Copy the generated URL at the bottom, open it in your browser, and invite the bot to your server.

---

### Step 2 — Create a Discord forum channel

The bot listens to a **Forum** channel (not a regular text channel).

1. In your Discord server, click **+** next to a category to add a channel.
2. Select **Forum** as the channel type.
3. Name it something like `#bug-reports` or `#feedback`.
4. **Get the channel ID:** Enable Developer Mode first if you haven't — go to
   User Settings → App Settings → Advanced → Developer Mode (toggle on).
   Then right-click your forum channel → **Copy Channel ID**.

---

### Step 3 — Create a GitHub personal access token

1. Go to [GitHub Settings → Personal Access Tokens (fine-grained)](https://github.com/settings/tokens?type=beta).
2. Click **Generate new token**.
3. Set a name (e.g. `discord-bot`) and expiration (90 days recommended — set a reminder to rotate).
4. Under **Repository access**, choose **Only select repositories** and pick your target repo.
5. Under **Repository permissions**, set:
   - **Issues**: Read and write
   - **Metadata**: Read-only (selected automatically)
6. Click **Generate token** and copy it. **Save this — you won't see it again.**

---

### Step 4 — Configure the bot

Clone the repo and create your `.env`:

```bash
git clone https://github.com/Sillhouette/discord-github-sync-bot.git
cd discord-github-sync-bot
cp .env.example .env
```

Open `.env` and fill in the required values:

```bash
DISCORD_TOKEN=        # from Step 1
DISCORD_CHANNEL_ID=   # from Step 2
GITHUB_ACCESS_TOKEN=  # from Step 3
GITHUB_USERNAME=      # GitHub username or org that owns the repo (e.g. myorg)
GITHUB_REPOSITORY=    # Repository name only, no owner prefix (e.g. my-game)
```

See the full [Configuration reference](#configuration) below for all options.

---

### Step 5 — Run the bot

**With Docker Compose (easiest):**

```bash
docker compose up -d
```

**Or with plain Docker:**

```bash
docker build -f Dockerfile.standalone -t discord-github-sync-bot .
docker run -d \
  --name discord-github-sync-bot \
  --restart unless-stopped \
  --env-file .env \
  -p 5000:5000 \
  -v discord-bot-data:/app/data \
  discord-github-sync-bot
```

**Check it started:**

```bash
docker logs discord-github-sync-bot
```

You should see the bot connect to Discord without errors.

---

### Step 6 — Add the GitHub webhook

The bot needs to receive events from GitHub when issues are commented on or closed.

> **Do this after the bot is running and reachable from the internet.**
> If you're testing locally, use a tunnel: `ssh -R 80:localhost:5000 serveo.net`
> (free, no install) or [ngrok](https://ngrok.com).

1. Go to your GitHub repository → **Settings** → **Webhooks** → **Add webhook**.
2. **Payload URL:** `https://<your-domain-or-ip>/github-webhook`
3. **Content type:** `application/json`
4. **Secret:** If you set `GITHUB_WEBHOOK_SECRET` in your `.env`, paste the same value here. Otherwise leave blank.
5. **Which events?** → Select **Let me select individual events**, then check:
   - ✅ Issues
   - ✅ Issue comments
6. Make sure **Active** is checked.
7. Click **Add webhook**.

GitHub will send a ping — the bot will respond with `200 OK`. You'll see a green checkmark on the webhook page.

---

### Step 7 — Test it

1. Create a new post in your Discord forum channel.
2. Within a few seconds, a GitHub issue should appear in your repository.
3. Comment on the GitHub issue — the comment should appear in the Discord thread.
4. Close the GitHub issue — the Discord thread should be archived.

---

## Configuration

All configuration is via environment variables in your `.env` file.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DISCORD_TOKEN` | **Required** | — | Discord bot token from the Developer Portal |
| `DISCORD_CHANNEL_ID` | **Required** | — | ID of the Discord forum channel to sync |
| `GITHUB_ACCESS_TOKEN` | **Required** | — | Fine-grained PAT with Issues: Read & Write |
| `GITHUB_USERNAME` | **Required** | — | GitHub account or org that owns the repository |
| `GITHUB_REPOSITORY` | **Required** | — | Repository name only (without owner prefix) |
| `PORT` | Optional | `5000` | Port the webhook HTTP server listens on |
| `GITHUB_WEBHOOK_SECRET` | Recommended | — | HMAC secret for webhook signature verification. Without it, the bot logs a warning and accepts all incoming requests. |
| `R2_BUCKET` | Optional | — | Cloudflare R2 bucket name for image re-hosting |
| `R2_CDN_BASE_URL` | Optional | — | Public CDN base URL for re-hosted images (e.g. `https://cdn.example.com`) |
| `CLOUDFLARE_ACCOUNT_ID` | Optional | — | Cloudflare account ID (required if using R2) |
| `CLOUDFLARE_API_TOKEN` | Optional | — | Cloudflare API token (required if using R2) |

---

## Optional Features

### Webhook Signature Verification

Without a webhook secret, anyone who discovers your bot's URL can send fake GitHub events.
Easy to prevent — takes 30 seconds.

1. Generate a secret:
   ```bash
   openssl rand -hex 32
   ```
2. Add it to your `.env`:
   ```
   GITHUB_WEBHOOK_SECRET=<the value you generated>
   ```
3. Add the **same value** to GitHub → your repo → Settings → Webhooks → edit webhook → Secret field.
4. Restart the bot.

Without this set, the bot prints a warning at startup and accepts all requests.

---

### R2 Image Re-hosting

Discord CDN URLs expire after ~7 days. Without re-hosting, images attached to Discord posts
will break in GitHub issues after that window.

To enable, set all four variables in your `.env`:

```bash
R2_BUCKET=your-bucket-name
R2_CDN_BASE_URL=https://cdn.yourdomain.com
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_API_TOKEN=your-api-token
```

Without these set, Discord attachment URLs are used as-is and may expire.

---

## Deployment

### Docker Compose (recommended)

```bash
docker compose up -d        # start
docker compose down         # stop
docker compose logs -f      # stream logs
docker compose pull && docker compose up -d  # update
```

### Plain Docker

```bash
# Build
docker build -f Dockerfile.standalone -t discord-github-sync-bot .

# Run
docker run -d \
  --name discord-github-sync-bot \
  --restart unless-stopped \
  --env-file .env \
  -p 5000:5000 \
  -v discord-bot-data:/app/data \
  discord-github-sync-bot

# Logs
docker logs discord-github-sync-bot -f

# Stop
docker stop discord-github-sync-bot

# Update
docker pull discord-github-sync-bot
docker stop discord-github-sync-bot && docker rm discord-github-sync-bot
# re-run the docker run command above
```

### Bare Node.js

Requires Node.js 20+ and pnpm.

```bash
pnpm install
pnpm build
node dist/index.js
```

All env vars must be set in your environment or a `.env` file in the working directory.

---

## Troubleshooting

**The bot connected to Discord but no GitHub issue is created when I post**
- Check that `DISCORD_CHANNEL_ID` matches the forum channel (not a text channel).
- Make sure the channel is a **Forum** type, not a regular text channel.
- Check the bot has permissions: Send Messages, Manage Threads, Read Message History.

**GitHub webhook shows a red ✗ (failed delivery)**
- Make sure the bot is running and the port is publicly reachable.
- Test connectivity: `curl https://<your-domain>/health` should return `{"status":"ok"}`.
- If you set `GITHUB_WEBHOOK_SECRET`, confirm the exact same value is in both `.env` and the GitHub webhook Secret field.

**Comments from GitHub aren't appearing in Discord**
- Confirm the webhook is configured with both **Issues** and **Issue comments** event types.
- Check `docker logs discord-github-sync-bot` for errors.

**Images in GitHub issues are broken**
- Discord CDN URLs expire after ~7 days. Enable [R2 image re-hosting](#r2-image-re-hosting) to fix this permanently.

**Bot says "Missing required environment variables" on startup**
- One or more required vars in your `.env` are empty or missing. The error message names which ones.

---

## Development

```bash
pnpm install
pnpm dev          # watch mode (tsx)
pnpm test         # run tests (vitest)
pnpm test:watch   # interactive test mode
pnpm build        # compile TypeScript → dist/
```

Tests live next to the source files they test (`*.test.ts`).

---

## License & Credits

MIT — see [LICENSE](LICENSE).

Originally based on [holmityd/GitHub-Issues-Discord-Threads-Bot](https://github.com/holmityd/GitHub-Issues-Discord-Threads-Bot) by Nicat (holmityd).
Forked, extended, and maintained by [Austin Melchior (Sillhouette)](https://github.com/Sillhouette).
