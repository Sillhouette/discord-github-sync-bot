# discord-github-sync-bot

> Let your Discord community report bugs and request features — without ever touching GitHub.
>
> Bidirectional sync between Discord forum threads and GitHub issues.
> Built for Discord-native communities: gaming, creator tooling, indie projects.

---

## How it works

```
Discord Forum Thread  ←→  Bot (Node.js)  ←→  GitHub Issues
      ↑                       ↑
   your community          webhook server
   (no GitHub needed)       port :5000
```

Users post in a Discord forum channel. The bot creates a GitHub issue automatically.
Comments, status changes, and labels sync in both directions — your community never
needs to visit GitHub.

---

## Features

- Create GitHub issues from Discord forum threads
- Sync comments bidirectionally (Discord → GitHub, GitHub → Discord)
- Sync issue status (open / closed / reopened)
- Map Discord tags to GitHub labels
- Optional webhook signature verification (recommended for production)
- Optional R2 image re-hosting (prevents Discord CDN URL expiry in GitHub issues)

---

## Quick Start

**Prerequisites:** Docker, a Discord bot token, and a GitHub fine-grained PAT.

1. **Clone the repo**

   ```bash
   git clone https://github.com/{owner}/discord-github-sync-bot.git
   cd discord-github-sync-bot
   ```

2. **Create your `.env` file**

   ```bash
   cp .env.example .env
   # Edit .env and fill in required values (see Configuration below)
   ```

3. **Start the bot**

   ```bash
   docker build -f Dockerfile.standalone -t discord-github-sync-bot .
   docker run -d \
     --name discord-github-sync-bot \
     --restart unless-stopped \
     --env-file .env \
     -v discord-bot-data:/app/data \
     -p 5000:5000 \
     discord-github-sync-bot
   ```

   Or with Docker Compose:

   ```bash
   docker compose up -d
   ```

   See `docker-compose.yml` in this directory.

4. **Invite the bot to your Discord server**

   Go to the [Discord Developer Portal](https://discord.com/developers/applications),
   select your app, then OAuth2 → URL Generator:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: Send Messages, Manage Threads, Manage Messages, Read Message History

5. **Add the GitHub webhook**

   See [GitHub Webhook Setup](#github-webhook-setup) below.

---

## Configuration

All configuration is via environment variables. Copy `.env.example` to `.env` and fill in the values.

| Variable | Required? | Default | Description |
|----------|-----------|---------|-------------|
| `DISCORD_TOKEN` | Required | — | Discord bot token from the Developer Portal |
| `DISCORD_CHANNEL_ID` | Required | — | ID of the Discord forum channel to sync |
| `GITHUB_ACCESS_TOKEN` | Required | — | Fine-grained PAT with Issues: Read & Write |
| `GITHUB_USERNAME` | Required | — | GitHub account or org that owns the repository |
| `GITHUB_REPOSITORY` | Required | — | Repository name (without owner prefix) |
| `PORT` | Optional | `5000` | Port the webhook HTTP server listens on |
| `GITHUB_WEBHOOK_SECRET` | Recommended | — | Shared secret for HMAC webhook signature verification. Without it, the bot logs a warning and accepts all incoming requests. |
| `R2_BUCKET` | Optional | — | Cloudflare R2 bucket name for image re-hosting |
| `R2_CDN_BASE_URL` | Optional | — | Public CDN base URL for re-hosted images (e.g. `https://cdn.example.com`) |
| `CLOUDFLARE_ACCOUNT_ID` | Optional | — | Cloudflare account ID (required with R2 vars) |
| `CLOUDFLARE_API_TOKEN` | Optional | — | Cloudflare API token (required with R2 vars) |

---

## Optional Features

### Webhook Signature Verification

Without a webhook secret, anyone who discovers your bot's webhook URL can send fake
GitHub events. This is harmless if the URL is obscure, but easy to prevent.

**Enable:**
1. Generate a secret: `openssl rand -hex 32`
2. Set `GITHUB_WEBHOOK_SECRET=<the secret>` in your `.env`
3. Add the same value to GitHub → your repo → Settings → Webhooks → Secret

**Without it:** The bot logs a startup warning and accepts all requests.

### R2 Image Re-hosting

Discord CDN URLs expire after approximately 7 days. Without re-hosting, images
attached to Discord posts will break in GitHub issues after that window.

**Enable:** Set all four R2/Cloudflare variables (`R2_BUCKET`, `R2_CDN_BASE_URL`,
`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`).

**Without it:** Discord attachment URLs are used as-is — images may expire.

---

## Deployment

### Docker (recommended)

Build and run from within the `discord-bot/` directory using `Dockerfile.standalone`:

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

**View logs:**
```bash
docker logs discord-github-sync-bot -f
```

**Check health:**
```bash
docker ps | grep discord-github-sync-bot
```

### Bare Node

```bash
pnpm install
pnpm build
node dist/index.js
```

Requires Node.js 20+, pnpm, and all env vars set in the environment or a `.env` file.

---

## GitHub Webhook Setup

Do this **after** the bot is running and reachable from the internet.

1. Go to your GitHub repository → Settings → Webhooks → Add webhook
2. **Payload URL:** `https://<your-domain-or-ip>/github-webhook`
   - If running locally, use a tunnel tool (e.g. [serveo.net](https://serveo.net): `ssh -R 80:localhost:5000 serveo.net`)
3. **Content type:** `application/json`
4. **Secret:** Paste the same value as `GITHUB_WEBHOOK_SECRET` in your `.env` (leave blank if not using)
5. **Events:** Select "Let me select individual events" and check:
   - Issues
   - Issue comments
6. **Active:** checked
7. Click "Add webhook"

GitHub will send a ping event — the bot will respond with 200.

---

## Development

```bash
pnpm install
pnpm dev          # Watch mode with tsx
pnpm test         # Run all tests with vitest
pnpm test:watch   # Interactive test mode
pnpm build        # Compile TypeScript to dist/
```

Tests live next to the source files they test (`*.test.ts`).

---

## License & Credits

MIT — see [LICENSE](LICENSE).

Originally based on [holmityd/GitHub-Issues-Discord-Threads-Bot](https://github.com/holmityd/GitHub-Issues-Discord-Threads-Bot) by Nicat (holmityd).
Forked, extended, and maintained by Austin Melchior (Sillhouette).
