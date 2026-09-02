import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('/batch TUI wiring', () => {
  it('awaits handleBatchSlashCommand instead of announcing initiation', () => {
    const source = readFileSync(
      new URL('../../src/commands/enhanced-command-handler.ts', import.meta.url),
      'utf8',
    );
    const batchBlock = source.slice(
      source.indexOf("['__BATCH__'"),
      source.indexOf("['__CLEAR_CHAT__'"),
    );
    expect(batchBlock).toContain('handleBatchSlashCommand(args)');
    expect(batchBlock).not.toContain('Batch command initiated');
    expect(batchBlock).not.toContain('asyncAction');
  });
});
