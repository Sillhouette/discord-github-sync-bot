---
spec_version: "1.0"
type: shaped-work
id: DGB-4
title: Reduce discordActions.ts public surface area and extract shared text utilities
status: shaped
created: 2026-03-15
appetite: small
priority: P2
target_project: discord-github-sync-bot
author: architect
depends_on: [DGB-2]
tags: [refactor, encapsulation, discord, text-utilities]
acceptance_criteria:
  - id: AC-1
    description: getThreadChannel is not exported from discordActions.ts
    status: pending
  - id: AC-2
    description: truncateContent, isImageUrlSafe, and extractImageUrls are not exported from discordActions.ts
    status: pending
  - id: AC-3
    description: evictForumCache is replaced by onForumChannelDeleted — a higher-level lifecycle event that encapsulates cache cleanup internally
    status: pending
  - id: AC-4
    description: stripImageMarkdown is moved to src/textUtils.ts and imported from there by both discordActions.ts and githubActions.ts
    status: pending
  - id: AC-5
    description: githubActions.ts no longer imports anything from discordActions.ts
    status: pending
  - id: AC-6
    description: All existing tests continue to pass
    status: pending
---

# DGB-4: Reduce discordActions.ts public surface area and extract shared text utilities

## Problem

`discordActions.ts` exports significantly more than it should. Five of its exports are either internal helpers or formatting utilities that have no business being in the Discord module's public API:

**Over-exposed internals (EV-3, EV-4, EV-5)**
- `getThreadChannel` — a private lookup helper used only within `discordActions.ts`; returning `ThreadChannel` (a discord.js type) and `Thread` (domain type) directly exposes implementation detail
- `truncateContent`, `isImageUrlSafe`, `extractImageUrls` — internal text sanitisation used only within `discordActions.ts`
- `evictForumCache` — leaks the existence of internal cache Maps; callers must know to call this on channel deletion, and if a second cache is added, every caller must be updated

**Wrong-direction dependency (C-8, EV-4)**
`githubActions.ts` imports `stripImageMarkdown` from `discordActions.ts`. A GitHub business-logic file should not depend on the Discord module. This also means GitHub action tests transitively load the Discord client and require Discord credentials to instantiate.

## Evidence

- `src/discord/discordActions.ts` lines 44, 54, 117, 127, 143, 363: five over-exposed exports
- `src/github/githubActions.ts` line 16: `import { stripImageMarkdown } from '../discord/discordActions'`
- Pass 1 finding C-8; Pass 2 findings EV-3, EV-4, EV-5

## Appetite & Boundaries

- **Appetite:** Small (create one new file; update imports in two files; remove exports)
- **In scope:** Create `src/textUtils.ts`; move `stripImageMarkdown` there; remove five unnecessary exports; replace `evictForumCache` with `onForumChannelDeleted`
- **No-gos:** Changing text utility behavior, refactoring githubActions internals beyond the import fix

## Solution Sketch

```
src/textUtils.ts  (new)
  export function stripImageMarkdown(body: string): string
  // truncateContent, isImageUrlSafe, extractImageUrls remain private in discordActions.ts
```

`githubActions.ts` changes its import from `'../discord/discordActions'` to `'../textUtils'`. `discordHandlers.ts` calls `discordActions.onForumChannelDeleted(channelId)` instead of `discordActions.evictForumCache(channelId)`. All five other exports lose their `export` keyword.

## Risks & Assumptions

| Assumption | Type | Fastest Test |
|------------|------|--------------|
| No external consumers of the removed exports exist outside src/ | correctness | grep for each export name across src/ |
| stripImageMarkdown behavior does not need to differ between Discord and GitHub contexts | correctness | Check call sites in both files |

## Routing

- [x] **Crafter** — Mechanical refactor; no logic change; run tests after each export removal
