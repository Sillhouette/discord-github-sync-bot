---
spec_version: "1.0"
type: shaped-work
id: DGB-8
title: Update aging dev dependencies and add pnpm audit to CI
status: shaped
created: 2026-03DGB-15
appetite: small
priority: P2
target_project: discord-github-sync-bot
author: architect
tags: [dependencies, ci, tooling, typescript]
acceptance_criteria:
  - id: AC-1
    description: "@typescript-eslint/eslint-plugin and @typescript-eslint/parser are upgraded from v6 to v8"
    status: pending
  - id: AC-2
    description: eslint is upgraded from v8 to v9 with flat config (eslint.config.js replacing .eslintrc)
    status: pending
  - id: AC-3
    description: typescript is upgraded from 5.4.x to 5.7.x
    status: pending
  - id: AC-4
    description: All existing tests pass after dependency upgrades
    status: pending
  - id: AC-5
    description: pnpm lint passes after upgrading ESLint and @typescript-eslint
    status: pending
---

# DGB-8: Update aging dev dependencies and add pnpm audit to CI

## Problem

Three dev toolchain packages are materially behind current versions, and CI has no vulnerability scanning step.

**@typescript-eslint v6 → v8 (MEDIUM — diagnose rank 12)**
`@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser` are at `^6.21.0`. v6 is end-of-life and does not support TypeScript 5.x type-level rules. The gap means real type-level issues (e.g., unsafe member access on discriminated unions introduced in TS 5.x) can produce false negatives in linting.

**ESLint v8 → v9 (MEDIUM — diagnose rank 12)**
ESLint v9 ships flat config (`eslint.config.js`). v8 uses the legacy `.eslintrc` format. Migrating now is straightforward; delaying makes the migration harder as v8 approaches EOL.

**TypeScript 5.4 → 5.7 (MEDIUM — diagnose rank 12)**
TS 5.7 includes improvements to type narrowing and control flow analysis that can catch errors 5.4 misses. Three minor versions behind is manageable now but grows as a gap.

## Evidence

- `package.json` devDependencies: `@typescript-eslint/*` at `^6.21.0`, `eslint` at `^8.57.0`, `typescript` at `^5.4.5`
- Diagnose report rank 12

## Appetite & Boundaries

- **Appetite:** Small (toolchain only; no production dependency changes)
- **In scope:** The three dependency upgrades listed above; flat config migration for ESLint v9

> **Note:** `pnpm audit --audit-level=high` in CI is owned by DGB-13 AC-6, which creates the CI workflow from scratch. DGB-8 does not need to create or modify the CI workflow — DGB-13 handles it. If DGB-13 has already landed, this item's scope is purely the toolchain upgrades (AC-1 through AC-3).
- **No-gos:** Upgrading production dependencies (discord.js, octokit, express), changing CI provider, adding new lint rules beyond what v8 enables

## Solution Sketch

ESLint v9 migration replaces `.eslintrc.*` with `eslint.config.js`:
```javascript
// eslint.config.js
import tseslint from 'typescript-eslint';
export default tseslint.config(
  ...tseslint.configs.recommended,
);
```

TypeScript upgrade: bump `"typescript": "^5.7.0"` in devDependencies. Run `pnpm install` and address any new type errors surfaced by improved narrowing.

## Risks & Assumptions

| Assumption | Type | Fastest Test |
|------------|------|--------------|
| ESLint v9 flat config is compatible with existing lint rules | feasibility | Run pnpm lint after migration and inspect output |
| TypeScript 5.7 does not introduce breaking changes to existing code | correctness | Run pnpm build after upgrade; check for new type errors |
| @typescript-eslint v8 is compatible with ESLint v9 | feasibility | Check @typescript-eslint v8 release notes |

## Routing

- [x] **Crafter** — Upgrade one package at a time; verify build and tests after each
