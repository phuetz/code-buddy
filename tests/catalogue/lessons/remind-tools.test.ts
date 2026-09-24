import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { RemindTool } from '../../../src/tools/registry/remind-tools.js';

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

describe('Remind Tool', () => {
  let tempDir: string;
  let originalCodebuddyHome: string | undefined;

  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-remind-test-'));
    originalEnv.CODEBUDDY_HOME = process.env.CODEBUDDY_HOME;
    originalEnv.CODEBUDDY_REMINDERS_FILE = process.env.CODEBUDDY_REMINDERS_FILE;
    
    process.env.CODEBUDDY_HOME = tempDir;
    process.env.CODEBUDDY_REMINDERS_FILE = path.join(tempDir, 'reminders.json');
  });

  afterEach(() => {
    for (const key of ['CODEBUDDY_HOME', 'CODEBUDDY_REMINDERS_FILE']) {
      if (originalEnv[key] !== undefined) {
        process.env[key] = originalEnv[key];
      } else {
        delete process.env[key];
      }
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('remind sets a new reminder successfully', async () => {
    const tool = new RemindTool();
    // Use a unique label so if it accidentally wrote to the global file earlier we don't fail
    const uniqueLabel = 'rappel-train-essai';
    const homeBefore = fingerprintHome();
    const res = await tool.execute({
      label: uniqueLabel,
      date: '2027-01-01',
      time: '10:38',
      leadMinutes: 30
    }, { cwd: tempDir } as any);

    expect(res.success).toBe(true);
    expect(res.output).toContain(uniqueLabel);
    expect(fingerprintHome()).toBe(homeBefore);

    // Verify it was written to temp directory
    const tempDb = path.join(tempDir, 'reminders.json');
    expect(fs.existsSync(tempDb)).toBe(true);
    const tempDbContent = fs.readFileSync(tempDb, 'utf8');
    expect(tempDbContent).toContain(uniqueLabel);
    expect(tempDbContent).toContain('10:08'); // (10:38 - 30 mins)
  });
});
