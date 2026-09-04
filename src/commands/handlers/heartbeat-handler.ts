/**
 * Heartbeat slash command handler
 *
 * Wires user-facing activation of the HeartbeatEngine
 * (`src/daemon/heartbeat.ts`). The engine has existed since the
 * enterprise-features sprint but had no slash command nor TOML hook,
 * so it was effectively unreachable in production.
 *
 * Sub-actions:
 *   /heartbeat enable   — start the engine (uses TOML config + env overrides)
 *   /heartbeat disable  — stop the engine, clear timers
 *   /heartbeat status   — show running/enabled, tick counters, suppression count
 *
 * Per task `task-2026-05-02-wire-heartbeat-activation` from
 * `private-handover-repo/.codebuddy/colab-tasks.json`. Unblocks Phase 2 of
 * AUTONOMOUS-FLEET-PROTOCOL v0.1 on the always-on Linux hub.
 */

import { CommandHandlerResult } from './branch-handlers.js';
import { logger } from '../../utils/logger.js';

const VALID_ACTIONS = new Set(['enable', 'disable', 'status', 'help', '']);

function formatStatusLines(status: {
  running: boolean;
  enabled: boolean;
  lastRunTime: Date | null;
  nextRunTime: Date | null;
  consecutiveSuppressions: number;
  totalTicks: number;
  totalSuppressions: number;
  lastResult: string | null;
}, intervalMs: number, heartbeatFilePath: string): string {
  const lines: string[] = [];
  lines.push('Heartbeat Engine Status');
  lines.push('═'.repeat(40));
  lines.push(`Running:   ${status.running ? 'yes' : 'no'}`);
  lines.push(`Enabled:   ${status.enabled ? 'yes' : 'no'}`);
  lines.push(`Interval:  ${Math.round(intervalMs / 1000)}s`);
  lines.push(`File:      ${heartbeatFilePath}`);
  lines.push('');
  lines.push(`Total ticks:        ${status.totalTicks}`);
  lines.push(`Total suppressions: ${status.totalSuppressions}`);
  lines.push(`Consecutive supr.:  ${status.consecutiveSuppressions}`);
  if (status.lastRunTime) {
    lines.push(`Last run:  ${status.lastRunTime.toISOString()}`);
  } else {
    lines.push('Last run:  (never)');
  }
  if (status.nextRunTime) {
    lines.push(`Next run:  ${status.nextRunTime.toISOString()}`);
  } else {
    lines.push('Next run:  (not scheduled)');
  }
  if (status.lastResult) {
    const trimmed = status.lastResult.length > 200
      ? status.lastResult.slice(0, 200) + '…'
      : status.lastResult;
    lines.push('');
    lines.push(`Last result:`);
    lines.push(`  ${trimmed.replace(/\n/g, '\n  ')}`);
  }
  return lines.join('\n');
}

const HELP_TEXT = `Usage: /heartbeat <action>

Actions:
  enable   Start the heartbeat engine. Reads HEARTBEAT.md every interval
           and surfaces important items via agent review.
  disable  Stop the engine and clear timers.
  status   Show running state, tick counters, suppression count, file path.

Configure defaults in TOML under [heartbeat]:
  enabled = true
  interval_minutes = 30
  active_hours_start = 8
  active_hours_end = 22
  heartbeat_file = ".codebuddy/HEARTBEAT.md"
  suppression_keyword = "HEARTBEAT_OK"
  max_consecutive_suppressions = 5`;

/**
 * /heartbeat <enable|disable|status>
 */
export async function handleHeartbeat(args: string[]): Promise<CommandHandlerResult> {
  const action = (args[0] || 'status').trim().toLowerCase();

  if (!VALID_ACTIONS.has(action)) {
    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: `Unknown heartbeat action: ${args[0]}\n\n${HELP_TEXT}`,
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

  const { getHeartbeatEngine } = await import('../../daemon/heartbeat.js');
  const { getConfigManager } = await import('../../config/toml-config.js');

  // Build config from TOML; only pass defined keys so the engine's
  // DEFAULT_HEARTBEAT_CONFIG fills the rest. (Passing undefined explicitly
  // would overwrite defaults via spread merge — reason: `new Date(NaN)`
  // crashes on toISOString in the status output.)
  const cfg = getConfigManager().getConfig().heartbeat ?? {};
  type HeartbeatConfigPartial = Parameters<typeof getHeartbeatEngine>[0];
  const partial: HeartbeatConfigPartial = { enabled: cfg.enabled ?? true };
  if (cfg.interval_minutes !== undefined) partial!.intervalMs = cfg.interval_minutes * 60 * 1000;
  if (cfg.active_hours_start !== undefined) partial!.activeHoursStart = cfg.active_hours_start;
  if (cfg.active_hours_end !== undefined) partial!.activeHoursEnd = cfg.active_hours_end;
  if (cfg.heartbeat_file !== undefined) partial!.heartbeatFilePath = cfg.heartbeat_file;
  if (cfg.suppression_keyword !== undefined) partial!.suppressionKeyword = cfg.suppression_keyword;
  if (cfg.max_consecutive_suppressions !== undefined) partial!.maxConsecutiveSuppressions = cfg.max_consecutive_suppressions;
  const engine = getHeartbeatEngine(partial);

  if (action === 'enable') {
    if (engine.isRunning()) {
      return {
        handled: true,
        entry: {
          type: 'assistant',
          content: 'Heartbeat engine already running. Use /heartbeat status to see counters.',
          timestamp: new Date(),
        },
      };
    }
    // Forcer enabled=true même si la config TOML disait false (le user demande explicitement).
    engine.updateConfig({ enabled: true });
    engine.start();
    logger.info('Heartbeat engine enabled via slash command');
    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: 'Heartbeat engine started. Use /heartbeat status to monitor.',
        timestamp: new Date(),
      },
    };
  }

  if (action === 'disable') {
    if (!engine.isRunning()) {
      return {
        handled: true,
        entry: {
          type: 'assistant',
          content: 'Heartbeat engine is not running.',
          timestamp: new Date(),
        },
      };
    }
    engine.stop();
    logger.info('Heartbeat engine disabled via slash command');
    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: 'Heartbeat engine stopped.',
        timestamp: new Date(),
      },
    };
  }

  // action === 'status'
  const status = engine.getStatus();
  const ec = engine.getConfig();
  const text = formatStatusLines(status, ec.intervalMs, ec.heartbeatFilePath);
  return {
    handled: true,
    entry: { type: 'assistant', content: text, timestamp: new Date() },
  };
}
