import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PluginManifestManager, PluginManifest } from '../../src/plugins/plugin-manifest.js';

describe('PluginManifestManager filesystem loading', () => {
  let tmpDir: string;
  let pluginDir: string;
  let manifestPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-plugin-manifest-'));
    pluginDir = path.join(tmpDir, 'demo-plugin');
    fs.mkdirSync(pluginDir, { recursive: true });
    manifestPath = path.join(pluginDir, 'manifest.json');

    const manifest: PluginManifest = {
      name: 'demo-plugin',
      version: '1.2.3',
      description: 'Demo plugin',
      components: {
        skills: ['skill.md'],
      },
    };

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads plugin from directory path', () => {
    const mgr = new PluginManifestManager();
    const installed = mgr.loadPlugin(pluginDir);

    expect(installed.manifest.name).toBe('demo-plugin');
    expect(installed.manifest.version).toBe('1.2.3');
    expect(installed.path).toBe(pluginDir);
  });

  it('loads plugin from explicit manifest file path', () => {
    const mgr = new PluginManifestManager();
    const installed = mgr.loadPlugin(manifestPath);

    expect(installed.manifest.name).toBe('demo-plugin');
    expect(installed.manifest.version).toBe('1.2.3');
  });

  it('resolves plugin paths using configured plugin directories', () => {
    const mgr = new PluginManifestManager([tmpDir]);
    const installed = mgr.loadPlugin('demo-plugin');

    expect(installed.manifest.name).toBe('demo-plugin');
  });

  it('installs from directory source by reading manifest from disk', async () => {
    const mgr = new PluginManifestManager();
    const installed = await mgr.installFromSource('directory', pluginDir);

    expect(installed.manifest.name).toBe('demo-plugin');
    expect(installed.manifest.version).toBe('1.2.3');
    expect(mgr.getPluginCount()).toBe(1);
  });
});
