---
spec_version: "1.0"
type: shaped-work
id: DGB-9
title: Document Thread interface field semantics, enqueueWebhookTask contract, and lock state machine
status: shaped
created: 2026-03-15
appetite: small
priority: P3
target_project: discord-github-sync-bot
author: architect
depends_on: [DGB-2]
tags: [documentation, interfaces, concurrency]
acceptance_criteria:
  - id: AC-1
    description: Thread interface fields have JSDoc comments distinguishing Discord IDs (id, comments[].id), GitHub IDs (number, node_id, comments[].git_id), and shared fields
    status: pending
  - id: AC-2
    description: ThreadComment interface fields have JSDoc comments clarifying which ID belongs to which system
    status: pending
  - id: AC-3
    description: enqueueWebhookTask has a JSDoc comment documenting the serial execution invariant, why prev.then(task, task) advances the queue on failure, and what the self-eviction pattern prevents
    status: pending
  - id: AC-4
    description: The archive+lock state machine implemented via lockingThreads: Set<string> (introduced by DGB-2) has a comment or inline state diagram in discordHandlers.ts documenting the 6 states, valid transitions, the 500ms setTimeout race window, and why the Set-based approach replaced the lockArchiving/lockLocking Thread fields
    status: pending
  - id: AC-5
    description: getIssueBody has a comment linking it to getDiscordInfoFromGithubBody — documenting that the format produced must match the regex used to parse it back
    status: pending
---

# DGB-9: Document Thread interface field semantics, enqueueWebhookTask contract, and lock state machine

## Problem

Three areas of the codebase carry non-obvious design decisions that are not documented and represent the highest comprehension cost for new contributors.

**Thread interface field semantics (MEDIUM — diagnose rank 10)**
`Thread` has six ID-like fields: `id` (Discord thread ID), `number` (GitHub issue number), `node_id` (GitHub GraphQL node ID), and within `ThreadComment`: `id` (Discord message ID), `git_id` (GitHub comment ID). The naming convention (`id` for Discord, `git_id` for GitHub, `node_id` for GraphQL) is the key to understanding the entire bidirectional mapping — but it is not documented anywhere. A new contributor must trace mutations across three files to infer this.

**enqueueWebhookTask concurrency contract (MEDIUM — diagnose rank 11)**
The webhook queue design is the most non-obvious part of the codebase. The existing comment describes intent but `enqueueWebhookTask` has no JSDoc explaining:
- What invariant it guarantees: serial execution per forum channel
- Why `prev.then(task, task)` passes the task as both fulfillment AND rejection handler — the queue must advance even when the previous task fails
- What the self-eviction pattern prevents: unbounded `webhookQueue` Map growth when channels are no longer active

**Archive+lock state machine (MEDIUM — diagnose rank 15)**
`handleThreadUpdate` manages Discord's constraint that archived threads cannot be directly locked. DGB-2 replaces the `thread.lockArchiving` and `thread.lockLocking` fields with a `lockingThreads: Set<string>` in module scope, combined with a `setTimeout(..., 500)`. This remains a six-state implicit machine. The states, valid transitions, why the Set-based approach replaced Thread fields, and why the 500ms delay exists are not documented anywhere.

> **Ordering:** This item depends on DGB-2. The state machine comment must describe the `lockingThreads` Set pattern, not the removed Thread fields. Do not deliver DGB-9 before DGB-2 is complete.

## Evidence

- `src/interfaces.ts` lines 1–22: Thread and ThreadComment with no JSDoc
- `src/discord/discordActions.ts` lines 29–40: enqueueWebhookTask with partial comment
- `src/discord/discordHandlers.ts` lines 159–187: handleThreadUpdate state machine
- `src/github/githubActions.ts` lines 123–148: getIssueBody ↔ getDiscordInfoFromGithubBody coupling
- Diagnose report ranks 10, 11, 15

## Appetite & Boundaries

- **Appetite:** Small (documentation only; no code changes)
- **In scope:** JSDoc on Thread, ThreadComment, enqueueWebhookTask; inline state diagram or comment for lock machine; linking comment on getIssueBody
- **No-gos:** Generating API docs, adding a documentation site, changing any behavior

## Solution Sketch

```typescript
// interfaces.ts
interface Thread {
  /** Discord thread ID (snowflake) — primary key on the Discord side */
  id: string;
  /** GitHub issue number — used for REST API calls */
  number: number;
  /** GitHub GraphQL node ID — used for GraphQL mutations (lock/unlock) */
  node_id: string;
  ...
}

// discordActions.ts — enqueueWebhookTask JSDoc
/**
 * Serialises webhook operations per forum channel.
 *
 * Invariant: only one webhook operation runs at a time per parentId.
 * Uses promise chaining (prev.then(task, task)) so the queue advances
 * even if the previous task rejects — preventing a failed send from
 * stalling all subsequent messages in the thread.
 *
 * Self-eviction: after each task completes, if the queue has not been
 * updated with a new task, the entry is removed from webhookQueue to
 * prevent unbounded Map growth on inactive channels.
 */

// discordHandlers.ts — state machine comment (reflects DGB-2's lockingThreads replacement)
// Discord archive+lock state machine:
// Discord prevents locking an archived thread directly. Workaround:
//   [archived] → setArchived(false) → [active] → setLocked(x) → [locked/unlocked] → setArchived(true) → [archived+locked]
// lockingThreads Set: tracks thread IDs currently in the unarchive→lock→rearchive sequence.
//   handleThreadUpdate checks lockingThreads.has(threadId) to suppress re-entrancy during intermediate steps.
//   Replaces the former lockArchiving/lockLocking boolean fields on Thread (removed in DGB-2).
// 500ms timeout: Discord emits the archived event asynchronously; timeout absorbs the race condition
//   between the setArchived(false) call and Discord firing the threadUpdate event for it.
```

## Risks & Assumptions

| Assumption | Type | Fastest Test |
|------------|------|--------------|
| The state machine description above is accurate | correctness | Review against discordActions.ts lockThread/unlockThread code |
| The prev.then(task, task) explanation is complete | correctness | Review enqueueWebhookTask implementation carefully before writing JSDoc |

## Routing

- [x] **Crafter** — Documentation only; verify accuracy of state machine description against code before writing
