---
spec_version: "1.0"
type: shaped-work
id: DGB-14
title: Annotate cleanup docs with forward-reference notice pointing to DGB-11
status: shaped
created: 2026-03-19
appetite: trivial
priority: P3
target_project: discord-github-sync-bot
author: scout
tags: [documentation, cleanup, housekeeping]
acceptance_criteria:
  - id: AC-1
    description: docs/cleanup/20260315_coupling_cohesion_pass1.md has a header notice explaining that remedy paths (src/domain/, src/infrastructure/, src/formatting.ts, etc.) reference DGB-11's planned target structure and do not yet exist
    status: pending
  - id: AC-2
    description: docs/cleanup/20260315_encapsulation_smells_pass2.md has a header notice explaining that src/textUtils.ts references DGB-4's planned output and does not yet exist
    status: pending
  - id: AC-3
    description: Both notices include a link to the relevant backlog item (DGB-11 or DGB-4) so a reader can navigate to the execution plan
    status: pending
---

# DGB-14: Annotate cleanup docs with forward-reference notice pointing to DGB-11

## Problem

The DX Coach report flagged 21 "broken path references" across two cleanup analysis documents. On investigation, these are not broken references — they are intentional forward references to the target structure planned in DGB-11 (Ports & Adapters restructure) and DGB-4 (surface area reduction).

A contributor reading `docs/cleanup/20260315_coupling_cohesion_pass1.md` and trying to find `src/domain/thread.ts` or `src/formatting.ts` will not find them. The connection between the cleanup docs and the backlog items that execute their remedies is implicit, not documented.

## Evidence

- `docs/cleanup/20260315_coupling_cohesion_pass1.md`: references `src/domain/`, `src/infrastructure/`, `src/formatting.ts`, `src/discord/webhookManager.ts`, `src/github/issueFormatter.ts` — all DGB-11 planned output
- `docs/cleanup/20260315_encapsulation_smells_pass2.md`: references `src/textUtils.ts` — DGB-4 planned output

## Appetite & Boundaries

- **Appetite:** Trivial (two file edits, ~10 minutes)
- **In scope:** Add header notice to two files; no content changes
- **No-gos:** Rewriting remedy paths, executing DGB-11, deleting the cleanup docs

## Solution Sketch

Add to the top of each affected file (below frontmatter if present, above the first heading):

```markdown
> **Note:** Remedy paths in this document (e.g., `src/domain/`, `src/infrastructure/`,
> `src/formatting.ts`) reference the target structure defined in
> [DGB-11](../backlog/DGB-11-ddd-ports-adapters-restructure.md) (Ports & Adapters
> restructure, status: shaped). These files do not yet exist. See DGB-11 for the
> full migration plan and execution order.
```

For `encapsulation_smells_pass2.md`:

```markdown
> **Note:** `src/textUtils.ts` referenced in EV-4 remedies is the planned output of
> [DGB-4](../backlog/DGB-4-discord-actions-surface-area.md) (surface area reduction,
> status: shaped). It does not yet exist.
```

## Routing

- [x] **Crafter** — Two file edits; no tests required
