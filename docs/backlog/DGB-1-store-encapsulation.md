---
spec_version: "1.0"
type: shaped-work
id: DGB-1
title: Encapsulate Store behind a ThreadRepository
status: reviewed
verdict: APPROVED
created: 2026-03-15
appetite: medium
priority: P1
target_project: discord-github-sync-bot
author: architect
tags: [refactor, coupling, encapsulation, store]
acceptance_criteria:
  - id: AC-1
    description: Store.threads is private — no external caller accesses it directly
    status: done
  - id: AC-2
    description: Store.availableTags is private — no external caller accesses it directly
    status: done
  - id: AC-3
    description: ThreadRepository exposes typed methods — addThread, removeThread, updateThread, findByDiscordId, findByNodeId, getAll, setAvailableTags
    status: done
  - id: AC-4
    description: All scattered store.threads.push / splice / find calls across discordHandlers, discordActions, githubHandlers, githubActions are replaced with repository method calls
    status: done
  - id: AC-5
    description: All existing tests continue to pass
    status: done
  - id: AC-6
    description: ThreadRepository is injectable (not a bare singleton import) to enable unit testing without module mocking
    status: done
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

## Implementation

**Delivered 2026-03-20**

- `src/store.ts`: Rewrote `Store` class as `ThreadRepository` with private `threads` and `availableTags` fields. Added `addThread`, `removeThread`, `updateThread`, `findByDiscordId`, `findByNodeId`, `getAll`, `loadThreads`, `setAvailableTags`, `getAvailableTags`, `clear`. Exported module-level singleton `threadRepository`.
- `src/store.test.ts`: 21 tests covering all repository methods with injectable instances (no singleton coupling).
- Updated callers: `discordHandlers.ts`, `discordActions.ts`, `githubHandlers.ts`, `githubActions.ts` — all direct `store.threads`/`store.availableTags` accesses replaced with repository method calls.
- Updated test files: `discordHandlers.test.ts`, `discordActions.test.ts`, `githubHandlers.test.ts`, `githubActions.test.ts` — replaced `store` imports and direct array mutation with `threadRepository` API.
- All 186 tests pass.

## Review

**Verdict:** APPROVED
**Reviewed:** 2026-03-20
**Reviewer:** critic

### Acceptance Criteria

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: `threads` private | Pass | `private threads: Thread[]` confirmed in `store.ts:5`. No external file accesses `.threads` directly. |
| AC-2: `availableTags` private | Pass | `private availableTags: GuildForumTag[]` confirmed in `store.ts:6`. No external file accesses `.availableTags` directly. |
| AC-3: Typed repository methods | Pass | All required methods present: `addThread`, `removeThread`, `updateThread`, `findByDiscordId`, `findByNodeId`, `getAll`, `setAvailableTags`. `getAvailableTags` and `loadThreads` added beyond spec — appropriate additions. |
| AC-4: Scattered push/splice/find calls replaced | Pass | `store.threads.push`, `.splice`, `.find`, `store.availableTags =` calls are gone from callers. All four files (`discordHandlers`, `discordActions`, `githubHandlers`, `githubActions`) route collection mutations through repository methods. Note: callers still mutate retrieved `Thread` object fields directly (e.g. `thread.archived = true`) — this is within scope of the pre-existing pattern and was not targeted by this item. |
| AC-5: All tests pass | Pass | 186 tests passing confirmed via `pnpm test`. |
| AC-6: Injectable for unit testing | Pass | Tests use `new ThreadRepository()` instances directly. Handler tests call `threadRepository.clear()` in `beforeEach` without module mocking. |

### Code Quality

#### Strengths

- `getAll()` returns `this.threads.slice()` — a defensive copy that prevents callers from mutating the backing array. The readonly return type is correctly enforced.
- `setAvailableTags` copies with `[...tags]` — same defensive copy discipline.
- `removeThread` accepts `string | undefined` gracefully — anticipates the calling pattern where `thread.id` may not be set.
- `clear()` is scoped appropriately with a doc comment marking it for test use only.
- 21 tests in `store.test.ts` follow the AAA pattern consistently and cover all public methods including edge cases (not-found, undefined id, readonly view).
- `threadRepository` singleton is wired into the running application via `src/index.ts` → `initDiscord()` / `initGithub()` → handlers — no additional wiring step required.

#### Observations (not blocking)

- Callers still mutate `Thread` field values directly after retrieving them via `findByDiscordId` / `findByNodeId` (e.g. `thread.archived = true`, `thread.locked = true`). This is the next logical encapsulation step — a future item could route these through `updateThread` — but it was explicitly out of scope for this item and does not violate any AC.
- `updateThread` uses `Object.assign(thread, patch)` which mutates in-place. This is consistent with the current mutable-object model and matches how callers directly mutate fields. No issue given the stated no-go against changing async locking strategy.

### Test Coverage

- **Store unit tests:** 21 tests across all 9 public methods — comprehensive coverage of both happy path and edge cases.
- **Handler integration tests:** 186 total tests pass; handler tests use injectable `threadRepository` instances with no module-level singleton mocking required, which confirms AC-6.
- **Missing:** No test verifies that `getAvailableTags()` returns a readonly/defensive copy (analogous to the `getAll` readonly test at `store.test.ts:189`). Minor gap — acceptable for approval.

### Risk Assessment

| Risk | Likelihood | Impact | Status |
|------|------------|--------|--------|
| External callers still bypass encapsulation via field mutation on Thread objects | Low (scoped out by AC-4 wording) | Medium | Acknowledged, tracked for future item |
| `loadThreads` replaces the array reference directly (no copy) | Low | Low | Intentional — startup bulk-load pattern |

### Routing

Ready for `/done` to archive.
