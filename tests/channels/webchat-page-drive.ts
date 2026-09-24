/**
 * Exécute le script réel de la page WebChat dans un DOM simulé.
 * Aucune écoute réseau : le WebSocket est un faux, et le script est borné.
 */
import vm from 'node:vm';

interface FakeElement {
  value: string;
  disabled: boolean;
  className: string;
  textContent: string;
  innerHTML: string;
  style: { display: string };
  focus: () => void;
  listeners: Record<string, () => void>;
  addEventListener: (name: string, fn: () => void) => void;
  appendChild: (child: unknown) => unknown;
  click: () => void;
}

export interface WebChatPageDrive {
  inputDisabled: () => boolean;
  frames: Array<Record<string, unknown>>;
  submitToken: (token: string) => void;
  sendText: (text: string) => void;
  deliver: (message: unknown) => void;
  /** Ferme la socket courante (readyState 3) et laisse la page programmer la reconnexion. */
  closeSocket: () => void;
  /** Déclenche la reconnexion programmée, sans attendre le délai de la page. */
  reconnect: () => void;
}

function makeElement(): FakeElement {
  const element: FakeElement = {
    value: '',
    disabled: true,
    className: '',
    textContent: '',
    innerHTML: '',
    style: { display: '' },
    focus() {},
    listeners: {},
    addEventListener(name: string, fn: () => void) {
      this.listeners[name] = fn;
    },
    appendChild(child: unknown) {
      return child;
    },
    click() {
      this.listeners.click?.();
    },
  };
  return element;
}

export function driveWebChatPage(html: string): WebChatPageDrive {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error('script introuvable');

  const elements = new Map<string, FakeElement>();
  const element = (id: string): FakeElement => {
    const existing = elements.get(id);
    if (existing) return existing;
    const created = makeElement();
    elements.set(id, created);
    return created;
  };
  for (const id of ['messages', 'msg-input', 'send-btn', 'status', 'token-input', 'auth-btn', 'auth-area']) {
    element(id);
  }

  const frames: Array<Record<string, unknown>> = [];
  const timers: Array<{ id: number; fn: () => void; ms: number }> = [];
  let nextTimerId = 1;
  let socket: {
    readyState: number;
    onopen?: () => void;
    onmessage?: (event: { data: string }) => void;
    onclose?: () => void;
  } | null = null;

  function fakeSetTimeout(fn: () => void, ms?: number): number {
    const id = nextTimerId;
    nextTimerId += 1;
    timers.push({ id, fn, ms: ms ?? 0 });
    return id;
  }

  function fakeClearTimeout(id: number): void {
    const index = timers.findIndex((timer) => timer.id === id);
    if (index >= 0) timers.splice(index, 1);
  }

  function FakeWebSocket(url: string): {
    url: string;
    readyState: number;
    onopen?: () => void;
    onmessage?: (event: { data: string }) => void;
    onclose?: () => void;
    onerror?: () => void;
    send: (data: string) => void;
  } {
    const created = {
      url,
      readyState: 1,
      onopen: undefined as (() => void) | undefined,
      onmessage: undefined as ((event: { data: string }) => void) | undefined,
      onclose: undefined as (() => void) | undefined,
      onerror: undefined as (() => void) | undefined,
      send(data: string): void {
        frames.push(JSON.parse(data) as Record<string, unknown>);
      },
    };
    socket = created;
    return created;
  }

  vm.runInNewContext(
    script,
    {
      document: {
        getElementById: (id: string) => element(id),
        createElement: () => makeElement(),
      },
      location: { protocol: 'http:', host: '127.0.0.1:9', hash: '', pathname: '/', search: '' },
      WebSocket: FakeWebSocket,
      setTimeout: fakeSetTimeout,
      clearTimeout: fakeClearTimeout,
      JSON,
      Date,
      decodeURIComponent,
      history: { replaceState() {} },
    },
    { timeout: 2_000 },
  );

  if (!socket?.onopen) throw new Error('onopen absent');
  socket.onopen();

  const input = element('msg-input');
  const send = element('send-btn');
  const tokenInput = element('token-input');
  const authButton = element('auth-btn');

  return {
    inputDisabled: () => input.disabled,
    frames,
    submitToken: (token: string) => {
      if (!authButton.listeners.click) return;
      tokenInput.value = token;
      authButton.click();
    },
    sendText: (text: string) => {
      input.value = text;
      send.click();
    },
    deliver: (message: unknown) => {
      socket?.onmessage?.({ data: JSON.stringify(message) });
    },
    closeSocket: () => {
      if (!socket?.onclose) throw new Error('onclose absent');
      socket.readyState = 3;
      socket.onclose();
    },
    reconnect: () => {
      const pending = timers.filter((timer) => timer.ms >= 1000);
      for (const timer of pending) {
        const index = timers.indexOf(timer);
        if (index >= 0) timers.splice(index, 1);
      }
      if (pending.length === 0) throw new Error('aucune reconnexion programmée');
      for (const timer of pending) timer.fn();
      if (!socket?.onopen) throw new Error('onopen absent');
      socket.readyState = 1;
      socket.onopen();
    },
  };
}
