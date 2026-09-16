/**
 * Tests for /persona slash command handler.
 */
import * as path from 'node:path';
import { makeTmpDir, removeTmpDir } from './helpers/tmp.js';
import { handlePersonaCommand } from '../src/commands/handlers/persona-handler.js';
import { getPersonaManager, resetPersonaManager } from '../src/personas/persona-manager.js';

const qaRoot = path.join(process.cwd(), '_qa', 'persona1');

// Mock fs-extra to avoid disk I/O
jest.mock('fs-extra', () => {
  const impl = {
  ensureDir: jest.fn().mockResolvedValue(undefined),
  readdir: jest.fn().mockResolvedValue([]),
  readJSON: jest.fn().mockRejectedValue(new Error('not found')),
  writeJSON: jest.fn().mockResolvedValue(undefined),
  remove: jest.fn().mockResolvedValue(undefined),
  pathExists: jest.fn().mockResolvedValue(false),
  watch: jest.fn().mockReturnValue({ close: jest.fn() }),
};
  return { ...impl, default: impl };
});

describe('/persona handler', () => {
  let customPersonasDir: string;

  beforeEach(async () => {
    customPersonasDir = makeTmpDir('handler-personas-', qaRoot);
    resetPersonaManager();
    const manager = getPersonaManager({
      customPersonasDir,
      persistActivePersona: false,
    });
    await manager.ready();
  });

  afterEach(() => {
    resetPersonaManager();
    removeTmpDir(customPersonasDir);
  });

  it('list returns all built-in personas', () => {
    const result = handlePersonaCommand('list');
    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('default');
    expect(result.entry?.content).toContain('senior-developer');
    expect(result.entry?.content).toContain('debugger');
  });

  it('list with no args defaults to listing', () => {
    const result = handlePersonaCommand('');
    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('Available Personas');
  });

  it('use switches to a valid persona by id', () => {
    const result = handlePersonaCommand('use debugger');
    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('Debugging Expert');
  });

  it('use switches by name (with spaces converted to dash)', () => {
    const result = handlePersonaCommand('use senior developer');
    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('Senior Developer');
  });

  it('use returns not found for unknown persona', () => {
    const result = handlePersonaCommand('use nonexistent-persona');
    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('not found');
  });

  it('info returns active persona details', () => {
    const result = handlePersonaCommand('info');
    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('Default Assistant');
    expect(result.entry?.content).toContain('Style:');
  });

  it('info with id returns that persona details', () => {
    const result = handlePersonaCommand('info teacher');
    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('Patient Teacher');
    expect(result.entry?.content).toContain('Traits:');
  });

  it('reset switches back to default persona', () => {
    handlePersonaCommand('use debugger');
    const result = handlePersonaCommand('reset');
    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('Default Assistant');
  });

  it('unknown subcommand shows usage', () => {
    const result = handlePersonaCommand('foobar');
    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('Usage:');
  });
});
