---
spec_version: "1.0"
type: shaped-work
id: DGB-2
title: Eliminate duplication in discordActions — webhook resolution and archive-bounce
status: shaped
created: 2026-03DGB-15
appetite: small
priority: P1
target_project: discord-github-sync-bot
author: architect
tags: [refactor, duplication, discord, webhook]
acceptance_criteria:
  - id: AC-1
    description: A single resolveWebhook private function handles webhook lookup and cache-miss resolution for both createComment and updateComment
    status: pending
  - id: AC-2
    description: createComment and updateComment no longer embed inline webhook lookup blocks
    status: pending
  - id: AC-3
    description: A single withArchiveBounce private function handles the unarchive-action-archive sequence
    status: pending
  - id: AC-4
    description: lockThread and unlockThread call withArchiveBounce rather than embedding the three-step sequence directly
    status: pending
  - id: AC-5
    description: lockArchiving and lockLocking fields are removed from the Thread interface
    status: pending
  - id: AC-6
    description: Lock/archive state is tracked inside discordActions module scope, invisible to Thread
    status: pending
  - id: AC-7
    description: All existing tests continue to pass
    status: pending
---

# DGB-2: Eliminate duplication in discordActions — webhook resolution and archive-bounce

## Problem

`discordActions.ts` (385 lines) contains three instances of duplicated logic that are each shotgun-surgery risks — a change to any one pattern must be made in multiple places.

**1. Webhook resolution duplication (CS-4, CS-5)**
`createComment` and `updateComment` each embed a ~20-line webhook lookup-and-cache block that is nearly identical. The only difference is whether a new webhook is created when none is found. Any change to the webhook preference strategy (e.g., filtering by token scope, adding retry logic) must be made in both places. A change made to one but missed in the other produces inconsistent behavior between comment creation and editing.

**2. Archive-bounce duplication (CS-6)**
`lockThread` and `unlockThread` each contain the same three-step sequence:
```
unarchive → lock/unlock → re-archive
```
differing only in `setLocked(true/false)`. This is a Discord API workaround — if Discord ever provides a direct lock-while-archived API, both functions must be updated.

**3. Temporary fields on Thread (CS-7)**
`lockArchiving` and `lockLocking` are optional boolean fields on the `Thread` interface that are `undefined` in normal operation and only set during archive-bounce sequences. They encode a state machine split across three files. The `Thread` domain type should not carry Discord-specific synchronisation flags.

## Evidence

- `src/discord/discordActions.ts` lines 172–193 and 230–253: near-identical webhook resolution
- `src/discord/discordActions.ts` lines 312–319 and 334–341: archive-bounce duplication
- `src/interfaces.ts` lines 13–14: `lockArchiving?: boolean; lockLocking?: boolean`
- Pass 2 findings CS-4, CS-5, CS-6, CS-7

## Appetite & Boundaries

- **Appetite:** Small (all changes contained within discordActions.ts and interfaces.ts)
- **In scope:** Extract resolveWebhook helper; extract withArchiveBounce helper; remove lockArchiving/lockLocking from Thread
- **No-gos:** Changing webhook caching strategy, changing lock/archive behavior, touching githubActions or handlers

## Solution Sketch

```typescript
// Private helper — replaces duplicate webhook resolution
async function resolveWebhook(
  channel: ThreadChannel,
  login: string,
  avatarUrl: string,
  createIfMissing: boolean
): Promise<Webhook | undefined>

// Private helper — replaces duplicate archive-bounce
async function withArchiveBounce(
  channel: ThreadChannel,
  action: () => Promise<void>
): Promise<void>

// Lock state moves out of Thread, into module scope
const lockingThreads = new Set<string>(); // keyed by thread Discord ID
```

`Thread` interface loses `lockArchiving` and `lockLocking`. Callers that check these flags are updated to check `lockingThreads.has(thread.id)`.

## Risks & Assumptions

| Assumption | Type | Fastest Test |
|------------|------|--------------|
| The two webhook resolution blocks are semantically equivalent except for createIfMissing | correctness | Side-by-side diff before extracting |
| Removing lockArchiving/lockLocking from Thread does not break any test assertions | correctness | Run tests after removing fields from interface |

## Routing

- [x] **Crafter** — TDD implementation; red tests for each extracted helper first
