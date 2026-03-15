# Encapsulation + Code Smells Analysis — discord-github-sync-bot (Pass 2)

**Date:** 2026-03-15

---

## Encapsulation Violations

### EV-1 — `Store.threads` and `Store.availableTags` are public mutable fields
**File:** `src/store.ts`, lines 5–6
**Type:** Public fields that should be private/controlled

Every consumer (`discordHandlers.ts`, `githubHandlers.ts`, `githubActions.ts`, `discordActions.ts`) directly reads and mutates these arrays — `store.threads.push(...)`, `store.threads.find(...)`, `store.threads.splice(...)`, `store.availableTags = forum.availableTags`. `Store.deleteThread` is the only encapsulated mutation, yet it is bypassed by callers who splice or push directly. There is no single control point for state changes and no invariant enforcement possible.

**Remedy:** Make `threads` and `availableTags` private; expose typed mutator methods (`addThread`, `setAvailableTags`, `findThreadById`, `findThreadByNodeId`) and a read-only view (`getThreads()`).

**Priority: HIGH**

---

### EV-2 — `octokit` and `repoCredentials` exported from `githubActions.ts`
**File:** `src/github/githubActions.ts`, lines 29–43
**Type:** Leaked implementation detail / over-exposure of credentialed client

Both are exported at module level but unused externally. The `octokit` instance carries the GitHub access token — exporting it makes the credentialed client reachable by any future module that imports from `githubActions`, bypassing the action façade entirely.

**Remedy:** Remove `export` from both. `repoCredentials` becomes a file-private constant. If the octokit instance needs sharing in future, use a factory or dependency-injection argument.

**Priority: HIGH**

---

### EV-3 — `getThreadChannel` exported from `discordActions.ts`
**File:** `src/discord/discordActions.ts`, lines 363–384
**Type:** Exposing an internal helper as a public API

Used exclusively within `discordActions.ts` itself. Returns a raw structural type exposing both a discord.js API type (`ThreadChannel`) and the internal domain model (`Thread`) — a double exposure with no domain logic gating it.

**Remedy:** Remove `export`. If future callers need a lookup, expose a domain-level query on the Store.

**Priority: MEDIUM**

---

### EV-4 — `truncateContent`, `isImageUrlSafe`, `extractImageUrls` exported unnecessarily
**File:** `src/discord/discordActions.ts`, lines 54, 117, 127
**Type:** Over-exposure of internal processing utilities

All three are used only within `discordActions.ts`. Exporting them creates a public utility surface with no governing API contract and invites external callers to depend on implementation details.

**Remedy:** Remove `export` from all three. `stripImageMarkdown` (line 143) is legitimately cross-module and should move to a shared `src/textUtils.ts` rather than being exported from the Discord module.

**Priority: MEDIUM**

---

### EV-5 — `evictForumCache` exposes cache internals as a public function
**File:** `src/discord/discordActions.ts`, lines 44–47
**Type:** Leaking cache internals through public API

Exists solely so `discordHandlers.ts` can reach the private `webhookCache` and `webhookQueue` Maps. If a third cache is added, the caller must be updated — even though it has no business knowing the internal cache structure.

**Remedy:** Replace with a higher-level `onForumChannelDeleted(channelId)` that internally handles whatever cleanup is needed, keeping implementation private.

**Priority: LOW**

---

### EV-6 — `r2.ts` reads credentials directly from `process.env` instead of `config`
**File:** `src/r2.ts`, lines 9–14
**Type:** Configuration leaking across module boundaries / dual config path

`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` are invisible to the startup validation in `config.ts`. A misconfigured value silently fails at runtime — the function returns `null` and uploads degrade without operator notice.

**Remedy:** Add `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` to `config.ts` as optional entries. `r2.ts` reads from `config` like every other module.

**Priority: MEDIUM**

---

## Code Smells

### CS-1 — Magic number: `params.type === 15`
**File:** `src/discord/discordHandlers.ts`, line 154
**Type:** Magic number / Primitive obsession

`15` is `ChannelType.GuildForum`. Without the named constant, the check is unreadable and fragile against future API versioning. TypeScript cannot narrow the type, making `params.availableTags` an implicit type assertion.

**Remedy:** Import `ChannelType` from `discord.js` and write `params.type === ChannelType.GuildForum`.

**Priority: MEDIUM**

---

### CS-2 — `handleClientReady` is a 104-line method doing four distinct things
**File:** `src/discord/discordHandlers.ts`, lines 29–132
**Type:** Long method + Divergent change

Four phases: (1) load and filter GitHub issues, (2) fetch forum tags, (3) reconcile archived state mismatch, (4) recover orphaned threads. Each changes for a different reason. Orphan recovery calls `createIssue` inline, entangling GitHub logic into a Discord event handler.

**Remedy:** Extract `loadAndValidateThreads(client)`, `reconcileArchivedState(forum, threads)`, `recoverOrphanedThreads(forum, threads)`. `handleClientReady` becomes a ~15-line sequencing function.

**Priority: MEDIUM**

---

### CS-3 — `attachmentsToMarkdown` — 67-line method with duplicated fetch/upload pattern
**File:** `src/github/githubActions.ts`, lines 55–121
**Type:** Long method + Divergent change

Switch on `contentType` with four branches. The fetch → buffer → uploadToR2 → fallback pattern appears twice (image branch, default branch). Adding a new attachment type requires editing a growing switch.

**Remedy:** Extract `rehostToR2(url, name, contentType, messageId)` private helper for the repeated download+upload logic. Switch cases become short delegate calls.

**Priority: MEDIUM**

---

### CS-4 — `createComment` too long; webhook resolution embedded inline
**File:** `src/discord/discordActions.ts`, lines 150–217
**Type:** Long method + Message chain

68 lines. Inside a single closure: compute embeds, resolve or create webhook (20+ lines), send message, push to thread.comments, save to commentMap, re-archive. The webhook resolution block is duplicated nearly verbatim in `updateComment`.

**Remedy:** Extract `resolveWebhook(parentId, login, avatarUrl): Promise<Webhook>` as a private function. Both create and update call it.

**Priority: HIGH**

---

### CS-5 — Duplicated webhook resolution logic in `createComment` and `updateComment`
**File:** `src/discord/discordActions.ts`, lines 172–193 and 230–253
**Type:** Shotgun surgery — same logic must be updated in two places

Two variations of the same webhook lookup and cache-miss resolution, differing only in whether a new webhook is created when none is found. Any change to webhook preference strategy must be made in both places.

**Remedy:** Same as CS-4 — extract `resolveWebhook` with a `createIfMissing: boolean` parameter.

**Priority: HIGH**

---

### CS-6 — Duplicated archive-bounce pattern in `lockThread` and `unlockThread`
**File:** `src/discord/discordActions.ts`, lines 312–319 and 334–341
**Type:** Shotgun surgery

Same three-step sequence (unarchive → lock/unlock → archive) in both functions, differing only in `setLocked(true/false)`. A change to the workaround strategy requires updating both.

**Remedy:** Extract `withArchiveBounce(channel, action: () => Promise<void>): Promise<void>`. Both functions call it with their respective lock operation.

**Priority: MEDIUM**

---

### CS-7 — `lockArchiving` and `lockLocking` are temporary fields on Thread
**File:** `src/interfaces.ts`, lines 13–14
**Type:** Temporary field smell

`undefined` in normal operation; only set during archive-bounce sequences as synchronisation flags between async Discord events. A `Thread` not in a transition has two meaningless fields. The logic for what these flags mean is split across three files, encoding a state machine that is never expressed explicitly.

**Remedy:** Remove from `Thread` interface. Represent synchronisation state as a `Set<string>` (keyed by thread id) inside `discordActions.ts`, invisible to the domain model.

**Priority: MEDIUM**

---

### CS-8 — `update()` returns `true | Error | unknown`
**File:** `src/github/githubActions.ts`, lines 171–182
**Type:** Primitive obsession / inconsistent return type

Returns `true` on success, the caught value (anything) on error. TypeScript infers `Promise<unknown>`. Callers must do three-branch runtime inspection (`=== true`, `instanceof Error`, else) at every call site. Adding a third caller means copying the pattern again.

**Remedy:** Make `update()` return `Promise<void>` and throw on error. Callers use standard `try/catch`.

**Priority: MEDIUM**

---

### CS-9 — Ambiguous return shape `{ channelId, id }` in `getDiscordInfoFromGithubBody`
**File:** `src/github/githubActions.ts`, lines 141–148
**Type:** Magic string (regex) + naming inconsistency

`id` in the return means Discord message ID, but `id` is used throughout the codebase for various entity IDs. A caller cannot know without reading the regex that this is a Discord message ID and not a GitHub ID.

**Remedy:** Rename return shape to `{ discordChannelId, discordMessageId }`. Consider renaming function to `extractDiscordCoordinatesFromBody`.

**Priority: LOW**

---

### CS-10 — `Triggerer` missing `as const` type alias
**File:** `src/logger.ts`, lines 25–28
**Type:** Primitive obsession / inconsistent typing pattern

`Actions` uses `as const` plus an explicit `ActionValue` type alias. `Triggerer` is structurally identical in intent but lacks both, allowing arbitrary strings where a `TriggererValue` type should be enforced.

**Remedy:** Apply `as const` plus `export type TriggererValue = (typeof Triggerer)[keyof typeof Triggerer]`.

**Priority: LOW**

---

### CS-11 — `params.availableTags` accessed without TypeScript narrowing
**File:** `src/discord/discordHandlers.ts`, lines 149–157
**Type:** Unsafe property access

Comparing `params.type === 15` (raw number) prevents TypeScript from narrowing `params` to `ForumChannel`. As a result `params.availableTags` is accessed without type safety.

**Remedy:** Fix CS-1 first. With `ChannelType.GuildForum`, TypeScript narrows and `availableTags` becomes safe.

**Priority: LOW** (dependent on CS-1)

---

### CS-12 — `console.log`/`console.warn` bypassing winston logger
**File:** `src/github/github.ts` line 84; `src/config.ts` lines 37–40
**Type:** Inconsistent instrumentation

Bypass transport configuration, timestamp formatting, and log-level filtering. The security warning in `config.ts` is particularly important — it should be emittable at warning level. Note: `config.ts` cannot use the winston logger without a circular dependency; remedy is to emit to `process.stderr` with a structured string.

**Remedy:** Replace `console.log` in `github.ts` with `logger.info`. In `config.ts`, write to `process.stderr` directly with a structured prefix.

**Priority: LOW**

---

## Prioritized Issue List

| ID | File(s) | Smell / Violation | Priority |
|----|---------|-------------------|----------|
| EV-1 | `store.ts` | Public mutable fields on Store | HIGH |
| EV-2 | `githubActions.ts` | Exported `octokit` + `repoCredentials` | HIGH |
| CS-4 | `discordActions.ts` | `createComment` too long; webhook resolution embedded | HIGH |
| CS-5 | `discordActions.ts` | Duplicated webhook resolution in create + update | HIGH |
| EV-3 | `discordActions.ts` | `getThreadChannel` exported unnecessarily | MEDIUM |
| EV-4 | `discordActions.ts` | 3 utility functions exported unnecessarily | MEDIUM |
| EV-6 | `r2.ts` | Reads credentials from `process.env` directly | MEDIUM |
| CS-1 | `discordHandlers.ts` | Magic number `15` for channel type | MEDIUM |
| CS-2 | `discordHandlers.ts` | `handleClientReady` — 104-line method, 4 concerns | MEDIUM |
| CS-3 | `githubActions.ts` | `attachmentsToMarkdown` — duplicated fetch/upload | MEDIUM |
| CS-6 | `discordActions.ts` | Duplicated archive-bounce in lock/unlock | MEDIUM |
| CS-7 | `interfaces.ts` | `lockArchiving`/`lockLocking` temporary fields on Thread | MEDIUM |
| CS-8 | `githubActions.ts` | `update()` returns `true \| Error \| unknown` | MEDIUM |
| EV-5 | `discordActions.ts` | `evictForumCache` exposes cache internals | LOW |
| CS-9 | `githubActions.ts` | Ambiguous return shape `{ channelId, id }` | LOW |
| CS-10 | `logger.ts` | `Triggerer` missing `as const` type alias | LOW |
| CS-11 | `discordHandlers.ts` | `params.availableTags` without type narrowing | LOW |
| CS-12 | `github.ts`, `config.ts` | `console.*` bypassing winston | LOW |

---

## Combined Summary: Pass 1 + Pass 2 → Backlog Candidates

Both passes converge on the same two files as primary problem sources: `discordActions.ts` and `githubActions.ts`. These are both too large (Pass 1: god-module concern) and leaking too many exports (Pass 2: over-exposure). The root cause is the absence of a domain model with proper encapsulation — `Thread` is a raw data bag any caller can mutate, and cross-cutting concerns are mixed into action modules that export everything they compute.

---

### ITEM A — Store Encapsulation
**Source:** C-4 (Pass 1) + EV-1 (Pass 2)
**Priority:** HIGH

Store is the coupling hub — everything imports and mutates it, and its fields are fully public with no mutation control. Every threading change touches the store with no way to observe or guard mutations.

*Scope:* Make `Store.threads` and `Store.availableTags` private; add typed accessor and mutator methods; update all callers. Medium appetite. Enables future testability.

---

### ITEM B — Discord Actions: Webhook + Lock Duplication
**Source:** CS-4, CS-5, CS-6, CS-7 (Pass 2) + H-3 (Pass 1)
**Priority:** HIGH

Three distinct duplications in `discordActions.ts`:
- Webhook resolution: `createComment` and `updateComment` each embed 20-line identical lookup blocks
- Archive-bounce: `lockThread` and `unlockThread` repeat the same three-step pattern
- Temporary fields: `lockArchiving`/`lockLocking` encode implicit state on the domain model

*Scope:* Extract `resolveWebhook(...)` and `withArchiveBounce(...)` helpers; move lock-state flags out of `Thread`. Small appetite per sub-item; can be done incrementally.

---

### ITEM C — Config + Credential Surface Reduction
**Source:** EV-2, EV-6 (Pass 2) + C-5 (Pass 1)
**Priority:** HIGH

- `octokit` and `repoCredentials` are unnecessarily exported (credentialed client as public symbol)
- `r2.ts` reads `process.env` directly (two env vars invisible to startup validation)

*Scope:* Unexport `octokit` and `repoCredentials`; add Cloudflare credentials to `config.ts`; update `r2.ts` to consume from config. Small appetite.

---

### ITEM D — Surface Area Reduction on discordActions.ts
**Source:** EV-3, EV-4, EV-5 (Pass 2) + H-3 (Pass 1)
**Priority:** MEDIUM

Four exports that should be private or relocated: `getThreadChannel`, `truncateContent`, `isImageUrlSafe`, `extractImageUrls`, `evictForumCache`. `stripImageMarkdown` is legitimately cross-module and should move to `src/textUtils.ts`.

*Scope:* Remove exports; create `src/textUtils.ts`; update one import in `githubActions.ts`. Small appetite.

---

### ITEM E — Method Decomposition
**Source:** CS-2, CS-3 (Pass 2) + H-5 (Pass 1)
**Priority:** MEDIUM

- `handleClientReady`: 104 lines across load, validate, reconcile, recover → extract 3–4 named private functions
- `attachmentsToMarkdown`: 67 lines with duplicated download+upload → extract `rehostToR2` helper

*Scope:* No behavior change. Small appetite.

---

### ITEM F — Type Safety + Convention Cleanup
**Source:** CS-1, CS-8, CS-9, CS-10, CS-12 (Pass 2)
**Priority:** MEDIUM/LOW

- Magic number `15` → `ChannelType.GuildForum`
- `update()` return type → `Promise<void>` throwing on error
- `Triggerer` missing `as const` type alias
- `getDiscordInfoFromGithubBody` return shape ambiguity
- `console.*` calls bypassing winston

*Scope:* Small appetite. Pure type-safety and convention alignment. No behavior change.

---

### Highest-Leverage Intervention

**Item A (Store) + Item B (Discord actions)** are the highest-leverage starting point. Fixing these two reduces the coupling surface from Pass 1 while closing the encapsulation gaps from Pass 2 — and unblocks making both god modules testable in isolation.
