/**
 * Corruptions silencieuses des outils d'édition (banc adverse 2026-10-04).
 * Chaque cas minimal reproduit un défaut constaté sur main 70bcab0 :
 *  1 chaîne vide, 2 stratégie unicode, 3 binaire, 4 CRLF apply_patch,
 *  5 hunks partiels, 6 hunk introuvable, 7 Add File écrase.
 * Plus les cas proches : CRLF (str_replace/multi_edit), BOM, fichier vide,
 * replace_all d'un caractère. Aucune dépendance simulée : vrai disque.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TextEditorTool } from '../../src/tools/text-editor.js';
import { MultiEditTool } from '../../src/tools/multi-edit.js';
import { ApplyPatchTool } from '../../src/tools/apply-patch.js';
import { multiStrategyMatch } from '../../src/utils/multi-strategy-match.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';

let dir: string;
let editor: TextEditorTool;
let multi: MultiEditTool;
let patch: ApplyPatchTool;

const file = (name: string) => path.join(dir, name);
const write = (name: string, data: string | Buffer) => fs.writeFileSync(file(name), data);
const read = (name: string) => fs.readFileSync(file(name));
const readText = (name: string) => fs.readFileSync(file(name), 'utf-8');
const mkPatch = (...body: string[]) => ['*** Begin Patch', ...body, '*** End Patch'].join('\n');

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'edition-corruptions-')));
  ConfirmationService.getInstance().setSessionFlag('fileOperations', true);
  delete process.env.CODEBUDDY_DIFF_REVIEW;
  delete process.env.CODEBUDDY_SHADOW_WORKSPACE;
  editor = new TextEditorTool();
  editor.setBaseDirectory(dir);
  multi = new MultiEditTool();
  multi.setBaseDirectory(dir);
  patch = new ApplyPatchTool();
});

afterEach(() => {
  editor.dispose();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('défaut 1 — chaîne vide', () => {
  it('str_replace refuse old_str vide et ne touche pas au fichier', async () => {
    write('a.txt', 'KEEP\n');
    const r = await editor.strReplace(file('a.txt'), '', 'X');
    expect(r.success).toBe(false);
    expect(readText('a.txt')).toBe('KEEP\n');
  });

  it('str_replace replace_all refuse old_str vide', async () => {
    write('a.txt', 'AB\n');
    const r = await editor.strReplace(file('a.txt'), '', 'X', true);
    expect(r.success).toBe(false);
    expect(readText('a.txt')).toBe('AB\n');
  });

  it('multi_edit refuse old_string vide, rien n\'est appliqué', async () => {
    write('a.txt', 'KEEP\nAB\n');
    const r = await multi.execute(file('a.txt'), [
      { old_string: 'AB', new_string: 'ZZ' },
      { old_string: '', new_string: 'X' },
    ]);
    expect(r.success).toBe(false);
    expect(readText('a.txt')).toBe('KEEP\nAB\n');
  });
});

describe('défaut 2 — stratégie unicode', () => {
  it('l\'index normalisé n\'est pas appliqué à la chaîne originale (flèche en amont)', async () => {
    write('u.txt', '→ say "hello" END\n');
    const r = await editor.strReplace(file('u.txt'), '“hello” END', 'Z');
    expect(r.success).toBe(true);
    expect(readText('u.txt')).toBe('→ say Z\n');
  });

  it('idem avec une ellipse en amont et des guillemets typographiques dans le fichier', async () => {
    write('u.txt', 'x … say “hello” END\n');
    const r = await editor.strReplace(file('u.txt'), '"hello" END', 'Z');
    expect(r.success).toBe(true);
    expect(readText('u.txt')).toBe('x … say Z\n');
  });

  it('le champ stratégie dit « unicode », pas « flexible »', () => {
    const m = multiStrategyMatch('→ say "hello" END\n', '“hello” END');
    expect(m?.strategy).toBe('unicode');
    expect(m?.matched).toBe('"hello" END');
  });

  it('refuse plutôt que de couper au milieu d\'une expansion', () => {
    // \u2026 devient trois points : un motif de deux points ne doit pas matcher la moitié de l'expansion
    const m = multiStrategyMatch('"\u2026\n', '\u201C..');
    expect(m).toBeNull();
  });
});

const BIN = Buffer.from([0x00, 0xff, 0xfe, 0x54, 0x4f, 0x4b, 0x00, 0x80, 0xff]);

describe('défaut 3 — binaire / non UTF-8', () => {
  it('str_replace refuse et laisse les octets intacts', async () => {
    write('b.bin', BIN);
    const r = await editor.strReplace(file('b.bin'), 'TOK', 'XXX');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/binaire|UTF-8/i);
    expect(read('b.bin').equals(BIN)).toBe(true);
  });

  it('multi_edit refuse et laisse les octets intacts', async () => {
    write('b.bin', BIN);
    const r = await multi.execute(file('b.bin'), [{ old_string: 'TOK', new_string: 'XXX' }]);
    expect(r.success).toBe(false);
    expect(read('b.bin').equals(BIN)).toBe(true);
  });

  it('apply_patch refuse et laisse les octets intacts', async () => {
    write('b.bin', BIN);
    const r = await patch.execute({
      patch: mkPatch('*** Update File: b.bin', '@@', '-TOK', '+XXX'),
    }, dir);
    expect(r.success).toBe(false);
    expect(read('b.bin').equals(BIN)).toBe(true);
  });

  it('apply_patch : un hunk qui MATCHE une ligne propre d\'un binaire est refusé aussi', async () => {
    const mixed = Buffer.concat([Buffer.from('TOK\n'), Buffer.from([0xff, 0xfe, 0x80]), Buffer.from('\nend\n')]);
    write('m.bin', mixed);
    const r = await patch.execute({ patch: mkPatch('*** Update File: m.bin', '@@', '-TOK', '+XXX') }, dir);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/binaire|UTF-8/i);
    expect(read('m.bin').equals(mixed)).toBe(true);
  });

  it('latin-1 (octet 0xE9 isolé) est refusé aussi', async () => {
    const latin = Buffer.from('caf\xe9 ok\n', 'latin1');
    write('l.txt', latin);
    const r = await editor.strReplace(file('l.txt'), 'ok', 'KO');
    expect(r.success).toBe(false);
    expect(read('l.txt').equals(latin)).toBe(true);
  });

  it('un UTF-8 valide avec accents reste éditable', async () => {
    write('ok.txt', 'café ok\n');
    const r = await editor.strReplace(file('ok.txt'), 'ok', 'KO');
    expect(r.success).toBe(true);
    expect(readText('ok.txt')).toBe('café KO\n');
  });
});

describe('défaut 4 — fin de ligne CRLF dans apply_patch', () => {
  it('conserve CRLF sur la ligne éditée', async () => {
    write('c.txt', 'keep\r\nold\r\nend\r\n');
    const r = await patch.execute({
      patch: mkPatch('*** Update File: c.txt', '@@', ' keep', '-old', '+NEW', ' end'),
    }, dir);
    expect(r.success).toBe(true);
    expect(readText('c.txt')).toBe('keep\r\nNEW\r\nend\r\n');
  });

  it('une insertion de plusieurs lignes prend le style du fichier', async () => {
    write('c.txt', 'keep\r\nold\r\nend\r\n');
    const r = await patch.execute({
      patch: mkPatch('*** Update File: c.txt', '@@', ' keep', '-old', '+A', '+B', ' end'),
    }, dir);
    expect(r.success).toBe(true);
    expect(readText('c.txt')).toBe('keep\r\nA\r\nB\r\nend\r\n');
  });

  it('un fichier LF reste LF', async () => {
    write('c.txt', 'keep\nold\nend\n');
    await patch.execute({ patch: mkPatch('*** Update File: c.txt', '@@', ' keep', '-old', '+NEW', ' end') }, dir);
    expect(readText('c.txt')).toBe('keep\nNEW\nend\n');
  });

  it('un fichier sans fin de ligne finale ne gagne pas de \\r parasite', async () => {
    write('c.txt', 'keep\r\nold');
    await patch.execute({ patch: mkPatch('*** Update File: c.txt', '@@', ' keep', '-old', '+NEW') }, dir);
    expect(readText('c.txt')).toBe('keep\r\nNEW');
  });

  it('le BOM UTF-8 est conservé et la première ligne reste adressable', async () => {
    write('bom.txt', '﻿first\r\nsecond\r\n');
    const r = await patch.execute({ patch: mkPatch('*** Update File: bom.txt', '@@', '-first', '+FIRST') }, dir);
    expect(r.success).toBe(true);
    expect(readText('bom.txt')).toBe('﻿FIRST\r\nsecond\r\n');
  });
});

describe('défauts 5 et 6 — apply_patch tout ou rien', () => {
  it('deux hunks dont le second rate : échec explicite, aucune écriture', async () => {
    write('p.txt', 'one\ntwo\nthree\n');
    const r = await patch.execute({
      patch: mkPatch('*** Update File: p.txt', '@@', '-one', '+ONE', '@@', '-absent', '+X'),
    }, dir);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/absent/);
    expect(readText('p.txt')).toBe('one\ntwo\nthree\n');
  });

  it('un seul hunk introuvable : échec explicite, fichier intact (octets et mtime)', async () => {
    write('p.txt', 'one\ntwo\n');
    const before = fs.statSync(file('p.txt')).mtimeMs;
    const r = await patch.execute({
      patch: mkPatch('*** Update File: p.txt', '@@', '-nope', '+X'),
    }, dir);
    expect(r.success).toBe(false);
    expect(readText('p.txt')).toBe('one\ntwo\n');
    expect(fs.statSync(file('p.txt')).mtimeMs).toBe(before);
  });

  it('un fichier raté annule aussi les autres fichiers du patch', async () => {
    write('a.txt', 'a\n');
    write('b.txt', 'b\n');
    const r = await patch.execute({
      patch: mkPatch(
        '*** Update File: a.txt', '@@', '-a', '+A',
        '*** Update File: b.txt', '@@', '-zzz', '+B',
        '*** Add File: new.txt', '+hello',
      ),
    }, dir);
    expect(r.success).toBe(false);
    expect(readText('a.txt')).toBe('a\n');
    expect(fs.existsSync(file('new.txt'))).toBe(false);
  });

  it('un fichier cible absent est une erreur, pas un succès', async () => {
    const r = await patch.execute({ patch: mkPatch('*** Update File: ghost.txt', '@@', '-a', '+b') }, dir);
    expect(r.success).toBe(false);
  });

  it('un patch valide reste appliqué (Add puis Update du même fichier)', async () => {
    const r = await patch.execute({
      patch: mkPatch('*** Add File: n.txt', '+x', '+y', '*** Update File: n.txt', '@@', '-x', '+X'),
    }, dir);
    expect(r.success).toBe(true);
    expect(readText('n.txt')).toBe('X\ny');
  });
});

describe('défaut 7 — Add File ne doit pas écraser', () => {
  it('refuse un fichier existant et le laisse intact', async () => {
    write('e.txt', 'precious\n');
    const r = await patch.execute({ patch: mkPatch('*** Add File: e.txt', '+overwritten') }, dir);
    expect(r.success).toBe(false);
    expect(readText('e.txt')).toBe('precious\n');
  });

  it('Delete puis Add du même chemin dans un patch reste permis', async () => {
    write('e.txt', 'old\n');
    const r = await patch.execute({
      patch: mkPatch('*** Delete File: e.txt', '*** Add File: e.txt', '+new'),
    }, dir);
    expect(r.success).toBe(true);
    expect(readText('e.txt')).toBe('new');
  });
});

describe('cas proches', () => {
  it('str_replace : old LF multi-ligne sur fichier CRLF garde CRLF partout', async () => {
    write('c.txt', 'keep\r\nold1\r\nold2\r\nend\r\n');
    const r = await editor.strReplace(file('c.txt'), 'old1\nold2', 'NEW1\nNEW2\nNEW3');
    expect(r.success).toBe(true);
    expect(readText('c.txt')).toBe('keep\r\nNEW1\r\nNEW2\r\nNEW3\r\nend\r\n');
  });

  it('str_replace : ligne unique (stratégie flexible) ne perd pas son \\r', async () => {
    write('c.txt', 'keep\r\n\tfoo(1)\r\nend\r\n');
    const r = await editor.strReplace(file('c.txt'), '    foo(1)', 'bar(2)');
    expect(r.success).toBe(true);
    expect(readText('c.txt')).toBe('keep\r\nbar(2)\r\nend\r\n');
  });

  it('str_replace : new_str multi-ligne dans un fichier CRLF prend CRLF', async () => {
    write('c.txt', 'keep\r\nold\r\nend\r\n');
    const r = await editor.strReplace(file('c.txt'), 'old', 'A\nB');
    expect(r.success).toBe(true);
    expect(readText('c.txt')).toBe('keep\r\nA\r\nB\r\nend\r\n');
  });

  it('multi_edit : new_str multi-ligne dans un fichier CRLF prend CRLF', async () => {
    write('c.txt', 'keep\r\nold\r\nend\r\n');
    const r = await multi.execute(file('c.txt'), [{ old_string: 'old', new_string: 'A\nB' }]);
    expect(r.success).toBe(true);
    expect(readText('c.txt')).toBe('keep\r\nA\r\nB\r\nend\r\n');
  });

  it('multi_edit : un fichier LF reste LF', async () => {
    write('c.txt', 'keep\nold\nend\n');
    await multi.execute(file('c.txt'), [{ old_string: 'old', new_string: 'A\nB' }]);
    expect(readText('c.txt')).toBe('keep\nA\nB\nend\n');
  });

  it('BOM UTF-8 conservé par str_replace et multi_edit', async () => {
    write('bom.txt', '﻿hello world\n');
    expect((await editor.strReplace(file('bom.txt'), 'hello', 'HELLO')).success).toBe(true);
    expect(readText('bom.txt')).toBe('﻿HELLO world\n');
    expect((await multi.execute(file('bom.txt'), [{ old_string: 'world', new_string: 'W' }])).success).toBe(true);
    expect(readText('bom.txt')).toBe('﻿HELLO W\n');
  });

  it('fichier vide : str_replace et multi_edit échouent proprement, rien n\'est écrit', async () => {
    write('empty.txt', '');
    expect((await editor.strReplace(file('empty.txt'), 'x', 'y')).success).toBe(false);
    expect((await multi.execute(file('empty.txt'), [{ old_string: 'x', new_string: 'y' }])).success).toBe(false);
    expect(readText('empty.txt')).toBe('');
  });

  it('replace_all sur un caractère remplace exactement chaque occurrence', async () => {
    write('r.txt', 'a-b-c-\n');
    const r = await editor.strReplace(file('r.txt'), '-', '+', true);
    expect(r.success).toBe(true);
    expect(readText('r.txt')).toBe('a+b+c+\n');
  });

  it('replace_all avec des $ dans new_str reste littéral', async () => {
    write('r.txt', 'a-b\n');
    await editor.strReplace(file('r.txt'), '-', '$&$$', true);
    expect(readText('r.txt')).toBe('a$&$$b\n');
  });

  it('un binaire ne passe pas non plus par replace_lines / insert', async () => {
    write('b.bin', BIN);
    expect((await editor.replaceLines(file('b.bin'), 1, 1, 'x')).success).toBe(false);
    expect((await editor.insert(file('b.bin'), 1, 'x')).success).toBe(false);
    expect(read('b.bin').equals(BIN)).toBe(true);
  });
});

describe('reprise 1 — le remplacement est épissé à la fenêtre trouvée, pas à la première copie', () => {
  const trapLf = 'export const value = 1;\n  return value;\nconst value = 1;\n  return value;\n';

  it('flexible LF : la vraie fenêtre (2e bloc) est réécrite, le 1er reste intact', async () => {
    write('t.ts', trapLf);
    const r = await editor.strReplace(file('t.ts'), 'const value = 1;\nreturn value;', 'let value = 2;\nreturn value;');
    expect(r.success).toBe(true);
    expect(readText('t.ts')).toBe('export const value = 1;\n  return value;\nlet value = 2;\nreturn value;\n');
  });

  it('flexible CRLF : idem, fins de ligne conservées', async () => {
    write('t.ts', trapLf.replace(/\n/g, '\r\n'));
    const r = await editor.strReplace(file('t.ts'), 'const value = 1;\nreturn value;', 'let value = 2;\nreturn value;');
    expect(r.success).toBe(true);
    expect(readText('t.ts')).toBe('export const value = 1;\r\n  return value;\r\nlet value = 2;\r\nreturn value;\r\n');
  });

  it('replace_all en stratégie non exacte : refus explicite, fichier intact', async () => {
    write('t.ts', trapLf);
    const r = await editor.strReplace(file('t.ts'), 'const value = 1;\nreturn value;', 'let value = 2;\nreturn value;', true);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/replace_all/);
    expect(readText('t.ts')).toBe(trapLf);
  });

  it('fuzzy : la 2e fonction (la fenêtre) est réécrite, pas le suffixe de la 1re', async () => {
    write('f.ts', 'xxxxfunction helloWorld()\nfunction helloWorld()\n');
    const r = await editor.strReplace(file('f.ts'), 'function helloWorlX()', 'function helloOK()');
    expect(r.success).toBe(true);
    expect(readText('f.ts')).toBe('xxxxfunction helloWorld()\nfunction helloOK()\n');
  });

  it('repli LCS : la ligne 2 (similarité 1) est réécrite, la ligne 1 non tronquée', async () => {
    const gap = ' '.repeat(30);
    const l1 = `xxxxfoo${gap}bar`;
    write('l.txt', `${l1}\nfoo${gap}bar\n`);
    const r = await editor.strReplace(file('l.txt'), 'foo bar', 'OK');
    expect(r.success).toBe(true);
    expect(readText('l.txt')).toBe(`${l1}\nOK\n`);
  });

  it('exact : plusieurs occurrences sans replace_all = refus explicite, fichier intact', async () => {
    write('e.txt', 'a b a b\n');
    const r = await editor.strReplace(file('e.txt'), 'a b', 'X');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/2 occurrences/);
    expect(readText('e.txt')).toBe('a b a b\n');
  });

  it('exact : replace_all reste permis, et une occurrence unique aussi', async () => {
    write('e.txt', 'a b a b\n');
    expect((await editor.strReplace(file('e.txt'), 'a b', 'X', true)).success).toBe(true);
    expect(readText('e.txt')).toBe('X X\n');
    expect((await editor.strReplace(file('e.txt'), 'X X', 'Y')).success).toBe(true);
    expect(readText('e.txt')).toBe('Y\n');
  });

  it('multi_edit : une édition ambiguë annule tout, y compris les précédentes', async () => {
    write('e.txt', 'one\na b\na b\n');
    const r = await multi.execute(file('e.txt'), [
      { old_string: 'one', new_string: 'ONE' },
      { old_string: 'a b', new_string: 'X' },
    ]);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Edit #2.*2 occurrences/);
    expect(readText('e.txt')).toBe('one\na b\na b\n');
  });
});
