/**
 * The phone half of sharing a photo: what the WebSocket accepts, and what the
 * album route is allowed to reveal. Both are remote input surfaces, so both are
 * tested for the refusals as much as for the happy path.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listAlbum, readAlbumEntry } from '../../src/server/mobile/album.js';
import {
  WS_MAX_ATTACHMENT_BYTES,
  WS_MAX_CHAT_ATTACHMENTS,
  validateChatAttachments,
} from '../../src/server/websocket/handler.js';
import { storeSharedPhoto } from '../../src/companion/shared-photos.js';

const PNG_1X1_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_1X1 = Buffer.from(PNG_1X1_B64, 'base64');

describe('WebSocket chat attachments', () => {
  it('accepts a plain base64 photo and re-derives its type from the bytes', () => {
    const result = validateChatAttachments([{ mimeType: 'image/heic', data: PNG_1X1_B64 }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The client CLAIMED heic; the bytes say png, and the bytes win.
    expect(result.attachments[0]!.mimeType).toBe('image/png');
  });

  it('accepts a data: URL payload', () => {
    const result = validateChatAttachments([{ data: `data:image/png;base64,${PNG_1X1_B64}` }]);
    expect(result.ok).toBe(true);
  });

  it('treats an absent field as no photo at all', () => {
    const result = validateChatAttachments(undefined);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.attachments).toEqual([]);
  });

  it('refuses more than four photos', () => {
    const result = validateChatAttachments(
      Array.from({ length: WS_MAX_CHAT_ATTACHMENTS + 1 }, () => ({ data: PNG_1X1_B64 })),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('At most 4');
  });

  it('refuses a photo over the per-photo ceiling', () => {
    const big = Buffer.concat([PNG_1X1, Buffer.alloc(WS_MAX_ATTACHMENT_BYTES)]);
    const result = validateChatAttachments([{ data: big.toString('base64') }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('KB');
  });

  it('refuses bytes that are not an image', () => {
    const result = validateChatAttachments([
      { data: Buffer.from('<svg onload=alert(1)>').toString('base64') },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('Attachment is not an image');
  });

  it('refuses malformed payloads without throwing', () => {
    expect(validateChatAttachments('nope').ok).toBe(false);
    expect(validateChatAttachments([null]).ok).toBe(false);
    expect(validateChatAttachments([{ data: 42 }]).ok).toBe(false);
    expect(validateChatAttachments([{ data: '' }]).ok).toBe(false);
    expect(validateChatAttachments([{ data: 'not base64 !!!' }]).ok).toBe(false);
  });
});

describe('the album route data', () => {
  let dir = '';
  let selfieDir = '';

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'cb-album-route-'));
    selfieDir = mkdtempSync(path.join(tmpdir(), 'cb-selfies-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(selfieDir, { recursive: true, force: true });
  });

  it('merges shared photos and Lisa selfies, newest first', async () => {
    await storeSharedPhoto(
      {
        bytes: PNG_1X1,
        mimeType: 'image/png',
        surface: 'mobile',
        captionUser: 'regarde',
        descriptionLisa: 'un lac',
      },
      { dir, now: new Date('2026-09-01T00:00:00Z') },
    );
    mkdirSync(path.join(selfieDir, 'safe', 'portrait'), { recursive: true });
    writeFileSync(path.join(selfieDir, 'safe', 'portrait', 'a.png'), PNG_1X1);

    const entries = await listAlbum({ dir, selfieDir });
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.kind).sort()).toEqual(['selfie', 'shared']);
    const shared = entries.find((entry) => entry.kind === 'shared')!;
    expect(shared.description).toBe('un lac');
    expect(shared.caption).toBe('regarde');
    // Newest first: the selfie was just written.
    expect(entries[0]!.kind).toBe('selfie');
  });

  it('never leaks a path — every entry is addressed by a digest', async () => {
    mkdirSync(path.join(selfieDir, 'safe'), { recursive: true });
    writeFileSync(path.join(selfieDir, 'safe', 'b.png'), PNG_1X1);
    const entries = await listAlbum({ dir, selfieDir });
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain(selfieDir);
    expect(serialized).not.toContain('.png');
    for (const entry of entries) expect(entry.id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('serves the bytes of a shared photo and of a selfie by id', async () => {
    const record = await storeSharedPhoto(
      { bytes: PNG_1X1, mimeType: 'image/png', surface: 'mobile' },
      { dir },
    );
    mkdirSync(path.join(selfieDir, 'safe'), { recursive: true });
    writeFileSync(path.join(selfieDir, 'safe', 'c.jpg'), PNG_1X1);

    const shared = await readAlbumEntry(record!.hash, { dir, selfieDir });
    expect(shared!.bytes.equals(PNG_1X1)).toBe(true);

    const entries = await listAlbum({ dir, selfieDir });
    const selfie = entries.find((entry) => entry.kind === 'selfie')!;
    const loaded = await readAlbumEntry(selfie.id, { dir, selfieDir });
    expect(loaded!.bytes.equals(PNG_1X1)).toBe(true);
    expect(loaded!.mimeType).toBe('image/jpeg');
  });

  it('refuses an id that is not a digest, and an unknown digest', async () => {
    expect(await readAlbumEntry('../../etc/passwd', { dir, selfieDir })).toBeNull();
    expect(await readAlbumEntry('safe/portrait/a.png', { dir, selfieDir })).toBeNull();
    expect(await readAlbumEntry('f'.repeat(64), { dir, selfieDir })).toBeNull();
  });

  it('is an empty album rather than an error when nothing exists yet', async () => {
    const entries = await listAlbum({
      dir: path.join(dir, 'absent'),
      selfieDir: path.join(selfieDir, 'absent'),
    });
    expect(entries).toEqual([]);
  });
});
