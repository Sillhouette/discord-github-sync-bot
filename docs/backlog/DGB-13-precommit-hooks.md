---
spec_version: "1.0"
type: shaped-work
id: DGB-13
title: Pre-commit hooks — Husky + lint-staged + pre-push test gate
status: shaped
created: 2026-03-19
appetite: small
priority: P2
target_project: discord-github-sync-bot
author: scout
tags: [ci, guardrails, tooling, contributors]
acceptance_criteria:
  - id: AC-1
    description: Husky is installed and initialised — .husky/ directory committed to the repo with hooks executable
    status: pending
  - id: AC-2
    description: pre-commit hook runs lint-staged — ESLint + Prettier check on staged .ts files only (not the full codebase)
    status: pending
  - id: AC-3
    description: pre-push hook runs pnpm test — full Vitest suite must pass before a push is allowed
    status: pending
  - id: AC-4
    description: lint-staged config is in package.json (not a separate file) — staged .ts files run eslint --fix and prettier --write
    status: pending
  - id: AC-5
    description: A minimal GitHub Actions workflow (.github/workflows/ci.yml) runs pnpm test on pull_request events — protects the repo for contributors who do not have local hooks configured
    status: pending
  - id: AC-6
    description: pnpm audit --audit-level=high runs in the GitHub Actions CI workflow — fails the build on high-severity dependency vulnerabilities
    status: pending
  - id: AC-7
    description: CONTRIBUTING.md documents the pre-commit hook setup and how to bypass hooks in an emergency (--no-verify with explicit warning)
    status: pending
---

# DGB-13: Pre-commit hooks — Husky + lint-staged + pre-push test gate

## Problem

The project has no automated quality gate before code enters the repository. There is no CI pipeline (no `.github/workflows/` exists) and no pre-commit hooks. This means:

- Lint or type errors can be committed and pushed without detection
- A breaking change to the test suite is caught only when another contributor runs `pnpm test` locally
- External contributors submitting PRs have no automated feedback
- The `pnpm audit` step recommended in DGB-8 has no CI home

The project is open source, so consumers and contributors will fork and run this code. A quality gate protects both the maintainer and contributors.

## Context

The project does not host its own deployment from this repository — consumers deploy their own instances. Therefore CI is sufficient; CD (automated deployment) is out of scope. Pre-commit hooks are the primary gate for the maintainer; GitHub Actions CI is the safety net for contributors who don't have hooks configured.

## Appetite & Boundaries

- **Appetite:** Small
- **In scope:** Husky + lint-staged pre-commit; pre-push test run; GitHub Actions CI for PRs; pnpm audit in CI; CONTRIBUTING.md update
- **No-gos:** Docker image building in CI, deployment automation, coverage reporting, branch protection rules (those are repo settings, not code)

## Solution Sketch

```bash
# Install
pnpm add -D husky lint-staged
pnpm exec husky init
```

```json
// package.json additions
{
  "lint-staged": {
    "*.ts": ["eslint --fix", "prettier --write"]
  },
  "scripts": {
    "prepare": "husky"
  }
}
```

```sh
# .husky/pre-commit
pnpm exec lint-staged

# .husky/pre-push
pnpm test
```

```yaml
# .github/workflows/ci.yml
name: CI
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm audit --audit-level=high
```

## Risks & Assumptions

| Assumption | Type | Fastest Test |
|---|---|---|
| pnpm test runs fast enough for a pre-push hook to be tolerable | usability | Time the full suite — Vitest is fast; acceptable if under ~10s |
| lint-staged --fix on staged files does not silently stage additional changes | correctness | Test with a deliberate lint error and verify staged file set after hook |
| GitHub Actions CI does not require repo secrets for the test suite | feasibility | Tests use vi.mock — no real Discord/GitHub credentials needed |

## Routing

- [x] **Crafter** — Install Husky; add pre-commit and pre-push hooks; add GitHub Actions workflow; update CONTRIBUTING.md
