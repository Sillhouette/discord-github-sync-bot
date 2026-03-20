---
spec_version: "1.0"
type: shaped-work
id: DGB-12
title: Structured JSON logging — Winston JSON transport and console.* consolidation
status: shaped
created: 2026-03-19
appetite: small
priority: P2
target_project: discord-github-sync-bot
author: scout
tags: [observability, logging, operations]
acceptance_criteria:
  - id: AC-1
    description: Winston is configured with a JSON transport alongside the existing Console transport — JSON output goes to stdout, human-readable output remains for local development
    status: pending
  - id: AC-2
    description: All console.warn and console.log call sites in src/ are replaced with logger.warn / logger.info calls
    status: pending
  - id: AC-3
    description: Error log calls include structured fields (err object passed as metadata, not interpolated into the message string) — e.g., logger.error('createThread failed', { err, threadId }) not logger.error(`createThread failed: ${err.stack}`)
    status: pending
  - id: AC-4
    description: Key operational events log structured fields — at minimum node_id / externalId, action, and platform on sync path log calls
    status: pending
  - id: AC-5
    description: JSON transport is disabled in test environment (NODE_ENV=test) so test output remains readable
    status: pending
  - id: AC-6
    description: A docker-compose.grafana.yml reference configuration is added at the repo root showing a Promtail + Loki + Grafana sidecar that reads stdout JSON logs — for consumers who want the full observability stack
    status: pending
---

# DGB-12: Structured JSON logging — Winston transport and console.* consolidation

## Problem

The bot uses Winston but its log output is not machine-queryable. All log calls use string interpolation to embed structured data into the message field. Two `console.*` call sites bypass Winston entirely. This means:

- A log aggregator (Grafana Loki, Datadog, CloudWatch) cannot filter by field — there are no fields, only message strings
- Error stack traces are embedded as `${err.stack}` in the message rather than as a structured `err` field — they become an unstructured blob in any log store
- The `commentMap.ts` corrupt-file warning goes to `console.warn` and is invisible to any Winston-based pipeline
- Operators debugging a production sync failure must grep raw strings across log output with no ability to filter by thread ID or action type

The bot is open source and deployed by consumers across varied environments. The logging foundation needs to emit structured JSON so consumers can route logs to whatever backend they use (Grafana/Loki, Datadog, CloudWatch, etc.) without requiring any changes to the bot.

## Evidence

- `src/logger.ts` lines 8–22: single Console transport with `format.colorize + format.printf` — no JSON transport
- `src/github/githubActions.ts` lines 45–51: `` logger.info(`${Triggerer.Discord} | ${action} | ${getGithubUrl(thread)}`) ``
- `src/discord/discordActions.ts` line 98: `` logger.error(`createThread failed: ${err instanceof Error ? err.stack : err}`) ``
- `src/commentMap.ts` line 27: `console.warn(...)` — bypasses Winston
- `src/github/github.ts` line 84: `console.log(...)` — bypasses Winston

## Appetite & Boundaries

- **Appetite:** Small
- **In scope:** Winston JSON transport; console.* migration (excluding `github.ts` line 84 — owned by DGB-3 AC-5); structured error calls; reference Grafana/Loki docker-compose
- **No-gos:** Metrics (counters, gauges), distributed tracing, changing log levels, adding new log call sites beyond the existing ones

> **Note:** The `console.log` in `src/github/github.ts` (server startup message) is
> already claimed by DGB-3 AC-5. If DGB-3 has landed before this item, that call site
> is already migrated. DGB-12's scope for `console.*` migration covers `src/commentMap.ts`
> and any remaining `console.*` calls — not the one in `github.ts`.

## Solution Sketch

```typescript
// src/logger.ts — add JSON transport
const transports: winston.transport[] = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize({ all: true }),
      winston.format.printf(({ level, message }) => `${level}: ${message}`),
    ),
  }),
];

if (process.env.NODE_ENV !== 'test') {
  transports.push(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json(),
      ),
    })
  );
}

// Error calls — structured metadata instead of interpolation
// Before:
logger.error(`createThread failed: ${err instanceof Error ? err.stack : err}`);
// After:
logger.error('createThread failed', { err, threadId: thread.id });

// Sync path — structured fields
// Before:
logger.info(`${Triggerer.Discord} | ${action} | ${getGithubUrl(thread)}`);
// After:
logger.info('sync event', { triggerer: Triggerer.Discord, action, externalId: thread.node_id });
```

```yaml
# docker-compose.grafana.yml — reference sidecar for consumers
# Consumers who want Grafana/Loki: docker compose -f docker-compose.yml -f docker-compose.grafana.yml up
services:
  promtail:
    image: grafana/promtail:latest
    # reads stdout JSON from the bot container, ships to Loki
  loki:
    image: grafana/loki:latest
  grafana:
    image: grafana/grafana:latest
    # preconfigured with Loki datasource
```

## Risks & Assumptions

| Assumption | Type | Fastest Test |
|---|---|---|
| Two Console transports (colorized + JSON) can coexist without duplicate output | feasibility | Test locally — Winston supports multiple transports targeting the same stream |
| Structured error metadata does not change log level or message semantics | correctness | Side-by-side comparison of before/after for each migrated call site |
| consumers reading stdout get both human and JSON output interleaved | usability | Consider using stderr for human-readable and stdout for JSON — verify docker logs behavior |

## Routing

- [x] **Crafter** — Migrate one call site at a time; run tests between each; write Grafana reference config last
