import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { registerScaffoldIpc, SCAFFOLD_CHANNELS } from '../src/main/studio/scaffold-ipc';
import type { ScaffoldService } from '../src/main/studio/scaffold-service';
import { assertTrustedRoot } from '../src/main/studio/studio-versions-service';

it('registers only the successfully generated project before returning it', async () => {
  const base = await mkdtemp(join(tmpdir(), 'studio-workspaces-'));
  const project = join(base, 'created');
  const sibling = join(base, 'other');
  await mkdir(project); await mkdir(sibling);
  const roots: string[] = [];
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  const service = { listTemplates: () => [], scaffoldProject: vi.fn(async () => ({ ok: true, data: { projectDir: project, files: [] } })) };
  try {
    registerScaffoldIpc({ handle: (channel, handler) => { handlers.set(channel, handler); } }, service as unknown as ScaffoldService, async (root) => { roots.push(root); });
    const generate = handlers.get(SCAFFOLD_CHANNELS.generate)!;
    await generate({}, { targetDir: project, template: 'react-ts' });
    await expect(assertTrustedRoot(project, () => roots)).resolves.toBe(project);
    await expect(assertTrustedRoot(sibling, () => roots)).rejects.toThrow('outside trusted workspaces');
    roots.length = 0;
    service.scaffoldProject.mockResolvedValueOnce({ ok: false, error: 'generation failed' } as never);
    await generate({}, { targetDir: sibling, template: 'react-ts' });
    expect(roots).toEqual([]);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
