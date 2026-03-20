---
spec_version: "1.0"
type: shaped-work
id: DGB-7
title: Close test coverage gaps in core sync paths
status: shaped
created: 2026-03-15
appetite: small
priority: P2
target_project: discord-github-sync-bot
author: architect
tags: [testing, coverage, discord, github]
acceptance_criteria:
  - id: AC-1
    description: handleThreadUpdate test advances fake timers and asserts closeIssue or openIssue is called after the 500ms setTimeout fires
    status: pending
  - id: AC-2
    description: handleMessageCreate has positive tests — createIssue called when thread.body is falsy, createIssueComment called when thread.body is set
    status: pending
  - id: AC-3
    description: handleOpened has a test verifying label-to-tag mapping logic produces correct tag IDs
    status: pending
  - id: AC-4
    description: closeIssue has tests for both the success path (octokit.rest.issues.update called with state closed) and the error path (error logged, false returned)
    status: pending
  - id: AC-5
    description: openIssue has tests for both the success path and the error path
    status: pending
  - id: AC-6
    description: lockIssue and unlockIssue have tests for both success and guard-clause paths
    status: pending
  - id: AC-7
    description: All new tests follow the AAA pattern with blank line separators
    status: pending
---

# DGB-7: Close test coverage gaps in core sync paths

## Problem

The project has strong test discipline overall, but four gaps exist in high-risk paths — paths that represent the core bidirectional sync behavior the bot provides.

**handleThreadUpdate setTimeout path (HIGH — diagnose rank 1)**
The archived state change wraps side effects in `setTimeout(..., 500)`. The existing test verifies that `thread.archived` is `false` immediately after the call — correct, since the timeout hasn't fired — but does NOT advance fake timers to verify that `closeIssue` or `openIssue` is actually called after the timeout expires. If the closure captures the wrong variable or the wrong function is called, no test catches it.

**handleMessageCreate positive paths (MEDIUM — diagnose rank 5)**
Three negative paths are tested (bot author, unknown thread, thread not in store). The positive paths — where a user message triggers `createIssue` or `createIssueComment` — are not tested. This is the most frequent user-facing behavior of the bot.

**handleOpened label-mapping logic (MEDIUM — diagnose rank 6)**
`handleOpened` maps GitHub labels to Discord forum tags. The mapping logic (lines 33–38 of `githubHandlers.ts`) could silently produce wrong tag IDs — no test exercises it at the handler level.

**closeIssue / openIssue / lockIssue / unlockIssue happy paths (MEDIUM — diagnose rank 4)**
All four are tested only for the "no issue number" guard case. The path where `octokit.rest.issues.update()` is actually called (success or failure) is not tested. The mock stubs exist but are never exercised.

## Evidence

- `src/discord/discordHandlers.test.ts` line 829: setTimeout path untested
- `src/discord/discordHandlers.test.ts`: no positive tests for handleMessageCreate
- `src/github/githubHandlers.test.ts`: no handleOpened label-mapping test
- `src/github/githubActions.test.ts`: closeIssue, openIssue, lockIssue, unlockIssue guard-only tests
- Diagnose report ranks 1, 4, 5, 6

## Appetite & Boundaries

- **Appetite:** Small (new tests only, no implementation changes)
- **In scope:** The four gaps listed above; vitest fake timers for setTimeout path
- **No-gos:** Changing test infrastructure, adding integration tests, adding coverage tooling
- **Ordering:** Must be delivered before DGB-10. DGB-10 renames the test files this item targets (`discordHandlers.test.ts` → `eventHandlers.test.ts`, `githubActions.test.ts` → `port.test.ts`). New tests added here will be migrated as part of DGB-10.
- **Interaction with DGB-6:** AC-4 and AC-5 test `closeIssue`/`openIssue` against the current `returns true | false` behavior. DGB-6 AC-3/4 changes `update()` to throw and updates callers to use try/catch. If DGB-6 runs before DGB-7, update the solution sketch for AC-4 and AC-5 to test the throw-based error path (no return value to assert, verify the caught error is logged instead).

## Solution Sketch

```typescript
// AC-1: handleThreadUpdate setTimeout
it('calls closeIssue after 500ms when thread is archived on GitHub', async () => {
  vi.useFakeTimers();
  // Arrange: thread archived on GitHub, not archived on Discord
  handleThreadUpdate(params);
  // Act: advance timers
  await vi.runAllTimersAsync();
  // Assert
  expect(mockCloseIssue).toHaveBeenCalledWith(thread.number);
});

// AC-2: handleMessageCreate positive path
it('calls createIssueComment when thread exists and thread.body is set', async () => {
  // Arrange: valid thread in store with body
  await handleMessageCreate(message);
  // Assert
  expect(mockCreateIssueComment).toHaveBeenCalledOnce();
});

// AC-4/5: closeIssue success path
it('calls octokit update with state closed and returns true', async () => {
  mockOctokit.rest.issues.update.mockResolvedValue({});
  const result = await closeIssue(42);
  expect(result).toBe(true);
  expect(mockOctokit.rest.issues.update).toHaveBeenCalledWith(
    expect.objectContaining({ issue_number: 42, state: 'closed' })
  );
});
```

## Risks & Assumptions

| Assumption | Type | Fastest Test |
|------------|------|--------------|
| vitest fake timers work with the existing test setup | feasibility | Add vi.useFakeTimers() to one test and run |
| handleOpened test can mock the store.availableTags to provide known tag IDs | feasibility | Check existing store mock patterns in test file |

## Routing

- [x] **Crafter** — Tests only; red-green cycle; no implementation changes
