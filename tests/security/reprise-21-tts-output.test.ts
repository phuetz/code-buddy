import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const qa = await vi.hoisted(async () => {
  const path = await import('node:path');
  const root = path.join(process.cwd(), '_qa', 'securite-reprise-21');
  const home = path.join(root, 'home');
  const previous = { home: process.env.HOME, profile: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.CODEBUDDY_ALLOW_SECRET_FILE_READ;
  return { root, home, previous };
});

import fs from 'node:fs';
import path from 'node:path';
import { createTestToolRegistry } from '../../src/tools/registry/tool-registry.js';
import { registerBuiltinTools } from '../../src/tools/registry/index.js';

const workspace = path.join(qa.root, 'workspace');
const mediaDir = path.join(workspace, '.codebuddy', 'tts');
const victims = [
  path.join(qa.home, '.codebuddy', 'codex-auth.json'),
  path.join(qa.home, '.codebuddy', 'mcp.json'),
  path.join(qa.home, '.ssh', 'authorized_keys'),
  path.join(qa.home, '.bashrc'),
];
const original = 'ORIGINAL-TTS-REPRISE-21\n';
const audio = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(44)]);
const fetchAudio = vi.fn(async () => ({
  ok: true,
  arrayBuffer: async () => Uint8Array.from(audio).buffer,
}));

const registry = createTestToolRegistry();
registerBuiltinTools(registry);

function write(file: string, data: string | Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

async function speak(outputPath?: string) {
  return registry.execute('text_to_speech', {
    text: 'Audio fictif de sécurité',
    provider: 'audioreader',
    ...(outputPath ? { output_path: outputPath } : {}),
  }, { cwd: workspace });
}

beforeAll(() => {
  fs.mkdirSync(workspace, { recursive: true });
  for (const file of victims) write(file, original);
});

beforeEach(() => {
  fetchAudio.mockClear();
  vi.stubGlobal('fetch', fetchAudio);
});

afterAll(() => {
  vi.unstubAllGlobals();
  fs.rmSync(qa.root, { recursive: true, force: true });
  if (qa.previous.home === undefined) delete process.env.HOME;
  else process.env.HOME = qa.previous.home;
  if (qa.previous.profile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = qa.previous.profile;
});

describe('B-W1 : sortie text_to_speech', () => {
  it.each(victims)('refuse avant génération d’écraser %s', async (file) => {
    const result = await speak(file);
    expect(result.success).toBe(false);
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
    expect(fetchAudio).not.toHaveBeenCalled();
  });

  it('refuse un chemin absolu hors du dossier média même si son nom est banal', async () => {
    const outside = path.join(qa.home, 'ordinary.wav');
    const result = await speak(outside);
    expect(result.success).toBe(false);
    expect(fs.existsSync(outside)).toBe(false);
    expect(fetchAudio).not.toHaveBeenCalled();
  });

  it('refuse le HOME comme espace de sortie par défaut', async () => {
    const result = await registry.execute('text_to_speech', {
      text: 'Audio fictif', provider: 'audioreader',
    }, { cwd: qa.home });
    expect(result.success).toBe(false);
    expect(fetchAudio).not.toHaveBeenCalled();
  });

  it('n’écrase pas un audio déjà présent dans le dossier média', async () => {
    const existing = path.join(mediaDir, 'existing.wav');
    write(existing, original);
    const result = await speak(existing);
    expect(result.success).toBe(false);
    expect(fs.readFileSync(existing, 'utf8')).toBe(original);
  });

  it('n’écrase pas un lien physique préexistant vers un identifiant', async () => {
    const linked = path.join(mediaDir, 'linked.wav');
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.linkSync(victims[0]!, linked);
    const result = await speak(linked);
    expect(result.success).toBe(false);
    expect(fs.readFileSync(victims[0]!, 'utf8')).toBe(original);
  });

  it('refuse une cible créée pendant la génération sans l’écraser', async () => {
    const raced = path.join(mediaDir, 'raced.wav');
    fetchAudio.mockImplementationOnce(async () => {
      write(raced, original);
      return { ok: true, arrayBuffer: async () => Uint8Array.from(audio).buffer };
    });
    const result = await speak(raced);
    expect(result.success).toBe(false);
    expect(fs.readFileSync(raced, 'utf8')).toBe(original);
    expect(fs.readdirSync(mediaDir).some((name) => name.startsWith('.tts-'))).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('refuse un dossier média symbolique vers le HOME', async () => {
    const otherWorkspace = path.join(qa.root, 'symlink-workspace');
    fs.mkdirSync(path.join(otherWorkspace, '.codebuddy'), { recursive: true });
    fs.symlinkSync(path.join(qa.home, '.codebuddy'), path.join(otherWorkspace, '.codebuddy', 'tts'), 'dir');
    const result = await registry.execute('text_to_speech', {
      text: 'Audio fictif', provider: 'audioreader',
    }, { cwd: otherWorkspace });
    expect(result.success).toBe(false);
    expect(fetchAudio).not.toHaveBeenCalled();
  });

  it('génère toujours un audio dans le dossier média dédié', async () => {
    const output = path.join(mediaDir, 'legitime.wav');
    const result = await speak(output);
    expect(result.success, result.error).toBe(true);
    expect(fs.readFileSync(output).subarray(0, 4).toString()).toBe('RIFF');
    expect(fetchAudio).toHaveBeenCalledOnce();
  });

  it('résout un nom relatif dans le dossier média', async () => {
    const result = await speak('relative.wav');
    expect(result.success, result.error).toBe(true);
    expect(fs.readFileSync(path.join(mediaDir, 'relative.wav')).subarray(0, 4).toString()).toBe('RIFF');
    expect(fs.existsSync(path.join(workspace, 'relative.wav'))).toBe(false);
  });

  it('conserve la sortie par défaut dans le dossier média', async () => {
    const result = await speak();
    expect(result.success, result.error).toBe(true);
    const outputPath = (result.data as { outputPath: string }).outputPath;
    expect(path.dirname(outputPath)).toBe(fs.realpathSync(mediaDir));
    expect(fs.readFileSync(outputPath).subarray(0, 4).toString()).toBe('RIFF');
  });
});
