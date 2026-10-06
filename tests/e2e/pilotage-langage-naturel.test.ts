import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserOperatorExecutor } from '../../src/browser-automation/browser-operator-executor.js';
import type { BrowserOperatorSessionDraft } from '../../src/browser-automation/browser-operator-session.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';

const fixtureDir = fileURLToPath(new URL('../fixtures/', import.meta.url));
const workspace = path.resolve(fixtureDir, '../..');
const email = 'preuve@example.test';
const phrases = [`remplis le champ E-mail avec ${email}`, 'clique sur Valider'] as const;
let chromiumAvailable = false;
try {
  const { chromium } = await import('playwright-core');
  chromiumAvailable = existsSync(chromium.executablePath());
} catch {
  // Playwright itself is optional for this test; skipIf reports the missing prerequisite.
}

function inputsForPhrase(phrase: string): Record<string, unknown> {
  const fill = /^remplis le champ .+ avec (.+)$/iu.exec(phrase);
  return fill ? { instruction: phrase, value: fill[1] } : { instruction: phrase };
}

function entry(id: string, sequence: number, action: string, title: string, inputs: Record<string, unknown>) {
  return {
    id, sequence, status: 'planned' as const, tool: 'browser_operator', action,
    stage: 'interact' as const, title, evidence: '', requiresConsent: false,
    expectedArtifact: '', reason: 'Démonstration locale', inputs,
  };
}

function session(url: string, variant: string): BrowserOperatorSessionDraft {
  return {
    schemaVersion: 1,
    sessionId: `preuve-pilotage-${variant}`,
    generatedAt: new Date().toISOString(),
    goal: 'Valider le formulaire de démonstration',
    query: url,
    mode: 'isolated',
    intent: 'research',
    dedicatedTab: { label: 'Démonstration', reason: 'Navigateur isolé' },
    consent: { required: true, granted: true, scopes: ['browser_interaction'], reason: 'Test local' },
    stopControl: { enabled: true, label: 'Arrêter', stopConditions: [] },
    actionLog: [
      entry('ouvrir', 1, 'navigate', 'Ouvrir le formulaire', { url }),
      entry('saisir', 2, 'act', phrases[0], inputsForPhrase(phrases[0])),
      entry('valider', 3, 'act', phrases[1], inputsForPhrase(phrases[1])),
      entry('verifier', 4, 'assert_text', 'Vérifier le résultat', { expectedText: `Inscription validée : ${email}` }),
    ],
    proofExport: { artifactName: `preuve-pilotage-${variant}.browser-operator.json`, includes: ['action log'] },
  };
}

describe.skipIf(!chromiumAvailable)('pilotage par phrases dans Chromium réel (aucun mock navigateur)', () => {
  let server: Server;
  let origin: string;

  beforeEach(async () => {
    server = createServer(async (request, response) => {
      const variant = request.url === '/variante' ? 'pilotage-formulaire-variante.html' : 'pilotage-formulaire.html';
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(await readFile(path.join(fixtureDir, variant)));
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Port HTTP indisponible');
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    vi.restoreAllMocks();
  });

  for (const variant of ['originale', 'variante'] as const) {
    it(`résout les mêmes phrases sur la page ${variant}`, async () => {
      vi.spyOn(ConfirmationService.getInstance(), 'requestConfirmation').mockResolvedValue({ confirmed: true });
      const draft = session(`${origin}/${variant}`, variant);
      const result = await new BrowserOperatorExecutor(draft, {
        urlGuard: async url => ({ safe: url.startsWith(origin) }),
      }).execute(workspace);
      expect(result.success, JSON.stringify(result.actionLog.map(action => [action.action, action.status, action.evidence]))).toBe(true);
      expect(result.actionLog.map(action => action.status)).toEqual(['completed', 'completed', 'completed', 'completed']);
      expect(result.actionLog[2]?.evidence).toContain('locally bound semantic click');
    }, 90_000);
  }
});

// Skip condition: Playwright or its Chromium executable is absent; install it with
// `npx playwright install chromium` before running this real-browser demonstration.
