---
adr_version: "1.0"
type: adr
id: ADR-000
title: "Use ADRs to record architecture decisions"
status: accepted
created: 2026-03-15
deciders: [architect]
tags: [process, documentation]
---

# ADR-000: Use ADRs to record architecture decisions

## Context

Technical decisions evaporate without a record. When developers ask "why did we
choose X over Y?" there is no authoritative answer. Design documents capture
what was designed but not the alternatives that were considered and rejected.

## Decision

Use Architecture Decision Records (ADRs) following the Michael Nygard pattern.
ADRs are stored in `docs/decisions/` with sequential numbering. They capture
context, decision, consequences, and alternatives considered.

ADRs are created when: (a) multiple viable alternatives exist AND (b) the
choice is hard to reverse OR affects multiple domains.

## Consequences

### Positive
- Decisions are discoverable and searchable
- New team members understand why decisions were made
- /diagnose can detect violations of documented decisions

### Negative
- Overhead of writing ADRs for significant decisions
- Risk of ADR proliferation if threshold is not respected

### Neutral
- ADRs complement but do not replace design documents

## Alternatives Considered

| Alternative | Pros | Cons | Why Not |
|-------------|------|------|---------|
| Document decisions in design docs | Already exists, no new files | Mixed with implementation details, hard to find later | Decisions get buried in larger documents |
| Wiki pages | Easy to edit, searchable | Not version-controlled, drift from code | Separate from the codebase |
| No formal records | Zero overhead | Decisions lost, repeated debates | Current pain point |
