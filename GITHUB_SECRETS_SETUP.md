# GitHub Secrets Setup for Discord Bot CI/CD

This document explains how to configure GitHub Secrets for automated Discord bot deployment via GitHub Actions.

---

## Required Secrets

| Secret Name | Description | How to Obtain |
|-------------|-------------|---------------|
| `DISCORD_TOKEN` | Discord bot authentication token | Discord Developer Portal |
| `DISCORD_CHANNEL_ID` | Discord forum channel ID where bot listens | Discord (Developer Mode) |
| `DISCORD_GITHUB_PAT` | GitHub Personal Access Token for bot | GitHub Settings |
| `GITHUB_WEBHOOK_SECRET` | HMAC secret for webhook signature verification | Generate with `openssl rand -hex 32` |

---

## Step-by-Step Setup

### 1. Create Discord Bot Application

**Where:** [Discord Developer Portal](https://discord.com/developers/applications)

**Steps:**
1. Click "New Application"
2. Navigate to "Bot" tab → Click "Add Bot"
3. **Copy Bot Token** → This becomes `DISCORD_TOKEN` secret
4. Enable Privileged Gateway Intents:
   - PRESENCE INTENT
   - MESSAGE CONTENT INTENT
5. Navigate to "OAuth2" → "URL Generator"
6. Scopes: `bot`, `applications.commands`
7. Bot Permissions:
   - Send Messages
   - Manage Threads
   - Manage Messages
   - Read Message History
8. Copy generated URL → Invite bot to your Discord server

---

### 2. Create Discord Forum Channel

1. In your Discord server, create a new channel
2. Channel Type: **Forum** (not Text Channel)
3. Enable Developer Mode if needed: User Settings → App Settings → Advanced → Developer Mode
4. Right-click the forum channel → Copy ID → This becomes `DISCORD_CHANNEL_ID` secret

---

### 3. Generate GitHub Personal Access Token (Fine-Grained)

**Where:** [GitHub Settings → Personal Access Tokens](https://github.com/settings/tokens?type=beta)

1. Click "Generate new token" (Fine-grained token)
2. Expiration: 90 days (set a calendar reminder to rotate)
3. Repository access: **Only select repositories** → select your target repo
4. Repository permissions:
   - **Issues**: Read and write
   - **Metadata**: Read-only (automatic)
5. Click "Generate token"
6. **Copy Token** → This becomes `DISCORD_GITHUB_PAT` secret
   - Token is shown only once. Store it securely.

---

### 4. Add Secrets to GitHub Repository

Go to your repository → Settings → Secrets and variables → Actions → New repository secret

Add each secret:

**DISCORD_TOKEN**
```
Name: DISCORD_TOKEN
Value: <paste discord bot token>
```

**DISCORD_CHANNEL_ID**
```
Name: DISCORD_CHANNEL_ID
Value: <paste forum channel id>
```

**DISCORD_GITHUB_PAT**
```
Name: DISCORD_GITHUB_PAT
Value: <paste github pat>
```

**GITHUB_WEBHOOK_SECRET**
```
Name: GITHUB_WEBHOOK_SECRET
Value: <output of: openssl rand -hex 32>
```

> **Coordinated deploy required:** The same secret must be set in both the
> bot's `.env` AND the GitHub webhook settings at the same time, or the bot
> will reject all incoming webhooks until both match.
>
> After adding this secret:
> 1. Go to your repo → Settings → Webhooks → edit the webhook
> 2. Paste the same value into the **Secret** field
> 3. Save the webhook
> 4. Restart the bot container

---

## Verification

After adding secrets, confirm all required secrets are listed:
- DISCORD_TOKEN
- DISCORD_CHANNEL_ID
- DISCORD_GITHUB_PAT
- GITHUB_WEBHOOK_SECRET

Secret values are never shown after creation.

---

## Token Rotation (Every 90 Days)

**Rotate Discord Bot Token:**
1. Discord Developer Portal → Your Application → Bot → Reset Token
2. Copy new token
3. GitHub Repo → Settings → Secrets → DISCORD_TOKEN → Update
4. Restart bot container

**Rotate GitHub PAT:**
1. GitHub Settings → Personal Access Tokens → Generate new token (same permissions)
2. Copy new token
3. GitHub Repo → Settings → Secrets → DISCORD_GITHUB_PAT → Update
4. Revoke old PAT via GitHub Settings

---

## Additional Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [GitHub Encrypted Secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [Discord Developer Portal](https://discord.com/developers/applications)
- [GitHub Fine-Grained PATs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
