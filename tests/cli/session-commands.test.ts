const mocks = vi.hoisted(() => ({
  getSessionStore: vi.fn(),
  getRecentSessions: vi.fn(),
  getSessionByPartialId: vi.fn(),
  listSessions: vi.fn(() => [] as unknown[]),
  resumeSession: vi.fn(),
  getLastSession: vi.fn(),
  searchSessions: vi.fn(),
  listUnifiedSessions: vi.fn(() => []),
  materializeUnifiedSession: vi.fn(async (id: string) => ({ id, origin: 'cli' as const })),
  loggerError: vi.fn(),
}));

vi.mock('../../src/persistence/session-store.js', () => ({
  getSessionStore: mocks.getSessionStore,
}));

vi.mock('../../src/persistence/unified-session-index.js', () => ({
  listUnifiedSessions: mocks.listUnifiedSessions,
  materializeUnifiedSession: mocks.materializeUnifiedSession,
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
      listSessions: mocks.listSessions,
      resumeSession: mocks.resumeSession,
      getLastSession: mocks.getLastSession,
      searchSessions: mocks.searchSessions,
    });
    mocks.listUnifiedSessions.mockReturnValue([]);
    mocks.materializeUnifiedSession.mockImplementation(async (id: string) => ({ id, origin: 'cli' as const }));
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
    expect(logSpy).toHaveBeenCalledWith('  session_child_123456 - Child session');
    expect(logSpy).toHaveBeenCalledWith('    parent: session_parent_abcdef');
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
    expect(session?.aliases()).toContain('sessions');
    expect(session?.commands.map((command) => command.name())).toEqual([
      'list',
      'search',
      'resume',
      'last',
    ]);
  });

  it('lists unified recents with origin via the sessions alias', async () => {
    const program = new Command();
    program.exitOverride();
    registerSessionCommands(program);
    mocks.listUnifiedSessions.mockReturnValue([
      {
        id: 'session_cli_abcdef',
        title: 'From CLI',
        origin: 'cli',
        messageCount: 2,
        createdAt: '2026-09-17T08:00:00.000Z',
        updatedAt: '2026-09-17T08:00:00.000Z',
        pointer: { kind: 'session-store' },
      },
    ]);

    await program.parseAsync(['node', 'buddy', 'sessions', 'list']);

    expect(mocks.listUnifiedSessions).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('    origin: cli');
    expect(mocks.getRecentSessions).not.toHaveBeenCalled();
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
    expect(logSpy).toHaveBeenCalledWith('    parent: session_parent_abcdef');
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
    expect(logSpy).toHaveBeenCalledWith('  session_child_123456 - Child session');
    expect(logSpy).toHaveBeenCalledWith('\nUse `buddy session resume <id>` to resume a session');
  });

  it('routes session resume by partial ID', async () => {
    const program = new Command();
    program.exitOverride();
    registerSessionCommands(program);
    mocks.listSessions.mockReturnValue([{
      id: 'session_child_123456',
      name: 'Child session',
      messages: [],
      lastAccessedAt: new Date('2026-05-16T08:00:00Z'),
    }]);

    await program.parseAsync(['node', 'buddy', 'session', 'resume', 'session_']);

    expect(mocks.resumeSession).toHaveBeenCalledWith('session_child_123456');
    expect(logSpy).toHaveBeenCalledWith('Resuming session: Child session (session_child_123456)');
  });

  it('refuses a partial ID shared by several sessions', async () => {
    const program = new Command();
    program.exitOverride();
    registerSessionCommands(program);
    const at = new Date('2026-05-16T08:00:00Z');
    mocks.listSessions.mockReturnValue([
      { id: 'session_child_123456', name: 'Child', messages: [], lastAccessedAt: at },
      { id: 'session_parent_abcdef', name: 'Parent', messages: [], lastAccessedAt: at },
    ]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    try {
      await expect(program.parseAsync(['node', 'buddy', 'session', 'resume', 'session_'])).rejects.toThrow('exit 1');
    } finally {
      exitSpy.mockRestore();
    }
    expect(mocks.resumeSession).not.toHaveBeenCalled();
    expect(mocks.loggerError).toHaveBeenCalledWith('Ambiguous session id: session_ matches 2 sessions.');
  });
  it('prints resumable identifiers for sessions sharing the generated session_ prefix', async () => {
    const program = new Command().exitOverride();
    registerSessionCommands(program);
    const ids = ['session_1790000000000_aaaa', 'session_1790000000000_bbbb'];
    mocks.listUnifiedSessions.mockReturnValue(ids.map((id) => ({
      id, title: id, origin: 'cli', messageCount: 1,
      createdAt: '2026-09-30T08:00:00.000Z', updatedAt: '2026-09-30T08:00:00.000Z',
      pointer: { kind: 'session-store' },
    })));
    await program.parseAsync(['node', 'buddy', 'session', 'list']);
    const shownIds = logSpy.mock.calls
      .map((call) => String(call[0]).match(/^ {2}(\S+) - /)?.[1])
      .filter((id): id is string => id !== undefined);
    expect(shownIds).toEqual(ids);
    mocks.listSessions.mockReturnValue(ids.map((id) => ({ id, name: id, messages: [], lastAccessedAt: new Date() })));
    for (const id of shownIds) {
      const resumeProgram = new Command().exitOverride();
      registerSessionCommands(resumeProgram);
      await resumeProgram.parseAsync(['node', 'buddy', 'session', 'resume', id]);
      expect(mocks.resumeSession).toHaveBeenCalledWith(id);
    }
  });
});
