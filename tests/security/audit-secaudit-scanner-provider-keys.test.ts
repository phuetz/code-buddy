import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { scanFileForSecrets } from '../../src/security/secrets-detector.js';

/**
 * AUDIT SECAUDIT-FLOTTE (Opus, 2026-09-05) — Surface 4.
 * Le scanner de secrets doit détecter les clés des fournisseurs que Code Buddy
 * utilise le plus : OpenAI (sk-proj-/sk-), Anthropic (sk-ant-), xAI (xai-).
 * Sans elles, `scan_secrets` donne une fausse assurance sur une fuite réelle.
 */
describe('SECAUDIT surface 4 — scanner détecte les clés fournisseurs', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secaudit-scan-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  function scan(body: string) {
    const p = path.join(dir, 'config.ts');
    fs.writeFileSync(p, body);
    return scanFileForSecrets(p);
  }

  it('détecte une clé Anthropic sk-ant-', () => {
    const f = scan('const c = { key: "sk-ant-api03-AbCdEf0123456789AbCdEf0123456789xyz" };\n');
    expect(f.length).toBeGreaterThan(0);
  });

  it('détecte une clé OpenAI sk-proj-', () => {
    const f = scan('const c = { key: "sk-proj-AbCdEf0123456789AbCdEf0123456789abcd" };\n');
    expect(f.length).toBeGreaterThan(0);
  });

  it('détecte une clé OpenAI legacy sk-', () => {
    const f = scan('const c = { key: "sk-AbCdEf0123456789AbCdEf0123456789" };\n');
    expect(f.length).toBeGreaterThan(0);
  });

  it('détecte une clé xAI xai-', () => {
    const f = scan('const c = { key: "xai-AbCdEf0123456789AbCdEf0123456789abcdEFGH" };\n');
    expect(f.length).toBeGreaterThan(0);
  });

  it('ne signale PAS un mot ordinaire "risk-management"', () => {
    const f = scan('const label = "risk-management-plan-for-the-quarter-review";\n');
    expect(f.length).toBe(0);
  });
});
