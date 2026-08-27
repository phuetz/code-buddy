/**
 * Le second chemin de la « famille cwd embarqué ». `bash-tool.ts` a été corrigé
 * (`isBareChangeDirectory`) pour ne traiter comme changement de répertoire qu'un
 * `cd` SEUL, mais `tool-handler.ts` (le chemin headless/streaming) gardait le
 * `command.startsWith('cd ')` naïf : `cd /repo && node --test && git status` était
 * stat comme un répertoire entier → « Cannot change directory … &&  … », et l'agent
 * headless ne lançait plus ses tests. Mesuré en conditions réelles le 27/08/2026.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToolHandler } from '../../src/agent/tool-handler.js';
import type { ToolResult } from '../../src/types/index.js';

type WithPrivate = {
  changeSessionDirectory(command: string, baseCwd: string): ToolResult | null;
  getWorkingDirectory(): string;
};

describe('ToolHandler — `cd` composé ne doit pas être traité comme un changement de répertoire', () => {
  let handler: ToolHandler;
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'th-cd-compound-'));
    handler = new ToolHandler({
      checkpointManager: { checkpointBeforeCreate: vi.fn(), checkpointBeforeEdit: vi.fn() } as never,
      hooksManager: { executeHooks: vi.fn().mockResolvedValue([]) } as never,
      marketplace: { executeTool: vi.fn() } as never,
      repairCoordinator: { isRepairEnabled: vi.fn(() => false) } as never,
    });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('laisse passer `cd <dir> && cmd` au shell (retourne null), sans stat la chaîne entière', () => {
    const result = (handler as unknown as WithPrivate).changeSessionDirectory(
      `cd ${dir} && node --test && git status --short`,
      dir,
    );
    // null = non intercepté → exécution shell normale, où `cd X && Y` a son sens.
    expect(result).toBeNull();
  });

  it('ne se laisse pas berner par un `cd` suivi d’un `;` ou d’un `|`', () => {
    expect(
      (handler as unknown as WithPrivate).changeSessionDirectory(`cd ${dir}; ls`, dir),
    ).toBeNull();
    expect(
      (handler as unknown as WithPrivate).changeSessionDirectory(`cd ${dir} | cat`, dir),
    ).toBeNull();
  });

  it('change toujours le répertoire pour un `cd <dir>` SEUL (pas de régression)', () => {
    const result = (handler as unknown as WithPrivate).changeSessionDirectory(`cd ${dir}`, dir);
    expect(result?.success).toBe(true);
    expect(fs.realpathSync((handler as unknown as WithPrivate).getWorkingDirectory())).toBe(
      fs.realpathSync(dir),
    );
  });

  it('rejette proprement un `cd <dir>` SEUL vers un répertoire inexistant', () => {
    const result = (handler as unknown as WithPrivate).changeSessionDirectory(
      `cd ${path.join(dir, 'nexistepas')}`,
      dir,
    );
    expect(result?.success).toBe(false);
    expect(result?.error).toMatch(/Cannot change directory/);
  });
});
