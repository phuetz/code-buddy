/**
 * Tests for /persona slash command handler.
 */
import { handlePersonaCommand } from '../src/commands/handlers/persona-handler.js';
import { getPersonaManager, resetPersonaManager } from '../src/personas/persona-manager.js';

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

/** Wait for PersonaManager's async initialize() to complete */
async function flushInit(): Promise<void> {
  // Two setImmediate ticks cover both `await ensureDir` and `await loadCustomPersonas`
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
}

describe('/persona handler', () => {
  beforeEach(async () => {
    resetPersonaManager();
    getPersonaManager(); // trigger initialization
    await flushInit();   // wait for async init to complete
  });

  afterEach(() => {
    resetPersonaManager();
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
