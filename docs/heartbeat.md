# Heartbeat engine

Periodic project wake. Not the sensory pacemaker (`src/sensory/heartbeat-scheduler.ts`).

## Start

```text
/heartbeat enable
buddy heartbeat start
```

TOML `[heartbeat] enabled = true` also auto-starts from the agent.
`start()` arms companion loops. `stop()` / `/heartbeat disable` disarms them.

## Checklist

Default path: `.codebuddy/HEARTBEAT.md`.

If the file is missing, the first tick writes the template from
`docs/examples/HEARTBEAT.md` (same text as `DEFAULT_HEARTBEAT_MARKDOWN`).
Disable with `CODEBUDDY_HEARTBEAT_SEED=false`.

With `CODEBUDDY_OPENCLAW_WORKSPACE_IMPORT=true`, the engine also reads
`~/.openclaw/workspace/HEARTBEAT.md` (override with `OPENCLAW_WORKSPACE`).

## Due-now filter

Headings are kept or dropped before the agent review:

| Text in the section | When it runs |
| --- | --- |
| `Morning` / `matin` | 06:00–11:00 |
| `Evening` / `soir` | 18:00–23:00 |
| `lundi` … `dimanche` (or EN) | that weekday |
| `SCHEDULE: 0 7 * * 1` | cron hour + weekday |
| `every 30 min` / `chaque battement` | every tick |
| no schedule | every tick |

Active hours still apply (default 08–22). Nothing due → `skipReason: nothing_due`.

If the reviewer answers `HEARTBEAT_OK`, the tick is suppressed. Five suppressions
in a row force a thorough review.

A real finding also tries `runImpulseDeliveryTick()`.

## Companion loops armed by start()

| Flag | Loop |
| --- | --- |
| (always attempted) | impulse delivery (no-op unless deliver/proactive flags) |
| `CODEBUDDY_COMPANION_PRESENCE=true` | presence |
| `CODEBUDDY_COMPANION_PROACTIVE=true` | proactive outreach |
| `CODEBUDDY_COMPANION_IDLE=true` | idle artifacts |

Impulse delivery itself: `CODEBUDDY_COMPANION_IMPULSE_DELIVER=true` or the proactive flag.

## Code

- `src/daemon/heartbeat.ts` — engine
- `src/daemon/heartbeat-sources.ts` — merge + seed
- `src/daemon/heartbeat-schedule.ts` — due-now
- `src/companion/companion-loops.ts` — always-on companion timers
- `src/openclaw/workspace-files.ts` — OpenClaw workspace contract
