import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  IntentStore,
  parseIntentMarkdown,
  serializeIntent,
  type Intent,
} from '../../src/intents/intent-store.js';

describe('IntentStore', () => {
  let rootDir: string;
  let store: IntentStore;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(os.tmpdir(), 'intent-store-'));
    store = new IntentStore({
      rootDir,
      now: () => new Date('2026-07-15T10:00:00.000Z'),
      idFactory: () => 'typed-contract',
    });
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('creates, gets, lists, and updates an intent status', async () => {
    const created = await store.create({
      title: 'Typed contract',
      files: ['src/example.ts'],
      criteria: [{ desc: 'Typecheck passes', cmd: 'npm run typecheck', expectExit: 0 }],
      body: '## Decision\n\nKeep this falsifiable.\n',
    });

    expect(created).toMatchObject({ id: 'typed-contract', status: 'active' });
    expect(await store.get(created.id)).toEqual(created);
    expect(await store.list()).toEqual([created]);

    const done = await store.setStatus(created.id, 'done');
    expect(done.status).toBe('done');
    expect((await store.get(created.id))?.body).toBe(created.body);

    const archived = await store.setStatus(created.id, 'archived');
    expect(archived.status).toBe('archived');
  });

  it('round-trips YAML frontmatter and a free-form Markdown body', () => {
    const intent: Intent = {
      id: 'yaml-round-trip',
      title: 'Handle: YAML symbols',
      status: 'active',
      createdAt: '2026-07-15T10:00:00.000Z',
      files: ['src/a file.ts', 'tests/a.test.ts'],
      criteria: [
        {
          desc: 'A quoted command succeeds',
          cmd: 'grep -q "a: b" "src/a file.ts"',
          expectExit: 0,
        },
      ],
      body: '## Context\n\nA colon: and --- inside the body stay untouched.\n',
    };

    expect(parseIntentMarkdown(serializeIntent(intent))).toEqual(intent);
  });

  it('appends created and archived audit events to ledger.jsonl', async () => {
    await store.create({
      title: 'Ledger audit',
      files: [],
      criteria: [{ desc: 'True', cmd: 'true', expectExit: 0 }],
    });
    await store.setStatus('typed-contract', 'done');
    await store.setStatus('typed-contract', 'archived');

    const lines = (await readFile(store.ledgerPath, 'utf8')).trim().split('\n');
    expect(lines.map((line) => JSON.parse(line))).toMatchObject([
      { type: 'created', intentId: 'typed-contract' },
      { type: 'archived', intentId: 'typed-contract', details: { previousStatus: 'done' } },
    ]);
  });

  it('skips malformed Markdown files while listing valid intents', async () => {
    const valid = await store.create({
      title: 'Valid intent',
      files: [],
      criteria: [{ desc: 'True', cmd: 'true', expectExit: 0 }],
    });
    await writeFile(path.join(store.intentsDir, 'broken.md'), 'not frontmatter', 'utf8');
    expect(await store.list()).toEqual([valid]);
  });
});
