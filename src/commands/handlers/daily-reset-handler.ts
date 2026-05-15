/**
 * Daily Reset slash command handler
 *
 * Wires user-facing activation of the DailyResetManager
 * (`src/daemon/daily-reset.ts`). The engine has existed since the
 * enterprise-features sprint but had no slash command nor TOML hook,
 * so it was effectively unreachable in production.
 *
 * Sub-actions:
 *   /daily-reset enable   — start the scheduler (uses TOML config)
 *   /daily-reset disable  — stop the scheduler
 *   /daily-reset status   — show enabled/scheduled, ms until next reset
 *   /daily-reset run      — manually trigger reset on engine state
 *
 * **Limitation V0.1** : the engine's internal scheduler calls
 * `runReset([])` with an empty array — it cannot actually clear the
 * agent's session messages without a callback registration. This
 * wirage exposes the scheduler + manual trigger; integration with the
 * agent's message lifecycle is V0.2 work (refactor engine to accept
 * an `onReset` callback that returns the messages array to clear).
 *
 * Per task `task-2026-05-02-wake-daily-reset` from
 * `claude-et-patrice/.codebuddy/colab-tasks.json` (audit OpenClaw findings).
 */

import { CommandHandlerResult } from './branch-handlers.js';
import { logger } from '../../utils/logger.js';

const VALID_ACTIONS = new Set(['enable', 'disable', 'status', 'run', 'help', '']);

const HELP_TEXT = `Usage: /daily-reset <action>

Actions:
  enable   Start the daily reset scheduler. Fires at the configured time
           each day and runs the engine reset hook. V0.1 does not clear
           the live agent session messages until a callback is wired.
  disable  Stop the scheduler.
  status   Show enabled flag, configured time, and ms until next reset.
  run      Manually trigger a reset on engine state (V0.1 limitation:
           does not clear agent session messages — V0.2 will wire callback).

Configure defaults in TOML under [daily_reset]:
  enabled = false
  reset_hour = 4
  reset_minute = 0
  post_summary = true
  idle_minutes = 0`;

function formatStatusLines(
  isEnabled: boolean,
  isScheduled: boolean,
  resetHour: number,
  resetMinute: number,
  msUntilNext: number,
): string {
  const lines: string[] = [];
  lines.push('Daily Reset Manager Status');
  lines.push('═'.repeat(40));
  lines.push(`Enabled:   ${isEnabled ? 'yes' : 'no'}`);
  lines.push(`Scheduled: ${isScheduled ? 'yes' : 'no'}`);
  lines.push(`Time:      ${String(resetHour).padStart(2, '0')}:${String(resetMinute).padStart(2, '0')} local`);
  if (isScheduled) {
    const minutes = Math.round(msUntilNext / 60_000);
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    lines.push(`Next in:   ${hours}h ${mins}m (${msUntilNext}ms)`);
  } else {
    lines.push('Next in:   (not scheduled)');
  }
  lines.push('');
  lines.push('Note: the scheduler clears the engine\'s internal state.');
  lines.push('Wiring it to the agent\'s session messages is V0.2 work.');
  return lines.join('\n');
}

/**
 * /daily-reset <enable|disable|status|run>
 */
export async function handleDailyReset(args: string[]): Promise<CommandHandlerResult> {
  const action = (args[0] || 'status').trim().toLowerCase();

  if (!VALID_ACTIONS.has(action)) {
    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: `Unknown daily-reset action: ${args[0]}\n\n${HELP_TEXT}`,
        timestamp: new Date(),
      },
    };
  }

  if (action === 'help' || action === '') {
    return {
      handled: true,
      entry: { type: 'assistant', content: HELP_TEXT, timestamp: new Date() },
    };
  }

  const { getDailyResetManager } = await import('../../daemon/daily-reset.js');
  const { getConfigManager } = await import('../../config/toml-config.js');

  // Build config from TOML, only passing defined keys (engine spreads defaults).
  const cfg = getConfigManager().getConfig().daily_reset ?? {};
  type Partial = Parameters<typeof getDailyResetManager>[0];
  const partial: Partial = { enabled: cfg.enabled ?? true };
  if (cfg.reset_hour !== undefined) partial!.resetHour = cfg.reset_hour;
  if (cfg.reset_minute !== undefined) partial!.resetMinute = cfg.reset_minute;
  if (cfg.timezone !== undefined) partial!.timezone = cfg.timezone;
  if (cfg.post_summary !== undefined) partial!.postSummary = cfg.post_summary;
  if (cfg.idle_minutes !== undefined) partial!.idleMinutes = cfg.idle_minutes;

  const engine = getDailyResetManager(partial);

  if (action === 'enable') {
    if (engine.isEnabled() && (engine as unknown as { timer: unknown }).timer) {
      return {
        handled: true,
        entry: {
          type: 'assistant',
          content: 'Daily reset scheduler already running. Use /daily-reset status.',
          timestamp: new Date(),
        },
      };
    }
    // Force enabled true (user explicitly asked).
    (engine as unknown as { config: { enabled: boolean } }).config.enabled = true;
    engine.start();
    logger.info('DailyResetManager enabled via slash command');
    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: 'Daily reset scheduler started. Use /daily-reset status to see next reset time.',
        timestamp: new Date(),
      },
    };
  }

  if (action === 'disable') {
    engine.stop();
    logger.info('DailyResetManager disabled via slash command');
    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: 'Daily reset scheduler stopped.',
        timestamp: new Date(),
      },
    };
  }

  if (action === 'run') {
    const result = await engine.runReset([]);
    return {
      handled: true,
      entry: {
        type: 'assistant',
        content:
          `Daily reset triggered manually at ${result.triggeredAt.toISOString()}\n` +
          `Messages cleared: ${result.messagesCleared} (engine internal state — does not affect agent session in V0.1)\n` +
          (result.summaryMessage ? `\nSummary:\n${result.summaryMessage}` : ''),
        timestamp: new Date(),
      },
    };
  }

  // action === 'status'
  const ec = engine.getConfig();
  const internalTimer = (engine as unknown as { timer: unknown }).timer;
  const isScheduled = internalTimer !== null && internalTimer !== undefined;
  const text = formatStatusLines(
    engine.isEnabled(),
    isScheduled,
    ec.resetHour,
    ec.resetMinute,
    isScheduled ? engine.msUntilNextReset() : 0,
  );
  return {
    handled: true,
    entry: { type: 'assistant', content: text, timestamp: new Date() },
  };
}
