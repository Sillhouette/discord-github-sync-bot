---
diagram_version: "2.0"
type: architecture-diagram
level: 1
title: "System Context — discord-github-sync-bot"
updated: 2026-03-15
updated_by: "/arch:init"
tags: [overview]
---

# System Context: discord-github-sync-bot

## Diagram

```mermaid
%%{init: {"theme": "base", "themeVariables": {
  "fontFamily": "system-ui, sans-serif",
  "lineColor": "#ff2e97",
  "primaryColor": "#0d2a2a",
  "primaryTextColor": "#ffffff",
  "primaryBorderColor": "#00fff5",
  "secondaryColor": "#120a18",
  "secondaryTextColor": "#ff2e97",
  "secondaryBorderColor": "#ff2e97",
  "tertiaryColor": "#0a1215",
  "tertiaryTextColor": "#9d4edd",
  "tertiaryBorderColor": "#9d4edd"
}}}%%
flowchart TB
    classDef actor fill:#2a0f1e,stroke:#ff2e97,stroke-width:2px,color:#ff2e97
    classDef core fill:#0d2a2a,stroke:#00fff5,stroke-width:3px,color:#00fff5
    classDef external fill:#1a0d24,stroke:#9d4edd,stroke-width:2px,color:#9d4edd

    subgraph users ["USERS"]
        community["<b>Discord Community Member</b><br/> <br/><span>Posts bug reports and feature requests</span><br/><span>Discord desktop/mobile app</span>"]:::actor
        maintainer["<b>Project Maintainer</b><br/> <br/><span>Manages GitHub issues and resolves reports</span><br/><span>GitHub web UI + Discord app</span>"]:::actor
    end

    subgraph system_boundary ["DISCORD-GITHUB-SYNC-BOT"]
        bot["<b>discord-github-sync-bot</b><br/> <br/><span>Bidirectional sync between Discord forum threads and GitHub issues</span><br/><span>Node.js 20 + TypeScript (Docker on Linux VPS)</span>"]:::core
    end

    subgraph external_systems ["EXTERNAL"]
        discord["<b>Discord API</b><br/> <br/><span>Forum thread events and message delivery</span><br/><span>WebSocket Gateway + HTTPS REST</span>"]:::external
        github["<b>GitHub REST + GraphQL API</b><br/> <br/><span>Issue creation, comments, and label management</span><br/><span>HTTPS REST + GraphQL (api.github.com)</span>"]:::external
        github_webhooks["<b>GitHub Webhooks</b><br/> <br/><span>Issue state changes and comment events pushed to bot</span><br/><span>HTTPS POST (HMAC-SHA256 signed)</span>"]:::external
        r2["<b>Cloudflare R2</b><br/> <br/><span>Re-hosts Discord CDN images to prevent URL expiry</span><br/><span>S3-compatible API (optional)</span>"]:::external
    end

    community -->|"creates forum threads, posts messages"| discord
    discord -->|"thread/message events (WebSocket)"| bot
    bot -->|"creates issues, posts comments, applies labels"| github
    github_webhooks -->|"issue state + comment events (HTTPS POST)"| bot
    bot -->|"posts updates to Discord threads"| discord
    maintainer -->|"comments and closes GitHub issues"| github
    maintainer -->|"reads Discord thread updates"| discord
    bot -->|"uploads Discord CDN images (optional)"| r2
```

## Coupling Notes

### Runtime Dependencies
- Bot depends on Discord API (persistent WebSocket connection for event streaming)
- Bot depends on GitHub API (outbound HTTPS calls on every thread/message event)
- Bot depends on GitHub Webhooks inbound (public endpoint required for bidirectional sync)
- Bot optionally depends on Cloudflare R2 (image upload on attachment detection)

### Build-time Dependencies
- None — all external dependencies are runtime-only via environment variables

### Data Dependencies
- Discord thread IDs and GitHub issue numbers are correlated in bot's local store (commentMap.json)
