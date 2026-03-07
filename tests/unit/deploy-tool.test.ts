/**
 * Deploy Tool Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeployTool, resetDeployTool, getDeployTool } from '../../src/tools/deploy-tool.js';

// Mock child_process
vi.mock('child_process', () => ({
  execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
    if (cb) cb(null, { stdout: 'deployed ok', stderr: '' });
  }),
}));

vi.mock('util', async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    promisify: (fn: Function) => {
      return async (...args: unknown[]) => {
        return new Promise((resolve, reject) => {
          fn(...args, (err: Error | null, result: unknown) => {
            if (err) reject(err);
            else resolve(result);
          });
        });
      };
    },
  };
});

describe('DeployTool', () => {
  beforeEach(() => {
    resetDeployTool();
    vi.clearAllMocks();
  });

  describe('singleton', () => {
    it('returns same instance', () => {
      expect(getDeployTool()).toBe(getDeployTool());
    });

    it('resetDeployTool creates new instance', () => {
      const a = getDeployTool();
      resetDeployTool();
      expect(getDeployTool()).not.toBe(a);
    });
  });

  describe('generate_config', () => {
    it('generates fly.io config', async () => {
      const tool = new DeployTool();
      const result = await tool.execute({
        action: 'generate_config',
        platform: 'fly',
        appName: 'my-app',
        region: 'iad',
        port: 3000,
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('fly.toml');
      expect(result.output).toContain('my-app');
    });

    it('generates railway config', async () => {
      const tool = new DeployTool();
      const result = await tool.execute({
        action: 'generate_config',
        platform: 'railway',
        appName: 'test-app',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('railway.json');
    });

    it('generates render config', async () => {
      const tool = new DeployTool();
      const result = await tool.execute({
        action: 'generate_config',
        platform: 'render',
        appName: 'render-app',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('render.yaml');
    });

    it('generates gcp config', async () => {
      const tool = new DeployTool();
      const result = await tool.execute({
        action: 'generate_config',
        platform: 'gcp',
        appName: 'gcp-app',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('app.yaml');
    });

    it('generates hetzner config', async () => {
      const tool = new DeployTool();
      const result = await tool.execute({
        action: 'generate_config',
        platform: 'hetzner',
        appName: 'hetzner-app',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('cloud-init');
    });

    it('generates northflank config', async () => {
      const tool = new DeployTool();
      const result = await tool.execute({
        action: 'generate_config',
        platform: 'northflank',
        appName: 'nf-app',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('northflank.json');
    });

    it('uses default app name when not provided', async () => {
      const tool = new DeployTool();
      const result = await tool.execute({
        action: 'generate_config',
        platform: 'fly',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('codebuddy-app');
    });
  });

  describe('unknown action', () => {
    it('returns error for unknown action', async () => {
      const tool = new DeployTool();
      const result = await tool.execute({
        action: 'unknown' as never,
        platform: 'fly',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown action');
    });
  });
});
