---
spec_version: "1.0"
type: shaped-work
id: DGB-6
title: Type safety and convention cleanup — magic numbers, return types, logger consistency
status: shaped
created: 2026-03-15
appetite: small
priority: P2
target_project: discord-github-sync-bot
author: architect
tags: [refactor, types, conventions, typescript]
acceptance_criteria:
  - id: AC-1
    description: ChannelType.GuildForum is used instead of magic number 15 in discordHandlers.ts
    status: pending
  - id: AC-2
    description: TypeScript narrows params to ForumChannel after the ChannelType.GuildForum check — availableTags is type-safe
    status: pending
  - id: AC-3
    description: The update() function in githubActions.ts returns Promise<void> and throws on error rather than returning true | Error | unknown
    status: pending
  - id: AC-4
    description: closeIssue and openIssue use try/catch rather than inspecting a return value
    status: pending
  - id: AC-5
    description: Triggerer uses as const and exports a TriggererValue type alias, consistent with the Actions pattern
    status: pending
  - id: AC-6
    description: getDiscordInfoFromGithubBody returns { discordChannelId, discordMessageId } instead of { channelId, id }
    status: pending
  - id: AC-7
    description: console.log in github.ts is replaced with logger.info
    status: pending
  - id: AC-8
    description: All existing tests continue to pass
    status: pending
---

# DGB-6: Type safety and convention cleanup — magic numbers, return types, logger consistency

## Problem

A cluster of small, independent type-safety and convention issues that can be addressed together. None are bugs today, but each represents a future maintenance risk or inconsistency that will compound as the codebase grows.

**Magic number (CS-1, CS-11)**
`discordHandlers.ts` line 154 compares `params.type === 15` where `15` is `ChannelType.GuildForum`. Without the named constant, TypeScript cannot narrow the type, so `params.availableTags` is accessed without type safety. If discord.js ever remaps the enum value, this silently breaks.

**Inconsistent return type on update() (CS-8)**
`githubActions.ts::update()` returns `true` on success and the caught value (anything) on failure — TypeScript infers `Promise<unknown>`. Callers do three-branch runtime inspection (`=== true`, `instanceof Error`, else) at each call site. This is an anti-pattern that spreads error-handling boilerplate.

**Triggerer missing type alias (CS-10)**
`Triggerer` in `logger.ts` is not typed with `as const` + a union type alias. `Actions` right below it uses both. The inconsistency means log functions that accept a triggerer parameter cannot enforce type safety.

**Ambiguous return shape (CS-9)**
`getDiscordInfoFromGithubBody` returns `{ channelId, id }` where `id` means Discord message ID. Throughout the rest of the codebase, `id` is used for various entity IDs and `git_id` for GitHub IDs. A caller cannot determine without reading the regex what `id` refers to.

**console.log bypassing logger (diagnose item, CS-12)**
`github.ts` line 84 uses `console.log` for the server startup message. All other logging goes through winston.

## Evidence

- `src/discord/discordHandlers.ts` line 154: `params.type === 15`
- `src/github/githubActions.ts` lines 171–182: `update()` return type
- `src/logger.ts` lines 25–28: `Triggerer` missing `as const`
- `src/github/githubActions.ts` lines 141–148: `{ channelId, id }` return shape
- `src/github/github.ts` line 84: `console.log`
- Diagnose item rank 2; Pass 2 findings CS-1, CS-8, CS-9, CS-10, CS-11, CS-12

## Appetite & Boundaries

- **Appetite:** Small (each fix is 1–5 lines; all are isolated changes)
- **In scope:** The six specific items listed in ACs above
- **No-gos:** Adding new lint rules, overhauling error handling architecture, changing log formatting

## Solution Sketch

```typescript
// CS-1: discordHandlers.ts
import { ChannelType } from 'discord.js';
if (params.type === ChannelType.GuildForum) { ... }

// CS-8: githubActions.ts
async function update(issue_number: number, state: 'open' | 'closed'): Promise<void> {
  await octokit.rest.issues.update({ ...repoCredentials, issue_number, state });
  // throws on error — callers use try/catch
}

// CS-10: logger.ts
export const Triggerer = { Discord: 'discord->github', Github: 'github->discord' } as const;
export type TriggererValue = (typeof Triggerer)[keyof typeof Triggerer];

// CS-9: githubActions.ts
return { discordChannelId: channelId, discordMessageId: id };

// CS-12: github.ts
logger.info(`Server is running on port ${config.PORT}`);
```

## Risks & Assumptions

| Assumption | Type | Fastest Test |
|------------|------|--------------|
| Renaming { channelId, id } to { discordChannelId, discordMessageId } requires updating all callers of getDiscordInfoFromGithubBody | correctness | grep for getDiscordInfoFromGithubBody usage |
| Changing update() to throw means callers' error handling must move to try/catch | correctness | Check closeIssue and openIssue callers |

## Routing

- [x] **Crafter** — No design needed; implement each AC independently; verify tests after each
