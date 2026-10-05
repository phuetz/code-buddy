import { describe, expect, it } from 'vitest';
import { StagnationDetector, isWriteCall } from '../../../src/agent/execution/stagnation-detector.js';

const view = (path: string, n: number) => ({ name: 'view_file', argumentsJson: JSON.stringify({ path, start_line: n }), success: true });

describe('StagnationDetector', () => {
  it('fires once after 30 write-less calls with a re-read file, whatever the ranges', () => {
    const d = new StagnationDetector();
    let fired = 0;
    for (let i = 0; i < 80; i++) {
      const r = d.observe(view(i % 2 ? 'a.ts' : 'b.ts', i));
      if (r) { fired++; expect(r.callsWithoutWrite).toBe(30); expect(r.reads).toBeGreaterThanOrEqual(3); }
    }
    expect(fired).toBe(1);
  });

  it('60 calls on 60 distinct files still fires (exploration without end)', () => {
    const d = new StagnationDetector();
    const hits = Array.from({ length: 70 }, (_, i) => d.observe(view(`f${i}.ts`, 0))).filter(Boolean);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.callsWithoutWrite).toBe(60);
  });

  it('a successful write resets; a refused write does not', () => {
    const d = new StagnationDetector();
    for (let i = 0; i < 25; i++) d.observe(view('a.ts', i));
    d.observe({ name: 'create_file', argumentsJson: '{"path":"o.md"}', success: true });
    for (let i = 0; i < 25; i++) expect(d.observe(view('a.ts', i))).toBeNull();
    const d2 = new StagnationDetector();
    for (let i = 0; i < 29; i++) d2.observe(view('a.ts', i));
    expect(d2.observe({ name: 'str_replace_editor', argumentsJson: '{"path":"/x/trusted-folders.json"}', success: false })).not.toBeNull();
  });

  it('classifies shell writes and reads', () => {
    expect(isWriteCall('bash', JSON.stringify({ command: 'cat a.ts > out.md' }))).toBe(true);
    expect(isWriteCall('bash', JSON.stringify({ command: 'git commit -m x' }))).toBe(true);
    expect(isWriteCall('bash', JSON.stringify({ command: 'sed -n 1,20p a.ts 2>&1 | head' }))).toBe(false);
    expect(isWriteCall('execute_code', JSON.stringify({ code: 'ls 2>/dev/null' }))).toBe(false);
    expect(isWriteCall('view_file', '{"path":"a"}')).toBe(false);
  });

  it('counts file names inside shell commands as reads (the real run used sed -n ranges)', () => {
    const d = new StagnationDetector();
    let r = null;
    for (let i = 0; i < 40 && !r; i++) {
      r = d.observe({ name: 'execute_code', argumentsJson: JSON.stringify({ code: `sed -n '${i},${i + 40}p' src/config/model-price-data.ts` }), success: true });
    }
    expect(r?.mostReadTarget).toBe('src/config/model-price-data.ts');
  });
});

describe('messages rendus au modèle (revue Grok, reprise 1)', () => {
  it('le refus d espace de travail ne nomme aucun réglage de confiance', async () => {
    const { WorkspaceIsolation } = await import('../../../src/workspace/workspace-isolation.js');
    const iso = new WorkspaceIsolation({ workspaceRoot: process.cwd() });
    const r = iso.validatePath('/home/someone/outside.md', 'write file', 'write');
    expect(r.valid).toBe(false);
    expect(r.error ?? '').not.toMatch(/trusted-folders|"folders"|\.codebuddy\/|--trust|add it to/i);
  });
});

describe('classification des écritures shell (revue Grok : faux « écriture »)', () => {
  it('une comparaison, le mot install ou patch dans du code lu ne comptent pas comme écriture', () => {
    expect(isWriteCall('execute_code', JSON.stringify({ code: 'if (count > 3) { console.log("install patch cp") }' }))).toBe(false);
    expect(isWriteCall('bash', JSON.stringify({ command: 'grep -n "npm install" README.md' }))).toBe(false);
    expect(isWriteCall('bash', JSON.stringify({ command: 'cp a.md b.md' }))).toBe(true);
    expect(isWriteCall('bash', JSON.stringify({ command: 'echo x | tee out.md' }))).toBe(true);
    expect(isWriteCall('bash', JSON.stringify({ command: 'echo x >> out.md' }))).toBe(true);
  });
});
