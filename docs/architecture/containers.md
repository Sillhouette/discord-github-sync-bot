---
diagram_version: "2.0"
type: architecture-diagram
level: 2
title: "Container Diagram — discord-github-sync-bot"
updated: 2026-03-15
updated_by: "/arch:init"
tags: [overview]
---

# Container Diagram: discord-github-sync-bot

## Diagram

```mermaid
%%{init: {"theme": "base", "themeVariables": {
  "fontFamily": "system-ui, sans-serif",
  "lineColor": "#01cdfe",
  "primaryColor": "#1f0d2e",
  "primaryTextColor": "#ffffff",
  "primaryBorderColor": "#b967ff",
  "secondaryColor": "#0f1a1e",
  "secondaryTextColor": "#01cdfe",
  "secondaryBorderColor": "#01cdfe",
  "tertiaryColor": "#0a1612",
  "tertiaryTextColor": "#05ffa1",
  "tertiaryBorderColor": "#05ffa1"
}}}%%
flowchart TB
    classDef person fill:#2d1028,stroke:#ff71ce,stroke-width:2px,color:#ff71ce
    classDef container fill:#0a2830,stroke:#01cdfe,stroke-width:2px,color:#01cdfe
    classDef service fill:#1f0d2e,stroke:#b967ff,stroke-width:2px,color:#b967ff
    classDef datastore fill:#0a2418,stroke:#05ffa1,stroke-width:2px,color:#05ffa1
    classDef external fill:#2a2810,stroke:#fffb96,stroke-width:2px,color:#fffb96

    subgraph users ["USERS"]
        community["<b>Discord Community Member</b><br/> <br/><span>Posts bug reports via forum threads</span><br/><span>Discord desktop/mobile app</span>"]:::person
        maintainer["<b>Project Maintainer</b><br/> <br/><span>Manages GitHub issues</span><br/><span>GitHub web UI</span>"]:::person
    end

    subgraph bot_system ["DISCORD-GITHUB-SYNC-BOT (Docker — Linux VPS)"]
        subgraph discord_module ["DISCORD MODULE"]
            discord_client["<b>Discord Bot Client</b><br/> <br/><span>Listens for forum thread and message events</span><br/><span>discord.js 14 + Node.js 20</span>"]:::container
            discord_handlers["<b>Discord Event Handlers</b><br/> <br/><span>Routes threadCreate, messageCreate, threadUpdate events</span><br/><span>TypeScript 5.4</span>"]:::service
            discord_actions["<b>Discord Actions</b><br/> <br/><span>Posts replies, adds reactions, archives threads</span><br/><span>TypeScript 5.4</span>"]:::service
        end

        subgraph github_module ["GITHUB MODULE"]
            webhook_server["<b>Webhook HTTP Server</b><br/> <br/><span>Receives GitHub webhook events on :5000/github-webhook</span><br/><span>Express.js 4 + Node.js 20</span>"]:::container
            github_handlers["<b>GitHub Event Handlers</b><br/> <br/><span>Verifies HMAC-SHA256 signature, routes issue events</span><br/><span>TypeScript 5.4</span>"]:::service
            github_actions["<b>GitHub Actions</b><br/> <br/><span>Creates issues, posts comments, applies labels via Octokit</span><br/><span>@octokit/rest 20 + @octokit/graphql 7</span>"]:::service
        end

        subgraph core_module ["CORE"]
            r2_service["<b>R2 Image Re-hoster</b><br/> <br/><span>Uploads Discord CDN attachments to Cloudflare R2</span><br/><span>TypeScript 5.4 + S3-compatible HTTP</span>"]:::service
            store["<b>Comment ID Store</b><br/> <br/><span>Maps Discord message IDs to GitHub comment IDs</span><br/><span>JSON file (Docker volume: bot-data)</span>"]:::datastore
        end
    end

    subgraph external ["EXTERNAL"]
        discord_api["<b>Discord API</b><br/> <br/><span>WebSocket gateway + REST for bot actions</span><br/><span>WebSocket + HTTPS (discord.com)</span>"]:::external
        github_api["<b>GitHub REST + GraphQL API</b><br/> <br/><span>Issue and comment management</span><br/><span>HTTPS (api.github.com)</span>"]:::external
        r2_api["<b>Cloudflare R2</b><br/> <br/><span>S3-compatible image object storage</span><br/><span>HTTPS S3 API (optional)</span>"]:::external
    end

    community -->|"posts forum thread"| discord_api
    discord_api -->|"WebSocket events"| discord_client
    discord_client -->|"dispatches events"| discord_handlers
    discord_handlers -->|"triggers on new thread/message"| github_actions
    discord_handlers -->|"triggers image upload"| r2_service
    github_actions -->|"REST/GraphQL calls"| github_api
    r2_service -->|"PUT image objects"| r2_api
    discord_handlers -->|"reads/writes comment ID map"| store
    github_handlers -->|"reads/writes comment ID map"| store

    maintainer -->|"comments, closes issues"| github_api
    github_api -->|"webhook POST events"| webhook_server
    webhook_server -->|"routes verified events"| github_handlers
    github_handlers -->|"triggers Discord updates"| discord_actions
    discord_actions -->|"REST calls"| discord_api
    discord_api -->|"thread updates visible to"| community
```

## Coupling Notes

### Runtime Dependencies
- Discord Bot Client depends on Discord API (persistent WebSocket — bot restarts break connection)
- Webhook HTTP Server requires a public IP/domain for GitHub to POST events to
- Discord Handlers and GitHub Handlers both share the Comment ID Store (single-writer risk on concurrent events)
- GitHub Actions depends on GitHub API for all issue/comment operations (no local fallback)

### Build-time Dependencies
- All modules compiled together as a single TypeScript project (tsup) — no independent deployment of submodules

### Data Dependencies
- commentMap.json in Docker volume `bot-data` is the sole correlation between Discord thread IDs and GitHub issue/comment IDs — loss of this volume breaks bidirectional sync permanently for existing threads
