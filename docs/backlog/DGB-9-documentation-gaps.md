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
    description: The lockArchiving/lockLocking state machine (or its replacement from DGB-2) has a comment or inline state diagram documenting the 6 states and valid transitions
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

**Lock/archive state machine (MEDIUM — diagnose rank 15)**
`handleThreadUpdate` uses `thread.lockArchiving` and `thread.lockLocking` flags, combined with a `setTimeout(..., 500)`, to manage Discord's constraint that archived threads cannot be directly locked. This is a six-state implicit machine documented only by the comment "timeout for fixing discord archived post locking." The states, valid transitions, and why the 500ms delay exists are not recorded anywhere.

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

// discordHandlers.ts — state machine comment
// Discord archive+lock state machine:
// Discord prevents locking an archived thread directly. Workaround:
//   [archived] → setArchived(false) → [active] → setLocked(x) → [locked/unlocked] → setArchived(true) → [archived+locked]
// lockArchiving flag: prevents handleThreadUpdate from re-triggering on the intermediate setArchived(false)
// lockLocking flag: prevents handleThreadUpdate from re-triggering on the setLocked call
// 500ms timeout: Discord emits the archived event asynchronously; timeout absorbs the race
```

## Risks & Assumptions

| Assumption | Type | Fastest Test |
|------------|------|--------------|
| The state machine description above is accurate | correctness | Review against discordActions.ts lockThread/unlockThread code |
| The prev.then(task, task) explanation is complete | correctness | Review enqueueWebhookTask implementation carefully before writing JSDoc |

## Routing

- [x] **Crafter** — Documentation only; verify accuracy of state machine description against code before writing
