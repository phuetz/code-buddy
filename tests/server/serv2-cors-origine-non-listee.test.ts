/**
 * SERV2 — écart 3 du rapport SERV1 : une origine HTTP non listée reçoit un
 * **200 sans `Access-Control-Allow-Origin`**, pas un 403. C'est le comportement
 * CORS standard (c'est le NAVIGATEUR qui refuse la lecture, pas le serveur),
 * mais la documentation parlait d'un serveur « origin-hardened » sans distinguer
 * les deux surfaces, et un lecteur en déduisait un refus HTTP.
 *
 * Ce fichier fige le contrat pour qu'il ne dérive plus en silence :
 *  - origine listée      → 200 + ACAO qui renvoie l'origine ;
 *  - origine NON listée  → 200, corps servi, ACAO ABSENT ;
 *  - préflight OPTIONS d'une origine non listée → pas d'ACAO non plus ;
 *  - aucune origine (curl, CLI, pair de flotte) → servi, comme avant.
 *
 * Corollaire à ne pas oublier : CORS n'est PAS un contrôle d'accès. Le corps est
 * réellement écrit sur le socket ; seul un navigateur le cache à la page
 * appelante. Le contrôle d'accès, c'est le JWT et le réseau.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetDatabaseManager } from '../../src/database/database-manager.js';

type StartedServer = Awaited<ReturnType<typeof import('../../src/server/index.js').startServer>>;

describe('SERV2 CORS — origine HTTP non listée', () => {
  let tmpHome = '';
  let previousHome: string | undefined;
  let started: StartedServer | null = null;
  let baseUrl = '';

  beforeEach(async () => {
    previousHome = process.env.CODEBUDDY_HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-serv2-cors-'));
    process.env.CODEBUDDY_HOME = tmpHome;
    resetDatabaseManager();

    const { startServer } = await import('../../src/server/index.js');
    started = await startServer({
      port: 0,
      host: '127.0.0.1',
      authEnabled: false,
      websocketEnabled: false,
      logging: false,
      rateLimit: false,
      cors: true,
      corsOrigins: ['http://listed.example'],
      docsEnabled: false,
      securityHeaders: { enabled: false },
    });
    const address = started.server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    if (started) {
      const { stopServer } = await import('../../src/server/index.js');
      await stopServer(started.server);
      started = null;
    }
    resetDatabaseManager();
    if (previousHome === undefined) {
      delete process.env.CODEBUDDY_HOME;
    } else {
      process.env.CODEBUDDY_HOME = previousHome;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('renvoie l’en-tête ACAO à une origine listée', async () => {
    const response = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'http://listed.example' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://listed.example');
  });

  it('sert un 200 SANS ACAO à une origine non listée — pas un 403', async () => {
    const response = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'https://evil.example' },
    });

    // Le contrat exact, tel que mesuré en vrai sur `buddy server --port 3620` :
    // le serveur répond normalement, c'est le navigateur qui bloque la lecture.
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();

    // Et le corps est bel et bien servi : CORS n'est pas un contrôle d'accès.
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.status).toBeDefined();
  });

  it('ne renvoie pas non plus d’ACAO au préflight OPTIONS d’une origine non listée', async () => {
    const response = await fetch(`${baseUrl}/api/health`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example',
        'Access-Control-Request-Method': 'GET',
      },
    });
    expect(response.status).toBeLessThan(400);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('sert un client sans en-tête Origin (curl, CLI, pair de flotte)', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.status).toBe(200);
  });
});
