import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowGuardMiddleware } from '../../../src/agent/middleware/workflow-guard.js';
import type { MiddlewareContext } from '../../../src/agent/middleware/types.js';
import { capCompactToolList, HEADLESS_LOCAL_COMPACT_ALWAYS_INCLUDE } from '../../../src/config/headless-local-prompt.js';

let directory: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-plan-schema-'));
  vi.spyOn(process, 'cwd').mockReturnValue(directory);
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(directory, { recursive: true, force: true }); });

describe('consigne de plan et schémas disponibles', () => {
  it.each([true, false])('ne prescrit aucun outil absent (sélection disponible : %s)', selected => {
    const exposed = capCompactToolList([...HEADLESS_LOCAL_COMPACT_ALWAYS_INCLUDE, 'restore_context', 'plan']
      .map(name => ({ function: { name } })));
    expect(exposed.some(tool => tool.function.name === 'plan')).toBe(false);
    const context: MiddlewareContext = {
      toolRound: 0, maxToolRounds: 50, sessionCost: 0, sessionCostLimit: 10,
      inputTokens: 100, outputTokens: 0, history: [], isStreaming: false,
      messages: [{ role: 'user', content: 'Create a module, fix the tests and update the docs.' }],
      ...(selected ? { tools: exposed } : {}),
    };
    const result = new WorkflowGuardMiddleware().beforeTurn(context);
    expect(result.action).toBe('warn');
    expect(result.message).toContain('PLAN.md');
    const prescribed = [...(result.message ?? '').matchAll(/`([a-z_][a-z0-9_]*)` tool/gi)].map(match => match[1]);
    const available = new Set((context.tools ?? []).map(tool => tool.function.name));
    expect(prescribed.filter(name => !available.has(name!))).toEqual([]);
  });

  // Banc harnais 2026-10-03 : `?? PLAN.md` laissé à la racine sur B-27b-1, B-4b-1,
  // C-4b-1, C-4b-2 (Astra) et sol61 B/C — la consigne « git status vide » échouait.
  it('suggère le plan dans le dossier d’état auto-ignoré, pas à la racine du dépôt', () => {
    const context: MiddlewareContext = {
      toolRound: 0, maxToolRounds: 50, sessionCost: 0, sessionCostLimit: 10,
      inputTokens: 100, outputTokens: 0, history: [], isStreaming: false,
      messages: [{ role: 'user', content: 'Create a module, fix the tests and update the docs.' }],
    };
    const message = new WorkflowGuardMiddleware().beforeTurn(context).message ?? '';
    expect(message).toContain('.codebuddy/PLAN.md');
    expect(message.replaceAll('.codebuddy/PLAN.md', '')).not.toMatch(/creating PLAN\.md/);
  });

  it('l’audit de complétion lit .codebuddy/PLAN.md en l’absence de PLAN.md racine', async () => {
    const { PlanCompletionAuditMiddleware } = await import('../../../src/agent/middleware/plan-completion-audit.js');
    fs.mkdirSync(path.join(directory, '.codebuddy'));
    fs.writeFileSync(path.join(directory, '.codebuddy', 'PLAN.md'), '- [ ] écrire le test rouge\n');
    const audit = new PlanCompletionAuditMiddleware({ planPath: path.join(directory, 'PLAN.md') });
    const open = await (audit as unknown as { readOpenItems(): Promise<Array<{ text: string }>> }).readOpenItems();
    expect(open.map(item => item.text)).toEqual(['écrire le test rouge']);
  });
});
