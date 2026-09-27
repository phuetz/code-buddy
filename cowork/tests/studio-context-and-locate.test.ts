/**
 * Contexte joint aux demandes d'App Studio (processus principal, vrai disque) :
 * candidats (jamais de .env, ni node_modules), lecture confinée, et
 * localisation d'un élément cliqué dans l'aperçu → fichier et lignes.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { elementExtent, isEnvFile, StudioContextService } from '../src/main/studio/studio-context-service';

const APP = `import { useState } from 'react';

export function TodoForm({ onAdd }: { onAdd: (t: string) => void }) {
  const [text, setText] = useState('');
  return (
    <form className="todo-form">
      <input value={text} onChange={(e) => setText(e.target.value)} />
      <button
        type="submit"
        className="btn btn-primary"
      >
        Ajouter
      </button>
    </form>
  );
}
`;

describe('StudioContextService', () => {
  let base: string;
  let root: string;
  let service: StudioContextService;

  beforeEach(() => {
    base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'studio-ctx-')));
    root = path.join(base, 'app');
    mkdirSync(path.join(root, 'src', 'components'), { recursive: true });
    mkdirSync(path.join(root, 'node_modules', 'react'), { recursive: true });
    writeFileSync(path.join(root, 'src', 'components', 'TodoForm.tsx'), APP);
    writeFileSync(path.join(root, 'src', 'App.tsx'), 'export default function App() { return <h1 className="titre">Mes tâches</h1>; }\n');
    writeFileSync(path.join(root, 'package.json'), '{"name":"app"}\n');
    writeFileSync(path.join(root, '.env.local'), 'VITE_KEY=secret-value-xyz\n');
    writeFileSync(path.join(root, 'src', '.env'), 'X=1\n');
    writeFileSync(path.join(root, 'node_modules', 'react', 'index.js'), 'module.exports = {};\n');
    writeFileSync(path.join(root, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    service = new StudioContextService({ trustedRoots: () => [base] });
  });

  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it('propose les fichiers texte avec une estimation en jetons, jamais un .env ni node_modules', async () => {
    const res = await service.candidates(root);
    expect(res.ok).toBe(true);
    const paths = res.ok ? res.data.map((c) => c.path) : [];
    expect(paths).toEqual(['package.json', 'src/App.tsx', 'src/components/TodoForm.tsx']);
    const todo = res.ok ? res.data.find((c) => c.path.endsWith('TodoForm.tsx')) : undefined;
    expect(todo?.tokens).toBe(Math.ceil(Buffer.byteLength(APP) / 4));
    expect(isEnvFile('a/b/.env.production')).toBe(true);
    expect(isEnvFile('src/environment.ts')).toBe(false);
  });

  it('lit les fichiers choisis mais refuse .env, traversée et lien symbolique', async () => {
    const outside = path.join(base, 'dehors.txt');
    writeFileSync(outside, 'hors projet');
    symlinkSync(outside, path.join(root, 'lien.txt'));
    const res = await service.read(root, ['src/App.tsx', '.env.local', 'src/.env', '../dehors.txt', '/etc/hostname', 'lien.txt']);
    expect(res.ok && res.data.map((f) => f.path)).toEqual(['src/App.tsx']);
    expect(JSON.stringify(res)).not.toContain('secret-value-xyz');
    expect((await service.read(path.join(os.tmpdir()), ['x'])).ok).toBe(false);
  });

  it("localise l'élément par la source React exacte (_debugSource) et borne son étendue", async () => {
    const res = await service.locate(root, {
      tag: 'button',
      text: 'Ajouter',
      classes: ['btn', 'btn-primary'],
      component: 'TodoForm',
      source: { fileName: path.join(root, 'src', 'components', 'TodoForm.tsx'), lineNumber: 8, columnNumber: 7 },
    });
    expect(res.ok && res.data).toMatchObject({ file: 'src/components/TodoForm.tsx', startLine: 8, endLine: 13, method: 'source' });
    expect(res.ok && res.data?.excerpt.split('\n')[0]).toBe('8|       <button');
  });

  it('retombe sur le texte visible, puis sur les classes, et ignore une source hors projet', async () => {
    const byText = await service.locate(root, {
      tag: 'button',
      text: 'Ajouter',
      source: { fileName: '/etc/passwd', lineNumber: 1 },
    });
    expect(byText.ok && byText.data).toMatchObject({ file: 'src/components/TodoForm.tsx', startLine: 8, endLine: 13, method: 'texte' });
    const byClass = await service.locate(root, { tag: 'h1', classes: ['titre'] });
    expect(byClass.ok && byClass.data).toMatchObject({ file: 'src/App.tsx', startLine: 1, method: 'classe' });
    const none = await service.locate(root, { tag: 'div', text: 'introuvable nulle part' });
    expect(none).toEqual({ ok: true, data: null });
  });

  it("sans source React (build de production) : le texte d'un ATTRIBUT ne trompe pas la localisation", async () => {
    // Cas constaté dans la vraie fenêtre Electron : « Ajouter » figure d'abord dans un placeholder.
    const form = [
      'export const TodoForm = () => (',
      '  <form className="todo-form">',
      '    <input',
      '      type="text"',
      '      placeholder="Ajouter une nouvelle tâche..."',
      '    />',
      '    <button type="submit">',
      '      Ajouter',
      '    </button>',
      '  </form>',
      ');',
      '',
    ].join('\n');
    writeFileSync(path.join(root, 'src', 'components', 'TodoForm.tsx'), form);
    const res = await service.locate(root, {
      tag: 'button',
      text: 'Ajouter',
      html: '<button type="submit">Ajouter</button>',
      component: 'TodoForm',
    });
    expect(res.ok && res.data).toMatchObject({ file: 'src/components/TodoForm.tsx', startLine: 7, endLine: 9, method: 'texte' });
    const byAria = await service.locate(root, { tag: 'button', html: '<button aria-label="Valider la tâche" class="x">✓</button>' });
    expect(byAria.ok && byAria.data).toBeNull(); // attribut absent du code : pas de faux positif
  });

  it('elementExtent : balise sur plusieurs lignes, auto-fermante, imbriquée', () => {
    const lines = ['<div>', '  <div>x</div>', '</div>', '<input />', '<img', '  src="a" />'];
    expect(elementExtent(lines, 1, 'div')).toBe(3);
    expect(elementExtent(lines, 4, 'input')).toBe(4);
  });
});
