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
