---
spec_version: "1.0"
type: unshaped
id: DGB-17
title: Slack adapter — MessagingPort implementation for Slack channels
status: blocked
blocked_on: DGB-10
created: 2026-03-19
appetite: tbd
priority: tbd
target_project: discord-github-sync-bot
author: scout
tags: [feature, slack, messaging-adapter, multi-platform]
---

# DGB-17: Slack adapter — MessagingPort implementation for Slack channels

> **Status: Blocked on DGB-10.**
>
> This item cannot be shaped until `MessagingPort` is defined and stable (DGB-10).
> When DGB-10 is complete, run a spike to answer the open questions below,
> then shape the implementation against the port interface.

## Intent

Implement a `MessagingPort` adapter for Slack so the bot can sync GitHub Issues
(or GitLab Issues, Discussions, etc.) to Slack channels — enabling teams using
Slack instead of Discord to benefit from the same bidirectional sync.

## Open Questions (spike before shaping)

1. **Thread model mismatch:** Discord has forum threads as first-class objects with
   their own IDs. Slack "threads" are reply chains on a parent message, identified by
   the parent message's `ts` (timestamp string). There is no separate thread ID.
   How does `messagingThreadId` in `MappingStore` represent a Slack thread?
   Options: store the parent `ts`, use `channelId:ts` composite key.

2. **Impersonation capability:** `MessagingPort.postMessageAs?()` is optional. Slack
   supports incoming webhooks with custom `username` and `icon_url` per message —
   this is not full impersonation (no real user identity) but produces similar UX.
   Does the Slack adapter implement `postMessageAs?` using incoming webhooks, or
   does it fall back to bot identity for all messages?

3. **Message edit/delete:** Slack allows editing and deleting messages via the Web API
   (`chat.update`, `chat.delete`) with the bot token. These map directly to
   `MessagingPort.editMessage()` and `MessagingPort.deleteMessage()`. Confirm no
   permission gaps for bots editing messages in public channels.

4. **Thread creation:** `MessagingPort.createThread()` maps to posting a parent message
   in a Slack channel. The "thread" is the reply chain under it. What is the
   equivalent of Discord forum tags in Slack? (Options: message header, channel topic
   section, no equivalent — just omit tags.)

5. **Event subscription:** Discord uses a persistent bot connection (WebSocket gateway).
   Slack uses either the Events API (HTTP callbacks) or Socket Mode. Which approach
   does this bot use? The existing architecture uses Express for GitHub webhooks —
   Socket Mode or Events API webhooks would fit the same pattern.

6. **Rate limiting:** Slack Web API has per-method rate limits (Tier 1–4). Discord has
   per-route rate limits. Confirm `enqueueWebhookTask` (or its post-DGB-10 equivalent
   in the Slack adapter) handles Slack's rate limit headers correctly.

7. **Multiple workspaces:** Can a single bot deployment serve multiple Slack workspaces,
   or is it one workspace per deployment (matching Discord's one-guild model)?

## Rough Shape (post-spike)

```
src/slack/
  app.ts             — Slack app bootstrap (Bolt framework or raw HTTP)
  eventHandlers.ts   — Translates Slack events → SyncService calls
  port.ts            — MessagingPort implementation using Slack Web API
```

## Dependencies

- DGB-10 (MessagingPort interface must exist, including postMessageAs? optional method)
- DGB-12 (MappingStore must support messagingPlatform: 'slack' and Slack's ts-based thread IDs)
