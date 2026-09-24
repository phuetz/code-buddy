/**
 * Chaque gestionnaire slash touché par failureFlag a un succès (sortie 0)
 * et, quand la commande en a un, un échec (sortie 1).
 * Le code reprend la décision de processPromptHeadless : failed ou denied → 1.
 * Les commandes qui lancent un outil, un navigateur ou une écriture du dépôt
 * ne passent pas par ici : leur retour anticipé est appelé directement.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { dispatchSlashPrompt } from '../../src/commands/headless-slash.js';
import { handleBackup } from '../../src/commands/handlers/backup-handlers.js';
import { handleCopy } from '../../src/commands/handlers/clipboard-handler.js';
import { handleModelRouter as handleResearchModelRouter } from '../../src/commands/handlers/research-handlers.js';

interface SlashLike {
  failed?: boolean;
  denied?: boolean;
  output?: string;
  prompt?: string;
  reason?: string;
  entry?: { content?: string };
  response?: string;
  error?: string;
}

interface OutcomeCase {
  handler: string;
  kind: 'succès' | 'échec';
  label: string;
  exitCode: 0 | 1;
  needle: string;
  run: () => Promise<SlashLike | null>;
}

function textOf(result: SlashLike | null): string {
  if (!result) return '';
  if (typeof result.output === 'string' && result.output.length > 0) return result.output;
  if (typeof result.entry?.content === 'string' && result.entry.content.length > 0) return result.entry.content;
  if (typeof result.prompt === 'string' && result.prompt.length > 0) return result.prompt;
  if (typeof result.response === 'string') return result.response;
  if (typeof result.reason === 'string') return result.reason;
  if (typeof result.error === 'string') return result.error;
  return '';
}

/** Même expression que src/index.ts pour le code de sortie headless. */
function exitCodeOf(result: SlashLike | null): number {
  if (!result) return 0;
  return result.failed || result.denied ? 1 : 0;
}

async function viaSlash(prompt: string): Promise<SlashLike | null> {
  return dispatchSlashPrompt(prompt);
}

/**
 * La détection réelle dit oui sur macOS, Windows et un Linux avec xclip,
 * non ailleurs. Le test fixe la réponse pour ne pas dépendre de l'hôte.
 */
const clipboard = vi.hoisted(() => ({ available: false }));
vi.mock('../../src/utils/clipboard.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/utils/clipboard.js')>()),
  isClipboardAvailable: () => clipboard.available,
  copyToClipboard: () => true,
}));

async function copyWithClipboard(available: boolean, prompt: string): Promise<SlashLike | null> {
  clipboard.available = available;
  try {
    return await viaSlash(prompt);
  } finally {
    clipboard.available = false;
  }
}

function gitIn(cwd: string, args: string[]): void {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  env.GIT_CONFIG_GLOBAL = os.devnull;
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_TERMINAL_PROMPT = '0';
  const result = spawnSync(
    'git',
    ['-c', 'user.name=Code Buddy QA', '-c', 'user.email=qa@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    { cwd, env, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

/**
 * /diff lit process.cwd(). Un dépôt jetable rend le succès indépendant
 * de l'arbre du worktree (propre ou sale).
 */
async function diffInIsolatedRepo(withChange: boolean): Promise<SlashLike | null> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slash-exit-diff-'));
  const saved = {
    ceiling: process.env.GIT_CEILING_DIRECTORIES,
    gitDir: process.env.GIT_DIR,
    workTree: process.env.GIT_WORK_TREE,
    configGlobal: process.env.GIT_CONFIG_GLOBAL,
    configNosystem: process.env.GIT_CONFIG_NOSYSTEM,
  };
  process.env.GIT_CEILING_DIRECTORIES = root;
  delete process.env.GIT_DIR;
  delete process.env.GIT_WORK_TREE;
  process.env.GIT_CONFIG_GLOBAL = os.devnull;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  const project = path.join(root, 'repo');
  fs.mkdirSync(project);
  const spy = vi.spyOn(process, 'cwd').mockReturnValue(project);
  try {
    const note = path.join(project, 'note.txt');
    fs.writeFileSync(note, 'avant\n');
    gitIn(project, ['init', '-q']);
    gitIn(project, ['add', 'note.txt']);
    gitIn(project, ['commit', '-qm', 'base']);
    if (withChange) fs.writeFileSync(note, 'avant\nslash-exit-diff-marker\n');
    return await viaSlash('/diff');
  } finally {
    spy.mockRestore();
    const restore = (key: 'GIT_CEILING_DIRECTORIES' | 'GIT_DIR' | 'GIT_WORK_TREE' | 'GIT_CONFIG_GLOBAL' | 'GIT_CONFIG_NOSYSTEM', value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore('GIT_CEILING_DIRECTORIES', saved.ceiling);
    restore('GIT_DIR', saved.gitDir);
    restore('GIT_WORK_TREE', saved.workTree);
    restore('GIT_CONFIG_GLOBAL', saved.configGlobal);
    restore('GIT_CONFIG_NOSYSTEM', saved.configNosystem);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

let bugFile = '';

beforeAll(() => {
  bugFile = path.join(os.tmpdir(), 'slash-exit-bug-sample.ts');
  fs.writeFileSync(bugFile, 'export const slashExitSample = 1;\n');
});

const cases: OutcomeCase[] = [
  { handler: 'handlePromptCache', kind: 'succès', label: '/prompt-cache off', exitCode: 0, needle: 'Prompt caching disabled', run: () => viaSlash('/prompt-cache off') },
  { handler: 'handlePromptCache', kind: 'succès', label: '/prompt-cache on', exitCode: 0, needle: 'Prompt caching enabled', run: () => viaSlash('/prompt-cache on') },
  { handler: 'handlePromptCache', kind: 'succès', label: '/prompt-cache', exitCode: 0, needle: 'Prompt Cache Statistics', run: () => viaSlash('/prompt-cache') },
  { handler: 'handleModelRouter', kind: 'succès', label: '/model-router off', exitCode: 0, needle: 'Model Router Status', run: () => viaSlash('/model-router off') },
  { handler: 'handleModelRouter', kind: 'succès', label: '/model-router', exitCode: 0, needle: 'Model Router Status', run: () => viaSlash('/model-router') },
  { handler: 'handleHelp', kind: 'succès', label: '/help', exitCode: 0, needle: 'CODE BUDDY COMMANDS', run: () => viaSlash('/help') },
  { handler: 'handleShortcuts', kind: 'succès', label: '/shortcuts', exitCode: 0, needle: 'KEYBOARD SHORTCUTS', run: () => viaSlash('/shortcuts') },
  { handler: 'handleFeatures', kind: 'succès', label: '/features', exitCode: 0, needle: 'Feature', run: () => viaSlash('/features') },
  { handler: 'handleYoloMode', kind: 'succès', label: '/yolo status', exitCode: 0, needle: 'YOLO', run: () => viaSlash('/yolo status') },
  { handler: 'handleYoloMode', kind: 'échec', label: '/yolo tool bash maybe', exitCode: 1, needle: 'Invalid rule', run: () => viaSlash('/yolo tool bash maybe') },
  { handler: 'handleAutonomy', kind: 'succès', label: '/autonomy', exitCode: 0, needle: 'Autonomy', run: () => viaSlash('/autonomy') },
  { handler: 'handleAutonomy', kind: 'succès', label: '/autonomy nope', exitCode: 0, needle: 'Autonomy Settings', run: () => viaSlash('/autonomy nope') },
  { handler: 'handleStats', kind: 'succès', label: '/stats', exitCode: 0, needle: 'Performance Summary', run: () => viaSlash('/stats') },
  { handler: 'handleStats', kind: 'échec', label: '/stats cache', exitCode: 1, needle: 'not initialized', run: () => viaSlash('/stats cache') },
  { handler: 'handleCache', kind: 'succès', label: '/cache', exitCode: 0, needle: 'Cache', run: () => viaSlash('/cache') },
  { handler: 'handleSelfHealing', kind: 'succès', label: '/heal off', exitCode: 0, needle: 'DISABLED', run: () => viaSlash('/heal off') },
  { handler: 'handleSelfHealing', kind: 'succès', label: '/heal on', exitCode: 0, needle: 'ENABLED', run: () => viaSlash('/heal on') },
  { handler: 'handleSecurity', kind: 'succès', label: '/security', exitCode: 0, needle: 'Security', run: () => viaSlash('/security') },
  { handler: 'handleDryRun', kind: 'succès', label: '/dry-run off', exitCode: 0, needle: 'DISABLED', run: () => viaSlash('/dry-run off') },
  { handler: 'handleDryRun', kind: 'succès', label: '/dry-run status', exitCode: 0, needle: 'Dry-Run', run: () => viaSlash('/dry-run status') },
  { handler: 'handleTheme', kind: 'succès', label: '/theme', exitCode: 0, needle: 'Available Themes', run: () => viaSlash('/theme') },
  { handler: 'handleTheme', kind: 'échec', label: '/theme slash-exit-absent', exitCode: 1, needle: 'not found', run: () => viaSlash('/theme slash-exit-absent') },
  { handler: 'handleAvatar', kind: 'succès', label: '/avatar', exitCode: 0, needle: 'Avatar', run: () => viaSlash('/avatar') },
  { handler: 'handleAvatar', kind: 'échec', label: '/avatar slash-exit-absent', exitCode: 1, needle: 'not found', run: () => viaSlash('/avatar slash-exit-absent') },
  { handler: 'handleVoice', kind: 'succès', label: '/voice off', exitCode: 0, needle: 'DISABLED', run: () => viaSlash('/voice off') },
  { handler: 'handleVoice', kind: 'échec', label: '/voice toggle', exitCode: 1, needle: 'Cannot start recording', run: () => viaSlash('/voice toggle') },
  { handler: 'handleSpeak', kind: 'succès', label: '/speak stop', exitCode: 0, needle: 'Speech stopped', run: () => viaSlash('/speak stop') },
  { handler: 'handleSpeak', kind: 'échec', label: '/speak bonjour', exitCode: 1, needle: 'TTS not available', run: () => viaSlash('/speak bonjour') },
  { handler: 'handleHistory', kind: 'succès', label: '/history', exitCode: 0, needle: 'history', run: () => viaSlash('/history') },
  { handler: 'handleHistory', kind: 'échec', label: '/history limit 1', exitCode: 1, needle: 'Invalid limit', run: () => viaSlash('/history limit 1') },
  { handler: 'handleConfig', kind: 'succès', label: '/config schemas', exitCode: 0, needle: 'Available Configuration Schemas', run: () => viaSlash('/config schemas') },
  { handler: 'handleConfig', kind: 'échec', label: '/config set', exitCode: 1, needle: 'Usage: /config set', run: () => viaSlash('/config set') },
  { handler: 'handleLogin', kind: 'échec', label: '/login nope', exitCode: 1, needle: 'Unknown provider', run: () => viaSlash('/login nope') },
  { handler: 'handleLogout', kind: 'succès', label: '/logout', exitCode: 0, needle: 'logged out', run: () => viaSlash('/logout') },
  { handler: 'handleLogout', kind: 'échec', label: '/logout nope', exitCode: 1, needle: 'Unknown provider', run: () => viaSlash('/logout nope') },
  { handler: 'handleWhoami', kind: 'succès', label: '/whoami', exitCode: 0, needle: 'Authentication status', run: () => viaSlash('/whoami') },
  { handler: 'handlePermissions', kind: 'succès', label: '/permissions', exitCode: 0, needle: 'Permission', run: () => viaSlash('/permissions') },
  { handler: 'handlePermissions', kind: 'échec', label: '/permissions add', exitCode: 1, needle: 'Usage: /permissions add', run: () => viaSlash('/permissions add') },
  { handler: 'handleFCS', kind: 'succès', label: '/fcs', exitCode: 0, needle: 'FileCommander Script', run: () => viaSlash('/fcs') },
  { handler: 'handleFCS', kind: 'échec', label: '/fcs validate missing.fcs', exitCode: 1, needle: 'Script not found', run: () => viaSlash('/fcs validate missing.fcs') },
  { handler: 'handleTDD', kind: 'succès', label: '/tdd', exitCode: 0, needle: 'TDD', run: () => viaSlash('/tdd') },
  { handler: 'handleTDD', kind: 'échec', label: '/tdd start', exitCode: 1, needle: 'Please provide requirements', run: () => viaSlash('/tdd start') },
  { handler: 'handleWorkflow', kind: 'succès', label: '/workflow', exitCode: 0, needle: 'Workflow', run: () => viaSlash('/workflow') },
  { handler: 'handleWorkflow', kind: 'échec', label: '/workflow validate', exitCode: 1, needle: 'Please specify a workflow file', run: () => viaSlash('/workflow validate') },
  { handler: 'handleHooks', kind: 'succès', label: '/hooks', exitCode: 0, needle: 'Hook', run: () => viaSlash('/hooks') },
  { handler: 'handleHooks', kind: 'échec', label: '/hooks enable', exitCode: 1, needle: 'Please specify a hook name', run: () => viaSlash('/hooks enable') },
  { handler: 'handleHooks', kind: 'échec', label: '/hooks disable absent', exitCode: 1, needle: 'not found', run: () => viaSlash('/hooks disable missing-hook-name-absent') },
  { handler: 'handleStarter', kind: 'succès', label: '/starter', exitCode: 0, needle: 'starter', run: () => viaSlash('/starter') },
  { handler: 'handleStarter', kind: 'échec', label: '/starter search', exitCode: 1, needle: 'Usage: /starter search', run: () => viaSlash('/starter search') },
  { handler: 'handleFastMode', kind: 'succès', label: '/fast off', exitCode: 0, needle: 'disabled', run: () => viaSlash('/fast off') },
  { handler: 'handleFastMode', kind: 'succès', label: '/fast status', exitCode: 0, needle: 'Fast Mode', run: () => viaSlash('/fast status') },
  { handler: 'handleThink', kind: 'succès', label: '/think', exitCode: 0, needle: 'Show current mode and help', run: () => viaSlash('/think') },
  { handler: 'handleThink', kind: 'succès', label: '/think off', exitCode: 0, needle: 'Reasoning mode disabled', run: () => viaSlash('/think off') },
  { handler: 'handleThink', kind: 'échec', label: '/think shallow sans cle', exitCode: 1, needle: 'GROK_API_KEY', run: () => viaSlash('/think shallow explique') },
  { handler: 'handleHeartbeat', kind: 'succès', label: '/heartbeat', exitCode: 0, needle: 'Heartbeat', run: () => viaSlash('/heartbeat') },
  { handler: 'handleHeartbeat', kind: 'échec', label: '/heartbeat nope', exitCode: 1, needle: 'Unknown heartbeat action', run: () => viaSlash('/heartbeat nope') },
  { handler: 'handleDailyReset', kind: 'succès', label: '/daily-reset', exitCode: 0, needle: 'Daily', run: () => viaSlash('/daily-reset') },
  { handler: 'handleDailyReset', kind: 'échec', label: '/daily-reset nope', exitCode: 1, needle: 'Unknown daily-reset action', run: () => viaSlash('/daily-reset nope') },
  { handler: 'handleShare', kind: 'succès', label: '/share', exitCode: 0, needle: 'Team Session Manager', run: () => viaSlash('/share') },
  { handler: 'handleShare', kind: 'échec', label: '/share nope', exitCode: 1, needle: 'Unknown share action', run: () => viaSlash('/share nope') },
  { handler: 'handleAgents', kind: 'succès', label: '/agents', exitCode: 0, needle: 'Multi-Agent System', run: () => viaSlash('/agents') },
  { handler: 'handleAgents', kind: 'échec', label: '/agents nope', exitCode: 1, needle: 'Unknown agents action', run: () => viaSlash('/agents nope') },
  { handler: 'handleSubagent', kind: 'succès', label: '/subagent', exitCode: 0, needle: 'subagent', run: () => viaSlash('/subagent') },
  { handler: 'handleSubagent', kind: 'échec', label: '/subagent info absent', exitCode: 1, needle: 'not found', run: () => viaSlash('/subagent info slash-exit-absent') },
  { handler: 'handleFleet', kind: 'succès', label: '/fleet', exitCode: 0, needle: 'fleet', run: () => viaSlash('/fleet') },
  { handler: 'handleFleet', kind: 'échec', label: '/fleet nope', exitCode: 1, needle: 'Unknown fleet action', run: () => viaSlash('/fleet nope') },
  { handler: 'handleSuggest', kind: 'succès', label: '/suggest help', exitCode: 0, needle: 'Categories', run: () => viaSlash('/suggest help') },
  { handler: 'handleSuggest', kind: 'échec', label: '/suggest nope', exitCode: 1, needle: 'Unknown suggestion category', run: () => viaSlash('/suggest nope') },
  { handler: 'handleBug', kind: 'échec', label: '/bug --severity nope', exitCode: 1, needle: 'Invalid severity', run: () => viaSlash('/bug --severity nope') },
  { handler: 'handleTransform', kind: 'succès', label: '/transform', exitCode: 0, needle: 'transform', run: () => viaSlash('/transform') },
  { handler: 'handleTransform', kind: 'échec', label: '/transform nope', exitCode: 1, needle: 'Unknown transformation type', run: () => viaSlash('/transform nope') },
  { handler: 'handleChangeMode', kind: 'succès', label: '/mode', exitCode: 0, needle: 'mode', run: () => viaSlash('/mode') },
  { handler: 'handleChangeMode', kind: 'échec', label: '/mode nope', exitCode: 1, needle: 'Unknown mode', run: () => viaSlash('/mode nope') },
  { handler: 'handlePersonaCommand', kind: 'succès', label: '/persona', exitCode: 0, needle: 'Persona', run: () => viaSlash('/persona') },
  { handler: 'handlePersonaCommand', kind: 'échec', label: '/persona use absent', exitCode: 1, needle: 'not found', run: () => viaSlash('/persona use slash-exit-absent') },
  { handler: 'handleSessions', kind: 'succès', label: '/sessions', exitCode: 0, needle: 'session', run: () => viaSlash('/sessions') },
  { handler: 'handleSessions', kind: 'échec', label: '/sessions show', exitCode: 1, needle: 'Usage: /sessions show', run: () => viaSlash('/sessions show') },
  { handler: 'handlePlugins', kind: 'succès', label: '/plugins', exitCode: 0, needle: 'Plugin', run: () => viaSlash('/plugins') },
  { handler: 'handlePlugins', kind: 'échec', label: '/plugins enable', exitCode: 1, needle: 'Usage: /plugins enable', run: () => viaSlash('/plugins enable') },
  { handler: 'handleAgent', kind: 'succès', label: '/agent', exitCode: 0, needle: 'agent', run: () => viaSlash('/agent') },
  { handler: 'handleAgent', kind: 'échec', label: '/agent info', exitCode: 1, needle: 'Usage: /agent info', run: () => viaSlash('/agent info') },
  { handler: 'handleMerge', kind: 'échec', label: '/merge', exitCode: 1, needle: 'Usage: /merge', run: () => viaSlash('/merge') },
  { handler: 'handleBatchSlashCommand', kind: 'échec', label: '/batch', exitCode: 1, needle: 'Usage: /batch', run: () => viaSlash('/batch') },
  { handler: 'handleBtw', kind: 'échec', label: '/btw', exitCode: 1, needle: 'Usage: /btw', run: () => viaSlash('/btw') },
  { handler: 'handleWorktree', kind: 'succès', label: '/worktree', exitCode: 0, needle: 'worktree', run: () => viaSlash('/worktree') },
  { handler: 'handleWorktree', kind: 'échec', label: '/worktree add', exitCode: 1, needle: 'Usage: /worktree add', run: () => viaSlash('/worktree add') },
  { handler: 'handleScript', kind: 'succès', label: '/script', exitCode: 0, needle: 'script', run: () => viaSlash('/script') },
  { handler: 'handleScript', kind: 'échec', label: '/script run absent.bs', exitCode: 1, needle: 'Script not found', run: () => viaSlash('/script run slash-exit-missing.bs') },
  { handler: 'handleSkill', kind: 'succès', label: '/skill', exitCode: 0, needle: 'Skill', run: () => viaSlash('/skill') },
  { handler: 'handleSkill', kind: 'échec', label: '/skill activate absent', exitCode: 1, needle: 'not found', run: () => viaSlash('/skill activate slash-exit-absent') },
  { handler: 'handleCost', kind: 'succès', label: '/cost', exitCode: 0, needle: 'Cost', run: () => viaSlash('/cost') },
  { handler: 'handleTools', kind: 'succès', label: '/tools', exitCode: 0, needle: 'tool', run: () => viaSlash('/tools') },
  { handler: 'handleStatus', kind: 'succès', label: '/status', exitCode: 0, needle: 'Status', run: () => viaSlash('/status') },
  { handler: 'handleResources', kind: 'succès', label: '/resources', exitCode: 0, needle: 'resource catalog', run: () => viaSlash('/resources') },
  { handler: 'handleQuota', kind: 'succès', label: '/quota', exitCode: 0, needle: 'rate limit', run: () => viaSlash('/quota') },
  { handler: 'handleLog', kind: 'succès', label: '/log', exitCode: 0, needle: 'Log', run: () => viaSlash('/log') },
  { handler: 'handleReload', kind: 'succès', label: '/reload', exitCode: 0, needle: 'eload', run: () => viaSlash('/reload') },
  { handler: 'handleVimMode', kind: 'succès', label: '/vim', exitCode: 0, needle: 'im', run: () => viaSlash('/vim') },
  { handler: 'handleDebugMode', kind: 'succès', label: '/debug off', exitCode: 0, needle: 'DISABLED', run: () => viaSlash('/debug off') },
  { handler: 'handleDebugMode', kind: 'succès', label: '/debug', exitCode: 0, needle: 'debug', run: () => viaSlash('/debug') },
  { handler: 'handleExportFormats', kind: 'succès', label: '/export-formats', exitCode: 0, needle: 'Format', run: () => viaSlash('/export-formats') },
  { handler: 'handleExport', kind: 'succès', label: '/export', exitCode: 0, needle: 'Nothing to export', run: () => viaSlash('/export') },
  { handler: 'handleExportList', kind: 'succès', label: '/export-list', exitCode: 0, needle: 'xport', run: () => viaSlash('/export-list') },
  { handler: 'handleDev', kind: 'succès', label: '/dev help', exitCode: 0, needle: 'Golden-path', run: () => viaSlash('/dev help') },
  { handler: 'handleDev', kind: 'échec', label: '/dev plan', exitCode: 1, needle: 'Usage: /dev plan', run: () => viaSlash('/dev plan') },
  { handler: 'handleUltraplan', kind: 'succès', label: '/ultraplan sans prompt', exitCode: 0, needle: 'Please provide a prompt', run: () => viaSlash('/ultraplan') },
  { handler: 'handleDeepthink', kind: 'échec', label: '/deepthink', exitCode: 1, needle: 'Usage', run: () => viaSlash('/deepthink') },
  { handler: 'handleWatch', kind: 'succès', label: '/watch', exitCode: 0, needle: 'not running', run: () => viaSlash('/watch') },
  { handler: 'handleConflicts', kind: 'succès', label: '/conflicts scan', exitCode: 0, needle: 'onflict', run: () => viaSlash('/conflicts scan') },
  { handler: 'handleConflicts', kind: 'échec', label: '/conflicts resolve', exitCode: 1, needle: 'Usage: /conflicts resolve', run: () => viaSlash('/conflicts resolve') },
  { handler: 'handleTelemetry', kind: 'succès', label: '/telemetry', exitCode: 0, needle: 'elemetry', run: () => viaSlash('/telemetry') },
  { handler: 'handleTrigger', kind: 'échec', label: '/trigger add', exitCode: 1, needle: '--source is required', run: () => viaSlash('/trigger add') },
  { handler: 'handleCloud', kind: 'échec', label: '/cloud cancel', exitCode: 1, needle: 'Usage: cloud cancel', run: () => viaSlash('/cloud cancel') },
  { handler: 'handleCloud', kind: 'succès', label: '/cloud', exitCode: 0, needle: 'loud', run: () => viaSlash('/cloud') },
  { handler: 'handleReplace', kind: 'succès', label: '/replace', exitCode: 0, needle: 'find & replace', run: () => viaSlash('/replace') },

  { handler: 'handleSwitch', kind: 'succès', label: '/switch', exitCode: 0, needle: 'witch', run: () => viaSlash('/switch') },
  { handler: 'handleCopy', kind: 'succès', label: '/copy <texte>', exitCode: 0, needle: 'Copied to clipboard', run: () => copyWithClipboard(true, '/copy slash-exit-copie') },
  { handler: 'handleCopy', kind: 'échec', label: '/copy sans presse-papiers', exitCode: 1, needle: 'Clipboard is not available', run: () => copyWithClipboard(false, '/copy') },
  { handler: 'handleCopy', kind: 'échec', label: '/copy sans réponse', exitCode: 1, needle: 'No assistant response found to copy', run: () => copyWithClipboard(true, '/copy') },
  { handler: 'handleCopy', kind: 'échec', label: '/copy code sans réponse', exitCode: 1, needle: 'No assistant response found to copy', run: () => copyWithClipboard(true, '/copy code') },
  {
    handler: 'handleCopy',
    kind: 'échec',
    label: '/copy code sans bloc',
    exitCode: 1,
    needle: 'No code block found',
    run: async () => {
      clipboard.available = true;
      try {
        return handleCopy(['code'], [{ type: 'assistant', content: 'réponse sans bloc de code', timestamp: new Date() }]);
      } finally {
        clipboard.available = false;
      }
    },
  },
  { handler: 'handleGoal', kind: 'succès', label: '/goal', exitCode: 0, needle: 'oal', run: () => viaSlash('/goal') },
  { handler: 'handleGoal', kind: 'succès', label: '/goal clear', exitCode: 0, needle: 'goal', run: () => viaSlash('/goal clear') },

  { handler: 'handleLessonsCommand', kind: 'succès', label: '/lessons', exitCode: 0, needle: 'esson', run: () => viaSlash('/lessons') },
  { handler: 'handlePipeline', kind: 'succès', label: '/pipeline', exitCode: 0, needle: 'ipeline', run: () => viaSlash('/pipeline') },
  { handler: 'handleParallel', kind: 'succès', label: '/parallel', exitCode: 0, needle: 'Parallel Subagent', run: () => viaSlash('/parallel') },
  { handler: 'handleTrack', kind: 'succès', label: '/track', exitCode: 0, needle: 'track', run: () => viaSlash('/track') },
  { handler: 'handleTeam', kind: 'succès', label: '/team', exitCode: 0, needle: 'eam', run: () => viaSlash('/team') },
  { handler: 'handleSwarm', kind: 'succès', label: '/swarm', exitCode: 0, needle: 'warm', run: () => viaSlash('/swarm') },
  { handler: 'handleCompanion', kind: 'succès', label: '/companion', exitCode: 0, needle: 'ompanion', run: () => viaSlash('/companion') },
  { handler: 'handleContext', kind: 'succès', label: '/context', exitCode: 0, needle: 'ontext', run: () => viaSlash('/context') },
  { handler: 'handleGenerateTests', kind: 'succès', label: '/generate-tests', exitCode: 0, needle: 'est', run: () => viaSlash('/generate-tests') },
  { handler: 'handleAITest', kind: 'échec', label: '/ai-test', exitCode: 1, needle: 'AI Test Failed', run: () => viaSlash('/ai-test') },
  { handler: 'handleIdentity', kind: 'succès', label: '/identity', exitCode: 0, needle: 'dentity', run: () => viaSlash('/identity') },
  { handler: 'handlePolicy', kind: 'succès', label: '/policy', exitCode: 0, needle: 'olicy', run: () => viaSlash('/policy') },
  { handler: 'handleElevated', kind: 'succès', label: '/elevated', exitCode: 0, needle: 'levated', run: () => viaSlash('/elevated') },
  { handler: 'handlePairing', kind: 'succès', label: '/pairing', exitCode: 0, needle: 'airing', run: () => viaSlash('/pairing') },
  { handler: 'handleToolAnalytics', kind: 'succès', label: '/tool-analytics', exitCode: 0, needle: 'ool', run: () => viaSlash('/tool-analytics') },
  { handler: 'handleClearChat', kind: 'succès', label: '/clear', exitCode: 0, needle: 'lear', run: () => viaSlash('/clear') },
  { handler: 'handleUndo', kind: 'succès', label: '/undo', exitCode: 0, needle: 'ndo', run: () => viaSlash('/undo') },
  { handler: 'handleDiff', kind: 'succès', label: '/diff dépôt isolé modifié', exitCode: 0, needle: 'slash-exit-diff-marker', run: () => diffInIsolatedRepo(true) },
  { handler: 'handleDiff', kind: 'succès', label: '/diff dépôt isolé propre', exitCode: 0, needle: 'No uncommitted changes', run: () => diffInIsolatedRepo(false) },
  { handler: 'handleCompact', kind: 'succès', label: '/compact', exitCode: 0, needle: 'ompact', run: () => viaSlash('/compact') },
  { handler: 'handleFork', kind: 'succès', label: '/fork', exitCode: 0, needle: 'Created branch', run: () => viaSlash('/fork') },
  { handler: 'handleBranches', kind: 'succès', label: '/branches', exitCode: 0, needle: 'ranch', run: () => viaSlash('/branches') },
  { handler: 'handleBranch', kind: 'succès', label: '/branch', exitCode: 0, needle: 'ranch', run: () => viaSlash('/branch') },
  { handler: 'handleCheckout', kind: 'échec', label: '/checkout', exitCode: 1, needle: 'Usage', run: () => viaSlash('/checkout') },
  { handler: 'handleWorkspace', kind: 'succès', label: '/workspace', exitCode: 0, needle: 'orkspace', run: () => viaSlash('/workspace') },
  { handler: 'handleAddContext', kind: 'succès', label: '/add', exitCode: 0, needle: 'Add Files to Context', run: () => viaSlash('/add') },
  { handler: 'handleAddContext', kind: 'échec', label: '/add fichier absent', exitCode: 1, needle: 'No files matched', run: () => viaSlash('/add slash-exit-no-such-file.ts') },
  { handler: 'handleColab', kind: 'succès', label: '/colab', exitCode: 0, needle: 'Statut de Collaboration', run: () => viaSlash('/colab') },
  { handler: 'handleVoiceCode', kind: 'succès', label: '/voice-code', exitCode: 0, needle: 'oice', run: () => viaSlash('/voice-code') },
  { handler: 'handleTTS', kind: 'succès', label: '/tts', exitCode: 0, needle: 'Text-to-Speech', run: () => viaSlash('/tts') },
  { handler: 'handlePromptCommand', kind: 'succès', label: '/prompt', exitCode: 0, needle: 'rompt', run: () => viaSlash('/prompt') },
  { handler: 'handleChangeModel', kind: 'succès', label: '/model', exitCode: 0, needle: 'odel', run: () => viaSlash('/model') },
  { handler: 'handleChangeModel', kind: 'succès', label: '/model auto off', exitCode: 0, needle: 'Auto model routing disabled', run: () => viaSlash('/model auto off') },
  { handler: 'handleListCheckpoints', kind: 'succès', label: '/checkpoints', exitCode: 0, needle: 'heckpoint', run: () => viaSlash('/checkpoints') },
  { handler: 'handleRestoreCheckpoint', kind: 'succès', label: '/restore', exitCode: 0, needle: 'No checkpoints available', run: () => viaSlash('/restore') },
  { handler: 'handleScanTodos', kind: 'succès', label: '/scan-todos', exitCode: 0, needle: 'odo', run: () => viaSlash('/scan-todos') },
  { handler: 'handleAddressTodo', kind: 'échec', label: '/address-todo', exitCode: 1, needle: 'sage', run: () => viaSlash('/address-todo') },
  { handler: 'handleRemember', kind: 'échec', label: '/remember', exitCode: 1, needle: 'sage', run: () => viaSlash('/remember') },
  { handler: 'handleNew', kind: 'succès', label: '/new', exitCode: 0, needle: 'ew', run: () => viaSlash('/new') },
  { handler: 'handleGrillMe', kind: 'succès', label: '/grill-me', exitCode: 0, needle: '/grill-me', run: () => viaSlash('/grill-me') },
  { handler: 'handlePlugin', kind: 'succès', label: '/plugin', exitCode: 0, needle: 'lugin', run: () => viaSlash('/plugin') },
  { handler: 'handleKnowledgeGraph', kind: 'succès', label: '/knowledge-graph', exitCode: 0, needle: 'isabled', run: () => viaSlash('/knowledge-graph') },
  { handler: 'handleTimeline', kind: 'succès', label: '/timeline', exitCode: 0, needle: 'isabled', run: () => viaSlash('/timeline') },
  { handler: 'handleApprovals', kind: 'succès', label: '/approvals', exitCode: 0, needle: 'pproval', run: () => viaSlash('/approvals') },
  { handler: 'handleRedo', kind: 'succès', label: '/redo', exitCode: 0, needle: 'edo', run: () => viaSlash('/redo') },
];

describe('sortie headless des gestionnaires touchés', () => {
  it.each(cases)('$handler $kind $label → $exitCode', async ({ run, exitCode, needle }) => {
    const result = await run();
    const output = textOf(result);
    expect(output, output).toContain(needle);
    expect(exitCodeOf(result), output).toBe(exitCode);
  });

  it('handleBackup list est un succès et un sous-commande inconnue un échec', async () => {
    const success = await handleBackup('list');
    const successText = textOf(success);
    expect(successText, successText).toMatch(/backup/i);
    expect(exitCodeOf(success), successText).toBe(0);
    const failure = await handleBackup('nope');
    const failureText = textOf(failure);
    expect(failureText, failureText).toContain('Unknown backup subcommand');
    expect(exitCodeOf(failure), failureText).toBe(1);
  });

  it('handleModelRouter interne : off succès, sensitivity sans niveau échec', () => {
    const success = handleResearchModelRouter(['off']);
    const successText = textOf(success);
    expect(successText, successText).toContain('Model routing disabled');
    expect(exitCodeOf(success), successText).toBe(0);
    const failure = handleResearchModelRouter(['sensitivity']);
    const failureText = textOf(failure);
    expect(failureText, failureText).toContain('Please specify sensitivity');
    expect(exitCodeOf(failure), failureText).toBe(1);
  });

  it('/bug sur un fichier minuscule réussit et un filtre invalide échoue', async () => {
    const success = await viaSlash(`/bug ${bugFile}`);
    const successText = textOf(success);
    expect(successText.toLowerCase(), successText).toContain('bug');
    expect(exitCodeOf(success), successText).toBe(0);
    const failure = await viaSlash('/bug --severity nope');
    const failureText = textOf(failure);
    expect(failureText, failureText).toContain('Invalid severity');
    expect(exitCodeOf(failure), failureText).toBe(1);
  });
});
