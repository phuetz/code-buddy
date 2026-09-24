/**
 * Chaque gestionnaire slash corrigé pose failed sur au moins un échec.
 * Le pont headless ne déduit pas l'échec du texte. Les aides restent des succès.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { handleLogin, handleLogout } from '../../src/commands/handlers/auth-handlers.js';
import { handleBtw } from '../../src/commands/handlers/btw-handler.js';
import { handleSubagent } from '../../src/commands/handlers/subagent-handler.js';
import { handleAgent } from '../../src/commands/handlers/agent-handlers.js';
import { handleAgents } from '../../src/commands/handlers/agents-handler.js';
import { handleBug } from '../../src/commands/handlers/bug-handler.js';
import { handleBatchSlashCommand } from '../../src/commands/handlers/batch-handlers.js';
import { handleMerge } from '../../src/commands/handlers/branch-handlers.js';
import { handleChangeMode } from '../../src/commands/handlers/missing-handlers.js';
import { handleCloud } from '../../src/commands/handlers/cloud-handlers.js';
import { handleDailyReset } from '../../src/commands/handlers/daily-reset-handler.js';
import { handleFCS } from '../../src/commands/handlers/fcs-handlers.js';
import { handleFleet } from '../../src/commands/handlers/fleet-handler.js';
import { handleHeartbeat } from '../../src/commands/handlers/heartbeat-handler.js';
import { handleHistory } from '../../src/commands/handlers/history-handlers.js';
import { handlePermissions } from '../../src/commands/handlers/permissions-handlers.js';
import { handlePersonaCommand } from '../../src/commands/handlers/persona-handler.js';
import { handleShare } from '../../src/commands/handlers/team-session-handler.js';
import { handleStarter } from '../../src/commands/handlers/starter-handlers.js';
import { handleSuggest } from '../../src/commands/handlers/suggest-handler.js';
import { handleTransform } from '../../src/commands/handlers/transform-handler.js';
import { handleAvatar } from '../../src/commands/handlers/ui-handlers.js';
import { announcesSlashFailure } from '../../src/commands/slash-failure.js';

interface SlashResult {
  failed?: boolean;
  entry?: { content?: string };
  output?: string;
  response?: string;
  error?: string;
}

interface FailureCase {
  handler: string;
  run: () => SlashResult | Promise<SlashResult>;
  needle: string;
}

const cases: FailureCase[] = [
  {
    handler: 'handleFCS validate',
    run: () => handleFCS(['validate', 'missing.fcs']),
    needle: `Script not found: ${path.resolve(process.cwd(), 'missing.fcs')}`,
  },
  {
    handler: 'handleFCS parse',
    run: () => handleFCS(['parse']),
    needle: 'Usage: /fcs parse',
  },
  {
    handler: 'handleFCS list',
    run: () => handleFCS(['list', path.join(os.tmpdir(), 'slash-exit-missing-dir')]),
    needle: 'Directory not found:',
  },
  {
    handler: 'handleAgents',
    run: () => handleAgents(['not-an-action']),
    needle: 'Unknown agents action:',
  },
  {
    handler: 'handleBug',
    run: () => handleBug(['--severity', 'nope']),
    needle: 'Invalid severity filter:',
  },
  {
    handler: 'handleSuggest',
    run: () => handleSuggest(['nope']),
    needle: 'Unknown suggestion category:',
  },
  {
    handler: 'handleHeartbeat',
    run: () => handleHeartbeat(['nope']),
    needle: 'Unknown heartbeat action:',
  },
  {
    handler: 'handleDailyReset',
    run: () => handleDailyReset(['nope']),
    needle: 'Unknown daily-reset action:',
  },
  {
    handler: 'handleLogin',
    run: () => handleLogin(['nope']),
    needle: 'Unknown provider:',
  },
  {
    handler: 'handlePermissions',
    run: () => handlePermissions(['add']),
    needle: 'Usage: /permissions add',
  },
  {
    handler: 'handleCloud',
    run: () => handleCloud(['cancel']),
    needle: 'Usage: cloud cancel',
  },
  {
    handler: 'handleFleet',
    run: () => handleFleet(['nope']),
    needle: 'Unknown fleet action:',
  },
  {
    handler: 'handleShare',
    run: () => handleShare(['nope']),
    needle: 'Unknown share action:',
  },
  {
    handler: 'handleTransform',
    run: () => handleTransform(['nope']),
    needle: 'Unknown transformation type:',
  },
  {
    handler: 'handleChangeMode',
    run: () => handleChangeMode(['nope']),
    needle: 'Unknown mode:',
  },
  {
    handler: 'handlePersonaCommand',
    run: () => handlePersonaCommand('use missing-persona'),
    needle: 'not found',
  },
  {
    handler: 'handleStarter',
    run: () => handleStarter(['search']),
    needle: 'Usage: /starter search',
  },
  {
    handler: 'handleHistory',
    run: () => handleHistory(['limit', '1']),
    needle: 'Invalid limit',
  },
  {
    handler: 'handleBatchSlashCommand',
    run: () => handleBatchSlashCommand([]),
    needle: 'Usage: /batch',
  },
  {
    handler: 'handleAvatar',
    run: () => handleAvatar(['missing-preset']),
    needle: 'not found',
  },
  {
    handler: 'handleAgent',
    run: () => handleAgent(['info']),
    needle: 'Usage: /agent info',
  },
  {
    handler: 'handleMerge',
    run: () => handleMerge([]),
    needle: 'Usage: /merge',
  },
  {
    handler: 'handleLogout',
    run: () => handleLogout(['nope']),
    needle: 'Unknown provider:',
  },
  {
    handler: 'handleBtw',
    run: () => handleBtw([]),
    needle: 'Usage: /btw',
  },
  {
    handler: 'handleSubagent',
    run: () => handleSubagent(['info', 'no-such-subagent']),
    needle: 'not found',
  },
];

function textOf(result: SlashResult): string {
  if (typeof result.entry?.content === 'string') return result.entry.content;
  if (typeof result.output === 'string') return result.output;
  if (typeof result.response === 'string') return result.response;
  if (typeof result.error === 'string') return result.error;
  return '';
}

describe('échecs slash : le drapeau failed est posé', () => {
  it.each(cases)('$handler annonce un échec et pose failed', async ({ run, needle }) => {
    const result = await run();
    const text = textOf(result);
    expect(text, text).toContain(needle);
    expect(result.failed, text).toBe(true);
  });

  it('/fcs validate fichier valide ne pose pas failed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slash-exit-fcs-'));
    const file = path.join(dir, 'ok.fcs');
    fs.writeFileSync(file, 'let x = 10\n');
    try {
      const result = handleFCS(['validate', file]);
      expect(result).not.toBeInstanceOf(Promise);
      if (result instanceof Promise) return;
      const text = textOf(result);
      expect(text, text).toContain('FCS Script Valid:');
      expect(result.failed, text).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("/fcs sans argument reste l'aide", () => {
    const result = handleFCS([]);
    expect(result).not.toBeInstanceOf(Promise);
    if (result instanceof Promise) return;
    const text = textOf(result);
    expect(text, text).toContain('FileCommander Script');
    expect(result.failed, text).toBeUndefined();
  });

  it('une page d\'aide qui commence par Usage n\'est pas un échec', () => {
    const help = 'Usage: /agents <action> [args]\n\nActions:\n  status  Show state\n';
    expect(announcesSlashFailure(help)).toBe(false);
    expect(announcesSlashFailure('Script not found: missing.fcs')).toBe(true);
    expect(announcesSlashFailure('No potential bugs found.')).toBe(false);
    expect(announcesSlashFailure('No starter pack found for "zzz".')).toBe(true);
  });
});
