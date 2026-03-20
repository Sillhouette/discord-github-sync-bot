---
spec_version: "1.0"
type: shaped-work
id: DGB-3
title: Consolidate config — move PORT and Cloudflare credentials into config.ts, unexport octokit
status: shaped
created: 2026-03DGB-15
appetite: small
priority: P1
target_project: discord-github-sync-bot
author: architect
tags: [refactor, config, security, credentials]
acceptance_criteria:
  - id: AC-1
    description: PORT is read from config.ts, not directly from process.env in github.ts
    status: pending
  - id: AC-2
    description: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are declared in config.ts as optional fields with startup warnings when R2 env vars are partially set
    status: pending
  - id: AC-3
    description: r2.ts reads all four Cloudflare credentials from config, not from process.env directly
    status: pending
  - id: AC-4
    description: octokit and repoCredentials are not exported from githubActions.ts
    status: pending
  - id: AC-5
    description: console.log in github.ts is replaced with logger.info
    status: pending
  - id: AC-6
    description: All existing tests continue to pass
    status: pending
---

# DGB-3: Consolidate config — move PORT and Cloudflare credentials into config.ts, unexport octokit

## Problem

Three configuration violations break the "one config source" invariant established by `config.ts`:

**1. PORT read directly in github.ts (diagnose item 7)**
```typescript
const PORT = process.env.PORT || 5000;
```
Every other env var goes through `config.ts`. `PORT` is invisible to the config layer and its startup validation. A missing or malformed PORT produces no startup warning.

**2. Cloudflare credentials read directly in r2.ts (EV-6, C-5)**
`r2.ts` calls `process.env` inside `getCredentials()` for all four Cloudflare vars. Two of them (`R2_BUCKET`, `R2_CDN_BASE_URL`) are already partially modelled in `config.ts` but not used by `r2.ts`. The other two (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`) are completely invisible to the startup validation layer. A misconfigured Cloudflare credential silently fails at runtime — the function returns `null` and image uploads degrade with no operator indication.

**3. octokit and repoCredentials exported unnecessarily (EV-2)**
```typescript
export const octokit = new Octokit({ auth: config.GITHUB_ACCESS_TOKEN });
export const repoCredentials = { owner: ..., repo: ... };
```
Neither is imported anywhere else in the codebase. Exporting `octokit` — a credentialed HTTP client carrying the GitHub token — as a public module symbol violates least privilege. Any future module can bypass the `githubActions` façade and call the GitHub API directly.

## Evidence

- `src/github/github.ts` line 82: `process.env.PORT`
- `src/github/github.ts` line 84: `console.log(...)` bypassing winston
- `src/r2.ts` lines 9–14: `process.env` read for all four Cloudflare vars
- `src/github/githubActions.ts` lines 29–43: `export const octokit`, `export const repoCredentials`
- Pass 1 finding C-5; Pass 2 findings EV-2, EV-6; Diagnose items 7, 8

## Appetite & Boundaries

- **Appetite:** Small (isolated changes across config.ts, github.ts, r2.ts, githubActions.ts)
- **In scope:** Add PORT and Cloudflare vars to config.ts; update r2.ts and github.ts to consume from config; remove exports from githubActions.ts
- **No-gos:** Changing R2 upload behavior, adding new config validation framework, changing the startup warning format

## Solution Sketch

```typescript
// config.ts additions:
export const PORT = parseInt(process.env.PORT ?? '5000', 10);
export const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
export const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
// R2_BUCKET and R2_CDN_BASE_URL already present — ensure r2.ts uses them

// Optional-group guard: if any R2 var is set, all must be set
if ([R2_BUCKET, R2_CDN_BASE_URL, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN]
    .some(Boolean) &&
    [R2_BUCKET, R2_CDN_BASE_URL, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN]
    .some(v => !v)) {
  console.warn('[CONFIG] Partial R2 configuration detected — image re-hosting disabled');
}
```

`r2.ts` removes `getCredentials()` and reads from config. `github.ts` replaces `process.env.PORT` with `config.PORT` and `console.log` with `logger.info`. `githubActions.ts` removes `export` from `octokit` and `repoCredentials`.

## Risks & Assumptions

| Assumption | Type | Fastest Test |
|------------|------|--------------|
| No external module imports octokit or repoCredentials from githubActions | correctness | grep for these imports across src/ |
| PORT=5000 default is correct and consistent with docker-compose | correctness | Check docker-compose.yml default |

## Routing

- [x] **Crafter** — Straightforward implementation; low risk, no new behavior
