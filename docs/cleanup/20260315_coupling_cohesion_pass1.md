# Coupling + Cohesion Analysis — discord-github-sync-bot (Pass 1)

**Date:** 2026-03-15

---

## 1. Dependency Map

```
src/index.ts
  └── src/discord/discord.ts
  └── src/github/github.ts

src/config.ts
  └── (leaf — imports only dotenv)

src/interfaces.ts
  └── (leaf — imports only express)

src/logger.ts
  └── src/config.ts
  └── src/interfaces.ts
  └── src/discord/discord.ts          ← INWARD PULL (logger → client leaf)

src/commentMap.ts
  └── src/interfaces.ts               (Thread type)

src/store.ts
  └── src/interfaces.ts
  └── discord.js (GuildForumTag)

src/r2.ts
  └── (leaf — no internal imports)

src/discord/discord.ts
  └── src/config.ts
  └── src/discord/discordHandlers.ts

src/discord/discordHandlers.ts
  └── src/config.ts
  └── src/github/githubActions.ts     ← CROSS-BOUNDARY (discord → github)
  └── src/discord/discordActions.ts
  └── src/logger.ts
  └── src/store.ts
  └── src/interfaces.ts

src/discord/discordActions.ts
  └── src/config.ts
  └── src/interfaces.ts
  └── src/logger.ts
  └── src/commentMap.ts
  └── src/store.ts
  └── src/discord/discord.ts          ← CIRCULAR RISK (discord.ts exports client, imports discordHandlers)

src/github/github.ts
  └── src/interfaces.ts
  └── src/config.ts
  └── src/github/webhookSignature.ts
  └── src/github/githubHandlers.ts

src/github/githubHandlers.ts
  └── src/discord/discordActions.ts   ← CROSS-BOUNDARY (github → discord)
  └── src/interfaces.ts
  └── src/logger.ts
  └── src/store.ts
  └── src/github/githubActions.ts

src/github/githubActions.ts
  └── src/config.ts
  └── src/r2.ts
  └── src/commentMap.ts
  └── src/interfaces.ts
  └── src/logger.ts
  └── src/store.ts
  └── src/discord/discordActions.ts   ← CROSS-BOUNDARY (github → discord)

src/github/webhookSignature.ts
  └── (leaf — Node crypto only)
```

---

## 2. Coupling Issues

### ISSUE C-1 — logger.ts imports the Discord client (circular-risk hidden coupling)

**File:** `src/logger.ts`, lines 4, 44–48
**Type:** Tight coupling / hidden coupling — stable utility module importing volatile infrastructure module

**Problem:**
`logger.ts` imports `client` from `src/discord/discord.ts` solely to call `client.channels.cache.get(...)` inside `getDiscordUrl()`. This pulls the Discord WebSocket client — the heaviest singleton in the system — into what should be a pure utility module. It also creates a latent circular dependency risk: `discord/discord.ts` → `discordHandlers.ts` → `logger.ts` → `discord/discord.ts`. Node's module loader resolves this by returning an incomplete module on the first pass, meaning `client` may be `undefined` during startup sequencing.

**Why it matters:**
If startup order changes, `client` resolves to `undefined` at the time `getDiscordUrl` is called. Additionally, `logger.ts` cannot be unit tested without instantiating or mocking the full Discord client. Any test of a GitHub action (which imports `logger`) now transitively depends on Discord.

**Remedy:**
Remove the Discord client import from `logger.ts`. Pass the Discord channel URL as a parameter to `getDiscordUrl(thread, channelBaseUrl)`, or move `getDiscordUrl` / `getGithubUrl` to a `urls.ts` utility that accepts the base URL as a plain string injected by callers.

**Priority:** HIGH

---

### ISSUE C-2 — logger.ts mixes infrastructure, domain constants, and URL construction

**File:** `src/logger.ts`, lines 25–52
**Type:** Mixed responsibilities / wrong home for code
*(Also cohesion issue H-2)*

**Problem:**
`logger.ts` exports five unrelated things: the Winston logger instance, `Triggerer` (string enum), `Actions` (string enum), `getDiscordUrl()` (URL builder dependent on Discord client), and `getGithubUrl()` (URL builder). Every module that needs only `Actions.Created` must transitively import the Discord client.

**Remedy:**
Split into `logger.ts` (Winston instance only), `events.ts` (Triggerer, Actions, ActionValue), and `urls.ts` (getDiscordUrl, getGithubUrl). URL builders receive what they need as parameters rather than closing over the global `client`.

**Priority:** HIGH

---

### ISSUE C-3 — Bidirectional coupling between discord/ and github/ packages

**Files:**
- `src/discord/discordHandlers.ts` line 23: imports from `../github/githubActions`
- `src/github/githubHandlers.ts` lines 2–11: imports from `../discord/discordActions`
- `src/github/githubActions.ts` line 16: imports `stripImageMarkdown` from `../discord/discordActions`

**Type:** Bidirectional tight coupling / inappropriate intimacy

**Problem:**
The `discord/` and `github/` modules form a fully bidirectional dependency cycle. Neither module can be changed, tested, or reasoned about independently. `githubActions.ts` even imports a formatting utility (`stripImageMarkdown`) from `discordActions.ts`, meaning a GitHub business-logic file knows about Discord message formatting internals.

**Remedy:**
Introduce an abstraction layer between the two domains. A `SyncBridge` interface (or event bus) should define the operations each domain exposes to the other. `stripImageMarkdown` should live in a shared `formatting.ts` utility rather than inside `discordActions.ts`.

**Priority:** HIGH

---

### ISSUE C-4 — store is a global singleton accessed across all module boundaries

**File:** `src/store.ts` (imported by `discordHandlers.ts`, `discordActions.ts`, `githubHandlers.ts`, `githubActions.ts`)
**Type:** Hidden coupling via global mutable state

**Problem:**
`store` is exported as a singleton instance and imported directly in six files. All six mutate `store.threads` and `store.availableTags` freely. Thread lifecycle transitions are scattered across files with no single authoritative location. Race conditions between concurrent webhook events can silently corrupt thread state.

**Remedy:**
Encapsulate `store` behind a `ThreadRepository` class with explicit mutation methods: `addThread()`, `removeThread()`, `updateThread()`, `findByNodeId()`, `findByDiscordId()`. Inject the repository into handlers and actions rather than importing the singleton.

**Priority:** HIGH

---

### ISSUE C-5 — r2.ts reads directly from process.env instead of config

**File:** `src/r2.ts`, lines 9–14
**Type:** Unstable dependency / hidden coupling to environment

**Problem:**
`r2.ts` calls `process.env` directly inside `getCredentials()`, bypassing the validated `config` module. `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` are not in `config.ts` at all, making them invisible to the fail-fast validation block. If they are missing in production, the bot starts silently with no indication.

**Remedy:**
Add `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` to `config.ts` as optional fields. Pass them as parameters to `uploadToR2()`. Remove direct `process.env` read from `r2.ts`.

**Priority:** MEDIUM

---

### ISSUE C-6 — discordActions.ts mutates Thread entity state fields directly

**File:** `src/discord/discordActions.ts`, lines 86–94, 202–203, 283–284, 355
**Type:** Feature envy / inappropriate intimacy with Thread entity

**Problem:**
`discordActions.ts` directly mutates `Thread` fields across `createThread`, `createComment`, `updateComment`, `archiveThread`, `lockThread`, `unlockThread`, and `deleteThread`. The module is serving as both a Discord API adapter and a Thread state manager. The `lockArchiving`/`lockLocking` interlock flags are especially fragile — they represent an informal state machine implemented via scattered boolean assignments.

**Remedy:**
Extract thread state transitions into a `ThreadRepository` or `ThreadStateMachine` with explicit methods. Discord actions should call `store.archiveThread(id)` rather than setting fields inline.

**Priority:** MEDIUM

---

### ISSUE C-7 — webhookCache and webhookQueue are module-level mutable state in discordActions.ts

**File:** `src/discord/discordActions.ts`, lines 25–30
**Type:** Hidden coupling / singleton global state within a module

**Problem:**
`webhookCache` and `webhookQueue` are module-level `Map` instances. The `evictForumCache` export tightly couples `discordHandlers.ts` to knowledge of the cache's existence. In tests, the module-level Map accumulates state across test cases.

**Remedy:**
Encapsulate `webhookCache` and `webhookQueue` inside a `WebhookManager` class. Expose `getOrCreateWebhook(channelId)` and `evict(channelId)` methods.

**Priority:** MEDIUM

---

### ISSUE C-8 — githubActions.ts imports stripImageMarkdown from discordActions.ts

**File:** `src/github/githubActions.ts`, line 16
**Type:** Inappropriate intimacy / wrong-direction dependency

**Problem:**
`githubActions.ts` imports a Discord formatting utility from `discordActions.ts`. Running GitHub action tests requires loading the Discord actions module (which imports the Discord client, which requires Discord credentials). This is a formatting utility with nothing to do with Discord.

**Remedy:**
Move `stripImageMarkdown`, `extractImageUrls`, `isImageUrlSafe`, and `truncateContent` to a shared `src/formatting.ts` utility. Both modules import from this neutral location.

**Priority:** MEDIUM

---

### ISSUE C-9 — github.ts contains both HTTP server setup and webhook routing logic

**File:** `src/github/github.ts`, lines 19–88
**Type:** Mixed responsibilities (infrastructure + routing)

**Problem:**
`github.ts` defines the Express application, configures middleware inline, registers routes, and starts the HTTP server in one function. Testing the webhook routing requires spinning up the entire Express server. The signature middleware cannot be unit-tested without importing the full application.

**Remedy:**
Separate `createApp()` (returns configured Express app, testable without listening) from `initGithub()` (calls `app.listen()`). Move `webhookSignatureMiddleware` to `src/github/webhookMiddleware.ts`.

**Priority:** LOW

---

## 3. Cohesion Issues

### ISSUE H-1 — interfaces.ts mixes Discord-domain and GitHub-domain types with a generic function type

**File:** `src/interfaces.ts`, lines 1–44
**Type:** Mixed responsibility

**Problem:**
Contains `Thread` (application domain), `ThreadComment` (application domain), `GitIssue` (GitHub API DTO), `GitHubLabel` (GitHub API DTO), and `GithubHandlerFunction` (Express infrastructure type). As the codebase grows this becomes a dumping ground.

**Remedy:**
Split into `src/domain/thread.ts` (Thread, ThreadComment), `src/github/types.ts` (GitIssue, GitHubLabel, GithubHandlerFunction).

**Priority:** LOW

---

### ISSUE H-2 — logger.ts has three distinct responsibilities

*(See C-2 above — same root issue)*

**Priority:** HIGH

---

### ISSUE H-3 — discordActions.ts is doing too much (385 lines, 6 responsibilities)

**File:** `src/discord/discordActions.ts`
**Type:** God module — mixed responsibilities

**Responsibilities mixed:** webhook lifecycle management, Discord thread CRUD, message content formatting, image URL validation, content truncation, direct thread state mutation on the store.

**Why it matters:**
Each responsibility evolves at a different rate. To test `truncateContent` you must load the entire Discord client infrastructure. Any change to webhook management risks touching image formatting.

**Remedy:**
Extract: (1) `src/discord/webhookManager.ts` (cache, queue, evict), (2) `src/formatting.ts` (truncateContent, extractImageUrls, isImageUrlSafe, stripImageMarkdown), (3) keep `discordActions.ts` as thin Discord operation façade.

**Priority:** MEDIUM

---

### ISSUE H-4 — githubActions.ts conflates data fetching, formatting, and GitHub API calls (416 lines)

**File:** `src/github/githubActions.ts`
**Type:** Mixed responsibility

**Responsibilities mixed:** Octokit client initialization, GraphQL client initialization, issue CRUD, comment CRUD, issue body formatting, attachment processing with R2 coordination, body parsing/extraction, GitHub response → Thread domain mapping, startup data loading orchestration.

**Remedy:**
Extract: (1) `src/github/issueFormatter.ts` (getIssueBody, attachmentsToMarkdown, formatIssuesToThreads), (2) `src/github/githubClient.ts` (octokit, graphqlWithAuth, repoCredentials), (3) keep `githubActions.ts` as pure GitHub operation façade. `getDiscordInfoFromGithubBody` moves to `src/formatting.ts`.

**Priority:** MEDIUM

---

### ISSUE H-5 — handleClientReady has 100 lines of startup orchestration inline

**File:** `src/discord/discordHandlers.ts`, lines 29–132
**Type:** Mixed responsibility — startup orchestration logic mixed into an event handler

**Problem:**
Performs four distinct phases: thread loading from GitHub, Discord channel validation, active thread reconciliation, orphaned thread recovery. The reconciliation logic is not testable in isolation. Orphan recovery calls `createIssue` inline, further entangling GitHub action logic into a Discord event handler.

**Remedy:**
Extract a `BotStartupService` or `ReconciliationService` with methods `validateThreadChannels()`, `reconcileArchivedThreads()`, `recoverOrphanedThreads()`. `handleClientReady` becomes a thin orchestrator.

**Priority:** MEDIUM

---

### ISSUE H-6 — commentMap.ts serves dual roles: disk persistence and startup hydration

**File:** `src/commentMap.ts`, lines 32–72
**Type:** Mixed responsibility

**Problem:**
Has two distinct responsibilities: (1) persistent disk-backed ID mapping, (2) merging persisted data into live `Thread` objects at startup via `loadInto`. The second responsibility reaches into the domain entity to mutate its `comments` array, coupling the persistence layer to the domain model's internal representation.

**Remedy:**
Keep `commentMap.ts` as pure persistence: `save`, `get`, `getAll`. Move `loadInto` hydration logic to the caller (`githubActions.getIssues`).

**Priority:** LOW

---

### ISSUE H-7 — store.ts is a false encapsulation with public mutable arrays

**File:** `src/store.ts`
**Type:** Low cohesion — class provides no encapsulation in practice

**Problem:**
The `Store` class has two public mutable arrays and one method. All consumers access `store.threads` and `store.availableTags` directly. The class boundary is meaningless in practice and gives a false impression of encapsulation.

**Remedy:**
Expand into a proper `ThreadRepository` with explicit methods (`findByNodeId`, `findByDiscordId`, `addThread`, `updateThread`, `removeThread`, `setAvailableTags`). All direct `.push`, `.splice`, `.find` calls across the codebase route through these methods. (Resolves C-4 as well.)

**Priority:** MEDIUM

---

## 4. Module Cohesion Ratings

| Module | Cohesion | Justification |
|---|---|---|
| `src/index.ts` | HIGH | Single responsibility: bootstrap. Thin, correct. |
| `src/config.ts` | HIGH | Single responsibility: validated environment config. Well-bounded. |
| `src/interfaces.ts` | MEDIUM | Mixes core domain types with GitHub API DTOs and an Express function type. |
| `src/logger.ts` | LOW | Logger, domain event constants, and Discord/GitHub URL builders — three unrelated concerns. |
| `src/commentMap.ts` | MEDIUM | Persistence is well-scoped; `loadInto` reaching into Thread entities breaks the boundary. |
| `src/store.ts` | LOW | Class facade exposes raw mutable arrays; adds no encapsulation in practice. |
| `src/r2.ts` | HIGH | Single responsibility: R2 upload. Clean and side-effect-free. |
| `src/discord/discord.ts` | HIGH | Single responsibility: Discord client setup and event binding. |
| `src/discord/discordHandlers.ts` | MEDIUM | Handlers focused but `handleClientReady` is 100-line outlier. |
| `src/discord/discordActions.ts` | LOW | Six distinct responsibilities across 385 lines. |
| `src/github/github.ts` | MEDIUM | Mixes Express app creation, middleware definition, route registration, and server startup. |
| `src/github/githubHandlers.ts` | HIGH | Handlers are thin and focused. Each handler extracts minimal data and delegates to actions. |
| `src/github/githubActions.ts` | LOW | Mixes Octokit init, GitHub CRUD, body formatting, attachment processing, startup orchestration. |
| `src/github/webhookSignature.ts` | HIGH | Single responsibility: HMAC verification. Pure function, no side effects. |

---

## 5. Prioritized Issue List

| # | Issue | Files | Type | Priority |
|---|---|---|---|---|
| C-1 | logger.ts imports Discord client (circular risk, untestable) | `logger.ts`, `discord.ts` | Tight coupling | HIGH |
| C-2 / H-2 | logger.ts holds three unrelated responsibilities | `logger.ts` | Low cohesion | HIGH |
| C-3 | Bidirectional coupling between discord/ and github/ | `discordHandlers.ts`, `githubHandlers.ts`, `githubActions.ts` | Tight coupling | HIGH |
| C-4 | Global mutable store singleton accessed across 6 modules | `store.ts` + all action/handler files | Hidden coupling | HIGH |
| H-3 | discordActions.ts has six distinct responsibilities | `discordActions.ts` | Low cohesion | MEDIUM |
| H-4 | githubActions.ts conflates formatting, fetching, and CRUD | `githubActions.ts` | Low cohesion | MEDIUM |
| C-8 | githubActions imports stripImageMarkdown from discordActions | `githubActions.ts` | Wrong-direction dependency | MEDIUM |
| C-6 | discordActions mutates Thread entity state fields directly | `discordActions.ts` | Inappropriate intimacy | MEDIUM |
| C-7 | webhookCache/webhookQueue are module-level global state | `discordActions.ts` | Hidden coupling | MEDIUM |
| H-5 | handleClientReady has 100 lines of startup orchestration inline | `discordHandlers.ts` | Low cohesion | MEDIUM |
| H-7 | Store class is a false encapsulation with public mutable arrays | `store.ts` | Low cohesion | MEDIUM |
| C-5 | r2.ts reads process.env directly, bypassing config | `r2.ts`, `config.ts` | Unstable dependency | MEDIUM |
| C-9 | github.ts mixes app creation and server startup | `github.ts` | Mixed responsibility | LOW |
| H-1 | interfaces.ts mixes domain and GitHub API types | `interfaces.ts` | Mixed responsibility | LOW |
| H-6 | commentMap.ts hydrates Thread entities (wrong layer) | `commentMap.ts` | Wrong responsibility | LOW |

---

## 6. Pass 1 Summary

The most consequential structural problem is the **bidirectional dependency between the `discord/` and `github/` bounded contexts** (C-3), compounded by `store`, `logger`, and `discordActions` becoming de-facto global infrastructure that every module reaches into directly. The `logger.ts` → `discord.ts` import (C-1) is the highest-risk single line — a latent circular dependency that Node.js resolves non-deterministically based on import order.

Three modules drive the majority of coupling complexity: `discordActions.ts` (god module), `githubActions.ts` (god module), and `logger.ts` (wrong-home code). Fixing these three — by introducing `src/formatting.ts`, `src/events.ts`, `src/urls.ts`, a `ThreadRepository`, and a `WebhookManager` — would resolve 9 of the 15 issues listed above and prepare the codebase for Pass 2 (encapsulation + code smells).
