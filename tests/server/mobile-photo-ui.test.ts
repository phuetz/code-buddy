// @vitest-environment happy-dom
/**
 * The gesture: tap 📷, see the thumbnails, send. Then the Album tab.
 *
 * Everything here runs the REAL `app.js` against the REAL `index.html`, the
 * same harness `mobile-chat-ui.test.ts` uses — no rewritten copy of the client.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.resolve(__dirname, '../../src/server/mobile/assets');

const TINY_JPEG_DATA_URL =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

type AttachApi = {
  init: () => void;
  destroy: () => void;
  bind: () => void;
  state: Record<string, unknown> & {
    token: string;
    assistant: string;
    attachments: Array<{ mimeType: string; dataUrl: string }>;
    album: Array<Record<string, unknown>>;
    ws: { readyState: number; send: (raw: string) => void } | null;
    lightboxAlbumId: string;
  };
  ATTACH_MAX_COUNT: number;
  addAttachments: (files: unknown[]) => Promise<number>;
  removeAttachment: (index: number) => number;
  clearAttachments: () => void;
  attachmentPayload: () => Array<{ mimeType: string; data: string }>;
  renderAttachPreview: () => void;
  currentChatPayload: (
    message: string,
    attachments?: Array<{ mimeType: string; data: string }>,
  ) => Record<string, unknown>;
  sendText: (text: string) => boolean;
  getMessages: () => Array<{ role: string; text: string; images?: string[] }>;
  loadAlbum: () => Promise<Array<Record<string, unknown>>>;
  renderAlbum: () => void;
  setAlbum: (entries: Array<Record<string, unknown>>) => void;
  getAlbum: () => Array<Record<string, unknown>>;
  toggleAlbumFavorite: () => Promise<boolean>;
  deleteAlbumEntry: () => Promise<boolean>;
  syncAlbumActions: () => void;
};

function loadApp(): AttachApi {
  document.documentElement.innerHTML = readFileSync(path.join(assetsDir, 'index.html'), 'utf8')
    .replace(/^[\s\S]*?<body>/, '')
    .replace(/<\/body>[\s\S]*$/, '');
  const emoji = readFileSync(path.join(assetsDir, 'emoji-data.js'), 'utf8');
  const app = readFileSync(path.join(assetsDir, 'app.js'), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function(emoji)();
  // eslint-disable-next-line no-new-func
  new Function(app)();
  return (globalThis as unknown as { CodeBuddyMobile: AttachApi }).CodeBuddyMobile;
}

/**
 * happy-dom has no canvas encoder. Stand in for the browser's decode+encode so
 * the resize PATH is exercised even though the pixels are not.
 */
function stubImagePipeline(): void {
  Object.defineProperty(globalThis.URL, 'createObjectURL', {
    configurable: true,
    value: () => 'blob:fake',
  });
  Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
    configurable: true,
    value: () => undefined,
  });
  class FakeImage {
    width = 2400;
    height = 1600;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: FakeImage });
  const original = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    const node = original(tag as 'div');
    if (tag === 'canvas') {
      Object.assign(node, {
        getContext: () => ({ drawImage: () => undefined }),
        toDataURL: () => TINY_JPEG_DATA_URL,
      });
    }
    return node;
  }) as typeof document.createElement);
}

function fakeFile(type = 'image/jpeg'): { type: string; name: string } {
  return { type, name: 'photo.jpg' };
}

/**
 * Rendering the grid fetches every thumbnail (the album route is
 * authenticated, so an `<img src>` would not carry the token). Those GETs are
 * expected traffic: assertions about "did it act" look only at the mutating
 * calls.
 */
function mutatingCalls(mock: { mock: { calls: unknown[][] } }): Array<[string, RequestInit]> {
  return mock.mock.calls
    .map((call) => call as unknown as [string, RequestInit | undefined])
    .filter(([, init]) => init?.method !== undefined)
    .map(([url, init]) => [url, init as RequestInit]);
}

let api: AttachApi;

beforeEach(() => {
  stubImagePipeline();
  api = loadApp();
  api.state.token = 'test-token';
  api.state.assistant = 'companion';
});

afterEach(() => {
  api?.destroy?.();
  vi.restoreAllMocks();
});

describe('attaching a photo in the composer', () => {
  it('shrinks the file, shows a thumbnail with a remove cross', async () => {
    await api.addAttachments([fakeFile()]);
    expect(api.state.attachments).toHaveLength(1);
    expect(api.state.attachments[0]!.mimeType).toBe('image/jpeg');

    const preview = document.getElementById('attach-preview')!;
    expect(preview.classList.contains('hidden')).toBe(false);
    expect(preview.querySelectorAll('.attach-thumb')).toHaveLength(1);
    expect(preview.querySelectorAll('.attach-remove')).toHaveLength(1);
  });

  it('removes a thumbnail and hides the strip when empty', async () => {
    await api.addAttachments([fakeFile(), fakeFile()]);
    expect(api.removeAttachment(0)).toBe(1);
    api.clearAttachments();
    expect(document.getElementById('attach-preview')!.classList.contains('hidden')).toBe(true);
  });

  it('never takes more than four photos', async () => {
    await api.addAttachments([fakeFile(), fakeFile(), fakeFile(), fakeFile(), fakeFile(), fakeFile()]);
    expect(api.state.attachments.length).toBeLessThanOrEqual(api.ATTACH_MAX_COUNT);
  });

  it('ignores a file that is not an image', async () => {
    await api.addAttachments([fakeFile('application/pdf')]);
    expect(api.state.attachments).toHaveLength(0);
  });

  it('offers the camera directly on a phone', () => {
    const input = document.getElementById('attach-input') as HTMLInputElement;
    expect(input.getAttribute('accept')).toBe('image/*');
    expect(input.getAttribute('capture')).toBe('environment');
    expect(input.hasAttribute('multiple')).toBe(true);
  });
});

describe('sending a photo', () => {
  it('puts base64 attachments on the companion chat frame and a thumbnail in the bubble', async () => {
    const sent: string[] = [];
    api.state.ws = { readyState: 1, send: (raw: string) => sent.push(raw) };
    await api.addAttachments([fakeFile()]);

    expect(api.sendText('regarde ce que j’ai vu')).toBe(true);
    const frame = JSON.parse(sent[0]!) as {
      type: string;
      payload: { assistant: string; attachments?: Array<{ mimeType: string; data: string }> };
    };
    expect(frame.type).toBe('chat');
    expect(frame.payload.assistant).toBe('companion');
    expect(frame.payload.attachments).toHaveLength(1);
    expect(frame.payload.attachments![0]!.data.startsWith('data:')).toBe(false);

    const bubble = api.getMessages().at(-1)!;
    expect(bubble.role).toBe('user');
    expect(bubble.images).toHaveLength(1);
    // The strip is cleared once sent.
    expect(api.state.attachments).toHaveLength(0);
  });

  it('lets a photo alone be the whole message', async () => {
    const sent: string[] = [];
    api.state.ws = { readyState: 1, send: (raw: string) => sent.push(raw) };
    await api.addAttachments([fakeFile()]);
    expect(api.sendText('')).toBe(true);
    const frame = JSON.parse(sent[0]!) as { payload: { message: string } };
    expect(frame.payload.message).toBe('Regarde cette photo.');
  });

  it('never attaches a photo to the agent or to a peer', async () => {
    await api.addAttachments([fakeFile()]);
    const photos = api.attachmentPayload();
    api.state.assistant = 'agent';
    expect(api.currentChatPayload('hello', photos).attachments).toBeUndefined();
    api.state.assistant = 'peer-x';
    expect(api.currentChatPayload('hello', photos).attachments).toBeUndefined();
  });

  it('refuses to send while a reply is streaming', async () => {
    api.state.ws = { readyState: 1, send: () => undefined };
    await api.addAttachments([fakeFile()]);
    (api.state as { streaming: boolean }).streaming = true;
    expect(api.sendText('coucou')).toBe(false);
  });
});

describe('the Album tab', () => {
  it('renders shared photos and selfies as tiles, newest first', () => {
    api.setAlbum([
      { id: 'a'.repeat(64), kind: 'shared', at: '2026-09-06T10:00:00Z', description: 'un lac', favorite: true },
      { id: 'b'.repeat(64), kind: 'selfie', at: '2026-09-05T10:00:00Z' },
    ]);
    const tiles = document.querySelectorAll('#album-grid .album-tile');
    expect(tiles).toHaveLength(2);
    expect(tiles[0]!.getAttribute('data-kind')).toBe('shared');
    expect(tiles[1]!.classList.contains('selfie')).toBe(true);
    expect(tiles[0]!.querySelector('.album-meta')!.textContent).toContain('❤️');
    expect(document.getElementById('album-empty')!.classList.contains('hidden')).toBe(true);
  });

  it('says so when the album is empty', () => {
    api.setAlbum([]);
    expect(document.getElementById('album-empty')!.classList.contains('hidden')).toBe(false);
  });

  it('fetches the album with the bearer token', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ entries: [{ id: 'c'.repeat(64), kind: 'shared', at: '2026-09-06T00:00:00Z' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const entries = await api.loadAlbum();
    expect(entries).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/__codebuddy__/mobile/album');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
  });

  it('offers favourite and delete on a shared photo only', () => {
    api.setAlbum([
      { id: 'a'.repeat(64), kind: 'shared', at: '2026-09-06T10:00:00Z' },
      { id: 'b'.repeat(64), kind: 'selfie', at: '2026-09-05T10:00:00Z' },
    ]);
    api.state.lightboxAlbumId = 'a'.repeat(64);
    api.syncAlbumActions();
    expect(document.getElementById('lightbox-actions')!.classList.contains('hidden')).toBe(false);

    api.state.lightboxAlbumId = 'b'.repeat(64);
    api.syncAlbumActions();
    expect(document.getElementById('lightbox-actions')!.classList.contains('hidden')).toBe(true);
  });

  it('marks a favourite through the API and reflects it in the grid', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const id = 'a'.repeat(64);
    api.setAlbum([{ id, kind: 'shared', at: '2026-09-06T10:00:00Z' }]);
    api.state.lightboxAlbumId = id;

    expect(await api.toggleAlbumFavorite()).toBe(true);
    const [url, init] = mutatingCalls(fetchMock)[0]!;
    expect(url).toBe(`/__codebuddy__/mobile/album/${id}/favorite`);
    expect(init.method).toBe('POST');
    expect(api.getAlbum()[0]!.favorite).toBe(true);
  });

  it('deletes only after the confirmation button is used', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const id = 'a'.repeat(64);
    api.setAlbum([{ id, kind: 'shared', at: '2026-09-06T10:00:00Z' }]);
    api.state.lightboxAlbumId = id;

    // The trash button only reveals the confirmation — nothing is deleted yet.
    (document.getElementById('album-del-btn') as HTMLButtonElement).click();
    expect(document.getElementById('album-del-confirm')!.classList.contains('hidden')).toBe(false);
    expect(mutatingCalls(fetchMock)).toHaveLength(0);

    expect(await api.deleteAlbumEntry()).toBe(true);
    expect(mutatingCalls(fetchMock)[0]![1].method).toBe('DELETE');
    expect(api.getAlbum()).toHaveLength(0);
  });

  it('refuses to delete a selfie', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const id = 'b'.repeat(64);
    api.setAlbum([{ id, kind: 'selfie', at: '2026-09-06T10:00:00Z' }]);
    api.state.lightboxAlbumId = id;
    expect(await api.deleteAlbumEntry()).toBe(false);
    expect(mutatingCalls(fetchMock)).toHaveLength(0);
  });
});
