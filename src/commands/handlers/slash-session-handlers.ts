import type { CommandHandlerResult } from './branch-handlers.js';
import { ConfirmationService } from '../../utils/confirmation-service.js';
import { loadPermissions } from '../../security/declarative-rules.js';
import { getPermissionModeManager } from '../../security/permission-modes.js';
import { ApprovalPatternTracker } from '../../utils/approval-pattern-tracker.js';
import { SessionTimeline } from '../../sessions/timeline.js';
import { getCollectiveKnowledgeGraph } from '../../memory/collective-knowledge-graph.js';

function result(content: string): CommandHandlerResult {
  return {
    handled: true,
    entry: { type: 'assistant', content, timestamp: new Date() },
  };
}

/** Read the checkpoint timeline and redo the next checkpoint when available. */
export async function handleRedo(_args: string[]): Promise<CommandHandlerResult> {
  const { createCheckpointManager } = await import('../../undo/checkpoint-manager.js');
  const checkpointManager = createCheckpointManager(process.cwd(), { autoCheckpoint: false });

  try {
    await checkpointManager.waitUntilReady();
    const redo = await checkpointManager.redo();
    if (!redo) {
      return result('Nothing to redo. Use /undo first to create a redo point.');
    }

    const restored = redo.restoredFiles.length > 0
      ? `\nRestored files:\n${redo.restoredFiles.map(file => `  - ${file}`).join('\n')}`
      : '';
    const errors = redo.errors.length > 0
      ? `\nErrors:\n${redo.errors.map(error => `  - ${error.path}: ${error.error}`).join('\n')}`
      : '';
    const status = redo.success ? 'Redo successful.' : 'Redo completed with errors.';
    return result(`${status}\nCheckpoint: ${redo.checkpoint.name} (${redo.checkpoint.id})${restored}${errors}`);
  } finally {
    checkpointManager.dispose();
  }
}

/** Show the append-only timeline for the active session, without changing it. */
export async function handleTimeline(
  args: string[],
  currentSessionId?: string | null,
): Promise<CommandHandlerResult> {
  if (process.env.CODEBUDDY_TIMELINE !== 'true') {
    return result(
      'Session timeline is disabled. Set CODEBUDDY_TIMELINE=true before starting Code Buddy to enable it.',
    );
  }

  const sessionId = args[0] ?? currentSessionId ?? process.env.CODEBUDDY_SESSION_ID;
  if (!sessionId) {
    return result('No active session id is available. Usage: /timeline [session-id].');
  }

  const entries = await new SessionTimeline().list(sessionId);
  if (entries.length === 0) {
    return result(`Timeline for session ${sessionId}\n\nNo recorded turns.`);
  }

  const lines = [
    `Timeline for session ${sessionId}`,
    `Turns: ${entries.length}`,
    '',
  ];
  for (const entry of entries.slice(-20)) {
    const tools = entry.toolCalls.length > 0
      ? entry.toolCalls.map(call => `${call.name} (${call.ok ? 'ok' : 'error'})`).join(', ')
      : 'none';
    const files = entry.filesTouched.length > 0 ? entry.filesTouched.join(', ') : 'none';
    lines.push(`#${entry.turn} ${entry.role} — ${entry.textPreview}`);
    lines.push(`  tools: ${tools}`);
    lines.push(`  files: ${files}`);
    if (entry.checkpointId) lines.push(`  checkpoint: ${entry.checkpointId}`);
  }
  if (entries.length > 20) lines.push(`\nShowing the last 20 of ${entries.length} turns.`);
  return result(lines.join('\n'));
}

/** Read-only stats, entity listing, and keyword recall for the collective graph. */
export function handleKnowledgeGraph(args: string[]): CommandHandlerResult {
  if (process.env.CODEBUDDY_COLLECTIVE_MEMORY !== 'true') {
    return result(
      'Collective knowledge graph is disabled. Set CODEBUDDY_COLLECTIVE_MEMORY=true before starting Code Buddy to enable it.',
    );
  }

  const action = args[0]?.toLowerCase() ?? 'stats';
  const graph = getCollectiveKnowledgeGraph();

  if (action === 'stats') {
    const stats = graph.getStats();
    return result([
      'Collective knowledge graph (read-only)',
      `Entities: ${stats.entities}`,
      `Superseded: ${stats.superseded}`,
      `Relations: ${stats.relations}`,
      `Ledger: ${stats.ledgerPath}`,
    ].join('\n'));
  }

  if (action === 'entities') {
    const entities = graph.listEntities({ limit: 20 });
    const lines = ['Collective knowledge graph entities (read-only)', ''];
    if (entities.length === 0) lines.push('No entities found.');
    for (const entity of entities) {
      lines.push(`- [${entity.type}] ${entity.name} (mentions: ${entity.mentions}, confidence: ${entity.confidence.toFixed(2)})`);
    }
    return result(lines.join('\n'));
  }

  if (action === 'recall' || action === 'query') {
    const query = args.slice(1).join(' ').trim();
    if (!query) return result('Usage: /knowledge-graph recall <query>');
    const matches = graph.recall(query, { limit: 5 });
    const lines = [`Knowledge graph recall for: ${query}`, ''];
    if (matches.length === 0) lines.push('No matches found.');
    for (const match of matches) {
      lines.push(`- [${match.type}] ${match.name}: ${match.text}`);
    }
    return result(lines.join('\n'));
  }

  return result(
    'Knowledge graph is read-only here. Use /knowledge-graph stats, entities, or recall <query>.',
  );
}

/** Show confirmation flags, permission rules, and learned approvals read-only. */
export async function handleApprovals(_args: string[]): Promise<CommandHandlerResult> {
  const confirmation = ConfirmationService.getInstance();
  const flags = confirmation.getSessionFlags();
  const permissionMode = getPermissionModeManager();
  const permissions = loadPermissions(process.cwd());
  const tracker = new ApprovalPatternTracker(process.cwd());
  const patterns = await tracker.listPatterns();
  const formatList = (values: string[] | undefined): string => values && values.length > 0 ? values.join(', ') : 'none';

  return result([
    'Approvals (read-only)',
    `Permission mode: ${permissionMode.getMode()}`,
    `Subagent mode: ${permissionMode.getSubagentMode()}`,
    `Bypass disabled: ${permissionMode.isBypassDisabled() ? 'yes' : 'no'}`,
    `Session flags: fileOperations=${flags.fileOperations}, bashCommands=${flags.bashCommands}, allOperations=${flags.allOperations}`,
    `Allowed rules: ${formatList(permissions.allow)}`,
    `Denied rules: ${formatList(permissions.deny)}`,
    `Learned patterns: ${patterns.length}`,
    `Auto-approval threshold: ${tracker.getThreshold()}`,
    '',
    'No approval rule is changed by this command.',
  ].join('\n'));
}
