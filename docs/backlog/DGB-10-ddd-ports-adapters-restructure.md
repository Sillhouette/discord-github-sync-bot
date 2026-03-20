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
depends_on: [DGB-1, DGB-2, DGB-3, DGB-4, DGB-12]
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
  - id: AC-11
    description: No domain type or SyncService method signature uses the string "node_id" — the platform-neutral term "externalId" is used throughout src/domain/
    status: pending
  - id: AC-12
    description: MessagingPort interface includes an optional impersonation capability (sendAs(identity, message)) that adapters may implement — Discord implements it, Teams/Slack stubs return the base send behavior
    status: pending
  - id: AC-13
    description: SyncService has unit tests covering onThreadCreated, onMessagePosted, onIssueOpened, and onCommentCreated with mock MessagingPort and VcsPort — these are the most critical new functions in the restructure and must have test coverage before the item is considered done
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

Before implementing, the syncService public interface must be defined. It is the seam between the domain and the adapters.

**Vocabulary note (navigator decision 2026-03-19):** Domain types and SyncService method signatures use `externalId` (not `node_id`). `node_id` is GitHub GraphQL vocabulary. `externalId` is the platform-neutral term — each VCS adapter maps its own ID scheme to this field. Similarly, `MessagingPort` uses `messagingThreadId` (not `discordThreadId`) and `VcsPort` uses `externalId` throughout.

```typescript
// src/domain/syncService.ts
export class SyncService {
  constructor(
    private messaging: MessagingPort,   // was: discord: DiscordPort
    private vcs: VcsPort,               // was: github: GitHubPort
    private store: ThreadRepository,
    private comments: CommentRepository,
  ) {}

  // Called by messaging platform event handlers
  async onThreadCreated(thread: SynchronizedThread, messageBody: string): Promise<void>
  async onMessagePosted(messagingThreadId: string, messageId: string, body: string): Promise<void>
  async onMessageDeleted(messagingThreadId: string, messageId: string): Promise<void>
  async onThreadArchived(messagingThreadId: string): Promise<void>
  async onThreadUnarchived(messagingThreadId: string): Promise<void>
  async onThreadLocked(messagingThreadId: string): Promise<void>
  async onThreadUnlocked(messagingThreadId: string): Promise<void>
  async onThreadDeleted(messagingThreadId: string): Promise<void>
  async onStartup(client: unknown): Promise<void>

  // Called by VCS webhook handlers
  async onIssueOpened(issue: TrackedIssue): Promise<void>
  async onIssueClosed(externalId: string): Promise<void>
  async onIssueReopened(externalId: string): Promise<void>
  async onIssueLocked(externalId: string): Promise<void>
  async onIssueUnlocked(externalId: string): Promise<void>
  async onCommentCreated(externalId: string, commentId: string, body: string, author: AuthorIdentity): Promise<void>
  async onCommentEdited(externalId: string, commentId: string, body: string, author: AuthorIdentity): Promise<void>
  async onCommentDeleted(externalId: string, commentId: string): Promise<void>
}
```

**MessagingPort impersonation design (navigator decision 2026-03-19):** Discord supports webhook impersonation (send as a specific user identity). Teams does not support this natively. The port interface includes optional impersonation so Discord implements it fully and other adapters fall back gracefully — no platform is blocked:

```typescript
// src/domain/ports.ts
export interface AuthorIdentity {
  login: string;
  avatarUrl?: string;
}

export interface MessagingPort {
  // All adapters implement these
  createThread(title: string, body: string, tags: string[]): Promise<string>
  postMessage(messagingThreadId: string, body: string): Promise<string>
  editMessage(messagingThreadId: string, messageId: string, body: string): Promise<void>
  deleteMessage(messagingThreadId: string, messageId: string): Promise<void>
  archiveThread(messagingThreadId: string): Promise<void>
  unarchiveThread(messagingThreadId: string): Promise<void>

  // Optional — adapters that support impersonation implement this;
  // adapters that don't (Teams, plain Slack bot) fall back to postMessage
  postMessageAs?(messagingThreadId: string, body: string, author: AuthorIdentity): Promise<string>
}

export interface VcsPort {
  createIssue(title: string, body: string, labels: string[]): Promise<TrackedIssue>
  closeIssue(externalId: string): Promise<void>
  reopenIssue(externalId: string): Promise<void>
  lockIssue(externalId: string): Promise<void>
  unlockIssue(externalId: string): Promise<void>
  postComment(externalId: string, body: string): Promise<string>
  editComment(externalId: string, commentId: string, body: string): Promise<void>
  deleteComment(externalId: string, commentId: string): Promise<void>
  // Startup reconciliation — fetch all open issues with their messaging join keys
  listActiveIssues(): Promise<TrackedIssue[]>
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
- **Do first:** DGB-1 (ThreadRepository), DGB-2 (deduplication), DGB-3 (config), DGB-4 (surface area), DGB-12 (local mapping store) — this restructure is cleaner if those are done first. DGB-12 in particular removes the "Discord URL in GitHub body" join strategy, which affects how commentRepository.ts is designed
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
