import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SELF_EVOLUTION_TOOL } from '../../src/codebuddy/tool-definitions/self-evolution-tools.js';
import { SelfEvolutionTool } from '../../src/tools/registry/self-evolution-tools.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('self_evolution', () => {
  it('is exposed, dispatched, read-only, and never fleet-safe', () => {
    const tool = new SelfEvolutionTool();
    expect(SELF_EVOLUTION_TOOL.function.name).toBe('self_evolution');
    expect(tool.getSchema().name).toBe('self_evolution');
    expect(tool.getMetadata()).toMatchObject({
      name: 'self_evolution',
      modifiesFiles: false,
      makesNetworkRequests: false,
      requiresConfirmation: false,
    });
    expect(tool.getMetadata().fleetSafe).toBeUndefined();
    expect(tool.validate({ since: '2026-09-03', limit: 3 }).valid).toBe(true);
    expect(tool.validate({ since: 'tomorrow' }).valid).toBe(false);
  });

  it('answers from local notes with date and subject filters', async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), '.evo1-test-'));
    roots.push(root);
    await fs.writeFile(
      path.join(root, 'CHANGELOG.md'),
      '## [Unreleased]\n\n### Voix plus fiable — 2026-09-03\n\n- La voix distingue mieux les échanges.\n',
      'utf8',
    );

    const result = await new SelfEvolutionTool().execute(
      { since: '2026-09-03', subject: 'voix', limit: 2 },
      { cwd: root },
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain('Voix plus fiable');
    expect((result.data as { notes: unknown[] }).notes).toHaveLength(1);
  });
});
