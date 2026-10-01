import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect } from 'vitest';
// The QA helper is deliberately independent of the production tools.
// @ts-expect-error Standalone Node QA script has no generated declaration file.
import { evaluateEvidence, fileDigest, assistantReplyMatches } from '../../scripts/qa/evidence-oracles.mjs';

const ocrOracle = {
  rules: [
    { field: 'data.ocr.attempted', op: 'eq', value: true },
    { field: 'data.ocr.ok', op: 'eq', value: true },
    { field: 'data.ocr.text', op: 'eq', value: 'P9 TEXT 42', normalize: true },
  ],
};

describe('oracles des preuves réelles', () => {
  it('refuse le texte utilisateur et exige une réponse assistant exacte', () => {
    expect(assistantReplyMatches([{ role: 'user', content: 'P9_CHAT_OK' }], 'P9_CHAT_OK')).toBe(false);
    expect(assistantReplyMatches([{ role: 'assistant', content: 'other answer' }], 'P9_CHAT_OK')).toBe(false);
    expect(assistantReplyMatches([{ role: 'assistant', content: [{ type: 'text', text: 'P9_CHAT_OK\n[tokens: 42 in / 3 out | cost: $0.0000]' }] }], 'P9_CHAT_OK')).toBe(true);
  });

  it('refuse la capture P9 : largeur correcte, texte OCR incorrect', () => {
    const capture = { success: true, data: { metadata: { width: 700 }, ocr: { attempted: true, ok: true, text: 'PO TEXT 42' } } };
    expect(evaluateEvidence(capture, ocrOracle).passed).toBe(false);
  });

  it('tolère seulement les espaces et fins de ligne explicitement documentés', () => {
    const capture = { success: true, data: { ocr: { attempted: true, ok: true, text: 'P9  TEXT 42\r\n' } } };
    expect(evaluateEvidence(capture, ocrOracle).passed).toBe(true);
  });

  it.each([
    { success: true, output: '700', data: { metadata: { width: 700 } } },
    { success: true, output: 'P9 TEXT 42', data: {} },
    { success: false, data: { ocr: { attempted: true, ok: true, text: 'P9 TEXT 42' } } },
  ])('refuse métadonnées, écho ou échec : %j', capture => {
    expect(evaluateEvidence(capture, ocrOracle).passed).toBe(false);
  });

  it('ne valide pas un rendu de diagramme grâce au code Mermaid recopié dans data', () => {
    const capture = { success: true, output: 'No nodes found in flowchart', data: { mermaidCode: 'graph TD; A[P9_START]-->B[P9_END]' } };
    expect(evaluateEvidence(capture, { rules: [{ field: 'output', op: 'includes', values: ['P9_START', 'P9_END'] }] }).passed).toBe(false);
  });

  it('rejette un fichier préexistant sans écriture, puis constate la nouvelle écriture', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'evidence-oracle-'));
    try {
      const file = path.join(root, 'result.txt');
      writeFileSync(file, 'P9_AFTER');
      const beforeFiles = { 'result.txt': fileDigest(file) };
      const oracle = { rules: [{ file: 'result.txt', changed: true, op: 'eq', value: 'P9_AFTER' }] };
      expect(evaluateEvidence({ success: true }, oracle, { root, beforeFiles }).passed).toBe(false);
      writeFileSync(file, 'P9_AFTER\n');
      expect(evaluateEvidence({ success: true }, { rules: [{ ...oracle.rules[0], normalize: true }] }, { root, beforeFiles }).passed).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('refuse les résultats vides et les diagnostics qui ne désignent pas le défaut connu', () => {
    const oracle = { success: false, rules: [{ field: 'data.files', op: 'some', value: { filePath: 'bad.js', errors: 1 } }] };
    expect(evaluateEvidence({ success: false, data: { files: [] } }, oracle).passed).toBe(false);
    expect(evaluateEvidence({ success: false, data: { files: [{ filePath: 'bad.js', errors: 1 }] } }, oracle).passed).toBe(true);
  });

  it('refuse un oracle sans clause plutôt que compter success=true comme preuve', () => {
    expect(evaluateEvidence({ success: true }, {}).passed).toBe(false);
  });

  it('rejette le simple écho de la requête pour chacun des 131 scénarios d’outils', () => {
    const scenarios = JSON.parse(readFileSync(new URL('../../scripts/qa/p9-tool-scenarios.json', import.meta.url), 'utf8')) as Array<{
      name: string;
      input: Record<string, unknown>;
      oracle: unknown;
    }>;
    const root = mkdtempSync(path.join(os.tmpdir(), 'evidence-echo-'));
    try {
      expect(scenarios).toHaveLength(131);
      for (const scenario of scenarios) {
        const echo = { success: true, output: JSON.stringify(scenario.input), data: scenario.input };
        expect(evaluateEvidence(echo, scenario.oracle, { root }).passed, scenario.name).toBe(false);
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
