import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

it('isolates environment, cwd and HOME between files, and detects a disabled isolation', () => {
  const root = mkdtempSync(join(tmpdir(), 'cb-file-isolation-'));
  try {
    symlinkSync(join(repoRoot, 'node_modules'), join(root, 'node_modules'), 'junction');
    mkdirSync(join(root, 'changed-cwd'));
    const producerState = join(root, 'producer.json');
    const witness = join(root, 'consumer.txt');
    writeFileSync(join(root, 'a-producer.test.ts'), [
      "import { it } from 'vitest';",
      "import { writeFileSync } from 'node:fs';",
      "it('producer', () => {",
      `  writeFileSync(${JSON.stringify(producerState)}, JSON.stringify({ pid: process.pid, home: process.env.HOME }));`,
      "  process.env.CODEBUDDY_TEST_ORDER_LEAK = 'producer';",
      `  process.chdir(${JSON.stringify(join(root, 'changed-cwd'))});`,
      '});',
    ].join('\n'));
    writeFileSync(join(root, 'b-consumer.test.ts'), [
      "import { expect, it } from 'vitest';",
      "import { readFileSync, writeFileSync } from 'node:fs';",
      "it('consumer', () => {",
      "  expect(process.env.CODEBUDDY_TEST_ORDER_LEAK, 'environment leaked between files').toBeUndefined();",
      `  expect(process.cwd()).toBe(${JSON.stringify(root)});`,
      `  const producer = JSON.parse(readFileSync(${JSON.stringify(producerState)}, 'utf8'));`,
      '  expect(process.pid).not.toBe(producer.pid);',
      '  expect(process.env.HOME).not.toBe(producer.home);',
      `  writeFileSync(${JSON.stringify(witness)}, 'ISOLATED');`,
      '});',
    ].join('\n'));
    const config = join(root, 'vitest.config.mjs');
    const writeConfig = (mutant: boolean) => writeFileSync(config, [
      `import base from ${JSON.stringify(pathToFileURL(join(repoRoot, 'vitest.config.ts')).href)};`,
      "import { BaseSequencer } from 'vitest/node';",
      'class Order extends BaseSequencer { sort(files) { return [...files].sort((a, b) => a.moduleId.localeCompare(b.moduleId)); } }',
      'export default { test: {',
      `  root: ${JSON.stringify(root)},`,
      "  include: ['*.test.ts'], environment: 'node', silent: true,",
      '  pool: base.test.pool, maxWorkers: 1, fileParallelism: false,',
      `  isolate: ${mutant ? 'false' : 'base.test.isolate'},`,
      `  setupFiles: [${JSON.stringify(join(repoRoot, 'tests/setup/home-isolation.ts'))}],`,
      '  sequence: { sequencer: Order },',
      '} };',
    ].join('\n'));
    const run = () => spawnSync(process.execPath, [
      join(repoRoot, 'node_modules/vitest/vitest.mjs'), 'run', '--config', config,
    ], { cwd: root, env: { ...process.env, CODEBUDDY_TEST_ORDER_LEAK: undefined }, encoding: 'utf8', timeout: 10_000 });

    writeConfig(false);
    const isolated = run();
    expect(isolated.status, `${isolated.stdout}\n${isolated.stderr}`).toBe(0);
    expect(readFileSync(witness, 'utf8')).toBe('ISOLATED');
    rmSync(witness);

    writeConfig(true);
    const shared = run();
    expect(shared.status, `${shared.stdout}\n${shared.stderr}`).toBe(1);
    expect(`${shared.stdout}\n${shared.stderr}`).toContain('environment leaked between files');
    expect(existsSync(witness)).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
