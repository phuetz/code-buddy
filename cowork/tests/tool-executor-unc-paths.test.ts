import { describe, expect, it } from 'vitest';
import { ToolExecutor } from '../src/main/tools/tool-executor';
import { SandboxToolExecutor } from '../src/main/tools/sandbox-tool-executor';

const mockPathResolver = {
  getMounts: () => [{ real: '/tmp/project', virtual: '/workspace' }],
  resolve: () => null,
};

describe('tool executors treat UNC paths as absolute', () => {
  it('does not resolve UNC paths relative to the mounted workspace in ToolExecutor', () => {
    const executor = new ToolExecutor(mockPathResolver as never);
    expect(() =>
      (executor as unknown as { resolveWorkspacePath: (sessionId: string, path: string) => string }).resolveWorkspacePath('session-1', '\\\\server\\share\\report.txt')
    ).toThrow('Path is outside the mounted workspace');
  });

  it('does not resolve UNC paths relative to the mounted workspace in SandboxToolExecutor', () => {
    const executor = new SandboxToolExecutor(mockPathResolver as never, {} as never);
    expect(() =>
      (executor as unknown as { resolveWorkspacePath: (sessionId: string, path: string) => string }).resolveWorkspacePath('session-1', '\\\\server\\share\\report.txt')
    ).toThrow('Path is outside the mounted workspace');
  });
});
