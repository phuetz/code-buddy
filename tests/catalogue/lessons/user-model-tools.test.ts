import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { UserModelObserveTool, UserModelRecallTool } from '../../../src/tools/registry/user-model-tools.js';

function fingerprintHome(): string {
  const root = path.join(os.homedir(), '.codebuddy');
  if (!fs.existsSync(root)) return '';
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile()) files.push(full);
    }
  };
  walk(root);
  return files.sort().map((file) => file + '\n' + fs.readFileSync(file, 'utf8')).join('\n---\n');
}

describe('User Model Tools', () => {
  let tempDir: string;
  let originalCodebuddyHome: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-user-model-test-'));
    originalCodebuddyHome = process.env.CODEBUDDY_HOME;
    process.env.CODEBUDDY_HOME = tempDir;
  });

  afterEach(() => {
    if (originalCodebuddyHome !== undefined) {
      process.env.CODEBUDDY_HOME = originalCodebuddyHome;
    } else {
      delete process.env.CODEBUDDY_HOME;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('user_model_observe creates an observation successfully', async () => {
    const tool = new UserModelObserveTool();
    const homeBefore = fingerprintHome();
    const res = await tool.execute({
      kind: 'preference',
      content: 'Prefers writing tests first'
    }, { cwd: tempDir } as any);

    expect(res.success).toBe(true);
    expect(res.output).toMatch(/Proposed observation.*Prefers writing tests first/);
    expect(fingerprintHome()).toBe(homeBefore);
    const stored = fs.readFileSync(path.join(tempDir, '.codebuddy', 'user-model.json'), 'utf8');
    expect(stored).toContain('Prefers writing tests first');
    expect(stored).toContain('pending');
  });

  it('user_model_recall returns empty when no accepted observations exist', async () => {
    const tool = new UserModelRecallTool();
    const res = await tool.execute({}, { cwd: tempDir } as any);

    expect(res.success).toBe(true);
    expect(res.output).toContain('No accepted observations about the user yet.');
  });

  it('user_model_recall returns known observations after one is manually added', async () => {
    // Add a mocked accepted observation to the user model file in tempDir
    const userModelPath = path.join(tempDir, '.codebuddy', 'user-model.json');
    fs.mkdirSync(path.dirname(userModelPath), { recursive: true });
    
    const db = {
      schemaVersion: 1,
      observations: [
        {
          id: 'test-obs-1',
          kind: 'expertise',
          content: 'Expert in TypeScript',
          status: 'accepted',
          confidence: 0.9,
          createdAt: Date.now(),
          source: 'self_observed'
        }
      ]
    };
    fs.writeFileSync(userModelPath, JSON.stringify(db));

    const tool = new UserModelRecallTool();
    const res = await tool.execute({ kind: 'expertise' }, { cwd: tempDir } as any);

    expect(res.success).toBe(true);
    expect(res.output).toContain('Expert in TypeScript');
  });

  it('fails to observe private information', async () => {
    const tool = new UserModelObserveTool();
    const res = await tool.execute({
      kind: 'preference',
      content: 'My password is password123'
    }, { cwd: tempDir } as any);

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Record only working preferences/);
  });
});
