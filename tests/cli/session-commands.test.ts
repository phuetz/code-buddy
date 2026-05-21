const mocks = vi.hoisted(() => ({
  getSessionStore: vi.fn(),
  getRecentSessions: vi.fn(),
  getSessionByPartialId: vi.fn(),
  resumeSession: vi.fn(),
  getLastSession: vi.fn(),
  searchSessions: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../../src/persistence/session-store.js', () => ({
  getSessionStore: mocks.getSessionStore,
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    error: mocks.loggerError,
  },
}));

import { Command } from 'commander';
import { registerSessionCommands, searchSessions } from '../../src/cli/session-commands.js';

describe('CLI session commands', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mocks.getSessionStore.mockReturnValue({
      getRecentSessions: mocks.getRecentSessions,
      getSessionByPartialId: mocks.getSessionByPartialId,
      resumeSession: mocks.resumeSession,
      getLastSession: mocks.getLastSession,
      searchSessions: mocks.searchSessions,
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('prints content search results with parent lineage', async () => {
    mocks.searchSessions.mockResolvedValue([
      {
        id: 'session_child_123456',
        name: 'Child session',
        messages: [{ type: 'user', content: 'hello' }],
        lastAccessedAt: new Date('2026-05-16T08:00:00Z'),
        metadata: {
          parentSessionId: 'session_parent_abcdef',
          searchSnippet: '[hello] from parent context',
          searchRole: 'user',
        },
      },
    ]);

    await searchSessions('hello');

    expect(mocks.searchSessions).toHaveBeenCalledWith('hello');
    expect(logSpy).toHaveBeenCalledWith('Session search results for "hello" (1):\n');
    expect(logSpy).toHaveBeenCalledWith('  session_ - Child session');
    expect(logSpy).toHaveBeenCalledWith('    parent: session_');
    expect(logSpy).toHaveBeenCalledWith('    match (user): [hello] from parent context');
    expect(logSpy).toHaveBeenCalledWith('\nUse `buddy session resume <id>` to resume a session');
  });

  it('prints a no-results message', async () => {
    mocks.searchSessions.mockResolvedValue([]);

    await searchSessions('missing');

    expect(logSpy).toHaveBeenCalledWith('No sessions found matching: missing');
  });

  it('registers a saved-session command group', () => {
    const program = new Command();

    registerSessionCommands(program);

    const session = program.commands.find((command) => command.name() === 'session');
    expect(session).toBeDefined();
    expect(session?.commands.map((command) => command.name())).toEqual([
      'list',
      'search',
      'resume',
      'last',
    ]);
  });

  it('routes session list through the session store with a limit', async () => {
    const program = new Command();
    program.exitOverride();
    registerSessionCommands(program);
    mocks.getRecentSessions.mockResolvedValue([]);

    await program.parseAsync(['node', 'buddy', 'session', 'list', '--limit', '2']);

    expect(mocks.getRecentSessions).toHaveBeenCalledWith(2);
    expect(logSpy).toHaveBeenCalledWith('No sessions found.');
  });

  it('prints legacy or malformed session summaries without crashing', async () => {
    const program = new Command();
    program.exitOverride();
    registerSessionCommands(program);
    mocks.getRecentSessions.mockResolvedValue([
      {
        metadata: {
          parentSessionId: 'session_parent_abcdef',
          searchSnippet: 'legacy hit',
        },
      },
    ]);

    await program.parseAsync(['node', 'buddy', 'session', 'list', '--limit', '1']);

    expect(logSpy).toHaveBeenCalledWith('Recent sessions (1):\n');
    expect(logSpy).toHaveBeenCalledWith('  unknown - (unnamed)');
    expect(logSpy).toHaveBeenCalledWith('    0 messages | (no date)');
    expect(logSpy).toHaveBeenCalledWith('    parent: session_');
    expect(logSpy).toHaveBeenCalledWith('    match: legacy hit');
  });

  it('routes session search with multi-word queries and a limit', async () => {
    const program = new Command();
    program.exitOverride();
    registerSessionCommands(program);
    mocks.searchSessions.mockResolvedValue([
      {
        id: 'session_child_123456',
        name: 'Child session',
        messages: [],
        lastAccessedAt: new Date('2026-05-16T08:00:00Z'),
      },
      {
        id: 'session_other_123456',
        name: 'Other session',
        messages: [],
        lastAccessedAt: new Date('2026-05-16T09:00:00Z'),
      },
    ]);

    await program.parseAsync(['node', 'buddy', 'session', 'search', 'hello', 'world', '--limit', '1']);

    expect(mocks.searchSessions).toHaveBeenCalledWith('hello world');
    expect(logSpy).toHaveBeenCalledWith('Session search results for "hello world" (1):\n');
    expect(logSpy).toHaveBeenCalledWith('  session_ - Child session');
    expect(logSpy).toHaveBeenCalledWith('\nUse `buddy session resume <id>` to resume a session');
  });

  it('routes session resume by partial ID', async () => {
    const program = new Command();
    program.exitOverride();
    registerSessionCommands(program);
    mocks.getSessionByPartialId.mockResolvedValue({
      id: 'session_child_123456',
      name: 'Child session',
      messages: [],
      lastAccessedAt: new Date('2026-05-16T08:00:00Z'),
    });

    await program.parseAsync(['node', 'buddy', 'session', 'resume', 'session_']);

    expect(mocks.getSessionByPartialId).toHaveBeenCalledWith('session_');
    expect(mocks.resumeSession).toHaveBeenCalledWith('session_child_123456');
    expect(logSpy).toHaveBeenCalledWith('Resuming session: Child session (session_)');
  });
});
