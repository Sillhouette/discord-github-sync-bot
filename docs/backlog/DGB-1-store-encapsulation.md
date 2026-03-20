---
spec_version: "1.0"
type: shaped-work
id: DGB-1
title: Encapsulate Store behind a ThreadRepository
status: shaped
created: 2026-03DGB-15
appetite: medium
priority: P1
target_project: discord-github-sync-bot
author: architect
tags: [refactor, coupling, encapsulation, store]
acceptance_criteria:
  - id: AC-1
    description: Store.threads is private — no external caller accesses it directly
    status: pending
  - id: AC-2
    description: Store.availableTags is private — no external caller accesses it directly
    status: pending
  - id: AC-3
    description: ThreadRepository exposes typed methods — addThread, removeThread, updateThread, findByDiscordId, findByNodeId, getAll, setAvailableTags
    status: pending
  - id: AC-4
    description: All scattered store.threads.push / splice / find calls across discordHandlers, discordActions, githubHandlers, githubActions are replaced with repository method calls
    status: pending
  - id: AC-5
    description: All existing tests continue to pass
    status: pending
  - id: AC-6
    description: ThreadRepository is injectable (not a bare singleton import) to enable unit testing without module mocking
    status: pending
---

# DGB-1: Encapsulate Store behind a ThreadRepository

## Problem

`store.ts` exports a singleton with two fully public mutable arrays: `store.threads` and `store.availableTags`. Six files across both the `discord/` and `github/` modules import this singleton and mutate the arrays directly — using `push`, `splice`, `find`, and direct field assignment with no single control point.

This means:
- Thread lifecycle transitions (create → archive → lock → delete) are scattered across files with no enforced path
- Concurrent webhook events (Discord and GitHub can fire simultaneously) can silently corrupt thread state with no guard
- The store cannot be unit tested without mocking the module-level singleton
- Any change to how threads are stored (e.g., switching from Array to Map) requires touching every call site

The `Store` class currently has one method (`deleteThread`) and two public fields — the class boundary is meaningless in practice.

## Evidence

- `src/store.ts` lines 5–6: public `threads: Thread[]` and `availableTags: GuildForumTag[]`
- Pass 1 finding C-4: global mutable store singleton accessed across 6 modules
- Pass 2 finding EV-1: public fields with no mutation control

## Appetite & Boundaries

- **Appetite:** Medium (this touches every action and handler file)
- **In scope:** Rename `Store` to `ThreadRepository`; make fields private; add typed mutator/accessor methods; update all callers
- **No-gos:** Changing persistence strategy (still JSON file), adding async locking, changing the Thread interface shape

## Solution Sketch

```typescript
// store.ts becomes:
class ThreadRepository {
  private threads: Thread[] = [];
  private availableTags: GuildForumTag[] = [];

  addThread(thread: Thread): void
  removeThread(id: string): void
  updateThread(id: string, patch: Partial<Thread>): void
  findByDiscordId(id: string): Thread | undefined
  findByNodeId(nodeId: string): Thread | undefined
  getAll(): readonly Thread[]
  setAvailableTags(tags: GuildForumTag[]): void
  getAvailableTags(): readonly GuildForumTag[]
}

export const threadRepository = new ThreadRepository();
```

All `store.threads.push(...)`, `store.threads.splice(...)`, `store.threads.find(...)`, and `store.availableTags = ...` calls across the codebase route through these methods.

## Risks & Assumptions

| Assumption | Type | Fastest Test |
|------------|------|--------------|
| All mutation sites can be identified via search | feasibility | grep store.threads across src/ |
| No concurrent write races require atomic transactions | correctness | Review async interleaving in handlers |

## Routing

- [x] **Architect** — Design the repository interface before implementation
- [x] **Crafter** — TDD implementation: write tests for repository methods first
