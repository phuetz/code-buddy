import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DelegationLogsExperienceSource,
  extractDelegationFacts,
  readDelegationLogs,
  NAMED_DELEGATION_FAILURES,
  PILOT_LESSONS,
} from '../../../src/agent/self-improvement/digest-sources.js';
import { EvolutionaryArchive } from '../../../src/agent/self-improvement/evolutionary-archive.js';
import {
  buildImprovementDigest,
  renderImprovementDigestMarkdown,
  renderImprovementDigestHtml,
} from '../../../src/agent/self-improvement/digest.js';

describe('DelegationLogsExperienceSource (Point 1 DGM5)', () => {
  let tmpDir: string;
  let delegationsDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dgm5-deleg-test-'));
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

  // 3 synthetic, fully anonymized fixtures covering the 5 failures and 5 lessons
  const fixture1Out = `→ luna sur /sandbox/project — journal : /sandbox/delegations/2026-09-04T070000-luna-MISSION-CIFIX1.log
Tests exécutés avec succès sous HOME isolé pour Vitest.
Règle observée : commiter après chaque point et preuve = tests des fichiers touchés.
─────────────────────────────────────────────
moteur luna · 1576 s · sortie 0
commandes réellement exécutées : 78
── ce qui a bougé ──
  d3b6bcccae0f66a2d8434f5fa7564361ecd7a36f
  docs/reports/2026-09/REPARATION-CIFIX1.md
`;

  const fixture1Log = `[2026-09-04T07:00:00.000Z] ℹ️ INFO Démarrage de la lane CIFIX1
[2026-09-04T07:26:16.000Z] ℹ️ INFO Fin normale. Preuve = tests des fichiers touchés.
`;

  const fixture2Log = `[2026-09-04T08:00:00.000Z] ℹ️ INFO Démarrage MODELLABEL1
[2026-09-04T08:02:06.000Z] ⚠️ WARN Préparation du repli modèle
[2026-09-04T08:02:06.000Z] ❌ ERROR Agent turn failed {"errorType":"TypeError","error":"(accumulatedMessage.content || \\"\\").trim is not a function"}
[2026-09-04T08:02:06.000Z] ❌ ERROR SyntaxError: Unexpected end of JSON input
Sortie en erreur : lire le journal du boot précédent avant de relancer.
── ce qui a bougé ──
  src/index.ts
`;

  const fixture3Out = `→ vibe sur /sandbox/project — journal : /sandbox/delegations/2026-09-04T090000-vibe-MISSION-COST1.log
Error: API error from provider: LLM backend error
  reason: peer closed connection without sending complete message body
  details: Maximum tool execution rounds reached. Turn limit exceeded.
Consigne du pilote : ne pas éditer un script bash en cours d'exécution.
─────────────────────────────────────────────
moteur vibe · 2332 s · sortie 1
── ce qui a bougé ──
  src/utils/cost-tracker.ts
`;

  it('extraits les faits structurés d’un journal individuel (moteur, durée, sortie, ce qui a bougé)', () => {
    const fact1 = extractDelegationFacts(fixture1Out, 'launcher-cifix1.out');
    expect(fact1.engine).toBe('luna');
    expect(fact1.durationSec).toBe(1576);
    expect(fact1.exitCode).toBe(0);
    expect(fact1.changes).toEqual([
      'd3b6bcccae0f66a2d8434f5fa7564361ecd7a36f',
      'docs/reports/2026-09/REPARATION-CIFIX1.md',
    ]);
  });

  it('extrait les 5 échecs nommés et les 5 leçons du pilote à travers les 3 fixtures', () => {
    // Écrire les 3 fixtures dans le dossier temporaire
    fs.writeFileSync(path.join(delegationsDir, 'launcher-cifix1.out'), fixture1Out, 'utf8');
    fs.writeFileSync(path.join(delegationsDir, '2026-09-04T070000-luna-MISSION-CIFIX1.log'), fixture1Log, 'utf8');
    fs.writeFileSync(path.join(delegationsDir, '2026-09-04T080000-mistral-MISSION-MODELLABEL1.log'), fixture2Log, 'utf8');
    fs.writeFileSync(path.join(delegationsDir, 'launcher-cost1-vibe.out'), fixture3Out, 'utf8');

    const facts = readDelegationLogs(delegationsDir);
    expect(facts.length).toBe(3);

    const engines = facts.map((f) => f.engine).sort();
    expect(engines).toEqual(['luna', 'mistral', 'vibe']);

    const allFailures = new Set(facts.flatMap((f) => f.namedFailures));
    for (const expectedFailure of NAMED_DELEGATION_FAILURES) {
      expect(allFailures.has(expectedFailure)).toBe(true);
    }
    expect(allFailures.size).toBe(5);

    const allLessons = new Set(facts.flatMap((f) => f.pilotLessons));
    for (const expectedLesson of PILOT_LESSONS) {
      expect(allLessons.has(expectedLesson)).toBe(true);
    }
    expect(allLessons.size).toBe(5);
  });

  it('respecte l’opt-in strict : vide si désactivé, actif si configuré', async () => {
    fs.writeFileSync(path.join(delegationsDir, '2026-09-04T080000-mistral-MISSION-MODELLABEL1.log'), fixture2Log, 'utf8');

    // 1. Désactivé par défaut
    const disabledSource = new DelegationLogsExperienceSource({
      delegationsDir,
      env: {},
    });
    const none = await disabledSource.collect();
    expect(none).toEqual([]);

    // 2. Activé via option enabled
    const archive = new EvolutionaryArchive({ workDir: tmpDir });
    const enabledSource = new DelegationLogsExperienceSource({
      delegationsDir,
      enabled: true,
      archive,
    });
    const experiences = await enabledSource.collect();
    expect(experiences.length).toBe(1);
    expect(experiences[0].source).toBe('delegation-log');
    expect(experiences[0].detail).toContain('Délégation mistral');
    expect(experiences[0].context).toContain('trim is not a function');
    expect(experiences[0].context).toContain('lire le journal du boot précédent avant de relancer');

    // L'entrée dans l'archive possède provenance: 'delegation-log'
    const archiveEntries = archive.list();
    expect(archiveEntries.length).toBe(1);
    expect(archiveEntries[0].provenance).toBe('delegation-log');
    expect(archiveEntries[0].kind).toBe('delegation-log');
  });

  it('le digest résume les enregistrements avec provenance: delegation-log', () => {
    const since = new Date('2026-09-01T00:00:00.000Z');
    const until = new Date('2026-09-05T00:00:00.000Z');

    const digest = buildImprovementDigest(
      {
        archive: [
          {
            proposalId: 'delegation:2026-09-04-mistral',
            createdAt: '2026-09-04T08:00:00.000Z',
            kind: 'delegation-log',
            provenance: 'delegation-log',
            targetScenarioId: 'trim is not a function',
            reviewedBy: 'auto:mistral',
            delta: 0,
            scoreAfter: 0,
          },
          {
            proposalId: 'delegation:2026-09-04-vibe',
            createdAt: '2026-09-04T09:00:00.000Z',
            kind: 'delegation-log',
            provenance: 'delegation-log',
            targetScenarioId: 'peer closed connection',
            reviewedBy: 'auto:vibe',
            delta: 0,
            scoreAfter: 0,
          },
        ],
      },
      { since, until },
    );

    expect(digest.hasActivity).toBe(true);
    expect(digest.delegationLogs).toBeDefined();
    expect(digest.delegationLogs?.count).toBe(2);
    expect(digest.delegationLogs?.engines).toEqual(['mistral', 'vibe']);
    expect(digest.delegationLogs?.failures).toEqual([
      { failure: 'peer closed connection', count: 1 },
      { failure: 'trim is not a function', count: 1 },
    ]);

    const md = renderImprovementDigestMarkdown(digest);
    expect(md).toContain('Journaux de délégation : 2');
    expect(md).toContain('provenance : `delegation-log`');
    expect(md).toContain('`mistral`, `vibe`');
    expect(md).toContain('`peer closed connection` (1)');
    expect(md).toContain('`trim is not a function` (1)');

    const html = renderImprovementDigestHtml(digest);
    expect(html).toContain('Délégations');
    expect(html).toContain('provenance delegation-log');
  });
});
