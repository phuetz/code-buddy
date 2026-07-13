import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from 'electron';
import { WorkflowBridge } from '../src/main/workflows/workflow-bridge';

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

describe('WorkflowBridge persistence', () => {
  let userDataPath: string;

  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'cowork-workflows-'));
    vi.spyOn(app, 'getPath').mockReturnValue(userDataPath);
  });

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true });
  });

  it('quarantines an invalid workflows file before creating a new one', () => {
    const bridge = new WorkflowBridge();
    const workflowDir = join(userDataPath, 'workflows');
    const workflowPath = join(workflowDir, 'workflows.json');
    writeFileSync(workflowPath, '{truncated', 'utf8');

    expect(bridge.list()).toEqual([]);
    expect(existsSync(workflowPath)).toBe(false);
    const corruptName = readdirSync(workflowDir).find((name) =>
      name.startsWith('workflows.json.corrupt-')
    );
    expect(corruptName).toBeDefined();
    expect(readFileSync(join(workflowDir, corruptName!), 'utf8')).toBe('{truncated');

    bridge.create({ name: 'Recovered', nodes: [], edges: [] });
    expect(JSON.parse(readFileSync(workflowPath, 'utf8'))).toHaveLength(1);
    expect(readFileSync(join(workflowDir, corruptName!), 'utf8')).toBe('{truncated');
  });

  it('keeps the persisted file and cache unchanged when the atomic write fails', () => {
    const bridge = new WorkflowBridge();
    const original = bridge.create({ name: 'Original', nodes: [], edges: [] });
    const workflowPath = join(userDataPath, 'workflows', 'workflows.json');
    const before = readFileSync(workflowPath, 'utf8');

    mkdirSync(`${workflowPath}.tmp`);
    expect(() => bridge.create({ name: 'Not persisted', nodes: [], edges: [] })).toThrow();

    expect(readFileSync(workflowPath, 'utf8')).toBe(before);
    expect(bridge.list().map((workflow) => workflow.id)).toEqual([original.id]);
  });
});
