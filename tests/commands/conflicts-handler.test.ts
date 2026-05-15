import { handleConflicts } from '../../src/commands/handlers/conflicts-handler';

const executeResolveConflicts = jest.fn();

jest.mock('../../src/tools/merge-conflict-tool.js', () => ({
  executeResolveConflicts: (...args: unknown[]) => executeResolveConflicts(...args),
}));

describe('handleConflicts', () => {
  beforeEach(() => {
    executeResolveConflicts.mockReset();
  });

  it('does not report scan success when the conflict tool fails without details', async () => {
    executeResolveConflicts.mockResolvedValueOnce({ success: false });

    const result = await handleConflicts(['scan']);

    expect(result.entry?.content).toBe('Conflict command failed without error details.');
  });

  it('reports empty successful scans explicitly', async () => {
    executeResolveConflicts.mockResolvedValueOnce({ success: true, output: '   ' });

    const result = await handleConflicts(['scan']);

    expect(result.entry?.content).toBe('Conflict scan completed with no details.');
  });

  it('does not report resolve success when the conflict tool fails without details', async () => {
    executeResolveConflicts.mockResolvedValueOnce({ success: false });

    const result = await handleConflicts(['resolve', 'src/file.ts', 'ours']);

    expect(result.entry?.content).toBe('Conflict command failed without error details.');
  });
});
