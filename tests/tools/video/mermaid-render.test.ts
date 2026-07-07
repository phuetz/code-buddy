/**
 * mermaid-render — mmdc PNG rendering: pure argv/config + fail-open contract.
 */
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import {
  buildPuppeteerConfig,
  buildMmdcArgs,
  renderMermaidPng,
} from '../../../src/tools/video/mermaid-render.js';

describe('pure builders', () => {
  it('buildPuppeteerConfig includes --no-sandbox and the chromium path', () => {
    const cfg = JSON.parse(buildPuppeteerConfig('/opt/chrome'));
    expect(cfg.args).toContain('--no-sandbox');
    expect(cfg.executablePath).toBe('/opt/chrome');
    expect(JSON.parse(buildPuppeteerConfig()).executablePath).toBeUndefined();
  });

  it('buildMmdcArgs wires input/output/config + scale + theme', () => {
    const a = buildMmdcArgs('/i.mmd', '/o.png', '/c.json', 'dark', '#111');
    expect(a).toEqual([
      '-i',
      '/i.mmd',
      '-o',
      '/o.png',
      '-t',
      'dark',
      '-b',
      '#111',
      '-s',
      '2',
      '-p',
      '/c.json',
    ]);
  });
});

function fakeSpawn(versionCode: number): typeof spawn {
  return ((_cmd: string, _args: string[]) => {
    const c = new EventEmitter() as unknown as ReturnType<typeof spawn>;
    setImmediate(() => c.emit('close', versionCode));
    return c;
  }) as unknown as typeof spawn;
}

describe('renderMermaidPng (fail-open)', () => {
  it('returns null when mmdc is not installed (version probe fails)', async () => {
    const out = await renderMermaidPng('flowchart LR\nA-->B', '/tmp/x.png', {
      spawn: fakeSpawn(127),
      env: {} as NodeJS.ProcessEnv,
    });
    expect(out).toBeNull();
  });
});
