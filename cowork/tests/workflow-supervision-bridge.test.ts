import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkflowBridge } from '../src/main/workflows/workflow-bridge';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('WorkflowBridge supervision wiring', () => {
  it('records compile failures and replays the stored snapshot through the same compiler', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'workflow-bridge-supervision-'));
    directories.push(directory);
    const bridge = new WorkflowBridge(directory);
    const saved = bridge.create({
      name: 'Invalid until configured',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', position: { x: 0, y: 0 } },
        { id: 'tool', type: 'tool', name: 'Tool', position: { x: 1, y: 0 } },
        { id: 'end', type: 'end', name: 'End', position: { x: 2, y: 0 } },
      ],
      edges: [
        { id: 'a', source: 'start', target: 'tool' },
        { id: 'b', source: 'tool', target: 'end' },
      ],
    });

    expect(bridge.preview(saved.id)).toMatchObject({ valid: false });
    const first = await bridge.run(saved.id, { password: 'not-persisted' });
    expect(first).toMatchObject({ success: false, runId: expect.any(String) });
    expect(bridge.history(saved.id)).toHaveLength(1);
    expect(bridge.history(saved.id)[0].initialContext.password).toBe('[REDACTED]');

    const replay = await bridge.replay(first.runId!);
    expect(replay).toMatchObject({
      success: false,
      runId: expect.any(String),
      error: expect.stringContaining('Secret input required'),
    });
    const records = bridge.history(saved.id);
    expect(records).toHaveLength(2);
    expect(records[0].replayOf).toBe(first.runId);
    expect(records[0].diagnostic?.category).toBe('secret_input');
    expect(bridge.compareRuns(records[1].id, records[0].id)?.sameDefinition).toBe(true);
  });
});
