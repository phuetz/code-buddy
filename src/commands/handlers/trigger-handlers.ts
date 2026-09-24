/**
 * Trigger Handlers
 *
 * CLI and slash command handlers for webhook trigger management.
 *
 * Slash commands:
 *   /trigger add --source github --events "pull_request.opened" --action "Review PR: {{event.title}}" [--secret <s>]
 *   /trigger list
 *   /trigger remove <id>
 *   /trigger test <id> [--sample-event <json>]
 *
 * CLI commands (via buddy trigger):
 *   buddy trigger add-webhook --source github --events "pull_request.opened" --action "..." --secret <s>
 *   buddy trigger list
 *   buddy trigger remove <id>
 *   buddy trigger test <id> --sample-event <json>
 */

import type { CommandHandlerResult } from './branch-handlers.js';

// ============================================================================
// Slash Command: /trigger
// ============================================================================

export async function handleTrigger(args: string[]): Promise<CommandHandlerResult> {
  const action = args[0]?.toLowerCase() || 'list';

  switch (action) {
    case 'list':
      return handleTriggerList();

    case 'add':
      return handleTriggerAdd(args.slice(1));

    case 'remove':
    case 'delete':
      return handleTriggerRemove(args.slice(1));

    case 'test':
      return handleTriggerTest(args.slice(1));

    default:
      return result(
        'Usage: /trigger <action>\n\n' +
        'Actions:\n' +
        '  list                                    — List all webhook triggers\n' +
        '  add --source <s> --events <e> --action <a> [--secret <s>] [--filter key=val]\n' +
        '                                          — Add a webhook trigger\n' +
        '  remove <id>                             — Remove a trigger by ID\n' +
        '  test <id> [--sample-event <json>]       — Test a trigger\n\n' +
        'Sources: github, gitlab, slack, linear, pagerduty, generic\n\n' +
        'Example:\n' +
        '  /trigger add --source github --events "pull_request.opened" --action "Review PR #{{event.number}}: {{event.title}}"'
      );
  }
}

// ============================================================================
// List Triggers
// ============================================================================

async function handleTriggerList(): Promise<CommandHandlerResult> {
  const { getWebhookTriggerManager } = await import('../../triggers/webhook-trigger.js');
  const manager = getWebhookTriggerManager();
  await manager.load();

  const triggers = manager.listTriggers();

  if (triggers.length === 0) {
    return result(
      'No webhook triggers configured.\n\n' +
      'Add one with:\n' +
      '  /trigger add --source github --events "pull_request.opened" --action "Review: {{event.title}}"'
    );
  }

  const lines = triggers.map(t => {
    const status = t.enabled ? '+' : '-';
    const events = t.events.join(', ');
    const lastFired = t.lastFiredAt
      ? `last: ${new Date(t.lastFiredAt).toLocaleString()}`
      : 'never fired';
    return `  ${status} [${t.id.slice(0, 8)}] ${t.name}\n    Source: ${t.source} | Events: ${events}\n    Fired: ${t.fireCount}x (${lastFired})\n    Action: ${t.action.slice(0, 80)}${t.action.length > 80 ? '...' : ''}`;
  });

  return result(`Webhook Triggers (${triggers.length}):\n\n${lines.join('\n\n')}`);
}

// ============================================================================
// Add Trigger
// ============================================================================

async function handleTriggerAdd(args: string[]): Promise<CommandHandlerResult> {
  // Parse flags
  const parsed = parseFlags(args);

  const source = parsed.flags['source'] || parsed.flags['s'];
  const eventsStr = parsed.flags['events'] || parsed.flags['e'];
  const action = parsed.flags['action'] || parsed.flags['a'];
  const secret = parsed.flags['secret'];
  const name = parsed.flags['name'] || parsed.flags['n'];

  if (!source) {
    return result('Error: --source is required (github, gitlab, slack, linear, pagerduty, generic)', true);
  }

  const validSources = ['github', 'gitlab', 'slack', 'linear', 'pagerduty', 'generic'];
  if (!validSources.includes(source)) {
    return result(`Error: Invalid source "${source}". Must be one of: ${validSources.join(', ')}`, true);
  }

  if (!eventsStr) {
    return result('Error: --events is required (comma-separated, e.g. "pull_request.opened,issues.created")', true);
  }

  if (!action) {
    return result('Error: --action is required (prompt template, e.g. "Review: {{event.title}}")', true);
  }

  const events = eventsStr.split(',').map(e => e.trim()).filter(Boolean);

  // Parse filters (--filter key=value)
  const filters: Record<string, string> = {};
  const filterStr = parsed.flags['filter'] || parsed.flags['f'];
  if (filterStr) {
    const parts = filterStr.split(',');
    for (const part of parts) {
      const [k, v] = part.split('=');
      if (k && v) {
        filters[k.trim()] = v.trim();
      }
    }
  }

  const { getWebhookTriggerManager } = await import('../../triggers/webhook-trigger.js');
  const manager = getWebhookTriggerManager();
  await manager.load();

  const config = {
    id: '',
    name: name || `${source} trigger (${events.join(', ')})`,
    source: source as 'github' | 'gitlab' | 'slack' | 'linear' | 'pagerduty' | 'generic',
    events,
    action,
    secret,
    enabled: true,
    filters: Object.keys(filters).length > 0 ? filters : undefined,
    createdAt: '',
    fireCount: 0,
  };

  manager.addTrigger(config);
  await manager.save();

  return result(
    `Webhook trigger created: ${config.id.slice(0, 8)}\n` +
    `  Source: ${config.source}\n` +
    `  Events: ${config.events.join(', ')}\n` +
    `  Action: ${config.action}\n` +
    (config.secret ? '  Secret: ****\n' : '') +
    (config.filters ? `  Filters: ${JSON.stringify(config.filters)}\n` : '') +
    `\nWebhook URL: POST /api/webhooks/${config.source}`
  );
}

// ============================================================================
// Remove Trigger
// ============================================================================

async function handleTriggerRemove(args: string[]): Promise<CommandHandlerResult> {
  const id = args[0];
  if (!id) {
    return result('Error: Trigger ID is required. Use `/trigger list` to see IDs.', true);
  }

  const { getWebhookTriggerManager } = await import('../../triggers/webhook-trigger.js');
  const manager = getWebhookTriggerManager();
  await manager.load();

  // Support prefix matching
  const triggers = manager.listTriggers();
  const match = triggers.find(t => t.id === id || t.id.startsWith(id));

  if (!match) {
    return result(`Error: Trigger not found: ${id}`, true);
  }

  manager.removeTrigger(match.id);
  await manager.save();

  return result(`Trigger removed: ${match.id.slice(0, 8)} (${match.name})`);
}

// ============================================================================
// Test Trigger
// ============================================================================

async function handleTriggerTest(args: string[]): Promise<CommandHandlerResult> {
  const id = args[0];
  const parsed = parseFlags(args.slice(1));
  const sampleEventStr = parsed.flags['sample-event'] || parsed.flags['sample'] || parsed.positional.join(' ');

  const { getWebhookTriggerManager } = await import('../../triggers/webhook-trigger.js');
  const manager = getWebhookTriggerManager();
  await manager.load();

  if (id) {
    const triggers = manager.listTriggers();
    const match = triggers.find(t => t.id === id || t.id.startsWith(id));
    if (!match) {
      return result(`Error: Trigger not found: ${id}`, true);
    }

    // Build sample event based on source
    let sampleBody: unknown;
    if (sampleEventStr) {
      try {
        sampleBody = JSON.parse(sampleEventStr);
      } catch {
        return result('Error: Invalid JSON for --sample-event', true);
      }
    } else {
      sampleBody = buildSampleEvent(match.source, match.events[0] || '*');
    }

    const sampleHeaders = buildSampleHeaders(match.source, match.events[0] || '*');
    const testResult = await manager.handleWebhook(match.source, sampleHeaders, sampleBody);

    return result(
      `Test result for trigger ${match.id.slice(0, 8)}:\n` +
      `  Fired: ${testResult.fired}\n` +
      `  Event type: ${testResult.eventType || 'n/a'}\n` +
      (testResult.prompt ? `  Resolved prompt:\n    ${testResult.prompt}\n` : '') +
      (testResult.error ? `  Error: ${testResult.error}\n` : '') +
      '\n(Test only - no agent action dispatched)',
      Boolean(testResult.error),
    );
  }

  return result('Error: Trigger ID is required. Use `/trigger list` to see IDs.', true);
}

// ============================================================================
// Sample Events
// ============================================================================

function buildSampleEvent(source: string, event: string): unknown {
  const eventBase = event.split('.')[0];

  if (source === 'github') {
    switch (eventBase) {
      case 'pull_request':
        return {
          action: event.split('.')[1] || 'opened',
          pull_request: {
            number: 42,
            title: 'Add user authentication',
            body: 'This PR implements JWT-based auth.',
            html_url: 'https://github.com/org/repo/pull/42',
            diff_url: 'https://github.com/org/repo/pull/42.diff',
            state: 'open',
            head: { ref: 'feature/auth', sha: 'abc1234' },
            base: { ref: 'main' },
            user: { login: 'developer' },
            labels: [{ name: 'enhancement' }],
            draft: false,
            merged: false,
            additions: 150,
            deletions: 20,
            changed_files: 5,
          },
          repository: { full_name: 'org/repo', html_url: 'https://github.com/org/repo', name: 'repo', owner: { login: 'org' } },
          sender: { login: 'developer', avatar_url: '' },
        };

      case 'issues':
        return {
          action: event.split('.')[1] || 'opened',
          issue: {
            number: 99,
            title: 'Bug: Login fails on Safari',
            body: 'When using Safari 17, the login form submits but redirects to a blank page.',
            html_url: 'https://github.com/org/repo/issues/99',
            state: 'open',
            user: { login: 'reporter' },
            labels: [{ name: 'bug' }, { name: 'browser' }],
          },
          repository: { full_name: 'org/repo', html_url: 'https://github.com/org/repo', name: 'repo', owner: { login: 'org' } },
          sender: { login: 'reporter', avatar_url: '' },
        };

      case 'push':
        return {
          ref: 'refs/heads/main',
          compare: 'https://github.com/org/repo/compare/abc...def',
          commits: [
            { id: 'def5678abc', message: 'fix: resolve login redirect', author: { name: 'Dev', email: 'dev@example.com' }, url: '', added: [], modified: ['src/auth.ts'], removed: [] },
          ],
          repository: { full_name: 'org/repo', html_url: 'https://github.com/org/repo', name: 'repo', owner: { login: 'org' } },
          sender: { login: 'developer', avatar_url: '' },
        };

      case 'workflow_run':
        return {
          action: event.split('.')[1] || 'completed',
          workflow_run: {
            name: 'CI Pipeline',
            conclusion: 'failure',
            html_url: 'https://github.com/org/repo/actions/runs/123',
            head_branch: 'main',
            head_sha: 'abc1234',
            run_number: 42,
          },
          repository: { full_name: 'org/repo', html_url: 'https://github.com/org/repo', name: 'repo', owner: { login: 'org' } },
          sender: { login: 'github-actions[bot]', avatar_url: '' },
        };

      default:
        return {
          action: 'test',
          repository: { full_name: 'org/repo', html_url: 'https://github.com/org/repo', name: 'repo', owner: { login: 'org' } },
          sender: { login: 'tester', avatar_url: '' },
        };
    }
  }

  // Generic sample
  return {
    event: event || 'test',
    message: 'Sample test event',
    timestamp: new Date().toISOString(),
    data: { status: 'ok', source },
  };
}

function buildSampleHeaders(source: string, event: string): Record<string, string> {
  const eventBase = event.split('.')[0] || event;

  switch (source) {
    case 'github':
      return { 'x-github-event': eventBase, 'x-github-delivery': 'test-delivery-id' };
    case 'gitlab':
      return { 'x-gitlab-event': eventBase };
    case 'slack':
      return { 'x-slack-request-timestamp': String(Math.floor(Date.now() / 1000)) };
    case 'linear':
      return {};
    case 'pagerduty':
      return {};
    default:
      return { 'x-event-type': event };
  }
}

// ============================================================================
// Flag Parsing
// ============================================================================

interface ParsedFlags {
  flags: Record<string, string>;
  positional: string[];
}

function parseFlags(args: string[]): ParsedFlags {
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  let i = 0;

  while (i < args.length) {
    const arg = args[i];
    if (arg === undefined) {
      i++;
      continue;
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i += 2;
      } else {
        flags[key] = 'true';
        i++;
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      const key = arg.slice(1);
      const next = args[i + 1];
      if (next && !next.startsWith('-')) {
        flags[key] = next;
        i += 2;
      } else {
        flags[key] = 'true';
        i++;
      }
    } else {
      positional.push(arg);
      i++;
    }
  }

  return { flags, positional };
}

// ============================================================================
// Helpers
// ============================================================================

function result(content: string, failed = false): CommandHandlerResult {
  return {
    handled: true,
    ...(failed ? { failed: true } : {}),
    entry: { type: 'assistant', content, timestamp: new Date() },
  };
}
