import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const scriptPath = path.resolve(process.cwd(), 'scripts/build-tray-icon.js');
const builderConfigPath = path.resolve(process.cwd(), 'electron-builder.yml');

describe('tray icon build helper', () => {
  it('does not fail Windows builds when the optional PNG source is absent but the ICO exists', () => {
    const output = execFileSync(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    expect(output).toContain('using existing tray-icon.ico');
    expect(fs.existsSync(path.resolve(process.cwd(), 'resources/tray-icon.ico'))).toBe(true);
  });

  it('does not require the optional tray PNG in Windows extraResources', () => {
    const builderConfig = fs.readFileSync(builderConfigPath, 'utf8');
    const winSection = builderConfig.split('\nmac:')[0] ?? builderConfig;

    expect(winSection).toContain('resources/tray-icon.ico');
    expect(winSection).not.toContain('resources/tray-icon.png');
  });

  it('packages generated built-in skills through extraResources', () => {
    const builderConfig = fs.readFileSync(builderConfigPath, 'utf8');

    expect(builderConfig).toContain('.claude/skills');
    expect(builderConfig).toContain('to: skills');
  });

  it('does not ask electron-builder to rebuild optional native accelerators', () => {
    const builderConfig = fs.readFileSync(builderConfigPath, 'utf8');

    expect(builderConfig).toContain('npmRebuild: false');
    expect(builderConfig).toContain('better-sqlite3 is rebuilt by postinstall');
  });
});
