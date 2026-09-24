/**
 * Les clés [middleware] explicites règlent les limites réelles.
 * Priorité : option de ligne de commande, fichier, constante historique.
 * Aucune source : les valeurs d'aujourd'hui. Pas de rechargement à chaud.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/memory/persistent-memory.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/memory/persistent-memory.js')>();
  actual.PersistentMemoryManager.prototype.initialize = () => Promise.resolve();
  return {
    ...actual,
    initializeMemory: () => Promise.resolve(undefined as never),
  };
});

import { CodeBuddyAgent } from '../../src/agent/codebuddy-agent.js';
import type { MiddlewareContext } from '../../src/agent/middleware/types.js';
import { CostLimitMiddleware } from '../../src/agent/middleware/cost-limit.js';
import { TurnLimitMiddleware } from '../../src/agent/middleware/turn-limit.js';
import { getAutonomyManager } from '../../src/utils/autonomy-manager.js';

interface AgentPeek {
  maxToolRounds: number;
  sessionCostLimit: number;
  yoloMode: boolean;
  turnWarningRatio?: number;
  costWarningRatio?: number;
  executor: {
    getMiddlewarePipeline(): {
      getMiddlewareNames(): string[];
      runBeforeTurn(context: MiddlewareContext): Promise<{ action: string; message?: string }>;
      runAfterTurn(context: MiddlewareContext): Promise<{ action: string; message?: string }>;
    } | undefined;
  };
  contextManager: { updateConfig(config: { autoCompactThreshold?: number }): void };
  dispose(): void;
  setModel(model: string): void;
  setYoloMode(enabled: boolean): void;
}

const previous = {
  home: process.env.CODEBUDDY_HOME,
  config: process.env.CODEBUDDY_CONFIG,
  maxCost: process.env.MAX_COST,
  yolo: process.env.YOLO_MODE,
  argv: process.argv.slice(),
  cwd: process.cwd(),
};

let scratch: string | undefined;
const agents: CodeBuddyAgent[] = [];

function restoreEnv(): void {
  process.chdir(previous.cwd);
  process.argv = previous.argv.slice();
  if (previous.home === undefined) delete process.env.CODEBUDDY_HOME;
  else process.env.CODEBUDDY_HOME = previous.home;
  if (previous.config === undefined) delete process.env.CODEBUDDY_CONFIG;
  else process.env.CODEBUDDY_CONFIG = previous.config;
  if (previous.maxCost === undefined) delete process.env.MAX_COST;
  else process.env.MAX_COST = previous.maxCost;
  if (previous.yolo === undefined) delete process.env.YOLO_MODE;
  else process.env.YOLO_MODE = previous.yolo;
}

function freshHome(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'mw-facade-'));
  scratch = root;
  mkdirSync(path.join(root, '.codebuddy'), { recursive: true });
  process.env.CODEBUDDY_HOME = root;
  delete process.env.CODEBUDDY_CONFIG;
  delete process.env.MAX_COST;
  delete process.env.YOLO_MODE;
  process.chdir(root);
  process.argv = ['node', 'buddy'];
  return root;
}

function writeToml(home: string, relative: string, body: string): void {
  const file = path.join(home, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
}

function spawn(rounds?: number): AgentPeek {
  const agent = rounds === undefined
    ? new CodeBuddyAgent('test-api-key')
    : new CodeBuddyAgent('test-api-key', undefined, undefined, rounds);
  agents.push(agent);
  return agent as unknown as AgentPeek;
}

function context(partial: Partial<MiddlewareContext>): MiddlewareContext {
  return {
    toolRound: 0,
    maxToolRounds: 10,
    sessionCost: 0,
    sessionCostLimit: 10,
    inputTokens: 0,
    outputTokens: 0,
    history: [],
    messages: [],
    isStreaming: false,
    ...partial,
  };
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const guardedMemory = path.join(homedir(), '.codebuddy', 'memory.md');
const guardedMemoryExisted = existsSync(guardedMemory);

afterEach(() => {
  getAutonomyManager().disableYOLO();
  while (agents.length > 0) {
    const agent = agents.pop();
    try { agent?.dispose(); } catch { /* le test a déjà échoué */ }
  }
  restoreEnv();
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
  if (!guardedMemoryExisted) rmSync(guardedMemory, { force: true });
});

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (!guardedMemoryExisted) rmSync(guardedMemory, { force: true });
});

describe('middleware — aucune source', () => {
  it('garde 50 tours et 10 dollars, comme aujourd\'hui', () => {
    freshHome();
    const agent = spawn();
    expect(agent.yoloMode).toBe(false);
    expect(agent.maxToolRounds).toBe(50);
    expect(agent.sessionCostLimit).toBe(10);
    expect(agent.turnWarningRatio).toBe(0.8);
    expect(agent.costWarningRatio).toBe(0.8);
    const manager = agent.contextManager as unknown as {
      config?: { autoCompactThreshold?: number };
    };
    expect(manager.config?.autoCompactThreshold).toBe(200000);
  });

  it('garde 400 tours et 100 dollars en YOLO, et le plafond dur à 1000', () => {
    freshHome();
    getAutonomyManager().enableYOLO(false);
    const agent = spawn();
    expect(agent.yoloMode).toBe(true);
    expect(agent.maxToolRounds).toBe(400);
    expect(agent.sessionCostLimit).toBe(100);

    writeToml(scratch as string, '.codebuddy/config.toml', '[middleware]\nmax_cost = 5000\n');
    const capped = spawn();
    expect(capped.sessionCostLimit).toBe(1000);
  });
});

describe('middleware — priorité et branchement', () => {
  it('lit max_turns, max_cost et le compactage explicites du fichier', () => {
    const home = freshHome();
    writeToml(home, '.codebuddy/config.toml', [
      '[middleware]',
      'max_turns = 80',
      'max_cost = 40',
      'auto_compact_threshold = 12345',
      'turn_warning_threshold = 0.5',
      'cost_warning_threshold = 0.5',
      '',
    ].join('\n'));
    const agent = spawn();
    expect(agent.maxToolRounds).toBe(80);
    expect(agent.sessionCostLimit).toBe(40);
    expect(agent.turnWarningRatio).toBe(0.5);
    expect(agent.costWarningRatio).toBe(0.5);
    const manager = agent.contextManager as unknown as {
      config?: { autoCompactThreshold?: number };
    };
    expect(manager.config?.autoCompactThreshold).toBe(12345);
  });

  it('l\'option de construction gagne sur le fichier pour les tours', () => {
    const home = freshHome();
    writeToml(home, '.codebuddy/config.toml', '[middleware]\nmax_turns = 80\n');
    const agent = spawn(30);
    expect(agent.maxToolRounds).toBe(30);
  });

  it('--max-price gagne sur le fichier, qui gagne sur MAX_COST', () => {
    const home = freshHome();
    writeToml(home, '.codebuddy/config.toml', '[middleware]\nmax_cost = 40\n');
    process.env.MAX_COST = '25';
    process.argv = ['node', 'buddy', '--max-price', '7'];
    const agent = spawn();
    expect(agent.sessionCostLimit).toBe(7);
  });

  it('sans --max-price, le fichier gagne sur MAX_COST', () => {
    const home = freshHome();
    writeToml(home, '.codebuddy/config.toml', '[middleware]\nmax_cost = 40\n');
    process.env.MAX_COST = '25';
    const agent = spawn();
    expect(agent.sessionCostLimit).toBe(40);
  });

  it('MAX_COST reste lu quand le fichier ne donne pas de coût', () => {
    freshHome();
    process.env.MAX_COST = '25';
    const agent = spawn();
    expect(agent.sessionCostLimit).toBe(25);
    expect(agent.maxToolRounds).toBe(50);
  });

  it('le projet gagne sur l\'utilisateur, le profil gagne sur le projet', () => {
    const home = freshHome();
    writeToml(home, '.codebuddy/config.toml', [
      '[middleware]',
      'max_turns = 80',
      '',
      '[profiles.serre.middleware]',
      'max_turns = 33',
      '',
    ].join('\n'));
    writeToml(home, 'workspace/.codebuddy/config.toml', '[middleware]\nmax_turns = 61\n');
    process.chdir(path.join(home, 'workspace'));
    const fromProject = spawn();
    expect(fromProject.maxToolRounds).toBe(61);

    process.argv = ['node', 'buddy', '--profile', 'serre'];
    const fromProfile = spawn();
    expect(fromProfile.maxToolRounds).toBe(33);
  });

  it('YOLO n\'efface pas un max_turns explicite, et /yolo non plus', () => {
    const home = freshHome();
    writeToml(home, '.codebuddy/config.toml', '[middleware]\nmax_turns = 80\nmax_cost = 40\n');
    getAutonomyManager().enableYOLO(false);
    const agent = spawn();
    expect(agent.maxToolRounds).toBe(80);
    expect(agent.sessionCostLimit).toBe(40);
    agent.setYoloMode(false);
    expect(agent.maxToolRounds).toBe(80);
    expect(agent.sessionCostLimit).toBe(40);
    agent.setYoloMode(true);
    expect(agent.maxToolRounds).toBe(80);
    expect(agent.sessionCostLimit).toBe(40);
  });

  it('un changement du fichier après le démarrage n\'est pas repris', () => {
    const home = freshHome();
    const file = '.codebuddy/config.toml';
    writeToml(home, file, '[middleware]\nmax_turns = 80\n');
    const agent = spawn();
    expect(agent.maxToolRounds).toBe(80);
    writeToml(home, file, '[middleware]\nmax_turns = 90\n');
    expect(agent.maxToolRounds).toBe(80);
  });
});

describe('middleware — consommateurs des seuils', () => {
  it('le seuil de tours du fichier est celui du middleware de la session', async () => {
    const home = freshHome();
    writeToml(home, '.codebuddy/config.toml', '[middleware]\nturn_warning_threshold = 0.5\n');
    const agent = spawn();
    await vi.waitFor(() => {
      expect(agent.executor.getMiddlewarePipeline()?.getMiddlewareNames()).toContain('turn-limit');
    }, { timeout: 10000 });
    const pipeline = agent.executor.getMiddlewarePipeline();
    const warned = await pipeline?.runBeforeTurn(context({ toolRound: 5, maxToolRounds: 10 }));
    expect(warned?.message ?? '').toMatch(/Approaching tool round limit/);
    const quiet = new TurnLimitMiddleware();
    const historical = quiet.beforeTurn(context({ toolRound: 5, maxToolRounds: 10 }));
    expect(historical.action).toBe('continue');
  });

  it('le seuil de coût du fichier est celui du middleware de la session', async () => {
    const home = freshHome();
    writeToml(home, '.codebuddy/config.toml', '[middleware]\ncost_warning_threshold = 0.5\n');
    const agent = spawn();
    await vi.waitFor(() => {
      expect(agent.executor.getMiddlewarePipeline()?.getMiddlewareNames()).toContain('cost-limit');
    }, { timeout: 10000 });
    const pipeline = agent.executor.getMiddlewarePipeline();
    const warned = await pipeline?.runAfterTurn(context({
      sessionCost: 6,
      sessionCostLimit: 10,
    }));
    expect(warned?.message ?? '').toMatch(/Session cost approaching limit/);
    const historical = new CostLimitMiddleware({
      isSessionCostLimitReached: () => false,
    }).afterTurn(context({ sessionCost: 6, sessionCostLimit: 10 }));
    expect(historical.action).toBe('continue');
  });

  it('TurnLimitMiddleware et CostLimitMiddleware honorent un ratio explicite', () => {
    const turns = new TurnLimitMiddleware({ warningRatio: 0.5 });
    expect(turns.beforeTurn(context({ toolRound: 5, maxToolRounds: 10 })).action).toBe('warn');
    expect(turns.beforeTurn(context({ toolRound: 4, maxToolRounds: 10 })).action).toBe('continue');
    const cost = new CostLimitMiddleware({
      isSessionCostLimitReached: () => false,
      warningRatio: 0.5,
    });
    expect(cost.afterTurn(context({ sessionCost: 5, sessionCostLimit: 10 })).action).toBe('warn');
    expect(cost.afterTurn(context({ sessionCost: 4, sessionCostLimit: 10 })).action).toBe('continue');
  });
});

describe('middleware — seuil de compactage après setModel', () => {
  function threshold(agent: AgentPeek): number | undefined {
    const manager = agent.contextManager as unknown as {
      config?: { autoCompactThreshold?: number };
    };
    return manager.config?.autoCompactThreshold;
  }

  it('conserve 12345 écrit dans le fichier après un changement de modèle', () => {
    const home = freshHome();
    writeToml(home, '.codebuddy/config.toml', '[middleware]\nauto_compact_threshold = 12345\n');
    const agent = spawn();
    expect(threshold(agent)).toBe(12345);
    agent.setModel('llama3');
    expect(threshold(agent)).toBe(12345);
  });

  it('sans clé dans le fichier, setModel recalcule encore le seuil sur la fenêtre', () => {
    freshHome();
    const agent = spawn();
    expect(threshold(agent)).toBe(200000);
    agent.setModel('llama3');
    expect(threshold(agent)).toBe(8192);
  });
});

describe('rechargement à chaud', () => {
  it('le module qui promettait un surveillant de fichiers n\'est plus là', () => {
    expect(existsSync(path.join(repoRoot, 'src/config/hot-reload/index.ts'))).toBe(false);
  });
});
