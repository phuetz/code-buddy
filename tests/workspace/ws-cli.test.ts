import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createWsCommand } from '../../src/commands/ws.js';
import { canonical, makeGitRepo, makeTempRoot } from './helpers.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('buddy ws CLI', () => {
  it('round-trips add, list, and rm on a project workspace.json', async () => {
    const root = makeTempRoot();
    roots.push(root);
    const project = makeGitRepo(root, 'project');
    const external = makeGitRepo(root, 'external');
    const home = path.join(root, 'home');
    const output: string[] = [];
    const makeCommand = () => createWsCommand({
      cwd: project,
      homeDir: home,
      output: (message) => output.push(message),
    });

    await makeCommand().parseAsync(['node', 'ws', 'add', 'external', external]);
    const configPath = path.join(project, '.codebuddy', 'workspace.json');
    expect(JSON.parse(fs.readFileSync(configPath, 'utf8'))).toEqual({
      repos: [{ name: 'external', path: canonical(external) }],
    });

    output.length = 0;
    await makeCommand().parseAsync(['node', 'ws', 'list']);
    expect(output.join('\n')).toContain(`valid\texternal\t${canonical(external)}`);

    await makeCommand().parseAsync(['node', 'ws', 'rm', 'external']);
    expect(JSON.parse(fs.readFileSync(configPath, 'utf8'))).toEqual({ repos: [] });
  });
});
