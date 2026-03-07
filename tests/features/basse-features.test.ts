/**
 * Tests for Base Features
 *
 * Covers: UserSettings, SessionPicker, BrailleSpinner, CJKInputHandler,
 * ITermProgressBar, SkillVariableResolver, SkillBudgetCalculator,
 * NestedLaunchGuard, ConfigBackupManager, FeedbackCommand,
 * HookEventEmitter, WorktreeSessionManager
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

// ============================================================================
// Mocks
// ============================================================================

jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('child_process', () => ({
  execSync: jest.fn(),
}));

// ============================================================================
// User Settings
// ============================================================================

describe('UserSettingsManager', () => {
  let UserSettingsManager: typeof import('../../src/config/user-settings').UserSettingsManager;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('../../src/config/user-settings.js');
    UserSettingsManager = mod.UserSettingsManager;
    UserSettingsManager.resetInstance();
  });

  it('should get and set a string array setting', () => {
    const mgr = new UserSettingsManager();
    mgr.set('spinnerVerbs', ['Working', 'Building']);
    expect(mgr.get('spinnerVerbs')).toEqual(['Working', 'Building']);
  });

  it('should get and set a boolean setting', () => {
    const mgr = new UserSettingsManager();
    mgr.set('reduceMotion', true);
    expect(mgr.get('reduceMotion')).toBe(true);
  });

  it('should get and set theme setting', () => {
    const mgr = new UserSettingsManager({ theme: 'minimal' });
    expect(mgr.get('theme')).toBe('minimal');
    mgr.set('theme', 'colorful');
    expect(mgr.get('theme')).toBe('colorful');
  });

  it('should check disallowed tools', () => {
    const mgr = new UserSettingsManager({ disallowedTools: ['bash', 'rm'] });
    expect(mgr.isToolDisallowed('bash')).toBe(true);
    expect(mgr.isToolDisallowed('read_file')).toBe(false);
  });

  it('should return false for disallowed when list is empty', () => {
    const mgr = new UserSettingsManager();
    expect(mgr.isToolDisallowed('bash')).toBe(false);
  });

  it('should return custom spinner verbs when set', () => {
    const mgr = new UserSettingsManager({ spinnerVerbs: ['Loading'] });
    expect(mgr.getSpinnerVerbs()).toEqual(['Loading']);
  });

  it('should return default spinner verbs when not set', () => {
    const mgr = new UserSettingsManager();
    const verbs = mgr.getSpinnerVerbs();
    expect(verbs.length).toBe(5);
    expect(verbs).toContain('Thinking');
  });

  it('should return temperature override', () => {
    const mgr = new UserSettingsManager({ temperatureOverride: 0.7 });
    expect(mgr.getTemperature()).toBe(0.7);
  });

  it('should return undefined temperature when not set', () => {
    const mgr = new UserSettingsManager();
    expect(mgr.getTemperature()).toBeUndefined();
  });

  it('should respect reduceMotion setting', () => {
    const mgr = new UserSettingsManager();
    expect(mgr.shouldReduceMotion()).toBe(false);
    mgr.set('reduceMotion', true);
    expect(mgr.shouldReduceMotion()).toBe(true);
  });

  it('should show turn duration by default', () => {
    const mgr = new UserSettingsManager();
    expect(mgr.shouldShowTurnDuration()).toBe(true);
  });

  it('should hide turn duration when explicitly false', () => {
    const mgr = new UserSettingsManager({ showTurnDuration: false });
    expect(mgr.shouldShowTurnDuration()).toBe(false);
  });

  it('should return default plans directory', () => {
    const mgr = new UserSettingsManager();
    expect(mgr.getPlansDirectory()).toBe('.codebuddy/plans');
  });

  it('should return custom plans directory', () => {
    const mgr = new UserSettingsManager({ plansDirectory: '/tmp/plans' });
    expect(mgr.getPlansDirectory()).toBe('/tmp/plans');
  });

  it('should implement singleton pattern', () => {
    const a = UserSettingsManager.getInstance({ theme: 'minimal' });
    const b = UserSettingsManager.getInstance();
    expect(a).toBe(b);
    expect(a.get('theme')).toBe('minimal');
  });
});

// ============================================================================
// Session Picker
// ============================================================================

describe('SessionPicker', () => {
  let SessionPicker: typeof import('../../src/persistence/session-picker').SessionPicker;
  const now = Date.now();
  const entries = [
    { id: 'abcdefgh1234', name: 'feature work', branch: 'main', messageCount: 10, lastAccessed: now - 1000, tags: ['dev'] },
    { id: 'ijklmnop5678', name: 'bugfix session', branch: 'fix/123', messageCount: 5, lastAccessed: now, tags: ['fix'] },
    { id: 'qrstuvwx9012', name: 'design review', branch: 'main', messageCount: 20, lastAccessed: now - 5000, tags: [] },
  ];

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('../../src/persistence/session-picker.js');
    SessionPicker = mod.SessionPicker;
  });

  it('should return entries sorted by lastAccessed', () => {
    const picker = new SessionPicker(entries);
    const result = picker.getEntries();
    expect(result[0].id).toBe('ijklmnop5678');
    expect(result[2].id).toBe('qrstuvwx9012');
  });

  it('should limit entries', () => {
    const picker = new SessionPicker(entries);
    expect(picker.getEntries(2)).toHaveLength(2);
  });

  it('should search by branch', () => {
    const picker = new SessionPicker(entries);
    const results = picker.searchByBranch('main');
    expect(results).toHaveLength(2);
  });

  it('should search by name (case insensitive)', () => {
    const picker = new SessionPicker(entries);
    const results = picker.searchByName('BUGFIX');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('bugfix session');
  });

  it('should format a single entry', () => {
    const picker = new SessionPicker(entries);
    const formatted = picker.formatEntry(entries[0]);
    expect(formatted).toContain('abcdefgh');
    expect(formatted).toContain('feature work');
    expect(formatted).toContain('main');
  });

  it('should format table with header and rows', () => {
    const picker = new SessionPicker(entries);
    const table = picker.formatTable(entries);
    const lines = table.split('\n');
    expect(lines.length).toBe(5); // header + divider + 3 rows
    expect(lines[0]).toContain('ID');
    expect(lines[0]).toContain('Name');
    expect(lines[0]).toContain('Branch');
  });
});

// ============================================================================
// Braille Spinner
// ============================================================================

describe('BrailleSpinner', () => {
  let BrailleSpinner: typeof import('../../src/ui/ui-enhancements').BrailleSpinner;

  beforeEach(async () => {
    jest.resetModules();
    jest.useFakeTimers();
    const mod = await import('../../src/ui/ui-enhancements.js');
    BrailleSpinner = mod.BrailleSpinner;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should return correct frame for tick', () => {
    const spinner = new BrailleSpinner();
    expect(spinner.getFrame(0)).toBe('⠋');
    expect(spinner.getFrame(1)).toBe('⠙');
    expect(spinner.getFrame(10)).toBe('⠋'); // wraps around
  });

  it('should return shimmer text with ANSI codes', () => {
    const spinner = new BrailleSpinner();
    const result = spinner.getShimmer('hello', 0);
    expect(result).toContain('hello');
    expect(result).toContain('\x1b[');
  });

  it('should start and write frames', () => {
    const spinner = new BrailleSpinner();
    const mockStream = { write: jest.fn() } as unknown as NodeJS.WriteStream;
    spinner.start('Loading', mockStream);
    jest.advanceTimersByTime(160);
    expect(mockStream.write).toHaveBeenCalled();
    spinner.stop();
  });

  it('should stop and clear line', () => {
    const spinner = new BrailleSpinner();
    const mockStream = { write: jest.fn() } as unknown as NodeJS.WriteStream;
    spinner.start('Test', mockStream);
    spinner.stop();
    // Last write should be a clear
    const calls = (mockStream.write as jest.Mock).mock.calls;
    const lastCall = calls[calls.length - 1][0];
    expect(lastCall).toContain('\r');
  });

  it('should update label', () => {
    const spinner = new BrailleSpinner();
    const mockStream = { write: jest.fn() } as unknown as NodeJS.WriteStream;
    spinner.start('Step 1', mockStream);
    spinner.update('Step 2');
    jest.advanceTimersByTime(80);
    const calls = (mockStream.write as jest.Mock).mock.calls;
    const lastWrite = calls[calls.length - 1][0];
    expect(lastWrite).toContain('Step 2');
    spinner.stop();
  });
});

// ============================================================================
// CJK Input Handler
// ============================================================================

describe('CJKInputHandler', () => {
  let CJKInputHandler: typeof import('../../src/ui/ui-enhancements').CJKInputHandler;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('../../src/ui/ui-enhancements.js');
    CJKInputHandler = mod.CJKInputHandler;
  });

  it('should detect full-width characters', () => {
    const handler = new CJKInputHandler();
    expect(handler.isFullWidth('\uFF21')).toBe(true); // Fullwidth A
    expect(handler.isFullWidth('A')).toBe(false);
    expect(handler.isFullWidth('\u4E00')).toBe(true); // CJK ideograph
  });

  it('should normalize full-width ASCII to half-width', () => {
    const handler = new CJKInputHandler();
    // \uFF21 = fullwidth A, \uFF22 = fullwidth B
    expect(handler.normalizeFullWidth('\uFF21\uFF22\uFF23')).toBe('ABC');
  });

  it('should normalize ideographic space to regular space', () => {
    const handler = new CJKInputHandler();
    expect(handler.normalizeFullWidth('\u3000')).toBe(' ');
  });

  it('should calculate display width for mixed text', () => {
    const handler = new CJKInputHandler();
    // 'AB' = 2, one CJK char = 2
    expect(handler.getDisplayWidth('AB')).toBe(2);
    expect(handler.getDisplayWidth('\u4E00')).toBe(2);
    expect(handler.getDisplayWidth('A\u4E00B')).toBe(4);
  });
});

// ============================================================================
// iTerm2 Progress Bar
// ============================================================================

describe('ITermProgressBar', () => {
  let ITermProgressBar: typeof import('../../src/ui/ui-enhancements').ITermProgressBar;
  let originalEnv: NodeJS.ProcessEnv;
  let writeSpy: jest.SpyInstance;

  beforeEach(async () => {
    jest.resetModules();
    originalEnv = { ...process.env };
    const mod = await import('../../src/ui/ui-enhancements.js');
    ITermProgressBar = mod.ITermProgressBar;
    writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    process.env = originalEnv;
    writeSpy.mockRestore();
  });

  it('should detect iTerm2 from TERM_PROGRAM', () => {
    process.env.TERM_PROGRAM = 'iTerm.app';
    const bar = new ITermProgressBar();
    expect(bar.isITerm2()).toBe(true);
  });

  it('should return false for non-iTerm2', () => {
    delete process.env.TERM_PROGRAM;
    delete process.env.LC_TERMINAL;
    const bar = new ITermProgressBar();
    expect(bar.isITerm2()).toBe(false);
  });

  it('should set and clear progress', () => {
    const bar = new ITermProgressBar();
    bar.setProgress(50);
    expect(writeSpy).toHaveBeenCalledWith('\x1b]9;4;1;50\x07');
    bar.clear();
    expect(writeSpy).toHaveBeenCalledWith('\x1b]9;4;0;0\x07');
  });
});

// ============================================================================
// Skill Variable Resolver
// ============================================================================

describe('SkillVariableResolver', () => {
  let SkillVariableResolver: typeof import('../../src/skills/skill-enhancements').SkillVariableResolver;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('../../src/skills/skill-enhancements.js');
    SkillVariableResolver = mod.SkillVariableResolver;
  });

  it('should resolve $ARGUMENTS with joined args', () => {
    const resolver = new SkillVariableResolver();
    const result = resolver.resolve('Run $ARGUMENTS now', { arguments: ['test', '--verbose'] });
    expect(result).toBe('Run test --verbose now');
  });

  it('should resolve indexed $ARGUMENTS[0] and $ARGUMENTS[1]', () => {
    const resolver = new SkillVariableResolver();
    const result = resolver.resolve('File: $ARGUMENTS[0], Mode: $ARGUMENTS[1]', {
      arguments: ['app.ts', 'strict'],
    });
    expect(result).toBe('File: app.ts, Mode: strict');
  });

  it('should resolve $ARGUMENTS[N] to empty string when index out of range', () => {
    const resolver = new SkillVariableResolver();
    const result = resolver.resolve('Val: $ARGUMENTS[5]', { arguments: ['only'] });
    expect(result).toBe('Val: ');
  });

  it('should resolve $CLAUDE_SESSION_ID', () => {
    const resolver = new SkillVariableResolver();
    const result = resolver.resolve('Session: $CLAUDE_SESSION_ID', { sessionId: 'abc-123' });
    expect(result).toBe('Session: abc-123');
  });

  it('should resolve $WORKING_DIR and $GIT_BRANCH', () => {
    const resolver = new SkillVariableResolver();
    const result = resolver.resolve('Dir: $WORKING_DIR Branch: $GIT_BRANCH', {
      workingDir: '/home/user/project',
      gitBranch: 'feature/x',
    });
    expect(result).toBe('Dir: /home/user/project Branch: feature/x');
  });

  it('should parse indexed argument references', () => {
    const resolver = new SkillVariableResolver();
    expect(resolver.parseIndexedArgument('$ARGUMENTS[0]')).toBe(0);
    expect(resolver.parseIndexedArgument('$ARGUMENTS[12]')).toBe(12);
    expect(resolver.parseIndexedArgument('$ARGUMENTS')).toBe(-1);
    expect(resolver.parseIndexedArgument('$OTHER')).toBe(-1);
  });
});

// ============================================================================
// Skill Budget Calculator
// ============================================================================

describe('SkillBudgetCalculator', () => {
  let SkillBudgetCalculator: typeof import('../../src/skills/skill-enhancements').SkillBudgetCalculator;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('../../src/skills/skill-enhancements.js');
    SkillBudgetCalculator = mod.SkillBudgetCalculator;
  });

  it('should calculate 2% of context window', () => {
    const calc = new SkillBudgetCalculator();
    expect(calc.calculateBudget(100000)).toBe(2000);
    expect(calc.calculateBudget(200000)).toBe(4000);
  });

  it('should truncate content exceeding budget', () => {
    const calc = new SkillBudgetCalculator();
    const content = 'A'.repeat(100);
    const truncated = calc.truncateToLimit(content, 50);
    expect(truncated.length).toBe(50);
    expect(truncated.endsWith('...')).toBe(true);
  });

  it('should not truncate content within budget', () => {
    const calc = new SkillBudgetCalculator();
    const result = calc.truncateToLimit('short', 1000);
    expect(result).toBe('short');
  });

  it('should return 4000 as default budget', () => {
    const calc = new SkillBudgetCalculator();
    expect(calc.getDefaultBudget()).toBe(4000);
  });
});

// ============================================================================
// Nested Launch Guard
// ============================================================================

describe('NestedLaunchGuard', () => {
  let NestedLaunchGuard: typeof import('../../src/utils/safety-misc').NestedLaunchGuard;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    jest.resetModules();
    originalEnv = process.env.CODEBUDDY_SESSION_ID;
    delete process.env.CODEBUDDY_SESSION_ID;
    const mod = await import('../../src/utils/safety-misc.js');
    NestedLaunchGuard = mod.NestedLaunchGuard;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.CODEBUDDY_SESSION_ID = originalEnv;
    } else {
      delete process.env.CODEBUDDY_SESSION_ID;
    }
  });

  it('should detect no nested launch when env not set', () => {
    const guard = new NestedLaunchGuard();
    expect(guard.isNestedLaunch()).toBe(false);
  });

  it('should detect nested launch when env is set', () => {
    process.env.CODEBUDDY_SESSION_ID = 'test-session';
    const guard = new NestedLaunchGuard();
    expect(guard.isNestedLaunch()).toBe(true);
  });

  it('should set session marker', () => {
    const guard = new NestedLaunchGuard();
    guard.setSessionMarker('my-session-123');
    expect(process.env.CODEBUDDY_SESSION_ID).toBe('my-session-123');
  });

  it('should return a warning message', () => {
    const guard = new NestedLaunchGuard();
    const warning = guard.getWarning();
    expect(warning).toContain('Warning');
    expect(warning).toContain('existing session');
  });
});

// ============================================================================
// Config Backup Manager
// ============================================================================

describe('ConfigBackupManager', () => {
  let ConfigBackupManager: typeof import('../../src/utils/safety-misc').ConfigBackupManager;
  let tmpDir: string;
  let testFile: string;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('../../src/utils/safety-misc.js');
    ConfigBackupManager = mod.ConfigBackupManager;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-backup-test-'));
    testFile = path.join(tmpDir, 'settings.json');
    fs.writeFileSync(testFile, '{"key":"value"}');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should create a backup file', () => {
    const mgr = new ConfigBackupManager();
    const backupPath = mgr.createBackup(testFile);
    expect(fs.existsSync(backupPath)).toBe(true);
    expect(backupPath).toContain('.bak');
    expect(fs.readFileSync(backupPath, 'utf-8')).toBe('{"key":"value"}');
  });

  it('should list backups sorted', () => {
    const mgr = new ConfigBackupManager();
    const bp1 = path.join(tmpDir, "settings.json.2026-01-01T00-00-00-000Z.bak");
    const bp2 = path.join(tmpDir, "settings.json.2026-01-02T00-00-00-000Z.bak");
    fs.writeFileSync(bp1, "backup1");
    fs.writeFileSync(bp2, "backup2");
    const backups = mgr.listBackups(testFile);
    expect(backups.length).toBeGreaterThanOrEqual(2);
  });

  it('should prune old backups keeping N most recent', () => {
    const mgr = new ConfigBackupManager();
    // Create 7 backups with distinct timestamps
    for (let i = 0; i < 7; i++) {
      const ts = `2026-01-01T00-00-0${i}-000Z`;
      const bp = `${testFile}.${ts}.bak`;
      fs.writeFileSync(bp, `backup-${i}`);
    }
    const removed = mgr.pruneBackups(testFile, 3);
    expect(removed.length).toBe(4);
    const remaining = mgr.listBackups(testFile);
    expect(remaining.length).toBe(3);
  });

  it('should restore from backup', () => {
    const mgr = new ConfigBackupManager();
    const backupPath = mgr.createBackup(testFile);
    fs.writeFileSync(testFile, '{"key":"changed"}');
    mgr.restoreBackup(backupPath, testFile);
    expect(fs.readFileSync(testFile, 'utf-8')).toBe('{"key":"value"}');
  });

  it('should return empty list when no backups exist', () => {
    const mgr = new ConfigBackupManager();
    const otherFile = path.join(tmpDir, 'other.json');
    fs.writeFileSync(otherFile, '{}');
    expect(mgr.listBackups(otherFile)).toEqual([]);
  });

  it('should return empty list when directory does not exist', () => {
    const mgr = new ConfigBackupManager();
    expect(mgr.listBackups('/nonexistent/path/file.json')).toEqual([]);
  });
});

// ============================================================================
// Feedback Command
// ============================================================================

describe('FeedbackCommand', () => {
  let FeedbackCommand: typeof import('../../src/utils/safety-misc').FeedbackCommand;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('../../src/utils/safety-misc.js');
    FeedbackCommand = mod.FeedbackCommand;
  });

  it('should return the repo issues URL', () => {
    const cmd = new FeedbackCommand();
    expect(cmd.getRepoUrl()).toBe('https://github.com/phuetz/code-buddy/issues/new');
  });

  it('should generate issue URL with title and body', () => {
    const cmd = new FeedbackCommand();
    const url = cmd.generateIssueUrl('Bug report', 'Steps to reproduce...');
    expect(url).toContain('title=Bug+report');
    expect(url).toContain('body=Steps+to+reproduce');
  });

  it('should format feedback message with repo URL', () => {
    const cmd = new FeedbackCommand();
    const msg = cmd.formatFeedbackMessage();
    expect(msg).toContain('feedback');
    expect(msg).toContain('github.com/phuetz/code-buddy');
  });
});

// ============================================================================
// Hook Events
// ============================================================================

describe('HookEventEmitter', () => {
  let HookEventEmitter: typeof import('../../src/hooks/hook-events').HookEventEmitter;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('../../src/hooks/hook-events.js');
    HookEventEmitter = mod.HookEventEmitter;
    HookEventEmitter.resetInstance();
  });

  it('should emit and handle PreCompact events', () => {
    const emitter = new HookEventEmitter();
    const handler = jest.fn();
    emitter.onPreCompact(handler);
    emitter.emitPreCompact({ messageCount: 100, tokenCount: 50000 });
    expect(handler).toHaveBeenCalledWith({ messageCount: 100, tokenCount: 50000 });
  });

  it('should emit and handle Notification events', () => {
    const emitter = new HookEventEmitter();
    const handler = jest.fn();
    emitter.onNotification(handler);
    emitter.emitNotification({ type: 'auth_success', message: 'Logged in' });
    expect(handler).toHaveBeenCalledWith({ type: 'auth_success', message: 'Logged in' });
  });

  it('should handle permission_prompt notification type', () => {
    const emitter = new HookEventEmitter();
    const handler = jest.fn();
    emitter.onNotification(handler);
    emitter.emitNotification({ type: 'permission_prompt', message: 'Allow?' });
    expect(handler).toHaveBeenCalledWith({ type: 'permission_prompt', message: 'Allow?' });
  });

  it('should emit PermissionRequest and return handler response', () => {
    const emitter = new HookEventEmitter();
    emitter.onPermissionRequest((_req) => ({ action: 'allow' as const }));
    const result = emitter.emitPermissionRequest({ tool: 'bash', input: 'ls' });
    expect(result).toEqual({ action: 'allow' });
  });

  it('should return ask when no PermissionRequest handler', () => {
    const emitter = new HookEventEmitter();
    const result = emitter.emitPermissionRequest({ tool: 'bash', input: 'rm -rf /' });
    expect(result).toEqual({ action: 'ask' });
  });

  it('should implement singleton pattern', () => {
    const a = HookEventEmitter.getInstance();
    const b = HookEventEmitter.getInstance();
    expect(a).toBe(b);
  });
});

// ============================================================================
// Worktree Sessions
// ============================================================================

describe('WorktreeSessionManager', () => {
  let WorktreeSessionManager: typeof import('../../src/git/worktree-sessions').WorktreeSessionManager;
  let mockExecSync: jest.Mock;

  beforeEach(async () => {
    jest.resetModules();
    mockExecSync = execSync as unknown as jest.Mock;
    mockExecSync.mockReset();
    mockExecSync.mockImplementation(() => Buffer.from(''));
    const mod = await import('../../src/git/worktree-sessions.js');
    WorktreeSessionManager = mod.WorktreeSessionManager;
    WorktreeSessionManager.resetInstance();
  });

  it('should create a worktree session', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-test-'));
    try {
      const mgr = new WorktreeSessionManager();
      const session = mgr.createWorktreeSession('feature/x', tmpDir);
      expect(session.branch).toBe('feature/x');
      expect(session.sessionId).toContain('wt-feature/x-');
      expect(session.worktreePath).toContain('.worktrees');
      expect(mockExecSync).toHaveBeenCalled();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should list worktree sessions', () => {
    const mgr = new WorktreeSessionManager();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-test-'));
    try {
      mgr.createWorktreeSession('branch-a', tmpDir);
      mgr.createWorktreeSession('branch-b', tmpDir);
      expect(mgr.listWorktreeSessions()).toHaveLength(2);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should find session by worktree path', () => {
    const mgr = new WorktreeSessionManager();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-test-'));
    try {
      const session = mgr.createWorktreeSession('branch-c', tmpDir);
      const found = mgr.getSessionForWorktree(session.worktreePath);
      expect(found).toBeDefined();
      expect(found!.branch).toBe('branch-c');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should return undefined for unknown worktree path', () => {
    const mgr = new WorktreeSessionManager();
    expect(mgr.getSessionForWorktree('/nonexistent')).toBeUndefined();
  });

  it('should cleanup worktree session', () => {
    const mgr = new WorktreeSessionManager();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-test-'));
    try {
      mgr.createWorktreeSession('branch-d', tmpDir);
      expect(mgr.isWorktreeActive('branch-d')).toBe(true);
      const result = mgr.cleanupWorktree('branch-d');
      expect(result).toBe(true);
      expect(mgr.isWorktreeActive('branch-d')).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should return false when cleaning up non-existent worktree', () => {
    const mgr = new WorktreeSessionManager();
    expect(mgr.cleanupWorktree('nonexistent')).toBe(false);
  });
});
