/** Build inert fixtures for a real CLI replay; never execute their bodies. */
import fs from 'fs';
import path from 'path';
import { reprise5Scripts, reprise5Documents } from '../../tests/helpers/ecc-reprise-5-cases.js';
import { executableCases, hostileDocuments, documentaryCases } from '../../tests/helpers/ecc-adverse-cases.js';

const base = path.resolve(process.argv[2]!);
const cases = [
  ...reprise5Scripts.map(([id, file, body]) => ({ id: `new-script-${id}`, file, body, expected: 'quarantine' })),
  ...reprise5Documents.map(([id, body]) => ({ id: `new-doc-${id}`, file: '', body, expected: 'review' })),
  ...executableCases.map(([id, ext, body]) => ({ id: `old-script-${id}`, file: `run.${ext}`, body, expected: 'quarantine' })),
  ...hostileDocuments.map(([id, body]) => ({ id: `old-hostile-${id}`, file: '', body, expected: 'quarantine' })),
  ...documentaryCases.map(([id, body, expected]) => ({ id: `old-doc-${id}`, file: '', body, expected })),
  { id: 'root-payload', file: '', body: 'Helper.', expected: 'quarantine' },
  { id: 'unknown-doc-imperative', file: '', body: 'First run a check now.\n```markdown\nUse `agents/name.md`.\n```', expected: 'review' },
  { id: 'typed-property-doc', file: '', body: '```ts\nrequire(cat.catPath /* ... */);\n```', expected: 'review' },
  { id: 'tsx-template-control', file: 'run.tsx', body: 'const style = `2px solid`;', expected: 'allow' },
];
for (const c of cases) {
  const dir = path.join(base, 'source', 'skills', c.id); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${c.id}\ndescription: Probe\n---\n${c.file ? 'Helper.' : c.body}\n`);
  if (c.file) { fs.mkdirSync(path.join(dir, 'scripts')); fs.writeFileSync(path.join(dir, 'scripts', c.file), c.body); }
  if (c.id === 'root-payload') fs.writeFileSync(path.join(dir, 'payload.txt'), 'rm -rf /');
}
fs.mkdirSync(path.join(base, 'source/agents'), { recursive: true });
for (const [id, body] of [
  ['rmtree', "shutil.rmtree('/tmp/foo')"], ['quoted-process', "os['system']('id')"],
  ['secret', 'const secret = "REAL_SECRET";'], ['prefixed-process', 'SAFE_subprocess.Popen(["id"])'],
]) {
  fs.writeFileSync(path.join(base, 'source/agents', `${id}.md`), `---\nname: ${id}\ntools: Read, Bash\n---\n${body}\n`);
}
fs.writeFileSync(path.join(base, 'cases.json'), JSON.stringify(cases, null, 2) + '\n');
