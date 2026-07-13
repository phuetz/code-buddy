import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MEETING_NOTES_TOOL } from '../../src/codebuddy/tool-definitions/meeting-tools.js';
import type { MeetingNotesResult } from '../../src/meeting/index.js';
import { MeetingNotesTool } from '../../src/tools/meeting-notes-tool.js';
import { TOOL_METADATA } from '../../src/tools/metadata.js';
import { createInteractiveToolAdapters } from '../../src/tools/registry/interactive-adapters.js';
import { createMeetingTools } from '../../src/tools/registry/meeting-tools.js';
import {
  FormalToolRegistry,
  getFormalToolRegistry,
} from '../../src/tools/registry/tool-registry.js';
import { getToolRegistry } from '../../src/tools/registry.js';

// Keep host-persisted authored tools out of the built-in exposition assertions.
process.env.CODEBUDDY_LOAD_AUTHORED_TOOLS = 'false';

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  FormalToolRegistry.reset();
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function resultFixture(): MeetingNotesResult {
  const notes = {
    schemaVersion: 1 as const,
    generatedAt: '2026-07-12T08:00:00.000Z',
    language: 'fr',
    analysisMode: 'deterministic' as const,
    source: { kind: 'text' as const, name: 'sync.txt' },
    title: 'Sync équipe',
    summary: 'Résumé local.',
    keyPoints: ['Point'],
    participants: [],
    decisions: [],
    actionItems: [],
    openQuestions: [],
    transcript: [],
  };
  return { notes, markdown: '# Sync équipe\n', json: JSON.stringify(notes, null, 2) };
}

describe('meeting_notes contract and registry wiring', () => {
  it('exposes a local-only provider schema and validates arguments', () => {
    const tool = new MeetingNotesTool();
    const schema = tool.getSchema();
    expect(schema.name).toBe('meeting_notes');
    expect(schema.parameters.required).toEqual(['input_path']);
    expect(Object.keys(schema.parameters.properties ?? {})).toEqual([
      'input_path', 'language', 'output_prefix',
    ]);
    expect(MEETING_NOTES_TOOL.function.parameters.properties).not.toHaveProperty('use_ai');
    expect(tool.validate({ input_path: 'meetings/sync.txt' })).toEqual({ valid: true });
    expect(tool.validate({ input_path: '../secret.txt' }).valid).toBe(false);
    expect(tool.validate({ input_path: 'sync.txt', use_ai: true }).valid).toBe(false);
  });

  it('is present once in factories, RAG metadata, exposition, and interactive dispatch', async () => {
    expect(createMeetingTools().map((tool) => tool.name)).toEqual(['meeting_notes']);
    const interactive = createInteractiveToolAdapters({
      includeWindowsTools: false,
      includeSelfImproveTools: false,
    }).filter((tool) => tool.name === 'meeting_notes');
    expect(interactive).toHaveLength(1);
    const { getBuiltinToolNames, initializeToolRegistry } = await import('../../src/codebuddy/tools.js');
    expect(getBuiltinToolNames()).toContain('meeting_notes');

    const metadata = TOOL_METADATA.find((entry) => entry.name === 'meeting_notes');
    expect(metadata).toMatchObject({ category: 'document', priority: 8 });
    expect(metadata?.keywords).toEqual(expect.arrayContaining(['meeting', 'transcript', 'réunion']));

    initializeToolRegistry();
    expect(getToolRegistry().getEnabledTools().map((tool) => tool.function.name)).toContain('meeting_notes');
  });
});

describe('meeting_notes execution and workspace confinement', () => {
  it('executes through FormalToolRegistry with deterministic AI-off options', async () => {
    const workspace = await tempDir('meeting-tool-workspace-');
    const input = join(workspace, 'sync.txt');
    await writeFile(input, 'Alice: Bonjour.', 'utf8');
    const generate = vi.fn(async () => resultFixture());
    const tool = new MeetingNotesTool({ generate });
    const registry = getFormalToolRegistry();
    registry.register(tool);

    const response = await registry.execute(
      'meeting_notes',
      { input_path: 'sync.txt', language: 'fr' },
      { cwd: workspace },
    );

    expect(response.success).toBe(true);
    expect(response.output).toContain('# Sync équipe');
    expect(generate).toHaveBeenCalledWith(
      { kind: 'file', path: input },
      { language: 'fr', useAI: false },
    );
    expect((response.data as { paths: unknown }).paths).toBeNull();
  });

  it('writes paired reports only below the workspace and returns relative paths', async () => {
    const workspace = await tempDir('meeting-tool-output-');
    await writeFile(join(workspace, 'sync.txt'), 'Alice: Bonjour.', 'utf8');
    const tool = new MeetingNotesTool({ generate: async () => resultFixture() });

    const response = await tool.execute(
      { input_path: 'sync.txt', output_prefix: 'reports/sync' },
      { cwd: workspace },
    );

    expect(response.success).toBe(true);
    expect(await readFile(join(workspace, 'reports', 'sync.md'), 'utf8')).toBe('# Sync équipe\n');
    expect(JSON.parse(await readFile(join(workspace, 'reports', 'sync.json'), 'utf8'))).toMatchObject({ title: 'Sync équipe' });
    expect((response.data as { paths: unknown }).paths).toEqual({
      markdown: join('reports', 'sync.md'),
      json: join('reports', 'sync.json'),
    });
  });

  it('preserves existing report targets and removes a partial reservation', async () => {
    const workspace = await tempDir('meeting-tool-no-overwrite-');
    await writeFile(join(workspace, 'sync.txt'), 'Alice: Bonjour.', 'utf8');
    await writeFile(join(workspace, 'package.json'), '{"private":true}\n', 'utf8');
    const tool = new MeetingNotesTool({ generate: async () => resultFixture() });

    const response = await tool.execute(
      { input_path: 'sync.txt', output_prefix: 'package' },
      { cwd: workspace },
    );

    expect(response.success).toBe(false);
    expect(response.error).toContain('already exists');
    expect(await readFile(join(workspace, 'package.json'), 'utf8')).toBe('{"private":true}\n');
    await expect(readFile(join(workspace, 'package.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('cannot create auto-loaded instructions or reports under control directories', async () => {
    const workspace = await tempDir('meeting-tool-control-output-');
    await writeFile(join(workspace, 'sync.txt'), 'Alice: Bonjour.', 'utf8');
    const tool = new MeetingNotesTool({ generate: async () => resultFixture() });

    const instruction = await tool.execute(
      { input_path: 'sync.txt', output_prefix: 'AGENTS' },
      { cwd: workspace },
    );
    const nestedReadme = await tool.execute(
      { input_path: 'sync.txt', output_prefix: 'docs/new/README' },
      { cwd: workspace },
    );
    const controlDirectory = await tool.execute(
      { input_path: 'sync.txt', output_prefix: '.codebuddy/meeting' },
      { cwd: workspace },
    );

    expect(instruction.success).toBe(false);
    expect(instruction.error).toContain('auto-loaded instruction');
    expect(nestedReadme.success).toBe(false);
    expect(nestedReadme.error).toContain('auto-loaded instruction');
    expect(controlDirectory.success).toBe(false);
    expect(controlDirectory.error).toContain('control');

    const reportDirectory = join(workspace, 'reports');
    await mkdir(reportDirectory);
    const dangerousResult = resultFixture();
    dangerousResult.notes.title = 'README';
    const titleDerived = await new MeetingNotesTool({
      generate: async () => dangerousResult,
    }).execute(
      { input_path: 'sync.txt', output_prefix: 'reports' },
      { cwd: workspace },
    );
    expect(titleDerived.success).toBe(false);
    expect(titleDerived.error).toContain('auto-loaded instruction');
  });

  it('blocks traversal and absolute paths outside cwd before reading', async () => {
    const workspace = await tempDir('meeting-tool-inside-');
    const outside = await tempDir('meeting-tool-outside-');
    const outsideFile = join(outside, 'secret.txt');
    await writeFile(outsideFile, 'secret', 'utf8');
    const generate = vi.fn(async () => resultFixture());
    const tool = new MeetingNotesTool({ generate });

    const traversal = await tool.execute({ input_path: '../secret.txt' }, { cwd: workspace });
    const absolute = await tool.execute({ input_path: outsideFile }, { cwd: workspace });

    expect(traversal.success).toBe(false);
    expect(traversal.error).toContain('traversal');
    expect(absolute.success).toBe(false);
    expect(absolute.error).toContain('outside the active workspace');
    expect(generate).not.toHaveBeenCalled();
  });

  it('rejects sensitive and unsupported workspace files before analysis', async () => {
    const workspace = await tempDir('meeting-tool-sensitive-');
    await writeFile(join(workspace, '.env'), 'OPENROUTER_API_KEY=secret', 'utf8');
    await writeFile(join(workspace, 'database.sqlite'), 'not a transcript', 'utf8');
    const generate = vi.fn(async () => resultFixture());
    const tool = new MeetingNotesTool({ generate });

    const secret = await tool.execute({ input_path: '.env' }, { cwd: workspace });
    const unsupported = await tool.execute({ input_path: 'database.sqlite' }, { cwd: workspace });

    expect(secret.success).toBe(false);
    expect(secret.error).toContain('Sensitive files');
    expect(unsupported.success).toBe(false);
    expect(unsupported.error).toContain('Unsupported meeting input extension');
    expect(generate).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform === 'win32')('blocks input and output symlinks escaping cwd', async () => {
    const workspace = await tempDir('meeting-tool-symlink-in-');
    const outside = await tempDir('meeting-tool-symlink-out-');
    const outsideFile = join(outside, 'secret.txt');
    await writeFile(outsideFile, 'secret', 'utf8');
    await symlink(outsideFile, join(workspace, 'linked.txt'));
    await mkdir(join(outside, 'reports'));
    await symlink(join(outside, 'reports'), join(workspace, 'reports'));
    await writeFile(join(workspace, 'safe.txt'), 'safe', 'utf8');
    const generate = vi.fn(async () => resultFixture());
    const tool = new MeetingNotesTool({ generate });

    const inputEscape = await tool.execute({ input_path: 'linked.txt' }, { cwd: workspace });
    const outputEscape = await tool.execute(
      { input_path: 'safe.txt', output_prefix: 'reports/sync' },
      { cwd: workspace },
    );

    expect(inputEscape.success).toBe(false);
    expect(inputEscape.error).toContain('symlink outside');
    expect(outputEscape.success).toBe(false);
    expect(outputEscape.error).toContain('symlink outside');
  });
});
