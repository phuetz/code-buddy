/**
 * Audit 2026-09-02 — famille « ressources non bornées » :
 * le ledger sécurité companion (`safety-ledger.jsonl`) est appendé à chaque
 * snapshot caméra sur le robot 24/7 et n'avait AUCUNE rotation — croissance
 * illimitée, et `readSafetyEvents` reparse tout le fichier à chaque stats.
 * Attendu : au-delà de 1 Mio, le fichier est roté vers `.1` (même motif que
 * reminder-log / idle-log / rule-runs).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { recordCompanionSafetyEvent } from '../../src/companion/safety-ledger.js';

describe('safety-ledger — rotation', () => {
  it('rote le ledger au-delà de 1 Mio au lieu de croître sans borne', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safety-ledger-'));
    const ledgerPath = path.join(dir, 'ledger.jsonl');
    try {
      const bigLine = JSON.stringify({ pad: 'x'.repeat(1024) }) + '\n';
      fs.writeFileSync(ledgerPath, bigLine.repeat(1100)); // > 1 Mio

      await recordCompanionSafetyEvent(
        {
          kind: 'observation',
          action: 'test rotation',
          reason: 'audit',
          source: 'test',
        } as any,
        { cwd: dir, ledgerPath },
      );

      expect(fs.existsSync(`${ledgerPath}.1`)).toBe(true);
      const size = fs.statSync(ledgerPath).size;
      expect(size).toBeLessThan(1024 * 1024);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
