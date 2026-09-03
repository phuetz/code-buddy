#!/usr/bin/env node
/**
 * Local fake Telegram Bot API for GK10.
 * Loopback only. Never contacts api.telegram.org.
 *
 *   node _qa/gk10/fake-telegram.mjs --port 0 --token 123456:gk10-fake-token
 *
 * QA control (not part of Bot API):
 *   POST /_qa/push      inject an update (message / callback / photo / voice)
 *   GET  /_qa/log       request journal (token redacted)
 *   GET  /_qa/outbound  sendMessage / sendVoice / sendPhoto / answerCallbackQuery
 *   GET  /_qa/health
 *   POST /_qa/reset
 */
import http from 'node:http';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_TOKEN = '123456:gk10-fake-token';
const HOST = '127.0.0.1';

/** Minimal JPEG (1×1 pixel) so sendPhoto / inbound photos have real bytes. */
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wAAAAD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAG/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPwB//9k=',
  'base64',
);

/** OggS magic + padding — enough for a fake Telegram voice note. */
const TINY_OGG = Buffer.concat([
  Buffer.from('OggS', 'ascii'),
  Buffer.alloc(32, 0),
]);

export function redactTelegramText(value, token) {
  if (typeof value !== 'string' || !token) return value;
  return value.split(token).join('<redacted-token>');
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port' || arg === '--token' || arg === '--log') {
      out[arg.slice(2)] = argv[++i];
    }
  }
  return out;
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseMultipart(buffer, contentType) {
  const boundaryMatch = /boundary=([^;]+)/i.exec(contentType || '');
  if (!boundaryMatch) return { fields: {}, files: [] };
  const boundary = boundaryMatch[1].trim().replace(/^"/, '').replace(/"$/, '');
  const raw = buffer.toString('latin1');
  const parts = raw.split(`--${boundary}`);
  const fields = {};
  const files = [];
  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd < 0) continue;
    const headers = part.slice(0, headerEnd);
    let body = part.slice(headerEnd + 4);
    if (body.endsWith('\r\n')) body = body.slice(0, -2);
    const name = /name="([^"]+)"/.exec(headers)?.[1];
    const filename = /filename="([^"]+)"/.exec(headers)?.[1];
    if (!name) continue;
    if (filename) {
      files.push({ field: name, filename, size: Buffer.byteLength(body, 'latin1') });
    } else {
      fields[name] = body;
    }
  }
  return { fields, files };
}

function parseParams(req, body, contentType) {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const params = {};
  for (const [key, value] of url.searchParams) params[key] = value;
  if (!body || body.length === 0) return params;
  if ((contentType || '').includes('multipart/form-data')) {
    const parsed = parseMultipart(body, contentType);
    Object.assign(params, parsed.fields);
    params.__files = parsed.files;
    return params;
  }
  const text = body.toString('utf8');
  if ((contentType || '').includes('application/json') || text.startsWith('{')) {
    try {
      return { ...params, ...JSON.parse(text) };
    } catch {
      return params;
    }
  }
  if ((contentType || '').includes('application/x-www-form-urlencoded')) {
    const form = new URLSearchParams(text);
    for (const [key, value] of form) params[key] = value;
  }
  return params;
}

function createState(token) {
  const botId = Number.parseInt(String(token).split(':')[0] || '123456', 10);
  return {
    token,
    bot: {
      id: Number.isFinite(botId) ? botId : 123456,
      is_bot: true,
      first_name: 'Lisa',
      username: 'lisa_gk10_bot',
    },
    updates: [],
    nextUpdateId: 1,
    nextMessageId: 1,
    outbound: [],
    journal: [],
    files: new Map(),
    waiters: [],
  };
}

function wakeWaiters(state) {
  const waiters = state.waiters.splice(0);
  for (const waiter of waiters) waiter();
}

export function pushUpdate(state, payload) {
  const update = {
    update_id: state.nextUpdateId++,
    ...payload,
  };
  state.updates.push(update);
  wakeWaiters(state);
  return update;
}

export function pushTextMessage(state, {
  chatId = 4242,
  userId = 4242,
  text,
  messageId,
} = {}) {
  const id = messageId ?? state.nextMessageId++;
  return pushUpdate(state, {
    message: {
      message_id: id,
      date: Math.floor(Date.now() / 1000),
      chat: { id: Number(chatId), type: 'private', first_name: 'Inconnu' },
      from: {
        id: Number(userId),
        is_bot: false,
        first_name: 'Inconnu',
        username: 'inconnu_gk10',
      },
      text,
    },
  });
}

export function pushPhotoMessage(state, {
  chatId = 4242,
  userId = 4242,
  caption,
  fileId = 'gk10-photo-1',
} = {}) {
  state.files.set(fileId, { path: `photos/${fileId}.jpg`, bytes: TINY_JPEG, contentType: 'image/jpeg' });
  const id = state.nextMessageId++;
  return pushUpdate(state, {
    message: {
      message_id: id,
      date: Math.floor(Date.now() / 1000),
      chat: { id: Number(chatId), type: 'private', first_name: 'Inconnu' },
      from: {
        id: Number(userId),
        is_bot: false,
        first_name: 'Inconnu',
        username: 'inconnu_gk10',
      },
      caption,
      photo: [
        { file_id: fileId, file_unique_id: fileId, width: 800, height: 600, file_size: TINY_JPEG.length },
      ],
    },
  });
}

export function pushVoiceMessage(state, {
  chatId = 4242,
  userId = 4242,
  fileId = 'gk10-voice-1',
} = {}) {
  state.files.set(fileId, { path: `voice/${fileId}.ogg`, bytes: TINY_OGG, contentType: 'audio/ogg' });
  const id = state.nextMessageId++;
  return pushUpdate(state, {
    message: {
      message_id: id,
      date: Math.floor(Date.now() / 1000),
      chat: { id: Number(chatId), type: 'private', first_name: 'Inconnu' },
      from: {
        id: Number(userId),
        is_bot: false,
        first_name: 'Inconnu',
        username: 'inconnu_gk10',
      },
      voice: {
        file_id: fileId,
        file_unique_id: fileId,
        duration: 1,
        mime_type: 'audio/ogg',
        file_size: TINY_OGG.length,
      },
    },
  });
}

function recordJournal(state, entry, logPath) {
  const redacted = JSON.parse(redactTelegramText(JSON.stringify(entry), state.token));
  redacted.ts = new Date().toISOString();
  state.journal.push(redacted);
  if (logPath) {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${JSON.stringify(redacted)}\n`);
  }
}

function okResult(result) {
  return { ok: true, result };
}

async function handleBotMethod(state, method, params) {
  switch (method) {
    case 'getMe':
      return okResult(state.bot);
    case 'deleteWebhook':
      return okResult(true);
    case 'setWebhook':
      return okResult(true);
    case 'setMyCommands':
      return okResult(true);
    case 'getUpdates': {
      const offset = Number(params.offset || 0);
      if (offset > 0) {
        state.updates = state.updates.filter((update) => update.update_id >= offset);
      }
      const timeoutSec = Number(params.timeout || 0);
      const pending = () => state.updates.filter((update) => update.update_id >= (offset || 0));
      let found = pending();
      if (found.length === 0 && timeoutSec > 0) {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, Math.min(timeoutSec, 30) * 1000);
          const wake = () => {
            clearTimeout(timer);
            resolve();
          };
          state.waiters.push(wake);
        });
        found = pending();
      }
      return okResult(found);
    }
    case 'sendMessage': {
      const message = {
        message_id: state.nextMessageId++,
        date: Math.floor(Date.now() / 1000),
        chat: { id: Number(params.chat_id), type: 'private' },
        text: String(params.text ?? ''),
      };
      state.outbound.push({
        method: 'sendMessage',
        chat_id: String(params.chat_id),
        text: message.text,
        reply_to_message_id: params.reply_to_message_id,
      });
      return okResult(message);
    }
    case 'sendVoice': {
      const files = params.__files || [];
      const message = {
        message_id: state.nextMessageId++,
        date: Math.floor(Date.now() / 1000),
        chat: { id: Number(params.chat_id), type: 'private' },
      };
      state.outbound.push({
        method: 'sendVoice',
        chat_id: String(params.chat_id),
        caption: params.caption ? String(params.caption) : undefined,
        files,
      });
      return okResult(message);
    }
    case 'sendPhoto': {
      const files = params.__files || [];
      const message = {
        message_id: state.nextMessageId++,
        date: Math.floor(Date.now() / 1000),
        chat: { id: Number(params.chat_id), type: 'private' },
      };
      state.outbound.push({
        method: 'sendPhoto',
        chat_id: String(params.chat_id),
        caption: params.caption ? String(params.caption) : undefined,
        files,
      });
      return okResult(message);
    }
    case 'answerCallbackQuery': {
      state.outbound.push({
        method: 'answerCallbackQuery',
        callback_query_id: String(params.callback_query_id ?? ''),
        text: params.text ? String(params.text) : undefined,
      });
      return okResult(true);
    }
    case 'getFile': {
      const fileId = String(params.file_id ?? '');
      const stored = state.files.get(fileId);
      if (!stored) {
        return { ok: false, error_code: 404, description: 'file not found' };
      }
      return okResult({ file_id: fileId, file_path: stored.path, file_size: stored.bytes.length });
    }
    default:
      return { ok: false, error_code: 404, description: `unknown method ${method}` };
  }
}

export function createFakeTelegramServer(options = {}) {
  const token = options.token || DEFAULT_TOKEN;
  const logPath = options.logPath;
  const state = createState(token);
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${HOST}`);
    const body = await readBody(req).catch(() => Buffer.alloc(0));
    const contentType = String(req.headers['content-type'] || '');
    const params = parseParams(req, body, contentType);

    try {
      if (url.pathname === '/_qa/health') {
        json(res, 200, { ok: true, bot: state.bot.username, pending: state.updates.length });
        return;
      }
      if (url.pathname === '/_qa/log') {
        json(res, 200, { ok: true, journal: state.journal });
        return;
      }
      if (url.pathname === '/_qa/outbound') {
        json(res, 200, { ok: true, outbound: state.outbound });
        return;
      }
      if (url.pathname === '/_qa/reset' && req.method === 'POST') {
        state.updates = [];
        state.outbound = [];
        state.journal = [];
        state.waiters.splice(0);
        json(res, 200, { ok: true });
        return;
      }
      if (url.pathname === '/_qa/push' && req.method === 'POST') {
        const kind = params.kind || (params.text ? 'text' : params.photo ? 'photo' : params.voice ? 'voice' : 'raw');
        let update;
        if (kind === 'text') update = pushTextMessage(state, params);
        else if (kind === 'photo') update = pushPhotoMessage(state, params);
        else if (kind === 'voice') update = pushVoiceMessage(state, params);
        else update = pushUpdate(state, params.update || params);
        json(res, 200, { ok: true, update });
        return;
      }

      const fileMatch = url.pathname.match(/^\/file\/bot([^/]+)\/(.+)$/);
      if (fileMatch) {
        if (fileMatch[1] !== token) {
          json(res, 401, { ok: false, error_code: 401, description: 'Unauthorized' });
          return;
        }
        const filePath = fileMatch[2];
        const stored = [...state.files.values()].find((file) => file.path === filePath);
        recordJournal(state, { method: 'GET', path: '/file/bot<redacted-token>/' + filePath }, logPath);
        if (!stored) {
          json(res, 404, { ok: false, error_code: 404, description: 'file not found' });
          return;
        }
        res.writeHead(200, {
          'Content-Type': stored.contentType,
          'Content-Length': stored.bytes.length,
        });
        res.end(stored.bytes);
        return;
      }

      const botMatch = url.pathname.match(/^\/bot([^/]+)\/([A-Za-z]+)$/);
      if (!botMatch) {
        json(res, 404, { ok: false, error_code: 404, description: 'not found' });
        return;
      }
      if (botMatch[1] !== token) {
        json(res, 401, { ok: false, error_code: 401, description: 'Unauthorized' });
        return;
      }
      const method = botMatch[2];
      recordJournal(state, {
        method: req.method,
        apiMethod: method,
        path: url.pathname,
        hasFiles: Array.isArray(params.__files) && params.__files.length > 0,
      }, logPath);
      const result = await handleBotMethod(state, method, params);
      json(res, result.ok ? 200 : (result.error_code || 400), result);
    } catch (error) {
      json(res, 500, {
        ok: false,
        error_code: 500,
        description: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return { server, state, token };
}

export function listenFakeTelegram(options = {}) {
  const { server, state, token } = createFakeTelegramServer(options);
  const requestedPort = options.port === undefined ? 0 : Number(options.port);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(requestedPort, HOST, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : requestedPort;
      const base = `http://${HOST}:${port}`;
      resolve({
        server,
        state,
        token,
        port,
        base,
        close: () => new Promise((done, fail) => {
          wakeWaiters(state);
          server.close((err) => (err ? fail(err) : done()));
        }),
      });
    });
  });
}

const isCli = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  const args = parseArgs(process.argv.slice(2));
  const token = args.token || process.env.FAKE_TELEGRAM_TOKEN || DEFAULT_TOKEN;
  const logPath = args.log || process.env.FAKE_TELEGRAM_LOG || undefined;
  const port = args.port !== undefined ? Number(args.port) : Number(process.env.FAKE_TELEGRAM_PORT || 0);
  const listening = await listenFakeTelegram({ token, logPath, port });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    port: listening.port,
    base: listening.base,
    tokenRedacted: true,
  })}\n`);
  const shutdown = () => {
    listening.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
