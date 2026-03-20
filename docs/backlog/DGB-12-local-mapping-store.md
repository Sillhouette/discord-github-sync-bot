---
spec_version: "1.0"
type: shaped-work
id: DGB-12
title: Replace Discord-URL join strategy with a local platform-agnostic mapping store
status: shaped
created: 2026-03-19
appetite: medium
priority: P1
target_project: discord-github-sync-bot
author: scout
depends_on: [DGB-1]
tags: [architecture, persistence, multi-platform, mapping-store]
acceptance_criteria:
  - id: AC-1
    description: src/mappingStore.ts (or src/domain/mappingStore.ts pre-DGB-10) persists thread↔issue mappings locally — not inside GitHub issue bodies
    status: pending
  - id: AC-2
    description: MappingStore entries use platform-neutral field names — externalId (VCS issue identifier), messagingThreadId (messaging platform thread identifier), platform (vcs source name), messagingPlatform (messaging platform name)
    status: pending
  - id: AC-3
    description: MappingStore includes a schemaVersion field — startup checks the version and runs a migration function before hydrating if the version is outdated
    status: pending
  - id: AC-4
    description: commentMap.json is superseded — comment ID mappings (commentId ↔ messageId) are stored in the MappingStore alongside thread mappings
    status: pending
  - id: AC-5
    description: Startup reconciliation (currently getIssues() + body scanning) reads the local MappingStore to restore thread state — no longer scans GitHub issue bodies for Discord URLs
    status: pending
  - id: AC-6
    description: GitHub issue bodies no longer contain embedded Discord URLs — the body is pure issue content
    status: pending
  - id: AC-7
    description: MappingStore writes are atomic (write-to-tmp + rename) matching the current commentMap.ts pattern
    status: pending
  - id: AC-8
    description: All existing sync behaviors (thread↔issue create, comment sync, archive/lock sync) continue to work correctly after migration
    status: pending
  - id: AC-9
    description: A one-time migration at startup detects pre-existing deployments (Discord URL present in issue bodies, no local mapping file) and offers a reconciliation path — either rebuild from GitHub API scan or start fresh with a warning
    status: pending
  - id: AC-10
    description: The migration function is tested with a fixture representing a GitHub issue body containing an embedded Discord URL — verifies the resulting MappingStore entry has correct messagingThreadId, externalId, and externalNumber values; this path runs exactly once per deployment and cannot be re-run, so test coverage is required before shipping
    status: pending
---

# DGB-12: Replace Discord-URL join strategy with a local platform-agnostic mapping store

## Problem

The current system uses a brittle and platform-specific join strategy: when a GitHub issue is created for a Discord thread, the bot embeds the Discord channel URL inside the GitHub issue body. At startup, the bot reconstructs its entire thread↔issue mapping by fetching all GitHub issues and scanning their bodies for `discord.com/channels/...` URLs.

This approach has three compounding problems:

**1. The join record lives in the wrong place**
GitHub is the database. If GitHub is unavailable at startup, the bot has no thread state. If GitHub API rate limits are hit during `getIssues()`, recovery is partial. This is a hard dependency on GitHub availability for a piece of state that the bot itself owns.

**2. It cannot generalize beyond GitHub**
A GitLab issue has no GitHub issue body. A Bitbucket issue has its own body field but the Discord URL scanning logic is coupled to the GitHub API response shape. Any second VCS source requires a different join strategy — meaning the current approach has no upgrade path for multi-platform support.

**3. `commentMap.json` is a separate persistence file with no schema version**
Comment ID mappings (`git_id ↔ discord_id`) are stored in a separate flat file with no version field. As the schema evolves (e.g., adding `vcs_platform` for multi-source support), existing deployments have no migration path and will silently produce incorrect behavior.

## Evidence

- `src/commentMap.ts` lines 1–22: flat `Record<string, { discord_id, node_id }>` with no `_schemaVersion` field
- `src/github/githubActions.ts` `getDiscordInfoFromGithubBody()`: regex scanning issue bodies for Discord URLs
- `src/github/githubActions.ts` `getIssueBody()`: embeds Discord URL in issue body on thread creation
- `src/store.ts` startup flow: rebuilds from `getIssues()` + body parsing
- Spike finding (2026-03-19): "Discord URL in GitHub body is the persistent join record" rated Critical feasibility risk for multi-platform

## Appetite & Boundaries

- **Appetite:** Medium
- **In scope:** New `MappingStore` replaces both `commentMap.ts` and the body-embedding join strategy; startup reconciliation reads from local store; schema versioning with v1 migration; migration path for existing deployments
- **No-gos:** Changing Discord API interactions, changing GitHub API interactions, adding multi-platform support (that is DGB-10's job — this item creates the foundation)
- **Schema design must be forward-compatible:** field names use `externalId` / `messagingThreadId` / `platform` — not `node_id` / `discord_id` / `github`

## Solution Sketch

```typescript
// src/mappingStore.ts

interface ThreadMapping {
  messagingThreadId: string;       // Discord thread ID (snowflake), or Slack ts, etc.
  messagingPlatform: string;       // 'discord' | 'slack' | 'teams'
  externalId: string;              // GitHub node_id, GitLab gid://, Bitbucket ID, etc.
  externalNumber: number;          // Human-readable issue number (for REST calls)
  vcsPlatform: string;             // 'github' | 'gitlab' | 'bitbucket'
  archived: boolean;
  comments: CommentMapping[];
}

interface CommentMapping {
  messageId: string;               // Messaging platform message ID
  externalCommentId: string;       // VCS comment ID
}

interface MappingStore {
  _schemaVersion: 1;
  threads: ThreadMapping[];
}

// Startup migration check
function loadMappingStore(): MappingStore {
  const raw = readOrInit();
  if (!raw._schemaVersion) {
    return migrateV0toV1(raw); // handles old commentMap.json + body scanning
  }
  return raw;
}
```

**Migration path for existing deployments (AC-9):**
If the local mapping file does not exist but GitHub issues with Discord URLs are found during startup reconciliation, the bot performs a one-time migration: scans GitHub issue bodies, builds the `ThreadMapping` entries, writes the local store, and logs a migration notice. After this, GitHub issue bodies are no longer used as the join record.

**No behavior change for consumers** beyond the one-time migration log notice. Existing synced threads continue to function.

## Risks & Assumptions

| Assumption | Type | Fastest Test |
|---|---|---|
| All existing thread↔issue mappings can be reconstructed from GitHub issue body scan | correctness | Test migration against a populated GitHub repo before switching |
| Atomic write (tmpFile + renameSync) is sufficient durability for a single-container deployment | feasibility | Existing commentMap.ts uses this pattern successfully |
| Schema v1 field names (`externalId`, `messagingThreadId`, `vcsPlatform`) are stable enough to commit to | architecture | Review against DGB-10 domain type design before finalising |
| Removing Discord URLs from issue bodies does not break any user workflows | correctness | Check if any consumers use the Discord URL in issue bodies for other purposes |

## Routing

- [x] **Architect** — Review schema field names against DGB-10 domain types before implementation; confirm migration path for existing deployments
- [x] **Crafter** — Implement MappingStore; replace commentMap.ts; update startup reconciliation; run full test suite after each phase
