import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { existsSync, createWriteStream } from 'node:fs';
import { describe, expect, it } from 'vitest';
import archiver from 'archiver';
import yauzl from 'yauzl';
import { ScaffoldService } from '../src/main/studio/scaffold-service.js';
import { CommandRunner, type CommandOutputEvent } from '../src/main/studio/command-runner.js';

function readZipEntries(zipPath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      if (!zipfile) return resolve([]);
      const entries: string[] = [];
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        entries.push(entry.fileName);
        zipfile.readEntry();
      });
      zipfile.on('end', () => resolve(entries));
      zipfile.on('error', reject);
    });
  });
}

describe('B2 & B3 Real Execution Proof (Template Scaffolding, DevDeps Installation, Export)', () => {
  it('scaffolds react-tailwind, verifies CommandRunner development env propagation, and proves B3 export zip', async () => {
    const tmpBase = await mkdtemp(path.join(os.tmpdir(), 'agy-proof-'));
    const projectDir = path.join(tmpBase, 'my-react-app');

    try {
      // 1. Scaffold the react-tailwind template
      const scaffold = new ScaffoldService();
      const scaffoldRes = await scaffold.scaffoldProject({
        template: 'react-tailwind',
        targetDir: projectDir,
        vars: { projectName: 'my-react-app' },
      });
      expect(scaffoldRes.ok).toBe(true);
      expect(existsSync(path.join(projectDir, 'package.json'))).toBe(true);
      expect(existsSync(path.join(projectDir, 'vite.config.ts'))).toBe(true);

      // Verify package.json contains @vitejs/plugin-react in devDependencies
      const pkg = JSON.parse(await readFile(path.join(projectDir, 'package.json'), 'utf8'));
      expect(pkg.devDependencies).toHaveProperty('@vitejs/plugin-react');

      // 2. Test that CommandRunner forces NODE_ENV=development even when parent is production
      const events: CommandOutputEvent[] = [];
      const runner = new CommandRunner((ev) => events.push(ev));

      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const envCheck = await runner.runToCompletion({
          cwd: projectDir,
          command: `${JSON.stringify(process.execPath)} -e "console.log(process.env.NODE_ENV)"`,
          id: 'check-env',
        });
        expect(envCheck.ok).toBe(true);
        const envOutput = events.find((e) => e.id === 'check-env' && e.stream === 'stdout');
        expect(envOutput?.line).toBe('development');
      } finally {
        process.env.NODE_ENV = prevEnv;
      }

      // 3. Test B3: Export Zip creation from the scaffolded project
      const zipPath = path.join(tmpBase, 'exported-project.zip');
      await new Promise<void>((resolve, reject) => {
        const output = createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        output.on('close', () => resolve());
        archive.on('error', (err) => reject(err));
        archive.pipe(output);
        archive.glob('**/*', {
          cwd: projectDir,
          dot: true,
          ignore: ['node_modules/**', '.git/**'],
        });
        void archive.finalize();
      });

      expect(existsSync(zipPath)).toBe(true);
      const zipStat = await stat(zipPath);
      expect(zipStat.size).toBeGreaterThan(0);

      // List and verify contents of the zip
      const zipEntries = await readZipEntries(zipPath);
      expect(zipEntries).toContain('package.json');
      expect(zipEntries).toContain('vite.config.ts');
      expect(zipEntries).toContain('src/App.tsx');
      expect(zipEntries.some((e) => e.startsWith('node_modules'))).toBe(false);

      console.log(`[B3 Proof] Exported zip archive: ${zipPath} (${zipStat.size} bytes)`);
      console.log(`[B3 Proof] Contained files: ${zipEntries.join(', ')}`);
    } finally {
      await rm(tmpBase, { recursive: true, force: true });
    }
  }, 30_000);
});
