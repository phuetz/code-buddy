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
});
