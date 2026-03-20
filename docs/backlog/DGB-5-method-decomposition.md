---
spec_version: "1.0"
type: shaped-work
id: DGB-5
title: Decompose long methods — handleClientReady and attachmentsToMarkdown
status: shaped
created: 2026-03DGB-15
appetite: small
priority: P2
target_project: discord-github-sync-bot
author: architect
tags: [refactor, complexity, discord, github]
acceptance_criteria:
  - id: AC-1
    description: handleClientReady is no longer more than 20 lines — it delegates to named private functions
    status: pending
  - id: AC-2
    description: loadAndValidateThreads, reconcileArchivedState, and recoverOrphanedThreads are extractable private functions within discordHandlers.ts
    status: pending
  - id: AC-3
    description: attachmentsToMarkdown is no longer more than 30 lines — it delegates to a private rehostOrFallback helper
    status: pending
  - id: AC-4
    description: The fetch → buffer → uploadToR2 → fallback pattern appears exactly once (in rehostOrFallback)
    status: pending
  - id: AC-5
    description: All existing tests continue to pass with no behavior change
    status: pending
---

# DGB-5: Decompose long methods — handleClientReady and attachmentsToMarkdown

## Problem

Two methods are significantly over-length and each mixes multiple unrelated concerns. Both are correct as written — this is a readability and maintainability issue, not a bug.

**handleClientReady — 104 lines, 4 concerns (CS-2, H-5)**
The Discord `ready` event handler performs:
1. Load all GitHub issues and filter to active threads (lines 32–65)
2. Fetch forum channel tags (lines 70–71)
3. Reconcile archived state mismatch between GitHub and Discord (lines 78–94)
4. Recover orphaned Discord threads with no corresponding GitHub issue (lines 94–122)

Each phase changes for a different reason and should be independently readable and testable. Orphan recovery calls `createIssue` inline, burying GitHub API interaction inside a Discord event handler. A bug in reconciliation currently requires parsing the full 104-line function to locate.

**attachmentsToMarkdown — 67 lines, repeated fetch/upload pattern (CS-3)**
The function switches on `contentType` with four branches. The fetch → buffer → uploadToR2 → fallback pattern is repeated twice (image branch, default branch). Adding a new attachment type extends a growing switch. The repeated pattern is a maintenance surface — a change to upload error handling must be made in two places.

## Evidence

- `src/discord/discordHandlers.ts` lines 29–132: handleClientReady
- `src/github/githubActions.ts` lines 55–121: attachmentsToMarkdown
- Pass 1 finding H-5; Pass 2 findings CS-2, CS-3
- Diagnose finding rank 3: decompose handleClientReady

## Appetite & Boundaries

- **Appetite:** Small (extraction only; no behavior change)
- **In scope:** Extract named private functions from both methods; no change to logic or tests
- **No-gos:** Changing startup orchestration behavior, changing attachment handling logic, moving functions to new files
- **Ordering:** Must be delivered before DGB-11. DGB-11 renames `discordHandlers.ts` → `discord/eventHandlers.ts` and `githubActions.ts` → `github/port.ts`. If DGB-5 runs after DGB-11, the target files no longer exist under these names.

## Solution Sketch

```typescript
// discordHandlers.ts — handleClientReady becomes:
export async function handleClientReady(client: Client): Promise<void> {
  const { threads, forum } = await loadAndValidateThreads(client);
  await reconcileArchivedState(forum, threads);
  await recoverOrphanedThreads(forum, threads);
  logger.info(...summary...);
}

// githubActions.ts — rehostOrFallback extracted:
async function rehostOrFallback(
  url: string,
  name: string,
  contentType: string,
  messageId: string
): Promise<string>  // returns markdown embed string

// attachmentsToMarkdown switch cases become short delegate calls:
case 'image/png': return rehostOrFallback(url, name, contentType, messageId);
```

## Risks & Assumptions

| Assumption | Type | Fastest Test |
|------------|------|--------------|
| Extracting handleClientReady phases does not change async ordering | correctness | Run full test suite after each extraction |
| The two fetch/upload blocks in attachmentsToMarkdown are semantically equivalent | correctness | Side-by-side diff before extracting |

## Routing

- [x] **Crafter** — Extract one function at a time; run tests between each extraction
