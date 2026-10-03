import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplyPatchTool } from '../../src/tools/apply-patch.js';

let directory: string;
const original = 'export const original = true;\n';
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-patch-hunks-'));
  fs.writeFileSync(path.join(directory, 'target.ts'), original);
  vi.stubEnv('CODEBUDDY_DIFF_REVIEW', 'off');
  vi.stubEnv('CODEBUDDY_SHADOW_WORKSPACE', 'false');
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(directory, { recursive: true, force: true });
});

const patch = (body: string) => `*** Begin Patch\n${body}\n*** End Patch`;

describe('apply_patch ne prétend pas appliquer une mise à jour sans hunk', () => {
  it.each([
    ['plage de lignes au lieu de @@', '--- 204,215 ---\n/** @internal */\ninterface Input {}'],
    ['corps sans en-tête', '-export const original = true;\n+export const original = false;'],
    ['aucun corps', ''],
    ['hunk vide', '@@'],
    ['ligne non préfixée dans le hunk', '@@\n-export const original = true;\n+export const original = false;\nignored code'],
    ['contexte seul', '@@\n export const original = true;'],
  ])('refuse %s et laisse tous les fichiers intacts', async (_label, body) => {
    const result = await new ApplyPatchTool().execute({ patch: patch(
      '*** Add File: earlier.ts\n+must not be written\n*** Update File: target.ts\n' + body,
    ) }, directory);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/hunk|change|patch/i);
    expect(fs.readFileSync(path.join(directory, 'target.ts'), 'utf8')).toBe(original);
    expect(fs.existsSync(path.join(directory, 'earlier.ts'))).toBe(false);
  });

  it('applique une vraie modification', async () => {
    const result = await new ApplyPatchTool().execute({ patch: patch(
      '*** Update File: target.ts\n@@\n-export const original = true;\n+export const original = false;',
    ) }, directory);
    expect(result.success).toBe(true);
    expect(fs.readFileSync(path.join(directory, 'target.ts'), 'utf8')).toBe('export const original = false;\n');
  });

  it('conserve le déplacement sans modification du contenu', async () => {
    const result = await new ApplyPatchTool().execute({ patch: patch(
      '*** Update File: target.ts\n*** Move to: renamed.ts',
    ) }, directory);
    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(directory, 'target.ts'))).toBe(false);
    expect(fs.readFileSync(path.join(directory, 'renamed.ts'), 'utf8')).toBe(original);
  });
});

describe('apply_patch expose les erreurs même après une écriture', () => {
  it('refuse le statut succès quand tous les hunks de mise à jour échouent', async () => {
    const result = await new ApplyPatchTool().execute({ patch: patch(
      '*** Update File: target.ts\n@@\n-missing line\n+replacement',
    ) }, directory);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Hunk failed');
    expect(fs.readFileSync(path.join(directory, 'target.ts'), 'utf8')).toBe(original);
  });

  it('signale une application partielle et conserve le détail des fichiers déjà écrits', async () => {
    const result = await new ApplyPatchTool().execute({ patch: patch(
      '*** Add File: earlier.ts\n+created\n*** Update File: target.ts\n@@\n-export const original = true;\n+export const original = false;\n@@\n-missing line\n+replacement',
    ) }, directory);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Hunk failed');
    expect(result.error).toContain('earlier.ts');
    expect(result.error).toContain('target.ts');
    expect(fs.readFileSync(path.join(directory, 'earlier.ts'), 'utf8')).toBe('created');
    expect(fs.readFileSync(path.join(directory, 'target.ts'), 'utf8')).toBe('export const original = false;\n');
  });
});
