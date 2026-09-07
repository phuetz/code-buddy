// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.resolve(__dirname, '../../src/server/mobile/assets');
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

type EmojiItem = { e: string; c: string; k: string };

type MobileApi = {
  init: () => void;
  destroy: () => void;
  state: {
    ws: { readyState: number; send: (raw: string) => void } | null;
    streaming: boolean;
    pickerOpen: boolean;
    unread: number;
    atBottom: boolean;
    avatarUrl: string;
    unreadAnchorId?: string;
    telegramForward?: boolean;
    replyTo?: { id: string; text: string } | null;
  };
  STORAGE: Record<string, string>;
  REACTIONS: string[];
  DEFAULT_AVATAR: string;
  MAX_RECENT: number;
  MAX_HISTORY: number;
  searchEmojis: (q: string) => EmojiItem[];
  getRecentEmojis: () => string[];
  rememberEmoji: (emoji: string) => string[];
  insertEmoji: (emoji: string) => void;
  insertAtCursor: (el: HTMLTextAreaElement, text: string) => void;
  openEmojiPicker: () => void;
  closeEmojiPicker: () => void;
  autosizeComposer: () => void;
  sendChat: (event?: Event) => boolean;
  sendText: (text: string) => boolean;
  handleComposerKey: (event: { key: string; shiftKey: boolean; preventDefault: () => void }) => boolean;
  addMessage: (partial: Record<string, unknown>) => { id: string; role: string };
  getMessages: () => Array<{ id: string; role: string; text: string; ack?: string; reaction?: string; image?: string }>;
  renderMessages: () => void;
  setReaction: (id: string, emoji: string) => string | null;
  openLightbox: (src: string) => void;
  closeLightbox: () => void;
  handleFrame: (data: Record<string, unknown>) => void;
  setPresence: (kind: string) => void;
  applyStatusPayload: (data: Record<string, unknown>) => void;
  getSuggestions: () => string[];
  refreshSuggestions: () => void;
  hideSuggestions: () => void;
  persistHistory: () => void;
  restoreHistory: () => void;
  clearHistory: () => void;
  showMain: () => void;
  daySeparatorLabel: (ts: number, now?: number) => string;
  renderMarkdown: (src: string) => string;
  haptic: () => void;
  pulseSend: () => void;
  showReactionBar: (id: string, x?: number, y?: number) => void;
  startReply: (id: string) => boolean;
  cancelReply: () => void;
  beginEdit: (id?: string) => boolean;
  deleteForMe: (id: string) => boolean;
  togglePin: (id: string) => boolean;
  searchConversation: (query: string) => string[];
  gotoSearch: (dir: number) => string;
  openSearch: () => void;
  closeSearch: () => void;
  setSelectMode: (on: boolean) => void;
  toggleSelected: (id: string) => void;
  deleteSelected: () => void;
  applyAck: (ack: string, clientMsgId?: string) => string | null;
  forwardMessage: (id: string) => Promise<boolean>;
  scrollToMessage: (id: string) => boolean;
  formatFullTime: (ts: number) => string;
  handleBubblePointerDown: (event: { target: EventTarget | null; clientX?: number; clientY?: number }) => void;
  handleBubblePointerMove: (event: { clientX?: number }) => void;
  handleBubblePointerUp: (event: { clientX?: number }) => void;
  currentChatPayload: (
    message: string,
    attachments?: unknown[],
    extras?: Record<string, unknown>,
  ) => Record<string, unknown>;
  applyStatusPayload: (data: Record<string, unknown>) => void;
};

function asset(name: string): string {
  return readFileSync(path.join(assetsDir, name), 'utf8');
}

function extractBody(): string {
  const html = asset('index.html');
  const match = html.match(/<body>([\s\S]*)<\/body>/i);
  if (!match?.[1]) throw new Error('index.html has no body');
  return match[1].replace(/<script[\s\S]*?<\/script>/gi, '');
}

function runScript(source: string): void {
  const fn = new Function(source);
  fn();
}

function mount(): MobileApi {
  document.body.innerHTML = extractBody();
  runScript(asset('emoji-data.js'));
  runScript(asset('app.js'));
  const api = (window as unknown as { CodeBuddyMobile: MobileApi }).CodeBuddyMobile;
  api.showMain();
  return api;
}

describe('Mobile chat UI (DOM)', () => {
  let sent: unknown[];
  let api: MobileApi;

  beforeEach(() => {
    sent = [];
    localStorage.clear();
    sessionStorage.clear();
    vi.useRealTimers();
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: vi.fn(() => true),
    });
    api = mount();
    api.state.ws = {
      readyState: 1,
      send: (raw: string) => {
        sent.push(JSON.parse(raw));
      },
    };
  });

  afterEach(() => {
    api?.destroy();
    vi.useRealTimers();
  });

  describe('composer and emoji picker', () => {
    it('ships eight categories and about 300 emojis', () => {
      const data = (window as unknown as {
        CODEBUDDY_EMOJI_DATA: { CATEGORIES: unknown[]; EMOJIS: unknown[] };
      }).CODEBUDDY_EMOJI_DATA;
      expect(data.CATEGORIES).toHaveLength(8);
      expect(data.CATEGORIES.map((c: { id: string }) => c.id)).toEqual([
        'recents', 'smileys', 'hearts', 'gestures', 'nature', 'food', 'activities', 'symbols',
      ]);
      expect(data.EMOJIS.length).toBeGreaterThanOrEqual(280);
      expect(data.EMOJIS.length).toBeLessThan(500);
    });

    it('searches by French and English keywords', () => {
      expect(api.searchEmojis('cœur').some((item) => item.e === '❤️')).toBe(true);
      expect(api.searchEmojis('coeur').some((item) => item.e === '❤️')).toBe(true);
      expect(api.searchEmojis('rire').some((item) => item.e === '😂')).toBe(true);
      expect(api.searchEmojis('kiss').some((item) => item.e === '😘' || item.e === '💋')).toBe(true);
    });

    it('inserts an emoji at the caret and remembers recents (max 10)', () => {
      const input = document.getElementById('message-input') as HTMLTextAreaElement;
      input.value = 'ab';
      input.setSelectionRange(1, 1);
      api.insertAtCursor(input, '❤️');
      expect(input.value).toBe('a❤️b');
      for (let i = 0; i < 12; i += 1) api.rememberEmoji(`e${i}`);
      const recents = api.getRecentEmojis();
      expect(recents).toHaveLength(10);
      expect(recents[0]).toBe('e11');
      expect(recents).not.toContain('e0');
    });

    it('sends on Enter, inserts a newline on Shift+Enter, pulses and vibrates', () => {
      const input = document.getElementById('message-input') as HTMLTextAreaElement;
      input.value = 'hello';
      const prevented: string[] = [];
      expect(api.handleComposerKey({
        key: 'Enter',
        shiftKey: true,
        preventDefault: () => prevented.push('shift'),
      })).toBe(false);
      expect(prevented).toEqual([]);
      expect(api.handleComposerKey({
        key: 'Enter',
        shiftKey: false,
        preventDefault: () => prevented.push('enter'),
      })).toBe(true);
      expect(prevented).toEqual(['enter']);
      expect(sent.some((frame) => (frame as { type: string }).type === 'chat')).toBe(true);
      expect(api.getMessages().some((msg) => msg.role === 'user' && msg.text === 'hello')).toBe(true);
      expect((navigator.vibrate as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(10);
      const sendBtn = document.getElementById('send-btn');
      expect(sendBtn?.classList.contains('pulse')).toBe(true);
    });

    it('opens the picker, closes on Escape and outside click', () => {
      const btn = document.getElementById('emoji-btn');
      expect(btn?.getAttribute('aria-label')).toBe('Émojis');
      api.openEmojiPicker();
      expect(document.getElementById('emoji-picker')?.classList.contains('hidden')).toBe(false);
      expect(btn?.getAttribute('aria-expanded')).toBe('true');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(document.getElementById('emoji-picker')?.classList.contains('hidden')).toBe(true);
      api.openEmojiPicker();
      document.getElementById('messages')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(api.state.pickerOpen).toBe(false);
    });

    it('autosizes the composer between 1 and 5 lines', () => {
      const input = document.getElementById('message-input') as HTMLTextAreaElement;
      let scrollHeight = 40;
      Object.defineProperty(input, 'scrollHeight', {
        configurable: true,
        get: () => scrollHeight,
      });
      scrollHeight = 40;
      api.autosizeComposer();
      expect(Number.parseInt(input.style.height, 10)).toBe(44);
      scrollHeight = 400;
      api.autosizeComposer();
      expect(Number.parseInt(input.style.height, 10)).toBe(132);
    });
  });

  describe('bubbles', () => {
    it('groups consecutive messages, shows day separators and checkmarks', () => {
      const now = Date.now();
      api.addMessage({ role: 'user', text: 'un', ts: now - 1000 });
      api.addMessage({ role: 'user', text: 'deux', ts: now - 500 });
      api.addMessage({ role: 'assistant', text: 'ok **gras** https://example.com', ts: now });
      const rows = document.querySelectorAll('.msg-row.user');
      expect(rows[0]?.className).toContain('group-start');
      expect(rows[1]?.className).toContain('group-end');
      expect(document.body.textContent).toContain('Aujourd’hui');
      expect(document.querySelector('.ack')?.textContent).toContain('✓✓');
      expect(document.querySelector('.bubble a')?.getAttribute('href')).toBe('https://example.com');
      expect(document.querySelector('strong')?.textContent).toBe('gras');
    });

    it('uses the default Lisa avatar and adopts a selfie thumbnail', () => {
      expect(api.state.avatarUrl).toContain('icon-192.png');
      api.addMessage({ role: 'assistant', text: 'photo', image: TINY_PNG });
      expect(api.state.avatarUrl).toBe(TINY_PNG);
      expect(localStorage.getItem(api.STORAGE.avatar)).toContain('data:image/png');
      expect((document.getElementById('lisa-avatar') as HTMLImageElement).src).toContain('data:image/png');
    });

    it('opens and closes the image lightbox', () => {
      api.addMessage({ role: 'assistant', text: '', image: TINY_PNG });
      const img = document.querySelector('img.bubble-img') as HTMLImageElement;
      img.click();
      expect(document.getElementById('lightbox')?.classList.contains('hidden')).toBe(false);
      document.getElementById('lightbox')?.click();
      expect(document.getElementById('lightbox')?.classList.contains('hidden')).toBe(true);
    });

    it('labels yesterday as Hier', () => {
      const now = new Date(2026, 8, 6, 12).getTime();
      const yesterday = new Date(2026, 8, 5, 18).getTime();
      expect(api.daySeparatorLabel(yesterday, now)).toBe('Hier');
    });
  });

  describe('reactions (local only)', () => {
    it('toggles a reaction without sending a WS frame', () => {
      const msg = api.addMessage({ role: 'assistant', text: 'hey' });
      sent.length = 0;
      expect(api.setReaction(msg.id, '❤️')).toBe('❤️');
      expect(document.querySelector('.bubble-reactions')?.textContent).toBe('❤️');
      expect(api.setReaction(msg.id, '❤️')).toBe('');
      expect(sent.some((frame) => (frame as { type?: string }).type === 'reaction')).toBe(false);
    });

    it('opens the six-emoji bar on long press', () => {
      vi.useFakeTimers();
      const msg = api.addMessage({ role: 'assistant', text: 'long' });
      const row = document.querySelector(`[data-id="${msg.id}"]`) as HTMLElement;
      row.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      vi.advanceTimersByTime(400);
      expect(document.getElementById('reaction-bar')?.classList.contains('hidden')).toBe(false);
      expect(api.REACTIONS).toEqual(['❤️', '😂', '😮', '😢', '👍', '🔥']);
      vi.useRealTimers();
    });
  });

  describe('presence and mood', () => {
    it('shows Lisa writes on the first stream chunk', () => {
      api.handleFrame({ type: 'stream_start' });
      expect(document.getElementById('typing-indicator')?.classList.contains('hidden')).toBe(true);
      api.handleFrame({ type: 'stream_chunk', payload: { delta: 'Salut' } });
      expect(document.getElementById('presence-line')?.textContent).toBe('écrit…');
      expect(document.getElementById('typing-indicator')?.classList.contains('hidden')).toBe(false);
      api.handleFrame({ type: 'stream_end' });
      expect(document.getElementById('typing-indicator')?.classList.contains('hidden')).toBe(true);
    });

    it('renders a mood chip from the status payload', () => {
      api.applyStatusPayload({ companion: { mood: 72, label: 'joyeuse' } });
      const chip = document.getElementById('mood-chip');
      expect(chip?.classList.contains('hidden')).toBe(false);
      expect(chip?.textContent).toBe('joyeuse');
    });
  });

  describe('suggestions', () => {
    it('starts with greeting chips and rotates after an image', () => {
      const start = api.getSuggestions();
      expect(start).toContain('Coucou 💕');
      api.addMessage({ role: 'assistant', text: 'selfie', image: TINY_PNG });
      const afterImage = api.getSuggestions();
      expect(afterImage.some((chip) => chip.includes('Encore') || chip.includes('belle'))).toBe(true);
      api.hideSuggestions();
      expect(api.getSuggestions()).toEqual([]);
    });

    it('sends a chip immediately on tap', () => {
      api.refreshSuggestions();
      const chip = document.querySelector('.suggest-chip') as HTMLButtonElement;
      chip.click();
      expect(sent.some((frame) => (frame as { type: string }).type === 'chat')).toBe(true);
    });
  });

  describe('local history', () => {
    it('restores the last messages after a reload', () => {
      api.addMessage({ role: 'user', text: 'ping' });
      api.addMessage({ role: 'assistant', text: 'pong' });
      api.destroy();
      api = mount();
      const texts = api.getMessages().map((msg) => msg.text);
      expect(texts).toContain('ping');
      expect(texts).toContain('pong');
    });

    it('caps history at 200 and clears after confirmation', () => {
      for (let i = 0; i < 205; i += 1) {
        api.addMessage({ role: 'user', text: `n${i}` });
      }
      expect(api.getMessages().length).toBeLessThanOrEqual(200);
      document.getElementById('clear-chat-btn')?.click();
      expect(document.getElementById('clear-chat-confirm')?.classList.contains('hidden')).toBe(false);
      document.getElementById('clear-chat-yes')?.click();
      expect(api.getMessages()).toEqual([]);
    });

    it('shows the jump-bottom unread badge when not pinned to the floor', () => {
      const box = document.getElementById('messages') as HTMLElement;
      Object.defineProperty(box, 'scrollHeight', { configurable: true, value: 800 });
      Object.defineProperty(box, 'clientHeight', { configurable: true, value: 200 });
      box.scrollTop = 0;
      box.dispatchEvent(new Event('scroll'));
      api.state.atBottom = false;
      api.addMessage({ role: 'assistant', text: 'nouveau' });
      expect(api.state.unread).toBeGreaterThanOrEqual(1);
      expect(document.getElementById('jump-bottom')?.classList.contains('hidden')).toBe(false);
    });

    it('handles QuotaExceededError without unhandled exception and truncates history', () => {
      for (let i = 0; i < 20; i += 1) {
        api.addMessage({ role: 'user', text: `Message number ${i} with enough text to measure size` });
      }

      const originalSetItem = localStorage.setItem.bind(localStorage);
      const setItemSpy = vi.spyOn(localStorage, 'setItem').mockImplementation((key, val) => {
        if (key === api.STORAGE.history) {
          const parsed = JSON.parse(val);
          if (parsed.length > 5) {
            const err = new Error('Quota exceeded');
            err.name = 'QuotaExceededError';
            throw err;
          }
        }
        return originalSetItem(key, val);
      });

      expect(() => {
        api.persistHistory();
      }).not.toThrow();

      const saved = JSON.parse(localStorage.getItem(api.STORAGE.history) || '[]');
      expect(saved.length).toBeLessThanOrEqual(5);
      expect(saved.length).toBeGreaterThan(0);
      expect(saved[saved.length - 1].text).toContain('Message number 19');

      setItemSpy.mockRestore();
    });

    it('handles QuotaExceededError safely when setItem always throws', () => {
      const setItemSpy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
        const err = new Error('Quota exceeded');
        err.name = 'QuotaExceededError';
        throw err;
      });

      expect(() => {
        api.addMessage({ role: 'user', text: 'will fail to persist' });
        api.persistHistory();
      }).not.toThrow();

      setItemSpy.mockRestore();
    });

    it('retains at most MAX_HISTORY_IMAGES (5) in persisted history', () => {
      for (let i = 0; i < 8; i += 1) {
        api.addMessage({ role: 'assistant', text: `img ${i}`, image: TINY_PNG });
      }
      api.persistHistory();
      const saved = JSON.parse(localStorage.getItem(api.STORAGE.history) || '[]');
      const savedWithImages = saved.filter((m: { image?: string }) => Boolean(m.image));
      expect(savedWithImages.length).toBeLessThanOrEqual(5);
    });
  });

  describe('speech recognition and mic button', () => {
    it('hides the mic button when SpeechRecognition is absent', () => {
      const micBtn = document.getElementById('mic-btn');
      expect(micBtn).not.toBeNull();
      expect(micBtn?.classList.contains('hidden')).toBe(true);
      expect(micBtn?.hidden).toBe(true);
    });

    it('shows the mic button and starts dictation when SpeechRecognition is present', () => {
      const startMock = vi.fn();
      class MockSpeechRecognition {
        start = startMock;
        lang = '';
        interimResults = false;
        onresult = null;
      }
      (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = MockSpeechRecognition;
      api.destroy();
      api = mount();
      const micBtn = document.getElementById('mic-btn');
      expect(micBtn?.classList.contains('hidden')).toBe(false);
      expect(micBtn?.hidden).toBe(false);
      micBtn?.click();
      expect(startMock).toHaveBeenCalledTimes(1);
      delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    });
  });
});

describe('Mobile chat UI — messagerie (lot 1)', () => {
  let sent: unknown[];
  let api: MobileApi;

  beforeEach(() => {
    sent = [];
    localStorage.clear();
    sessionStorage.clear();
    vi.useRealTimers();
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: vi.fn(() => true),
    });
    api = mount();
    api.state.ws = {
      readyState: 1,
      send: (raw: string) => {
        sent.push(JSON.parse(raw));
      },
    };
  });

  afterEach(() => {
    api?.destroy();
  });

  it('quotes a message above the composer and in the outgoing bubble', () => {
    const original = api.addMessage({ role: 'assistant', text: 'on se voit ce soir ?' });
    expect(api.startReply(original.id)).toBe(true);
    expect(document.getElementById('reply-quote')?.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('reply-quote-text')?.textContent).toContain('on se voit');
    expect(api.sendText('oui')).toBe(true);
    const frame = sent.find((item) => (item as { type?: string }).type === 'chat') as {
      payload?: { replyTo?: { id: string; text: string }; clientMsgId?: string; message?: string };
    };
    expect(frame?.payload?.replyTo?.id).toBe(original.id);
    expect(frame?.payload?.replyTo?.text).toContain('on se voit');
    expect(frame?.payload?.clientMsgId).toMatch(/^m-/);
    expect(frame?.payload?.message).toBe('oui');
    const mine = api.getMessages().find((msg) => msg.role === 'user' && msg.text === 'oui') as
      { replyTo?: { id: string } };
    expect(mine?.replyTo?.id).toBe(original.id);
    expect(document.querySelector('.quote-ref')?.textContent).toContain('on se voit');
    expect(document.getElementById('reply-quote')?.classList.contains('hidden')).toBe(true);
  });

  it('scrolls to the original when the quote is tapped', () => {
    const original = api.addMessage({ role: 'assistant', text: 'citation cible' });
    api.startReply(original.id);
    api.sendText('reçu');
    const quote = document.querySelector('.quote-ref') as HTMLButtonElement;
    expect(quote.getAttribute('aria-label')).toBe('Aller au message cité');
    const row = document.querySelector(`[data-id="${original.id}"]`) as HTMLElement;
    const spy = vi.fn();
    row.scrollIntoView = spy;
    quote.click();
    expect(spy).toHaveBeenCalled();
  });

  it('starts a reply after a right swipe', () => {
    const msg = api.addMessage({ role: 'assistant', text: 'swipe-moi' });
    const row = document.querySelector(`[data-id="${msg.id}"]`) as HTMLElement;
    api.handleBubblePointerDown({ target: row, clientX: 10, clientY: 40 });
    api.handleBubblePointerMove({ clientX: 80 });
    api.handleBubblePointerUp({ clientX: 80 });
    expect(document.getElementById('reply-quote')?.classList.contains('hidden')).toBe(false);
  });

  it('copies from the action bar without a WS reaction frame', () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const msg = api.addMessage({ role: 'assistant', text: 'à copier' });
    sent.length = 0;
    api.copyMessage(msg.id);
    expect(writeText).toHaveBeenCalledWith('à copier');
    expect(sent.some((frame) => (frame as { type?: string }).type === 'reaction')).toBe(false);
  });

  it('hides Telegram forward until status says the channel is configured', async () => {
    expect(document.getElementById('forward-msg-btn')?.classList.contains('hidden')).toBe(true);
    api.applyStatusPayload({ telegramForward: true });
    expect(document.getElementById('forward-msg-btn')?.classList.contains('hidden')).toBe(false);
    const msg = api.addMessage({ role: 'user', text: 'transfert' });
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await api.forwardMessage(msg.id);
    expect(fetchMock).toHaveBeenCalled();
    const call = fetchMock.mock.calls[0] as [string, { method?: string; body?: string }];
    expect(call[0]).toContain('/forward');
    expect(call[1]?.method).toBe('POST');
    expect(JSON.parse(call[1]?.body ?? '{}').text).toBe('transfert');
    vi.unstubAllGlobals();
  });

  it('deletes a message for me only', () => {
    const msg = api.addMessage({ role: 'assistant', text: 'à effacer' });
    api.deleteForMe(msg.id);
    expect(api.getMessages().some((item) => item.id === msg.id)).toBe(false);
    expect(document.querySelector(`[data-id="${msg.id}"]`)).toBeNull();
    expect(sent.some((frame) => (frame as { type?: string }).type === 'chat')).toBe(false);
  });

  it('edits the last user message, resends it and marks it modifié', () => {
    const mine = api.addMessage({ role: 'user', text: 'brouillon' });
    expect(api.beginEdit(mine.id)).toBe(true);
    expect((document.getElementById('message-input') as HTMLTextAreaElement).value).toBe('brouillon');
    sent.length = 0;
    expect(api.sendText('version finale')).toBe(true);
    const frame = sent.find((item) => (item as { type?: string }).type === 'chat') as {
      payload?: { editOf?: string; message?: string };
    };
    expect(frame?.payload?.editOf).toBe(mine.id);
    expect(frame?.payload?.message).toBe('version finale');
    expect(api.getMessages().filter((msg) => msg.role === 'user')).toHaveLength(1);
    expect(api.getMessages()[0]?.text).toBe('version finale');
    expect(document.querySelector('.edited-mark')?.textContent).toBe('modifié');
  });

  it('selects several messages and deletes them', () => {
    const a = api.addMessage({ role: 'user', text: 'un' });
    const b = api.addMessage({ role: 'assistant', text: 'deux' });
    api.addMessage({ role: 'user', text: 'trois' });
    api.setSelectMode(true);
    expect(document.getElementById('select-bar')?.classList.contains('hidden')).toBe(false);
    api.toggleSelected(a.id);
    api.toggleSelected(b.id);
    api.deleteSelected();
    const texts = api.getMessages().map((msg) => msg.text);
    expect(texts).toEqual(['trois']);
    expect(document.getElementById('select-bar')?.classList.contains('hidden')).toBe(true);
  });

  it('searches, highlights, and walks previous/next hits', () => {
    api.addMessage({ role: 'user', text: 'alpha unique' });
    api.addMessage({ role: 'assistant', text: 'beta unique' });
    api.addMessage({ role: 'user', text: 'gamma' });
    api.openSearch();
    expect(document.getElementById('search-bar')?.classList.contains('hidden')).toBe(false);
    const hits = api.searchConversation('unique');
    expect(hits).toHaveLength(2);
    expect(document.querySelectorAll('mark.search-hit').length).toBeGreaterThanOrEqual(2);
    expect(document.getElementById('search-count')?.textContent).toBe('1/2');
    api.gotoSearch(1);
    expect(document.getElementById('search-count')?.textContent).toBe('2/2');
    api.closeSearch();
    expect(document.getElementById('search-bar')?.classList.contains('hidden')).toBe(true);
    expect(document.querySelector('mark.search-hit')).toBeNull();
  });

  it('pins a message and shows the banner', () => {
    const msg = api.addMessage({ role: 'assistant', text: 'à garder' });
    expect(api.togglePin(msg.id)).toBe(true);
    expect(document.getElementById('pinned-bar')?.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('pinned-label')?.textContent).toContain('épinglé');
    expect(api.togglePin(msg.id)).toBe(false);
    expect(document.getElementById('pinned-bar')?.classList.contains('hidden')).toBe(true);
  });

  it('upgrades ✓ sent to ✓✓ received then blue read from server acks', () => {
    const mine = api.addMessage({ role: 'user', text: 'ping' });
    expect(document.querySelector('.ack.sent')?.textContent).toBe('✓');
    api.applyAck('received', mine.id);
    expect(document.querySelector('.ack.received')?.textContent).toBe('✓✓');
    api.handleFrame({ type: 'ack', payload: { ack: 'read', clientMsgId: mine.id } });
    expect(document.querySelector('.ack.read')?.getAttribute('aria-label')).toBe('Lu');
    expect(document.querySelector('.ack.read')?.textContent).toBe('✓✓');
  });

  it('shows a full timestamp on touch and a new-messages separator', () => {
    const first = api.addMessage({ role: 'user', text: 'hier soir' });
    api.state.unreadAnchorId = first.id;
    api.addMessage({ role: 'assistant', text: 'nouveau' });
    expect(document.querySelector('.new-sep')?.textContent).toMatch(/nouveaux messages/i);
    const row = document.querySelector(`[data-id="${first.id}"]`) as HTMLElement;
    row.click();
    expect(row.classList.contains('meta-on')).toBe(true);
    expect(row.querySelector('.bubble-meta')?.textContent).toMatch(/\d{4}|\d{1,2}\s/);
  });

  it('labels every new action with an aria-label and a 44 px target class', () => {
    [
      'search-btn', 'search-prev', 'search-next', 'search-close',
      'reply-msg-btn', 'copy-msg-btn', 'forward-msg-btn', 'pin-msg-btn',
      'edit-msg-btn', 'delete-msg-btn', 'select-msg-btn',
      'reply-quote-close', 'select-delete', 'select-cancel',
    ].forEach((id) => {
      const node = document.getElementById(id);
      expect(node?.getAttribute('aria-label'), id).toBeTruthy();
      expect(node?.className, id).toMatch(/touch/);
    });
    expect(document.getElementById('search-input')?.getAttribute('aria-label')).toBe(
      'Rechercher dans la conversation',
    );
  });
});

describe('Mobile chat UI — reconnexion automatique (serveur redémarré)', () => {
  type FakeWs = {
    readyState: number;
    sent: string[];
    listeners: Record<string, Array<() => void>>;
    onclose: null;
    send: (raw: string) => void;
    close: () => void;
    addEventListener: (name: string, fn: () => void) => void;
    emit: (name: string, payload?: unknown) => void;
  };
  const sockets: FakeWs[] = [];
  let api: MobileApi;

  function makeFakeWs(): FakeWs {
    const ws: FakeWs = {
      readyState: 0,
      sent: [],
      listeners: {},
      onclose: null,
      send(raw: string) { ws.sent.push(raw); },
      close() { ws.readyState = 3; },
      addEventListener(name: string, fn: () => void) { (ws.listeners[name] ||= []).push(fn); },
      emit(name: string, payload?: unknown) {
        (ws.listeners[name] || []).forEach((fn) => (fn as (e?: unknown) => void)(payload));
      },
    };
    sockets.push(ws);
    return ws;
  }

  beforeEach(() => {
    sockets.length = 0;
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers();
    function FakeWebSocket(this: unknown) { return makeFakeWs(); }
    vi.stubGlobal('WebSocket', FakeWebSocket);
    Object.defineProperty(window, 'WebSocket', { configurable: true, writable: true, value: FakeWebSocket });
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vi.fn(() => true) });
    api = mount();
    (api.state as { token: string }).token = 'jeton-de-test';
    (api as unknown as { connectWs: () => void }).connectWs();
    const ws = sockets[0]!;
    ws.readyState = 1;
    ws.emit('open');
    api.handleFrame({ type: 'authenticated', payload: { userId: 'u', scopes: ['chat'] } });
  });

  afterEach(() => {
    api?.destroy();
    vi.useRealTimers();
  });

  it('authenticates on open and is connected', () => {
    const ws = sockets[0]!;
    expect(JSON.parse(ws.sent[0]!).type).toBe('authenticate');
    expect((api.state as { connected: boolean }).connected).toBe(true);
  });

  it('reconnects with backoff after the server closes the socket and re-authenticates', () => {
    const first = sockets[0]!;
    first.readyState = 3;
    first.emit('close');
    expect((api.state as { connected: boolean }).connected).toBe(false);
    expect(document.getElementById('presence-line')?.textContent).toBe('reconnexion…');
    expect(sockets.length).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(sockets.length).toBe(2);
    const second = sockets[1]!;
    second.readyState = 1;
    second.emit('open');
    expect(JSON.parse(second.sent[0]!).type).toBe('authenticate');
    api.handleFrame({ type: 'authenticated', payload: { userId: 'u', scopes: ['chat'] } });
    expect((api.state as { connected: boolean }).connected).toBe(true);
    expect(document.getElementById('presence-line')?.textContent).toBe('en ligne');
  });

  it('queues a message sent while disconnected and replays it once re-authenticated', () => {
    const first = sockets[0]!;
    first.readyState = 3;
    first.emit('close');
    expect(api.sendText('Tu es là ?')).toBe(true);
    expect(first.sent.some((raw) => JSON.parse(raw).type === 'chat')).toBe(false);
    expect((api.state as { outbox: unknown[] }).outbox).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    const second = sockets[sockets.length - 1]!;
    second.readyState = 1;
    second.emit('open');
    api.handleFrame({ type: 'authenticated', payload: { userId: 'u', scopes: ['chat'] } });
    const chat = second.sent.map((raw) => JSON.parse(raw)).find((f) => f.type === 'chat');
    expect(chat?.payload?.message).toBe('Tu es là ?');
    expect((api.state as { outbox: unknown[] }).outbox).toHaveLength(0);
  });

  it('backs off exponentially up to 30 s and resets after a successful auth', () => {
    const delays: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      const ws = sockets[sockets.length - 1]!;
      ws.readyState = 3;
      ws.emit('close');
      delays.push((api as unknown as { reconnectDelayMs: () => number }).reconnectDelayMs());
      vi.advanceTimersByTime(30000);
    }
    expect(delays[0]).toBe(2000);
    expect(Math.max(...delays)).toBe(30000);
    const ws = sockets[sockets.length - 1]!;
    ws.readyState = 1;
    ws.emit('open');
    api.handleFrame({ type: 'authenticated', payload: { userId: 'u', scopes: ['chat'] } });
    expect((api.state as { reconnectAttempt: number }).reconnectAttempt).toBe(0);
  });

  it('does not reconnect after an explicit logout', () => {
    (api as unknown as { logout: () => void }).logout();
    const before = sockets.length;
    const ws = sockets[sockets.length - 1]!;
    ws.readyState = 3;
    ws.emit('close');
    vi.advanceTimersByTime(60000);
    expect(sockets.length).toBe(before);
  });
});
