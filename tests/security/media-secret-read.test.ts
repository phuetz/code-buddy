import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const qa = await vi.hoisted(async () => {
  const path = await import('node:path');
  // A sibling of the earlier reprise fixture: both suites can run in separate forks.
  const root = path.join(process.cwd(), '_qa', 'securite-reprise-media-readers');
  const oldHome = process.env.HOME;
  const oldProfile = process.env.USERPROFILE;
  const home = path.join(root, 'home');
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.CODEBUDDY_ALLOW_SECRET_FILE_READ;
  return { root, home, oldHome, oldProfile };
});

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { understandVideoCloud } from '../../src/tools/video/cloud-understand.js';
import { analyzeVideoWithModel } from '../../src/tools/video-analysis-tool.js';
import { generateVideo } from '../../src/tools/media-generation-tool.js';
import { ImageEditTool } from '../../src/tools/registry/multimodal-tools.js';
import { findCredentialPathInCommand, validateCommand } from '../../src/tools/bash/command-validator.js';

const work = path.join(qa.root, 'media-work');
const credential = path.join(qa.home, '.codebuddy', 'codex-auth.json');
const imageCredential = path.join(qa.home, '.codebuddy', 'credentials.png');
const fake = 'FAKE-MEDIA-SECRET-REPRISE';

beforeAll(async () => {
  expect(path.normalize(os.homedir())).toBe(path.normalize(qa.home));
  await fs.rm(qa.root, { recursive: true, force: true });
  await fs.mkdir(path.dirname(credential), { recursive: true });
  await fs.mkdir(work, { recursive: true });
  await fs.writeFile(credential, JSON.stringify({ access_token: fake }));
  await fs.writeFile(imageCredential, fake);
  await fs.writeFile(path.join(work, 'scene.mp4'), 'ordinary video bytes');
  await fs.writeFile(path.join(work, 'scene.png'), 'ordinary image bytes');
  await fs.symlink(credential, path.join(work, 'clip.mp4'));
});

afterAll(async () => {
  await fs.rm(qa.root, { recursive: true, force: true });
  if (qa.oldHome === undefined) delete process.env.HOME;
  else process.env.HOME = qa.oldHome;
  if (qa.oldProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = qa.oldProfile;
});

describe('les lecteurs multimédia gardent les chemins locaux avant transmission', () => {
  it('understand_video refuse le jeton direct et accepte une vidéo ordinaire', async () => {
    const callGemini = vi.fn(async () => 'ok');
    const deps = { env: { GEMINI_API_KEY: 'fake-api-key' }, callGemini };
    const denied = await understandVideoCloud(credential, 'Que voit-on ?', deps);
    expect(denied.ok).toBe(false);
    const symlinkDenied = await understandVideoCloud(path.join(work, 'clip.mp4'), 'Que voit-on ?', deps);
    expect(symlinkDenied.ok).toBe(false);
    expect(callGemini).not.toHaveBeenCalled();
    const allowed = await understandVideoCloud(path.join(work, 'scene.mp4'), 'Que voit-on ?', deps);
    expect(allowed.ok).toBe(true);
    expect(callGemini).toHaveBeenCalledOnce();
  });

  it('video_analyze refuse un symlink vers le jeton avant POST', async () => {
    const fetchStub = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 }));
    const runtime = {
      rootDir: work,
      env: { CODEBUDDY_VIDEO_ANALYSIS_API_KEY: 'fake-api-key' },
      fetch: fetchStub as typeof fetch,
    };
    await expect(analyzeVideoWithModel({ videoUrl: 'clip.mp4', question: 'Que voit-on ?' }, runtime))
      .rejects.toThrow(/credential\/secret/i);
    expect(fetchStub).not.toHaveBeenCalled();
    const allowed = await analyzeVideoWithModel({ videoUrl: 'scene.mp4', question: 'Que voit-on ?' }, runtime);
    expect(allowed.success).toBe(true);
    expect(fetchStub).toHaveBeenCalledOnce();
  });

  it('video_generate refuse une référence secrète avant upload ComfyUI', async () => {
    const fetchStub = vi.fn(async () => new Response(JSON.stringify({ name: 'uploaded.png' }), { status: 200 }));
    await expect(generateVideo({ prompt: 'Une scène', referenceImageUrls: [credential] }, {
      rootDir: work,
      env: { CODEBUDDY_VIDEO_PROVIDER: 'comfyui', CODEBUDDY_VIDEO_BASE_URL: 'http://localhost:8190' },
      fetch: fetchStub as typeof fetch,
    })).rejects.toThrow(/credential\/secret/i);
    expect(fetchStub).not.toHaveBeenCalled();
    await expect(generateVideo({ prompt: 'Une scène', referenceImageUrls: [path.join(work, 'clip.mp4')] }, {
      rootDir: work,
      env: { CODEBUDDY_VIDEO_PROVIDER: 'comfyui', CODEBUDDY_VIDEO_BASE_URL: 'http://localhost:8190' },
      fetch: fetchStub as typeof fetch,
    })).rejects.toThrow(/credential\/secret/i);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('video_generate transmet encore une image locale ordinaire à ComfyUI', async () => {
    const fetchStub = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith('/upload/image')) {
        expect(init?.body).toBeInstanceOf(FormData);
        return new Response(JSON.stringify({ name: 'scene.png' }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
    await expect(generateVideo({ prompt: 'Une scène', referenceImageUrls: [path.join(work, 'scene.png')] }, {
      rootDir: work,
      env: { CODEBUDDY_VIDEO_PROVIDER: 'comfyui', CODEBUDDY_VIDEO_BASE_URL: 'http://localhost:8190' },
      fetch: fetchStub as typeof fetch,
    })).rejects.toThrow(/no prompt_id/i);
    expect(fetchStub.mock.calls.some(([url]) => String(url).endsWith('/upload/image'))).toBe(true);
  });

  it('image_edit refuse une image classée secrète, même dans son workspace', async () => {
    const fetchStub = vi.fn(async () => new Response('{}', { status: 200 }));
    const tool = new ImageEditTool({
      rootDir: qa.home,
      env: { CODEBUDDY_IMAGE_PROVIDER: 'xai', CODEBUDDY_IMAGE_API_KEY: 'fake-api-key' },
      fetch: fetchStub as typeof fetch,
    });
    const result = await tool.execute({ prompt: 'Modifier', image_path: '.codebuddy/credentials.png' }, { cwd: qa.home });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/credential\/secret/i);
    expect(fetchStub).not.toHaveBeenCalled();
  });
});

describe('réserves du validateur shell', () => {
  it.each([
    'F=auth; cat ~/.codebuddy/codex-$F.json',
    'cat ~/.codebuddy/codex-$(echo auth).json',
  ])('refuse une composition dynamique sous la racine des identifiants : %s', (command) => {
    expect(findCredentialPathInCommand(command)).not.toBeNull();
    expect(validateCommand(command).valid).toBe(false);
  });

  it('interprète les séparateurs Windows quand la plateforme est Windows', () => {
    const command = `cat ${qa.home}\\.codebuddy\\codex-auth.json`;
    expect(findCredentialPathInCommand(command, 'win32')).not.toBeNull();
    expect(findCredentialPathInCommand(`cat ${qa.home}\\.codebuddy\\codex-$F.json`, 'win32')).not.toBeNull();
    expect(findCredentialPathInCommand('cat ~/.codebuddy/settings.json', 'win32')).toBeNull();
  });
});
