/**
 * Audit 2026-09-02 — famille « perte silencieuse » :
 * si le ledger JSONL se termine par une ligne déchirée (crash pendant un
 * write d'un autre processus), l'append suivant se soudait à cette ligne :
 * les DEUX événements devenaient invalides — la nouvelle écriture était
 * perdue (warn seulement). Attendu : l'append détecte l'absence de '\n'
 * final et s'en isole, la nouvelle entrée survit.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CollectiveKnowledgeGraph } from '../../src/memory/collective-knowledge-graph.js';

describe('CKG — append après ligne déchirée', () => {
  it('ne soude pas la nouvelle entrée à une queue de ligne déchirée', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ckg-torn-'));
    const ledger = path.join(dir, 'ledger.jsonl');
    try {
      const a = new CollectiveKnowledgeGraph({ ledgerPath: ledger, agentId: 'A', persistentEmbeddingCache: false });
      await a.ingest({ type: 'fact', text: 'entree saine numero un', source: 'test' });
      // Crash simulé : queue de ligne déchirée sans '\n' final.
      fs.appendFileSync(ledger, '{"type":"fact","content":"dechire');

      const b = new CollectiveKnowledgeGraph({ ledgerPath: ledger, agentId: 'B', persistentEmbeddingCache: false });
      await b.ingest({ type: 'fact', text: 'entree posterieure cruciale', source: 'test' });

      const raw = fs.readFileSync(ledger, 'utf8');
      const parseable = raw.split('\n').filter(Boolean).filter((l) => {
        try { JSON.parse(l); return true; } catch { return false; }
      });
      const joined = parseable.map((l) => JSON.stringify(JSON.parse(l))).join('\n');
      expect(joined).toContain('entree posterieure cruciale');

      // Et l'entrée saine d'origine est intacte.
      expect(joined).toContain('entree saine numero un');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
