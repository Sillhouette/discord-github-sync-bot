---
type: spike-result
topic: Multi-platform sync engine abstraction
created: 2026-03-19
author: scout
---

# Spike: Multi-Platform Sync Engine Abstraction

## Spike Question

**What is the right abstraction boundary for a platform-agnostic sync engine?**

Specifically:
1. What are the platform-specific concepts that would break a naive "just add GitLab support" approach?
2. Where do GitHub, GitLab, and Bitbucket diverge in ways the domain model must account for?
3. Where do Discord, Slack, and Teams diverge in ways the messaging adapter must account for?
4. Is DGB-11's proposed `src/domain/syncService.ts` the right seam, or does the abstraction need to be different?
5. What are the riskiest assumptions in pursuing a "generic sync engine" vs. "Discord-GitHub bot with optional extras"?

---

## What We Found in the Current Domain Model (GitHub-specific concepts)

The current codebase has deep GitHub and Discord specificity woven into every layer. This is not a criticism — it is appropriate for a focused tool. The purpose of this audit is to surface exactly where that specificity lives before it gets frozen into DGB-11's port interfaces.

### `node_id` is a load-bearing GitHub-only concept

`node_id` (GitHub's GraphQL global identifier) appears in:

- `interfaces.ts` — `Thread.node_id?: string`
- `store.ts` — thread lookup by `node_id`
- `commentMap.ts` — `CommentEntry.node_id: string` (persisted to disk as a stable thread key)
- `githubActions.ts` — `createIssue()` writes back `thread.node_id`; `deleteIssue()` and `deleteComment()` dispatch GraphQL mutations using `node_id`
- `githubHandlers.ts` — every handler extracts `node_id` from the webhook payload to look up threads
- `discordActions.ts` — `getThreadChannel()`, `createComment()`, `updateComment()`, `archiveThread()`, `lockThread()` all take `node_id` as the primary lookup key

**Finding:** `node_id` is not a generic "VCS entity identifier". It is GitHub's GraphQL node identifier, mandatory for the `deleteIssue` mutation. It has no equivalent on GitLab (uses integer IIDs) or Bitbucket (uses integer IDs). The entire cross-platform comment mapping (`commentMap.json`) is keyed on `node_id` as the stable thread anchor. Any second VCS source would need its own identifier type — and a single `node_id?: string` field cannot represent both.

### The Discord URL is embedded in GitHub issue/comment bodies as the join key

`githubActions.ts` uses the presence of a `discord.com/channels/...` URL embedded in the GitHub issue body to:
1. Reconstruct the thread-to-issue mapping at startup (`formatIssuesToThreads`)
2. Skip echo-back comments that originated from the bot (`getDiscordInfoFromGithubBody`)
3. Populate comment mappings at startup (`fillCommentsData`)

This means the **Discord channel ID and Discord message ID are stored inside GitHub issue bodies** as the persistent join record. This is a Discord-specific encoding. A Slack or Teams deployment cannot use the same body format. There is no generic "messaging platform URL" — each platform has its own deep-link format.

**Finding:** The join record strategy (embedding the messaging platform URL in the VCS issue body) is clever for GitHub Issues but is coupling the data model to both GitHub and Discord simultaneously. It also relies on GitHub rendering URLs in issue bodies — a property of GitHub's editor, not a general VCS property.

### `number` (integer issue number) is a secondary REST key, `node_id` is the primary GraphQL key

The `Thread` interface carries both `number?: number` (used for REST API calls: create, close, lock, comment) and `node_id?: string` (used for GraphQL: delete, and as the cross-platform join key). This dual-key pattern is GitHub-specific:

- GitHub REST API uses integer issue numbers
- GitHub GraphQL API uses `node_id` strings
- GitLab REST API uses integer IIDs (scoped per project, not global)
- Bitbucket uses integer IDs scoped per repository

Neither GitLab nor Bitbucket has a concept analogous to `node_id`. A generic `VcsIssueRef` would need a different identity structure for each source.

### Discord-specific threading model embedded in domain state

`Thread.appliedTags: string[]` is a Discord Forum Channel concept. Forum channels in Discord have user-defined tags (like GitHub labels but Discord-native). The bot maps Discord tags to GitHub labels bidirectionally.

`Thread.lockArchiving` and `Thread.lockLocking` are workaround flags invented specifically for Discord's forum thread behaviour: Discord auto-archives closed threads when a message is posted, causing a false "reopened" event. These flags exist to suppress that echo. They are Discord-specific state with no equivalent in Slack or Teams.

### `getDiscordUrl` and `getGithubUrl` live in `logger.ts`

Both URL formatters are hardcoded in `logger.ts` and reference `config.DISCORD_CHANNEL_ID` and `config.GITHUB_USERNAME / GITHUB_REPOSITORY` directly. These are not injectable or platform-agnostic.

### Config is wired to a single GitHub repo and a single Discord channel

`config.ts` defines exactly one `DISCORD_CHANNEL_ID` and one `GITHUB_REPOSITORY`. There is no concept of a routing table. Every handler uses `config.DISCORD_CHANNEL_ID` as a hard filter. Adding even a second Discord channel (let alone a second platform) requires the config to understand routing.

---

## Platform Divergence Analysis

### Issue Trackers

#### ID Schemes

| Platform | Primary ID | Global ID | Notes |
|----------|-----------|-----------|-------|
| GitHub Issues | `number` (integer, per-repo) | `node_id` (GraphQL string) | Two IDs required: REST uses number, GraphQL uses node_id |
| GitHub Discussions | `number` (integer) | `node_id` (GraphQL string) | Same dual-key scheme as Issues, but separate namespace |
| GitLab Issues | `iid` (integer, per-project) | `id` (integer, global across instance) | No node_id equivalent; GraphQL uses `gid://gitlab/Issue/{id}` URIs |
| Bitbucket Issues | `id` (integer, per-repo) | No global ID | REST only; no GraphQL API for issues |

**Domain impact:** The `Thread` type's `node_id?: string` field cannot serve as a universal VCS entity identifier. A generic domain needs a `VcsRef` type with at minimum `{ platform: 'github' | 'gitlab' | 'bitbucket', id: string | number, platformSpecific?: Record<string, unknown> }` — or separate typed refs per platform that share an interface.

#### Authentication Models

| Platform | Primary Auth | Webhook Auth |
|----------|-------------|--------------|
| GitHub | PAT / GitHub App (Octokit) | HMAC-SHA256 signature header `X-Hub-Signature-256` |
| GitLab | PAT / OAuth2 / Deploy token | `X-Gitlab-Token` secret token header (not HMAC) |
| Bitbucket | App passwords / OAuth2 | `X-Hub-Signature` header (SHA256 with shared secret) |

**Domain impact:** The current `webhookSignature.ts` is a GitHub-specific HMAC verifier. A generic webhook receiver needs a signature verification strategy per source. The verification algorithm is not just a config value — GitLab uses a simple equality check, not HMAC.

#### Webhook Payload Shape

The GitHub webhook payload shape is deeply assumed in `githubHandlers.ts`:
- `req.body.issue.node_id` — not present on GitLab (`req.body.object_attributes.iid`)
- `req.body.issue.labels` — GitLab uses `req.body.labels` with a different structure
- `req.body.comment.id` (integer) — GitLab uses `req.body.object_attributes.id`
- `req.body.issue.user.avatar_url` — GitLab provides this but nested differently

**Finding:** Webhook payloads are not normalizable by simple field mapping. The structural divergence is deep enough that each source platform needs its own webhook handler (the current `githubHandlers.ts` pattern), with normalization to a common domain event type happening inside the handler before the domain is called. DGB-11's proposed `webhookHandlers.ts` is the right place for this normalization — but the domain event types it emits must be generic, not GitHub-shaped.

#### Concepts That Exist Only on GitHub

- **`node_id` for GraphQL mutations** — Issue/Discussion deletion requires the GraphQL API (`deleteIssue` mutation) which takes `node_id`. No GitLab/Bitbucket equivalent.
- **Lock reason** — GitHub supports a lock reason (off-topic, too heated, resolved, spam). The current bot ignores it, but it exists.
- **Labels vs. Tags** — GitHub labels have a `color` and `description`. The bot maps them to Discord forum tags by name.

#### Concepts That Exist Only on GitLab

- **Namespace/project structure** — GitLab uses `namespace/project` path structure. API calls require both. No equivalent in GitHub (owner/repo is conceptually similar but structurally different in API).
- **Confidential issues** — GitLab issues can be marked confidential. No GitHub equivalent.
- **Issue type** (bug, incident, test case) — GitLab-specific.
- **Milestone** — Both GitHub and GitLab have milestones, but the API structures differ.

#### Concepts That Exist Only on Bitbucket

- **REST-only API** — Bitbucket Cloud has no GraphQL API. Issue deletion is a REST call. No `node_id` concept whatsoever.
- **Issue priority** — Bitbucket has explicit priority fields (blocker, critical, major, minor, trivial).
- **Components** — Bitbucket issues have a component field (similar to GitHub labels but separate).
- **Assignee limit** — Bitbucket allows only one assignee; GitHub allows multiple.

#### Comment Threading Model

| Platform | Comment Model | Edit/Delete |
|----------|--------------|-------------|
| GitHub | Flat comments on issues; threaded replies in Discussions | Edit/delete via REST or GraphQL |
| GitLab | Flat comments (notes) on issues; threaded "discussions" on MRs | Edit/delete via REST |
| Bitbucket | Flat comments on issues | Edit/delete via REST |

**Finding:** For the issue sync use case, all three platforms converge on flat comments. Comment threading is a Discussions-specific concern (DGB-15), not a general multi-platform concern for the basic issue sync.

---

### Messaging Platforms

#### Thread and Channel Model

| Platform | Structure | Bot Interaction |
|----------|-----------|----------------|
| Discord | Forum Channel → Forum Thread → Messages | Bot token + discord.js; webhook for impersonation |
| Slack | Channel → Thread (reply chain on a message) | Bot token + Web API; incoming webhooks (limited) |
| Teams | Channel → Post → Replies | Bot token + Bot Framework or Graph API; incoming webhooks (basic) |

**Critical divergence:** Discord Forum Channels are the only first-class "forum thread" primitive. A Discord Forum Thread is a first-class object with its own ID, name, tags, archived state, and locked state.

Slack does not have "threads" as first-class objects. A Slack thread is a reply chain hanging off a parent message. The parent message IS the thread. There is no separate "thread ID" — only the message timestamp (`ts`) of the parent message.

Teams channels have posts and replies. A "post" is closer to a Discord thread than a Slack parent message, but Teams uses a Graph API conversation model that differs from both.

**Domain impact:** The current `Thread` type maps cleanly to a Discord Forum Thread. A generic "conversation" concept would need to abstract: the container (forum channel / Slack channel / Teams channel), the thread anchor (Discord thread / Slack parent message `ts` / Teams post ID), and the reply type (Discord message / Slack reply / Teams reply).

#### Webhook vs. Bot Token Authentication

| Platform | Auth Model | Impersonation |
|----------|-----------|--------------|
| Discord | Bot token (discord.js) + per-channel Webhooks | Webhooks allow custom name + avatar per-message |
| Slack | Bot token (OAuth2) | Display name changeable per-message via `username` field in `chat.postMessage` |
| Teams | Bot token (Bot Framework / Entra ID app) | No per-message impersonation; all messages from the bot identity |

**Finding:** Discord's webhook impersonation (posting as "John Smith (GitHub)" with John's avatar) has no equivalent in Teams. Teams messages always appear as the bot identity. This affects the UX promise of the bot significantly — Teams consumers would not get the "who said what on GitHub" visual identity in the Discord thread.

#### Message Edit and Delete Capabilities

| Platform | Edit | Delete | Constraints |
|----------|------|--------|-------------|
| Discord | `webhook.editMessage()` | `webhook.deleteMessage()` or `message.delete()` | Webhook messages: requires webhook that created them |
| Slack | `chat.update` | `chat.delete` | Requires message `ts`; bot can only edit its own messages |
| Teams | Graph API `PATCH /messages/{id}` | Graph API `DELETE /messages/{id}` | Complex permissions; edit content only, not metadata |

**Finding:** The current Discord implementation uses webhooks for comment impersonation, and stores the Discord message ID (`ThreadComment.id`) to support later edits. This pattern works because Discord webhooks are editable. Slack's equivalent would store the message `ts`. Teams requires a different edit mechanism entirely. The `ThreadComment` type currently stores `{ id: string, git_id: number }` — the `id` is a Discord message snowflake. A generic comment ref needs to be platform-typed.

#### Discord-Specific Behaviors the Domain Currently Works Around

1. **Auto-unarchive on message post** — Discord auto-unarchives a thread when any message is posted. The current code detects this and re-archives (`thread.lockArchiving`). Slack and Teams do not have this behavior.
2. **Forum tag ↔ GitHub label mapping** — `store.availableTags: GuildForumTag[]` holds Discord-specific tag objects. No Slack or Teams equivalent.
3. **Webhook per forum channel** — Discord requires one webhook per forum channel for impersonation. Slack uses `chat.postMessage` with `username` override. Teams does not support this.
4. **2000 character message limit** — Discord's limit drives `truncateContent()`. Slack has a different limit (varies by API). Teams has yet another.
5. **Webhook queue for rename serialisation** — The `webhookQueue` in `discordActions.ts` exists because Discord webhook rename + send must be serialised to avoid avatar/name races. This is a Discord-specific concurrency concern.

#### Rate Limiting

| Platform | Rate Limit Model |
|----------|----------------|
| Discord | Per-route bucket limits; 429 responses with `retry_after`; global limit of 50 req/s |
| Slack | Tier-based (1–4); Tier 1 = 1 req/min, Tier 3 = 50+ req/min |
| Teams | Graph API: 10,000 req/10min per app; additional throttling per resource |

**Finding:** Rate limit strategies are platform-specific enough that each adapter needs its own retry/backoff logic. A generic port interface should not try to abstract rate limits — it should let adapters handle them internally.

---

## DGB-11 Assessment — Sufficient or Needs Redesign?

### What DGB-11 Gets Right

The proposed Ports & Adapters split is the correct structural move. Breaking the bidirectional coupling between `discord/` and `github/` is necessary regardless of whether multi-platform support is added. The proposed `domain/syncService.ts` seam is the right place for cross-cutting sync logic.

The proposed `SyncService` constructor:

```typescript
constructor(
  private discord: DiscordPort,
  private github: GitHubPort,
  private store: ThreadRepository,
  private comments: CommentRepository,
)
```

...is a correct dependency inversion for the two-platform case.

### Where DGB-11's Design Breaks for Multi-Platform

**1. The `SyncService` method signatures are GitHub-typed, not VCS-typed.**

The proposed interface:

```typescript
async onIssueOpened(issue: GitIssue): Promise<void>
async onIssueClosed(nodeId: string): Promise<void>
async onIssueLocked(nodeId: string): Promise<void>
async onCommentCreated(nodeId: string, commentId: number, body: string, login: string, avatarUrl: string): Promise<void>
```

`nodeId: string` as the primary VCS entity identifier is GitHub-specific. A GitLab adapter would pass an `iid: number` and a `projectPath: string`. The `commentId: number` is also GitHub's integer comment ID; GitLab uses integers too but the field name `commentId` and parameter position assume a single integer key.

**2. The `GitHubPort` is a named single-platform dependency in `SyncService`.**

```typescript
constructor(
  private discord: DiscordPort,
  private github: GitHubPort,  ← named as GitHub
  ...
)
```

Adding GitLab support means either:
- Renaming to `vcs: VcsPort` and using a single port interface (requires all VCS platforms to share one interface — possible but constraining)
- Or injecting `vcs: VcsPort[]` (a registry of sources) — which changes the SyncService routing logic fundamentally

**3. The `DiscordPort` is still named as a single platform.**

Same issue as GitHub: `discord: DiscordPort` binds the service to a single messaging platform. For multi-platform messaging, this becomes `messaging: MessagingPort` or `messaging: MessagingPort[]`.

**4. `node_id` is still in the domain event signatures.**

`onIssueClosed(nodeId: string)` — this `nodeId` is the primary thread identifier throughout the domain. The `Thread` store (ThreadRepository) currently looks up threads by `node_id`. For GitLab, the equivalent would be a different type of identifier.

The `Thread` domain type itself needs a platform-agnostic primary identifier for thread lookup — not `node_id` which is a GitHub artifact.

**5. DGB-11's proposed `SyncService` interface is a direct extraction of current code, not a redesign.**

Looking at the method signatures, every `onIssue*` method maps 1:1 to a GitHub webhook event. This is correct for DGB-11's stated goal (Ports & Adapters restructure without behavior change) but would freeze in GitHub-specific event semantics.

### What Would Need to Change in DGB-11 to Support GitLab as a Second VCS

1. **Replace `GitHubPort` with `VcsPort`** — a platform-agnostic interface covering `createIssue`, `closeIssue`, `lockIssue`, `createComment`, `editComment`, `deleteComment`, `deleteIssue`. Both the GitHub and GitLab adapters implement this interface.

2. **Replace `node_id: string` with a generic `VcsEntityId`** — an opaque identifier that each VCS adapter knows how to resolve. The domain stores and passes it as an opaque `string` or structured `{ platform: string; id: string }`. The adapter handles its own identity scheme.

3. **Replace `DiscordPort` with `MessagingPort`** — similar abstraction for the messaging side.

4. **Replace the `Thread.node_id` field name** — it should be `vcsId: string` or `externalId: string` in the domain to avoid GitHub vocabulary in the core type.

5. **Replace the join-key strategy** — the current approach embeds the Discord URL in the GitHub issue body. A platform-agnostic join requires the `ThreadRepository` to be the authoritative source of truth (stored on disk or in a database), not GitHub issue bodies. This is a data model change, not just a naming change.

---

## Riskiest Assumptions (Ranked)

### Rank 1 — Feasibility: The Discord URL embedded in GitHub bodies is the persistent join record (CRITICAL)

**Type:** Feasibility
**Risk:** The current persistence strategy stores the Discord thread identity *inside* the GitHub issue body. The bot reconstructs the thread-to-issue mapping at startup by scanning all GitHub issues for embedded Discord URLs. This strategy works for a single deployment targeting one Discord forum and one GitHub repo. For multi-platform support:
- A Slack deployment would embed a Slack URL in the VCS issue body — but the pattern for each platform's URL is different and must be recognized separately.
- A Teams deployment embeds a different URL format.
- GitLab stores issue bodies differently and may sanitize URLs.
- This strategy has no explicit "mapping table" — it distributes state across thousands of VCS issue bodies. Migrating to a new join strategy after launch (e.g., a local database) would require scanning all existing issues.

**Counter-evidence:** For the OSS self-hosted use case, users control their own GitHub repos and Discord servers, so the embedded URL approach is reliable within that scope. It has been working in production.

**Why this is #1:** Any multi-platform expansion requires rethinking this join strategy before anything else. It is not an adapter concern — it is a data model concern that affects the `ThreadRepository` and `CommentRepository` abstractions in DGB-11.

---

### Rank 2 — Feasibility: `node_id` is used for GraphQL issue deletion — no equivalent on GitLab/Bitbucket (HIGH)

**Type:** Feasibility
**Risk:** The `deleteIssue` operation uses a GitHub GraphQL mutation that requires `node_id`. GitLab and Bitbucket do not have `node_id`. Deleting a GitLab issue uses `DELETE /projects/:id/issues/:issue_iid` (REST). Bitbucket uses `DELETE /2.0/repositories/{workspace}/{repo_slug}/issues/{issue_id}` (REST). These are implementable — but they require the delete operation to use a different identifier type per platform. The `VcsPort.deleteIssue(id)` interface must be designed so each adapter can accept its native ID form.

**Counter-evidence:** This is an implementable interface design problem, not a fundamental blocker. The domain stores a `vcsId` opaque string; each adapter knows its own resolution strategy.

---

### Rank 3 — Value: Teams consumers will not get visual impersonation (HIGH)

**Type:** Value
**Risk:** The bot's core UX value is "messages in Discord look like they came from the GitHub user, with their avatar." This is achieved via Discord webhooks. Microsoft Teams does not support per-message username/avatar overriding — all messages appear as the bot identity. Teams consumers get a degraded experience relative to Discord consumers. If Teams is a first-class target, the product promise needs to be different: "messages from {VCS platform} appear in your Teams channel" rather than "messages from {username} appear in your Teams channel."

**Counter-evidence:** Teams is used in enterprise contexts where the bot identity is clear. The message *content* still conveys who said what. This may be acceptable.

---

### Rank 4 — Viability: A generic sync engine requires a maintained SDK for each platform combination (HIGH)

**Type:** Viability
**Risk:** The current bot uses `@octokit/rest` and `@octokit/graphql` for GitHub, and `discord.js` for Discord. Adding GitLab requires `@gitbeaker/node` or manual REST calls. Adding Bitbucket requires its own client. Adding Slack requires `@slack/web-api`. Adding Teams requires `@microsoft/teams-js` or the Graph API client. Each SDK has its own release cycle, deprecation patterns, and auth model. Maintaining 3 VCS adapters × 3 messaging adapters = 9 possible integration combinations at library level is a significant ongoing burden for an OSS project.

**Counter-evidence:** Many of these SDKs are stable and low-maintenance. The adapter pattern contains the blast radius of SDK changes.

---

### Rank 5 — Feasibility: GitLab's webhook signature verification is not HMAC (MODERATE)

**Type:** Feasibility
**Risk:** GitHub uses HMAC-SHA256 for webhook verification (`X-Hub-Signature-256`). GitLab uses a secret token header (`X-Gitlab-Token`) compared with `===`. These are different security models. The generic webhook receiver must dispatch to the correct signature verifier per source platform before trusting the payload.

**Counter-evidence:** This is a straightforward adapter concern. The webhook router checks the source header (GitHub sends `X-GitHub-Event`, GitLab sends `X-Gitlab-Event`) and dispatches to the right verifier. It does not affect the domain.

---

### Rank 6 — Value: The Discord forum tag ↔ GitHub label bidirectional sync has no equivalent in Slack or Teams (MODERATE)

**Type:** Value
**Risk:** One of the bot's features is mapping Discord Forum tags to GitHub labels. Slack channels have no tag system. Teams channels have no equivalent either. If label sync is a valued feature, it becomes Discord+GitHub specific and cannot be generalized. The domain model currently stores `Thread.appliedTags: string[]` as Discord tag IDs.

**Counter-evidence:** Label-to-tag mapping is an optional feature. Core sync (thread ↔ issue, message ↔ comment) can work without it.

---

### Rank 7 — Usability: JSON env var config for multi-channel routing is fragile (LOW-MODERATE)

**Type:** Usability
**Risk:** DGB-15 notes that `CHANNEL_CONFIGS=[{"channelId":"123","target":"issues"}]` is error-prone in Docker Compose, GitHub Actions, and `.env` files. Multiplied across platform pairs, this config surface becomes unwieldy. A multi-platform bot needs a config file (YAML/TOML) rather than environment variables.

**Counter-evidence:** Many self-hosted bots (e.g., Matrix bridges) use config files. This is a precedent users can follow. The engineering cost is low.

---

### Rank 8 — Viability: Multi-platform support fragments the product identity (LOW-MODERATE)

**Type:** Viability
**Risk:** The current bot is simple and focused: "Discord ↔ GitHub Issues, you configure it with 5 env vars." Adding multi-platform support could mean "you configure it with a YAML file, choose your VCS, choose your messaging platform, and it works" — or it could mean "it's harder to set up with fewer clear examples." OSS projects succeed when onboarding is frictionless. A generic engine may increase setup complexity enough to deter the target user (self-hosted, small to medium OSS community).

**Counter-evidence:** The project owner has explicitly stated this is the direction. The risk is real but accepted.

---

## Recommendation

### DGB-11 should proceed as designed — with one targeted modification

DGB-11's Ports & Adapters restructure is correct and necessary. It should not be blocked on full multi-platform generalization. However, **one change is recommended before implementation begins:**

**Replace all occurrences of `node_id` in domain-layer types and `SyncService` method signatures with `externalId: string`.**

This is a low-risk, low-cost change that:
- Removes a GitHub vocabulary term from the domain model
- Makes the seam future-proof without requiring any new platform support yet
- Costs approximately 20-30 line changes in types and handler calls

Everything else in DGB-11 can be delivered as-is. The `GitHubPort` and `DiscordPort` interface names are fine for now — they are adapter names, not domain names.

### The join-key strategy must be redesigned before any second VCS source is added

The embedded-Discord-URL-in-GitHub-issue-body strategy is the single most load-bearing assumption in the current architecture. Before GitLab or Bitbucket support is added, the `ThreadRepository` must become the authoritative source of identity mapping, persisted locally. The commentMap already does this for comments — the same pattern needs to cover threads.

This is a pre-requisite for any multi-VCS work, not something to address at implementation time.

### "Generic sync engine" vs. "Discord-GitHub bot with optional extras"

The riskiest path is attempting full genericity in one phase. The recommended path is incremental adapter addition:

1. **Phase 1 (DGB-11 + DGB-11 mod):** Ports & Adapters restructure, swap `node_id` → `externalId` in domain. No new platform support.
2. **Phase 2 (DGB-15):** GitHub Discussions as a second VCS *target* (same GitHub source, different endpoint). Lower complexity than a second VCS *source*.
3. **Phase 3:** Replace join-key strategy with a proper local mapping store.
4. **Phase 4:** Add GitLab adapter. At this point the abstract `VcsPort` interface and `MessagingPort` interface become real contracts enforced by two implementations.

This path avoids the trap of designing a generic interface with only one concrete implementation, where the "genericity" is speculative.

---

## Impact on Existing Backlog (DGB-1 through DGB-15)

| Item | Impact |
|------|--------|
| DGB-1 (ThreadRepository) | Unaffected. Proceed. The ThreadRepository abstraction is correct and needed. |
| DGB-2 (Deduplication) | Unaffected. Proceed. |
| DGB-3 (Config) | Moderate. The config layer will need redesign for multi-channel routing (DGB-15 Option B). The DGB-3 changes should not hard-code assumptions about a single channel+single platform pair. |
| DGB-4 (Surface area) | Unaffected. Proceed. |
| DGB-5 through DGB-9 | Unaffected. Proceed. |
| DGB-11 (Ports & Adapters) | Recommend one modification: rename `node_id` to `externalId` in domain types and `SyncService` signatures. All other design decisions are sound. |
| DGB-15 (Discussions routing) | This spike reinforces that Discussions routing is lower complexity than a second VCS source (same GitHub auth, same node_id scheme, same Octokit client). The join-key question (how does the bot identify which GitHub Discussion corresponds to a Discord thread at startup?) still needs to be answered in the DGB-15 spike, as Discussions cannot use the same `formatIssuesToThreads` body-scanning approach without modification. |
