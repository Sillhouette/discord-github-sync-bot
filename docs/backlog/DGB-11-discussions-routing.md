# DGB-11: GitHub Discussions Routing

**Type:** Shaped Work Contract
**Status:** Unshaped (needs discovery spike before implementation)
**Priority:** P3
**Appetite:** TBD — depends on spike findings

---

## Problem

The bot currently hardcodes GitHub Issues as the sync target. GitHub Issues and GitHub
Discussions serve different purposes — Issues for trackable bugs/tasks, Discussions for
open-ended community conversation, Q&A, and announcements. A team running both may want
different Discord forum channels to route to different GitHub targets.

Additionally, the GitHub Discussions consolidation trend means some communities will want
to use Discussions instead of Issues entirely. Without this, the bot is a non-starter for
those users.

---

## Open Questions (spike before shaping)

These need answers before scope can be fixed:

1. **GitHub Discussions API parity** — Does the GraphQL Discussions API support the same
   operations as the Issues REST API? Specifically: create, comment, edit comment, delete,
   close/reopen, lock/unlock. Any gaps directly constrain feature parity.

2. **Routing granularity** — What's the right config unit?
   - Per-bot (one target for all channels) — simplest
   - Per-channel (each forum channel routes independently) — most flexible
   - Per-tag (Discord tags determine routing) — most powerful, most complex

3. **Bidirectionality for Discussions** — GitHub Discussions webhooks exist but differ from
   Issues webhooks. Does the bot need to listen for `discussion` and
   `discussion_comment` events separately? What's the delta from the current
   `issues`/`issue_comment` handler set?

4. **State mapping** — Discussions have `OPEN`/`CLOSED`/`ANSWERED` states (categories
   matter too). Issues have `open`/`closed`. How does Discord thread archive/lock map to
   Discussions state? Is "answered" a concept the bot should surface?

5. **Category requirement** — GitHub Discussions require a category. How is this configured?
   Env var? Per-channel mapping? Derived from Discord tags?

---

## Rough Solution Space

### Option A — Bot-wide target (simplest)

Single env var: `GITHUB_SYNC_TARGET=issues|discussions`

One target for the whole bot. Easy to implement, covers the "we use Discussions instead
of Issues" use case. Doesn't help teams using both.

### Option B — Per-channel routing (recommended to spike)

Each monitored forum channel gets its own target config:

```bash
# Single channel (current behaviour)
DISCORD_CHANNEL_ID=123456

# Multi-channel with per-channel routing
CHANNEL_CONFIGS=[{"channelId":"123","target":"issues"},{"channelId":"456","target":"discussions","category":"General"}]
```

Covers all cases. Config is more complex to parse but the logic is clean — routing
happens at the handler level, not scattered through the sync functions.

> **Spike note:** JSON in env vars is error-prone to escape in shell, Docker Compose
> `env_file`, and GitHub Actions secrets. The spike (item 3) must test round-trip
> serialization in all three environments. If JSON proves fragile, consider a simple
> delimiter format (e.g. `CHANNEL_CONFIGS=123:issues,456:discussions:General`) instead.

### Option C — Per-tag routing

Discord forum tags determine the GitHub target. A "Bug" tag routes to Issues; a
"Question" tag routes to Discussions. Most expressive but tightest coupling between
Discord taxonomy and GitHub structure. Likely over-engineered for v2.

---

## Spike Task

Before shaping, run a spike to answer the open questions:

1. Test GitHub Discussions GraphQL API against a real repo — verify create/comment/edit/
   delete/close/lock operations all exist and behave as expected
2. Check `discussion` and `discussion_comment` webhook event payloads against current
   handler signatures — estimate delta. The bot branches on `event.action` values (e.g.
   `"opened"`, `"created"`, `"edited"`) — confirm whether Discussions uses the same
   action names or a different set, as mismatches would widen the handler diff significantly
3. Prototype Option B config parsing — is it clean or does it explode the config layer?
4. Document any API gaps or state mapping issues found

**Spike output:** A short findings doc at `docs/analysis/YYYYMMDD_spike_discussions-api.md`
that answers the open questions above and recommends which option to shape.

---

## Out of Scope

- GitHub Discussions as a *read* source (displaying Discussions content in Discord)
- Syncing existing Issues to Discussions (migration tooling)
- Per-tag routing (Option C) — defer to a later version if demand exists
- Notification-only mode (one-way push without sync)
