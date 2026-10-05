import fs from 'fs';
import path from 'path';
import { reprise6Scripts } from '../../tests/helpers/ecc-reprise-6-cases.js';
const root = path.resolve(process.argv[2]!);
const cases: Array<{id: string; expected: string}> = [];
function add(id: string, body: string, expected: string, file?: string) {
  const dir = path.join(root, 'source/skills', id); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${id}\ndescription: Probe\n---\n${file ? 'Helper.' : body}\n`);
  if (file) { fs.mkdirSync(path.join(dir, 'scripts')); fs.writeFileSync(path.join(dir, 'scripts', file), body); }
  cases.push({ id, expected });
}
for (const [id, file, body] of reprise6Scripts) add(id, body, 'quarantine', file);
for (const [id, body] of [['doc-absolute', '/bin/bash ../payload.txt'], ['doc-wide', 'ｂａｓｈ ../payload.txt'], ['doc-spawn', 'spawn("rm", ["-rf", "/"])'], ['doc-template', 'const secret = `REAL_SECRET`;']]) add(id!, body!, 'review');
for (const [id, body] of [['control-template', 'const style = `2px solid`;'], ['control-secret', 'secret'], ['control-braces', '${bash ../payload.txt}']]) add(id!, body!, 'allow', 'run.js');
const agents = path.join(root, 'source/agents'); fs.mkdirSync(agents, { recursive: true });
for (const [i, body] of ['/bin/bash ../payload.txt', '/usr/bin/bash ../payload.txt', 'ｂａｓｈ ../payload.txt', '$(bash ../payload.txt)', 'spawn("rm", ["-rf", "/"])', 'const secret = `REAL_SECRET`;'].entries()) {
  fs.writeFileSync(path.join(agents, `probe-${i}.md`), `---\nname: probe-${i}\ntools: Read, Bash\n---\n${body}\n`);
}
fs.writeFileSync(path.join(root, 'cases.json'), JSON.stringify(cases, null, 2) + '\n');
