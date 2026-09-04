import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  extractDelegationFacts,
  formatRunFactsLine,
  readDelegationLogs,
  findHeadlessJson,
  extractModel,
  extractRoundLimit,
  countToolRounds,
  extractCostUsd,
  extractCostCap,
} from '../../../src/agent/self-improvement/delegation-facts.js';
import { DelegationLogsExperienceSource } from '../../../src/agent/self-improvement/digest-sources.js';
import { parseRunFacts, replayUnder, ReplayStrategyEvaluator } from '../../../src/agent/self-improvement/strategy-replay.js';
import type { StrategySpec } from '../../../src/agent/self-improvement/strategy-types.js';

describe('delegation-facts pure parsers (Point 1 DGM6)', () => {
  let tmpDir: string;
  let delegationsDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dgm6-deleg-facts-'));
    delegationsDir = path.join(tmpDir, 'delegations');
    fs.mkdirSync(delegationsDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('extrait le modèle effectif et le coût réel quand pricing != unknown', () => {
    const content = `→ mistral sur /sandbox/project — journal : /sandbox/delegations/2026-09-04T073708-mistral-MISSION.log
{"result":"Opération terminée","cost":{"total":0.047052,"pricing":"known","billing":"pay-per-use"},"model":"mistral-medium-latest","messages":[{"role":"user","content":"do task"},{"role":"assistant","content":"I am calling tool","tool_calls":[{"id":"tc-1","type":"function","function":{"name":"view_file","arguments":"{}"}}]},{"role":"tool","tool_call_id":"tc-1","content":"done"},{"role":"assistant","content":"finished"}]}
─────────────────────────────────────────────
moteur mistral · 10 s · sortie 0
`;
    const fact = extractDelegationFacts(content, 'launcher-test.out');
    expect(fact.engine).toBe('mistral');
    expect(fact.model).toBe('mistral-medium-latest');
    expect(fact.requestedModel).toBeUndefined();
    expect(fact.costUsd).toBe(0.047052);
    expect(fact.durationSec).toBe(10);
    expect(fact.exitCode).toBe(0);
    expect(fact.toolRounds).toBe(1);
  });

  it('laisse costUsd absent si pricing == unknown', () => {
    const content = `→ nvidia sur /sandbox/project — journal : /sandbox/delegations/2026-09-04T080000-nvidia-MISSION.log
{"result":"Rate limit","cost":{"total":0.100113,"pricing":"unknown","billing":"pay-per-use"},"model":"moonshotai/kimi-k3"}
─────────────────────────────────────────────
moteur nvidia · 45 s · sortie 1
`;
    const fact = extractDelegationFacts(content, 'launcher-nvidia.out');
    expect(fact.engine).toBe('nvidia');
    expect(fact.model).toBe('moonshotai/kimi-k3');
    expect(fact.costUsd).toBeUndefined(); // pricing == unknown => absent
    expect(fact.exitCode).toBe(1);
  });

  it('gère le repli de modèle MODELLABEL1 (modèle effectif vs demandé)', () => {
    const content = `→ gmi sur /sandbox/project — journal : /sandbox/delegations/2026-09-04T090000-gmi-MISSION.log
⚠️  Modèle "gpt-6-astra" non disponible, repli sur "gpt-5.6-sol"
{"result":"OK","cost":{"total":0.0117,"pricing":"known"},"model":"gpt-5.6-sol","requestedModel":"gpt-6-astra","messages":[]}
─────────────────────────────────────────────
moteur gmi · 12 s · sortie 0
`;
    const fact = extractDelegationFacts(content, 'launcher-gmi.out');
    expect(fact.model).toBe('gpt-5.6-sol'); // effectif
    expect(fact.requestedModel).toBe('gpt-6-astra'); // demandé
    expect(fact.costUsd).toBe(0.0117);
    expect(fact.toolRounds).toBe(0);
  });

  it('extrait roundLimit et toolRounds lors d’une coupure au plafond 300', () => {
    const content = `→ qwen sur /sandbox/project — journal : /sandbox/delegations/2026-09-04T100000-qwen-MISSION.log
Commande exécutée : node dist/index.js -m qwen3.8:27b --max-tool-rounds 300 -p "run"
Maximum tool execution rounds reached.
─────────────────────────────────────────────
moteur qwen · 1820 s · sortie 1
`;
    const fact = extractDelegationFacts(content, 'launcher-qwen.out');
    expect(fact.engine).toBe('qwen');
    expect(fact.roundLimit).toBe(300);
    expect(fact.toolRounds).toBe(300);
    expect(fact.namedFailures).toContain('Maximum tool execution rounds');
    expect(fact.exitCode).toBe(1);
  });

  it('extrait le nombre N d’un avertissement explicite Maximum tool execution rounds (N)', () => {
    const content = `→ local sur /sandbox/project
Warning: Maximum tool execution rounds (50) reached. Stopping to prevent infinite loops.
─────────────────────────────────────────────
moteur local · 300 s · sortie 1
`;
    const fact = extractDelegationFacts(content, 'launcher-local.out');
    expect(fact.roundLimit).toBe(50);
    expect(fact.toolRounds).toBe(50);
    expect(fact.namedFailures).toContain('Maximum tool execution rounds');
  });

  it('extrait le plafond de coût costCap si journalisé (--max-price ou cost cap)', () => {
    const content = `→ mistral sur /sandbox/project
Execution: node dist/index.js --max-price 4.5 --max-tool-rounds 100
Plafond de coût : $4.5
sortie 1
`;
    const fact = extractDelegationFacts(content, 'launcher-cost.out');
    expect(fact.costCap).toBe(4.5);
    expect(fact.roundLimit).toBe(100);
  });

  it('les faits absents restent strictement absents (aucun chiffre inventé)', () => {
    const content = `Journal brut sans métriques particulières
Opération achevée.
`;
    const fact = extractDelegationFacts(content, 'simple.log');
    expect(fact.costUsd).toBeUndefined();
    expect(fact.costCap).toBeUndefined();
    expect(fact.roundLimit).toBeUndefined();
    expect(fact.toolRounds).toBeUndefined();
    expect(fact.exitCode).toBeUndefined();
    expect(fact.durationSec).toBeUndefined();
    expect(fact.model).toBeUndefined();
  });

  it('formatRunFactsLine génère uniquement les clés connues', () => {
    const lineFull = formatRunFactsLine({
      id: 'test-1',
      engine: 'mistral',
      toolRounds: 300,
      roundLimit: 300,
      costUsd: 0.05,
      costCap: 3.0,
      exitCode: 1,
      namedFailures: ['Maximum tool execution rounds'],
      changes: [],
      pilotLessons: [],
    });
    expect(lineFull).toBe('facts: rounds=300 limit=300 cost=0.05 cap=3 outcome=failure failure=max-rounds');

    const lineSuccess = formatRunFactsLine({
      id: 'test-2',
      engine: 'luna',
      toolRounds: 41,
      exitCode: 0,
      namedFailures: [],
      changes: [],
      pilotLessons: [],
    });
    expect(lineSuccess).toBe('facts: rounds=41 outcome=success');

    const lineEmpty = formatRunFactsLine({
      id: 'test-3',
      engine: 'inconnu',
      changes: [],
      namedFailures: [],
      pilotLessons: [],
    });
    expect(lineEmpty).toBe('');
  });
});

describe('Replay contrefactuel sur expériences de délégations (Point 2 DGM6)', () => {
  let tmpDir: string;
  let delegationsDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dgm6-replay-test-'));
    delegationsDir = path.join(tmpDir, 'delegations');
    fs.mkdirSync(delegationsDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  const baseSpec = (rounds: number): StrategySpec => ({
    id: `strat-test-${rounds}`,
    version: 1,
    scope: 'headless',
    limits: { maxToolRounds: rounds, maxCostUsd: 10 },
    reasoning: 'default',
    verification: { commitPerStep: false, testsForTouchedFiles: false },
    directives: [],
  });

  it('une lane coupée à 300 tours rejoue en PERTE sous plafond 75 et en GAIN sous 400', async () => {
    const fixtureCut300 = `→ qwen sur /sandbox/project — journal : /sandbox/delegations/2026-09-04T100000-qwen-MISSION.log
Lancement : buddy --max-tool-rounds 300 -p "heavy refactor"
Maximum tool execution rounds reached.
─────────────────────────────────────────────
moteur qwen · 1820 s · sortie 1
`;
    fs.writeFileSync(path.join(delegationsDir, 'launcher-qwen-300.out'), fixtureCut300, 'utf8');

    const source = new DelegationLogsExperienceSource({
      delegationsDir,
      enabled: true,
    });
    const experiences = await source.collect();
    expect(experiences.length).toBe(1);

    const exp = experiences[0]!;
    expect(exp.context).toContain('facts: rounds=300 limit=300 outcome=failure failure=max-rounds');

    // Vérifier l'analyse des faits
    const facts = parseRunFacts(exp);
    expect(facts.rounds).toBe(300);
    expect(facts.limit).toBe(300);
    expect(facts.failure).toBe('max-rounds');
    expect(facts.outcome).toBe('failure');

    // 1. Sous un plafond de 75 : la lane de 300 tours reste en échec (PERTE)
    const replay75 = replayUnder(facts, baseSpec(75));
    expect(replay75).not.toBeNull();
    expect(replay75!.ok).toBe(false);
    expect(replay75!.note).toContain('ceiling 75 ≤ 300');

    // 2. Sous un plafond de 400 : la lane de 300 tours réussit (GAIN)
    const replay400 = replayUnder(facts, baseSpec(400));
    expect(replay400).not.toBeNull();
    expect(replay400!.ok).toBe(true);
    expect(replay400!.note).toContain('ceiling 400 > 300 rounds used');

    // 3. Évaluation comparative via ReplayStrategyEvaluator
    // Parent à 300 (la lane y a échoué) vs Candidate à 75 (échoue aussi -> pas de gain)
    const evaluator75 = new ReplayStrategyEvaluator([exp]);
    const evalResult75 = await evaluator75.evaluate(baseSpec(75), baseSpec(300));
    expect(evalResult75.observations.length).toBe(1);
    expect(evalResult75.observations[0]!.parentOk).toBe(false);
    expect(evalResult75.observations[0]!.candidateOk).toBe(false);

    // Parent à 300 (la lane a échoué) vs Candidate à 400 (réussit -> GAIN net !)
    const evaluator400 = new ReplayStrategyEvaluator([exp]);
    const evalResult400 = await evaluator400.evaluate(baseSpec(400), baseSpec(300));
    expect(evalResult400.observations.length).toBe(1);
    expect(evalResult400.observations[0]!.parentOk).toBe(false);
    expect(evalResult400.observations[0]!.candidateOk).toBe(true);
  });

  it('une lane réussie en 41 tours reste un succès sous 50 (et échouerait sous 30)', async () => {
    // Fixture d'une session headless réussie ayant fait 41 tours d'outils
    const toolMessages: Array<{ role: string; content?: string; tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }> }> = [
      { role: 'user', content: 'test mission' },
    ];
    for (let i = 0; i < 41; i++) {
      toolMessages.push({
        role: 'assistant',
        tool_calls: [{ id: `tc-${i}`, type: 'function', function: { name: 'bash', arguments: '{"command":"ls"}' } }],
      });
      toolMessages.push({
        role: 'tool',
        content: 'ok',
      });
    }
    toolMessages.push({ role: 'assistant', content: 'Mission accomplished' });

    const jsonOutput = JSON.stringify({
      result: 'Mission accomplished',
      cost: { total: 0.035, pricing: 'known' },
      model: 'gpt-5.6-luna',
      messages: toolMessages,
    });

    const fixtureSuccess41 = `→ luna sur /sandbox/project — journal : /sandbox/delegations/2026-09-04T110000-luna-MISSION.log
${jsonOutput}
─────────────────────────────────────────────
moteur luna · 410 s · sortie 0
`;
    fs.writeFileSync(path.join(delegationsDir, 'launcher-luna-41.out'), fixtureSuccess41, 'utf8');

    const source = new DelegationLogsExperienceSource({
      delegationsDir,
      enabled: true,
    });
    const experiences = await source.collect();
    expect(experiences.length).toBe(1);

    const exp = experiences[0]!;
    expect(exp.context).toContain('facts: rounds=41 cost=0.035 outcome=success');

    const facts = parseRunFacts(exp);
    expect(facts.rounds).toBe(41);
    expect(facts.outcome).toBe('success');
    expect(facts.costUsd).toBe(0.035);

    // 1. Sous un plafond de 50 : 50 >= 41 -> reste un succès !
    const replay50 = replayUnder(facts, baseSpec(50));
    expect(replay50).not.toBeNull();
    expect(replay50!.ok).toBe(true);
    expect(replay50!.note).toBe('unchanged');

    // 2. Sous un plafond de 30 : 30 < 41 -> rejoue en échec
    const replay30 = replayUnder(facts, baseSpec(30));
    expect(replay30).not.toBeNull();
    expect(replay30!.ok).toBe(false);
    expect(replay30!.note).toContain('ceiling 30 < 41 rounds needed');

    // 3. ReplayStrategyEvaluator : Parent à 50 vs Candidate à 50 -> les deux ok
    const evaluator = new ReplayStrategyEvaluator([exp]);
    const evalResult = await evaluator.evaluate(baseSpec(50), baseSpec(50));
    expect(evalResult.observations.length).toBe(1);
    expect(evalResult.observations[0]!.parentOk).toBe(true);
    expect(evalResult.observations[0]!.candidateOk).toBe(true);
  });
});
