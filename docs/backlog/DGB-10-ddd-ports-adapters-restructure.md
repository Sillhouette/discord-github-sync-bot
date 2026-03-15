---
spec_version: "1.0"
type: shaped-work
id: DGB-10
title: Restructure to Ports & Adapters — introduce domain/syncService and platform adapters
status: shaped
created: 2026-03-15
appetite: medium
priority: P2
target_project: discord-github-sync-bot
author: architect
depends_on: [DGB-1, DGB-2, DGB-3, DGB-4]
tags: [architecture, ddd, restructure, coupling]
acceptance_criteria:
  - id: AC-1
    description: src/domain/ directory exists containing thread.ts, threadStore.ts, commentRepository.ts, syncService.ts, and events.ts
    status: pending
  - id: AC-2
    description: syncService.ts contains all cross-platform synchronization logic — neither discord/ nor github/ imports from the other
    status: pending
  - id: AC-3
    description: src/discord/ contains client.ts, eventHandlers.ts, and port.ts — no imports from src/github/
    status: pending
  - id: AC-4
    description: src/github/ contains server.ts, webhookHandlers.ts, port.ts, and webhookSignature.ts — no imports from src/discord/
    status: pending
  - id: AC-5
    description: src/infrastructure/ contains config.ts, logger.ts, and r2.ts
    status: pending
  - id: AC-6
    description: No flat source files remain at the src/ root (except index.ts)
    status: pending
  - id: AC-7
    description: Domain types (SynchronizedThread, ThreadComment) live in src/domain/thread.ts — not in a generic interfaces.ts
    status: pending
  - id: AC-8
    description: Actions and Triggerer constants live in src/domain/events.ts — not in logger.ts
    status: pending
  - id: AC-9
    description: All existing tests continue to pass
    status: pending
  - id: AC-10
    description: tsconfig.json and vitest.config.ts path aliases or baseUrl are updated to reflect new structure
    status: pending
---

# DGB-10: Restructure to Ports & Adapters — introduce domain/syncService and platform adapters

## Problem

The current structure has two compounding issues:

**1. Flat files at the root with no domain expression**
`interfaces.ts`, `store.ts`, `commentMap.ts`, `logger.ts`, `r2.ts`, and `config.ts` live at the `src/` root with no organizing principle. A reader cannot tell which files form the domain model, which are infrastructure, and which are platform integrations.

**2. Bidirectional coupling between bounded contexts**
`githubHandlers.ts` imports directly from `../discord/discordActions` and `discordHandlers.ts` imports directly from `../github/githubActions`. The discord and github bounded contexts know about each other's internals. Neither can be reasoned about, changed, or tested independently. This is the root structural cause of most issues found in Pass 1 and Pass 2.

## Target Structure

```
src/
  index.ts                              # Bootstrap only — wires adapters to domain

  domain/                              # Core domain — no platform imports
    thread.ts                           # SynchronizedThread, ThreadComment types
    threadStore.ts                      # In-memory thread registry (ThreadRepository)
    commentRepository.ts                # Persisted git_id↔discord_id mapping
    syncService.ts                      # All cross-platform sync logic lives here
    events.ts                           # Actions enum, Triggerer constants, domain event types

  discord/                             # Discord bounded context — no github/ imports
    client.ts                           # Discord.js client bootstrap
    eventHandlers.ts                   # Translate Discord events → syncService calls
    port.ts                             # Discord output: createThread, postComment, archiveThread, etc.

  github/                              # GitHub bounded context — no discord/ imports
    server.ts                           # Express HTTP server setup
    webhookHandlers.ts                 # Translate GitHub webhook events → syncService calls
    port.ts                             # GitHub output: createIssue, closeIssue, postComment, etc.
    webhookSignature.ts                # HMAC verification — unchanged

  infrastructure/                      # Cross-cutting concerns
    config.ts                           # Environment variable validation
    logger.ts                           # Winston logger (no domain constants)
    r2.ts                               # Cloudflare R2 upload adapter
```

## What Moves Where

| From | To | Change type |
|---|---|---|
| `src/interfaces.ts` | `src/domain/thread.ts` | Rename + move |
| `src/store.ts` | `src/domain/threadStore.ts` | Rename + move (after DGB-1) |
| `src/commentMap.ts` | `src/domain/commentRepository.ts` | Rename + move |
| `src/logger.ts` (Actions, Triggerer) | `src/domain/events.ts` | Extract + move |
| `src/logger.ts` (winston instance) | `src/infrastructure/logger.ts` | Move |
| `src/config.ts` | `src/infrastructure/config.ts` | Move |
| `src/r2.ts` | `src/infrastructure/r2.ts` | Move |
| `src/discord/discord.ts` | `src/discord/client.ts` | Rename + move |
| `src/discord/discordHandlers.ts` | `src/discord/eventHandlers.ts` | Rename + move |
| `src/discord/discordActions.ts` | `src/discord/port.ts` | Rename + move |
| `src/github/github.ts` | `src/github/server.ts` | Rename + move |
| `src/github/githubHandlers.ts` | `src/github/webhookHandlers.ts` | Rename + move |
| `src/github/githubActions.ts` | `src/github/port.ts` | Rename + move |
| Cross-platform logic in handlers | `src/domain/syncService.ts` | Extract (logic change) |

## The Key Design Decision: syncService Interface

Before implementing, the syncService public interface must be defined. It is the seam between the domain and the adapters:

```typescript
// src/domain/syncService.ts
export class SyncService {
  constructor(
    private discord: DiscordPort,
    private github: GitHubPort,
    private store: ThreadRepository,
    private comments: CommentRepository,
  ) {}

  // Called by Discord event handlers
  async onThreadCreated(thread: SynchronizedThread, messageBody: string): Promise<void>
  async onMessagePosted(threadId: string, messageId: string, body: string): Promise<void>
  async onMessageDeleted(threadId: string, messageId: string): Promise<void>
  async onThreadArchived(threadId: string): Promise<void>
  async onThreadUnarchived(threadId: string): Promise<void>
  async onThreadLocked(threadId: string): Promise<void>
  async onThreadUnlocked(threadId: string): Promise<void>
  async onThreadDeleted(threadId: string): Promise<void>
  async onStartup(client: Client): Promise<void>

  // Called by GitHub webhook handlers
  async onIssueOpened(issue: GitIssue): Promise<void>
  async onIssueClosed(nodeId: string): Promise<void>
  async onIssueReopened(nodeId: string): Promise<void>
  async onIssueLocked(nodeId: string): Promise<void>
  async onIssueUnlocked(nodeId: string): Promise<void>
  async onCommentCreated(nodeId: string, commentId: number, body: string, login: string, avatarUrl: string): Promise<void>
  async onCommentEdited(nodeId: string, commentId: number, body: string, login: string, avatarUrl: string): Promise<void>
  async onCommentDeleted(nodeId: string, commentId: number): Promise<void>
}
```

## Dependency Flow (after restructure)

```
index.ts
  → wires SyncService with discord/port.ts + github/port.ts + domain/threadStore.ts + domain/commentRepository.ts

discord/eventHandlers.ts  →  domain/syncService.ts  →  discord/port.ts
                                                     →  github/port.ts

github/webhookHandlers.ts →  domain/syncService.ts  (same)

domain/*  →  infrastructure/config.ts, infrastructure/logger.ts
           NO imports from discord/ or github/
```

## Appetite & Boundaries

- **Appetite:** Medium
- **In scope:** Full restructure to target layout; syncService extraction; all handler files become thin translators
- **No-gos:** Changing sync behavior, changing Discord/GitHub API interactions, adding new features during restructure
- **Do first:** DGB-1 (ThreadRepository), DGB-2 (deduplication), DGB-3 (config), DGB-4 (surface area) — this restructure is cleaner if those are done first
- **Not required before starting:** DGB-5 through DGB-9 can follow after or in parallel

## Risks & Assumptions

| Assumption | Type | Fastest Test |
|------------|------|--------------|
| syncService can call both discord/port and github/port without circular dependency | correctness | Draw dependency graph before writing code |
| All Discord event handler logic is translatable to syncService calls without losing context | correctness | Map each handler function to a syncService method signature |
| Test import paths can be updated without restructuring test files | correctness | Check vitest path resolution after first file move |
| tsup build config handles new directory structure | feasibility | Test build after first set of moves |

## Routing

- [x] **Architect** — Define syncService interface and port interfaces before Crafter starts
- [x] **Crafter** — Migrate one bounded context at a time (infrastructure first, then domain, then adapters); run tests between each move
