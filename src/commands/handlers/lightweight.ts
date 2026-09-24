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
import { getLessonsTracker, renderLessonConceptGraph } from '../../agent/lessons-tracker.js';
import type { LessonGraphRenderFormat } from '../../agent/lessons-tracker.js';
import { getTrackCommands } from '../../tracks/track-commands.js';
import { failureFlag } from '../slash-failure.js';

// ─── /quota ──────────────────────────────────────────────────────────────────

/**
 * /quota — Show remaining API rate limit capacity per provider.
 */
export async function handleQuota(): Promise<CommandHandlerResult> {
  const { formatAllRateLimits } = await import('../../utils/rate-limit-display.js');
  const output = formatAllRateLimits();

  return {
    handled: true,
...failureFlag(output),
    entry: { type: 'assistant', content: output, timestamp: new Date() },
  };
}

// ─── /lessons ────────────────────────────────────────────────────────────────

export function handleLessonsCommand(args: string): CommandHandlerResult {
  const tracker = getLessonsTracker(process.cwd());
  const parts = tokenizeSlashArgs(args);
  const sub = parts[0] ?? 'list';

  if (sub === 'list' || sub === '') {
    const block = tracker.buildContextBlock();
    const output = block ?? 'No lessons recorded yet.';
    return {
      handled: true,
...failureFlag(output),
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
...failureFlag(lines.join('\n')),
      entry: { type: 'assistant', content: lines.join('\n'), timestamp: new Date() },
    };
  }

  if (sub === 'add' && parts.length > 1) {
    const content = parts.slice(1).join(' ');
    const item = tracker.add('INSIGHT', content, 'manual');
    return {
      handled: true,
...failureFlag(`Lesson added [${item.id}]`),
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
...failureFlag(output),
      entry: { type: 'assistant', content: output, timestamp: new Date() },
    };
  }

  if (sub === 'graph') {
    const { query, concept, format, includeKeywords } = parseLessonsGraphSlashArgs(parts.slice(1));
    const graph = tracker.buildConceptGraph({ query, concept, includeKeywords });
    return {
      handled: true,
...failureFlag(renderLessonConceptGraph(graph, format)),
      entry: { type: 'assistant', content: renderLessonConceptGraph(graph, format), timestamp: new Date() },
    };
  }

  // Unknown sub-command → show help
  return {
    handled: true,
...failureFlag('Usage: /lessons [list|add <content>|search <query>|graph [query] [--concept <concept>] [--no-keywords] [--json|--markdown|--mermaid]|stats]'),
    entry: {
      type: 'assistant',
      content: 'Usage: /lessons [list|add <content>|search <query>|graph [query] [--concept <concept>] [--no-keywords] [--json|--markdown|--mermaid]|stats]',
      timestamp: new Date(),
    },
  };
}

function tokenizeSlashArgs(args: string): string[] {
  const tokens: string[] = [];
  for (const match of args.trim().matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  return tokens;
}

function parseLessonsGraphSlashArgs(tokens: string[]): {
  query?: string;
  concept?: string;
  format: LessonGraphRenderFormat;
  includeKeywords: boolean;
} {
  const queryParts: string[] = [];
  let concept: string | undefined;
  let format: LessonGraphRenderFormat = 'summary';
  let includeKeywords = true;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === undefined) continue;
    if (token === '--json') {
      format = 'json';
      continue;
    }
    if (token === '--markdown') {
      format = 'markdown';
      continue;
    }
    if (token === '--mermaid') {
      format = 'mermaid';
      continue;
    }
    if (token === '--no-keywords') {
      includeKeywords = false;
      continue;
    }
    if (token === '--concept') {
      concept = tokens[i + 1];
      i++;
      continue;
    }
    if (token.startsWith('--concept=')) {
      concept = token.slice('--concept='.length) || undefined;
      continue;
    }
    queryParts.push(token);
  }

  return {
    query: queryParts.join(' ') || undefined,
    concept,
    format,
    includeKeywords,
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
...failureFlag(lines.join('\n')),
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
...failureFlag(`Coverage targets: lines=${targets.lines}%, functions=${targets.functions}%, branches=${targets.branches}%, statements=${targets.statements}%`),
        entry: {
          type: 'assistant',
          content: `Coverage targets: lines=${targets.lines}%, functions=${targets.functions}%, branches=${targets.branches}%, statements=${targets.statements}%`,
          timestamp: new Date(),
        },
      };
    } catch (err) {
      return {
        handled: true,
...failureFlag(`Failed to read coverage targets: ${err instanceof Error ? err.message : String(err)}`),
        entry: { type: 'assistant', content: `Failed to read coverage targets: ${err instanceof Error ? err.message : String(err)}`, timestamp: new Date() },
      };
    }
  }

  return {
    handled: true,
...failureFlag('Usage: /coverage check|targets'),
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
    ...failureFlag(content),
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
...failureFlag(result.output || result.error || 'Scan complete.'),
    entry: {
      type: 'assistant',
      content: result.output || result.error || 'Scan complete.',
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
...failureFlag(result.message),
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
...failureFlag(result.success
          ? result.message
          : `Error: ${result.message}`),
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
...failureFlag(`Error executing track command: ${error instanceof Error ? error.message : 'Unknown error'}`),
      entry: {
        type: 'assistant',
        content: `Error executing track command: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date(),
      },
    };
  }
}
