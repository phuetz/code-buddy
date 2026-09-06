import { mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';

import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import {
  buildMobileStatus,
  companionStatusForMobile,
} from '../../src/server/mobile/status.js';
import { mobilePwaRouter } from '../../src/server/mobile/index.js';

describe('Mobile status companion mood', () => {
  const previousRelational = process.env.CODEBUDDY_COMPANION_RELATIONAL;
  const previousStateFile = process.env.CODEBUDDY_RELATIONSHIP_STATE_FILE;
  let tmpDir: string | undefined;

  afterEach(() => {
    if (previousRelational === undefined) delete process.env.CODEBUDDY_COMPANION_RELATIONAL;
    else process.env.CODEBUDDY_COMPANION_RELATIONAL = previousRelational;
    if (previousStateFile === undefined) delete process.env.CODEBUDDY_RELATIONSHIP_STATE_FILE;
    else process.env.CODEBUDDY_RELATIONSHIP_STATE_FILE = previousStateFile;
    if (tmpDir) {
      removeTmpDir(tmpDir);
      tmpDir = undefined;
    }
  });

  function writeState(mood: number): string {
    tmpDir = makeTmpDir('mobile-status-', path.join(process.cwd(), 'tmp'));
    const file = path.join(tmpDir, 'relationship-state.json');
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({
        celebratedMilestones: [],
        mood,
        traits: { warmth: 80, humor: 40, depth: 50, energy: 60 },
      }),
    );
    process.env.CODEBUDDY_RELATIONSHIP_STATE_FILE = file;
    return file;
  }

  it('omits companion when CODEBUDDY_COMPANION_RELATIONAL is unset', () => {
    delete process.env.CODEBUDDY_COMPANION_RELATIONAL;
    expect(companionStatusForMobile()).toBeUndefined();
  });

  it('exposes mood, traits and a French label when relational is on', async () => {
    process.env.CODEBUDDY_COMPANION_RELATIONAL = 'true';
    writeState(72);
    const companion = companionStatusForMobile();
    expect(companion).toMatchObject({
      mood: 72,
      label: 'joyeuse',
      traits: { warmth: 80, humor: 40, depth: 50, energy: 60 },
    });
    const status = await buildMobileStatus();
    expect(status.companion).toMatchObject({ mood: 72, label: 'joyeuse' });
  });

  it('serves GET /__codebuddy__/mobile/status with companion when opted in', async () => {
    process.env.CODEBUDDY_COMPANION_RELATIONAL = 'true';
    writeState(90);
    const app = express();
    app.use('/__codebuddy__/mobile', mobilePwaRouter);
    const server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('expected a TCP port');
      const res = await fetch(`http://127.0.0.1:${address.port}/__codebuddy__/mobile/status`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { companion?: { mood: number; label: string } };
      expect(body.companion?.mood).toBe(90);
      expect(body.companion?.label).toBe('radieuse');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it('serves GET /__codebuddy__/mobile/status without companion when opted out', async () => {
    delete process.env.CODEBUDDY_COMPANION_RELATIONAL;
    const app = express();
    app.use('/__codebuddy__/mobile', mobilePwaRouter);
    const server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('expected a TCP port');
      const res = await fetch(`http://127.0.0.1:${address.port}/__codebuddy__/mobile/status`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { companion?: unknown };
      expect(body.companion).toBeUndefined();
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
