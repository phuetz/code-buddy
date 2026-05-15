/**
 * Lightweight slash-command handlers — Vague 3.C consolidation.
 *
 * Six trivial handlers (quota, lessons, coverage, telemetry, vulns, track)
 * collapsed into one file. Each was previously its own ~50-LOC module.
 * Behavior is preserved verbatim — only the file boundary moves.
 *
 * Excluded from this consolidation (kept in their own files because they
 * own module-level singleton state):
 *   - voice-code-handler.ts (let pipeline)
 *   - btw-handler.ts (let clientRef + setBtwClient setter)
 */

import type { CommandHandlerResult } from './branch-handlers.js';
import { getLessonsTracker } from '../../agent/lessons-tracker.js';
import { getTrackCommands } from '../../tracks/track-commands.js';

// ─── /quota ──────────────────────────────────────────────────────────────────

/**
 * /quota — Show remaining API rate limit capacity per provider.
 */
export async function handleQuota(): Promise<CommandHandlerResult> {
  const { formatAllRateLimits } = await import('../../utils/rate-limit-display.js');
  const output = formatAllRateLimits();

  return {
    handled: true,
    entry: { type: 'assistant', content: output, timestamp: new Date() },
  };
}

// ─── /lessons ────────────────────────────────────────────────────────────────

export function handleLessonsCommand(args: string): CommandHandlerResult {
  const tracker = getLessonsTracker(process.cwd());
  const parts = args.trim().split(/\s+/);
  const sub = parts[0] ?? 'list';

  if (sub === 'list' || sub === '') {
    const block = tracker.buildContextBlock();
    const output = block ?? 'No lessons recorded yet.';
    return {
      handled: true,
      entry: { type: 'assistant', content: output, timestamp: new Date() },
    };
  }

  if (sub === 'stats') {
    const stats = tracker.getStats();
    const lines = [`Total: ${stats.total}`];
    for (const [cat, n] of Object.entries(stats.byCategory)) {
      lines.push(`  ${cat}: ${n}`);
    }
    if (stats.oldestAt) lines.push(`Oldest: ${new Date(stats.oldestAt).toISOString().slice(0, 10)}`);
    if (stats.newestAt) lines.push(`Newest: ${new Date(stats.newestAt).toISOString().slice(0, 10)}`);
    return {
      handled: true,
      entry: { type: 'assistant', content: lines.join('\n'), timestamp: new Date() },
    };
  }

  if (sub === 'add' && parts.length > 1) {
    const content = parts.slice(1).join(' ');
    const item = tracker.add('INSIGHT', content, 'manual');
    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: `Lesson added [${item.id}]`,
        timestamp: new Date(),
      },
    };
  }

  if (sub === 'search' && parts.length > 1) {
    const query = parts.slice(1).join(' ');
    const results = tracker.search(query);
    const output =
      results.length === 0
        ? `No lessons matching "${query}"`
        : `Found ${results.length}:\n` +
          results.map(r => `  [${r.id}] ${r.category}: ${r.content}`).join('\n');
    return {
      handled: true,
      entry: { type: 'assistant', content: output, timestamp: new Date() },
    };
  }

  // Unknown sub-command → show help
  return {
    handled: true,
    entry: {
      type: 'assistant',
      content: 'Usage: /lessons [list|add <content>|search <query>|stats]',
      timestamp: new Date(),
    },
  };
}

// ─── /coverage ───────────────────────────────────────────────────────────────

/**
 * /coverage check — Run tests with coverage and compare against targets.
 */
export async function handleCoverage(args: string[]): Promise<CommandHandlerResult> {
  const action = args[0]?.toLowerCase() || 'check';

  if (action === 'check' || action === 'status') {
    try {
      const { getCoverageTargets } = await import('../../testing/coverage-targets.js');
      const cwd = process.cwd();
      const targets = await getCoverageTargets(cwd);

      const lines: string[] = [];
      lines.push('Coverage Targets');
      lines.push('='.repeat(50));
      lines.push(`  Lines:      ${targets.lines ?? 'not set'}%`);
      lines.push(`  Functions:  ${targets.functions ?? 'not set'}%`);
      lines.push(`  Branches:   ${targets.branches ?? 'not set'}%`);
      lines.push(`  Statements: ${targets.statements ?? 'not set'}%`);
      lines.push('');
      lines.push('Run `npm run test:coverage` to generate actual coverage data,');
      lines.push('then use /coverage check to compare against these targets.');

      return {
        handled: true,
        entry: { type: 'assistant', content: lines.join('\n'), timestamp: new Date() },
      };
    } catch (err) {
      return {
        handled: true,
        entry: { type: 'assistant', content: `Coverage check failed: ${err instanceof Error ? err.message : String(err)}`, timestamp: new Date() },
      };
    }
  }

  if (action === 'targets') {
    try {
      const { getCoverageTargets } = await import('../../testing/coverage-targets.js');
      const targets = await getCoverageTargets(process.cwd());
      return {
        handled: true,
        entry: {
          type: 'assistant',
          content: `Coverage targets: lines=${targets.lines}%, functions=${targets.functions}%, branches=${targets.branches}%, statements=${targets.statements}%`,
          timestamp: new Date(),
        },
      };
    } catch (err) {
      return {
        handled: true,
        entry: { type: 'assistant', content: `Failed to read coverage targets: ${err instanceof Error ? err.message : String(err)}`, timestamp: new Date() },
      };
    }
  }

  return {
    handled: true,
    entry: {
      type: 'assistant',
      content: 'Usage: /coverage check|targets',
      timestamp: new Date(),
    },
  };
}

// ─── /telemetry ──────────────────────────────────────────────────────────────

/**
 * /telemetry on|off|errors-only|full|status — Telemetry opt-in/opt-out.
 */
export async function handleTelemetry(args: string[]): Promise<CommandHandlerResult> {
  const action = args[0]?.toLowerCase() || 'status';

  const {
    getTelemetryConfig,
    setTelemetryEnabled,
    setTelemetryLevel,
    isTelemetryEnabled,
  } = await import('../../utils/telemetry-config.js');

  switch (action) {
    case 'on': {
      setTelemetryEnabled(true);
      return telemetryResult('Telemetry enabled. Error reports and tracing data will be collected.\nRestart may be needed for changes to take full effect.');
    }

    case 'off': {
      setTelemetryEnabled(false);
      return telemetryResult('Telemetry disabled. No error reports or tracing data will be collected.\nRestart may be needed for changes to take full effect.');
    }

    case 'errors-only': {
      setTelemetryLevel('errors-only');
      return telemetryResult('Telemetry set to errors-only mode. Only error reports will be sent (no tracing).');
    }

    case 'full': {
      setTelemetryLevel('full');
      return telemetryResult('Telemetry set to full mode. Error reports and tracing data will be collected.');
    }

    case 'status':
    default: {
      const config = getTelemetryConfig();
      const enabled = isTelemetryEnabled();
      const sentryDsn = process.env.SENTRY_DSN ? 'configured' : 'not set';
      const otelEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ? 'configured' : 'not set';

      return telemetryResult(
        `Telemetry status:\n` +
        `  Enabled: ${enabled ? 'yes' : 'no'}\n` +
        `  Level:   ${config.level}\n` +
        `  Sentry:  ${sentryDsn}\n` +
        `  OTEL:    ${otelEndpoint}\n\n` +
        `Use /telemetry on|off|errors-only|full to change settings.`
      );
    }
  }
}

function telemetryResult(content: string): CommandHandlerResult {
  return {
    handled: true,
    entry: { type: 'assistant', content, timestamp: new Date() },
  };
}

// ─── /vulns ──────────────────────────────────────────────────────────────────

/**
 * /vulns — Scan dependencies for known vulnerabilities.
 */
export async function handleVulns(args: string[]): Promise<CommandHandlerResult> {
  const { executeScanVulnerabilities } = await import('../../security/dependency-vuln-scanner.js');

  const packageManager = args[0] as 'npm' | 'pip' | 'cargo' | 'go' | 'gem' | 'composer' | undefined;
  const projectPath = args.find(a => a.startsWith('--path='))?.split('=')[1] || undefined;

  const result = await executeScanVulnerabilities({
    path: projectPath,
    package_manager: packageManager && ['npm', 'pip', 'cargo', 'go', 'gem', 'composer'].includes(packageManager)
      ? packageManager
      : undefined,
  });

  return {
    handled: true,
    entry: {
      type: 'assistant',
      content: result.output?.trim()
        || result.error?.trim()
        || (result.success
          ? 'Vulnerability scan completed with no report output.'
          : 'Vulnerability scan failed without error details.'),
      timestamp: new Date(),
    },
  };
}

// ─── /track ──────────────────────────────────────────────────────────────────

/**
 * /track new|implement|status|list|complete|setup|context|update —
 * Conductor-inspired spec-driven development workflow.
 */
export async function handleTrack(args: string[]): Promise<CommandHandlerResult> {
  const trackCommands = getTrackCommands(process.cwd());
  const argsString = args.join(' ');

  try {
    const result = await trackCommands.execute(argsString);

    // If there's a prompt, pass it to the AI
    if (result.prompt) {
      return {
        handled: true,
        passToAI: true,
        prompt: result.prompt,
        entry: {
          type: 'assistant',
          content: result.message,
          timestamp: new Date(),
        },
      };
    }

    // Otherwise just display the result
    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: result.success
          ? result.message
          : `Error: ${result.message}`,
        timestamp: new Date(),
      },
    };
  } catch (error) {
    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: `Error executing track command: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date(),
      },
    };
  }
}
