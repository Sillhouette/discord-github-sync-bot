---
spec_version: "1.0"
type: unshaped
id: DGB-16
title: GitLab adapter — VcsPort implementation for GitLab Issues
status: blocked
blocked_on: DGB-10
created: 2026-03-19
appetite: tbd
priority: tbd
target_project: discord-github-sync-bot
author: scout
tags: [feature, gitlab, vcs-adapter, multi-platform]
---

# DGB-16: GitLab adapter — VcsPort implementation for GitLab Issues

> **Status: Blocked on DGB-10.**
>
> This item cannot be shaped until `VcsPort` is defined and stable (DGB-10).
> When DGB-10 is complete, run a spike to answer the open questions below,
> then shape the implementation against the port interface.

## Intent

Implement a `VcsPort` adapter for GitLab so the bot can sync Discord forum threads
with GitLab Issues — enabling teams using GitLab as their version control and issue
tracker to use the bot without GitHub.

## Open Questions (spike before shaping)

1. **ID scheme:** GitLab uses integer `iid` (scoped per project) for REST calls and
   `gid://gitlab/Issue/<id>` for GraphQL. How does this map to `externalId` in the
   `VcsPort` interface? Does `listActiveIssues()` return both, or does the adapter
   normalize to one?

2. **Authentication:** GitLab uses personal access tokens and project access tokens
   via REST, plus OAuth for user-level access. How does this fit into `config.ts`
   alongside GitHub credentials? Can a single bot instance serve both GitHub and GitLab
   simultaneously, or is it one VCS source per deployment?

3. **Webhook signatures:** GitLab uses a simple token header (`X-Gitlab-Token`) rather
   than HMAC-SHA256. The existing `webhookSignature.ts` is GitHub-specific. How does
   the `github/server.ts` → `VcsPort` boundary handle signature verification per adapter?

4. **Label/tag API parity:** GitLab labels are project-scoped strings. GitHub labels
   map to Discord forum tags. Does GitLab's label API provide equivalent structure for
   the `handleOpened` tag-mapping logic?

5. **Missing REST operations:** GitLab does not have a direct "lock issue" REST endpoint
   equivalent to GitHub's `PATCH /issues/:number/lock`. How does `VcsPort.lockIssue()`
   get implemented for GitLab? (Options: note in thread, close+reopen with locked label,
   no-op with warning.)

6. **Startup reconciliation:** `listActiveIssues()` on GitHub scans issue bodies for
   Discord URLs (pre-DGB-12) or reads the local MappingStore (post-DGB-12). With
   MappingStore in place (DGB-12), this should work identically for GitLab — confirm
   the MappingStore `vcsPlatform: 'gitlab'` field is sufficient.

## Rough Shape (post-spike)

```
src/gitlab/
  server.ts          — Express route for GitLab webhook events
  webhookHandlers.ts — Translates gitlab webhook payloads → SyncService calls
  port.ts            — VcsPort implementation using GitLab REST/GraphQL API
  webhookSignature.ts — Token header verification (differs from GitHub HMAC)
```

## Dependencies

- DGB-10 (VcsPort interface must exist)
- DGB-12 (MappingStore must support vcsPlatform: 'gitlab')
