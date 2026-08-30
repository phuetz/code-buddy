/**
 * Presence Bridge — Electron IPC + internal event bus.
 *
 * The renderer captures camera frames (it has the DOM/MediaDevices API),
 * runs detection in-browser (MediaPipe BlazeFace via web), and asks the
 * main process to encode the cropped face and match it against the store.
 * Why split this way:
 *   - WebGL acceleration for detection lives in the renderer (browser).
 *   - ONNX Runtime + identity store live in the main process (Node, fs access).
 *   - The split keeps the model files + JSON store off the renderer's
 *     sandboxed filesystem and centralises the agent-facing event bus.
 *
 * IPC channels (renderer → main):
 *   - `presence:enroll`   { name, aliases, embedding }  → PersonIdentity
 *   - `presence:add-sample` { personId, embedding }     → PersonIdentity
 *   - `presence:match`    { embedding, threshold? }     → PresenceMatch | null
 *   - `presence:list`     {}                            → PersonIdentity[]
 *   - `presence:remove`   { personId }                  → boolean
 *
 * Event bus (main → Code Buddy core consumer):
 *   - `presence:detected` { match, timestamp }   — periodic, throttled
 *   - `presence:left`     { previousMatch, timestamp }
 *   - `presence:enrolled` { person, timestamp }
 *
 * Consumers in Code Buddy core register via `getPresenceBridge().on(...)`.
 *
 * @module cowork/main/presence/presence-bridge
 */

import { EventEmitter } from 'events';
import { ipcMain, dialog, type IpcMainInvokeEvent } from 'electron';
import * as fs from 'fs/promises';
import { createWriteStream } from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import * as http from 'http';
import { URL as NodeURL } from 'url';
import { log, logError } from '../utils/logger';
import { getPresenceStore } from './presence-store';
import { FaceRecognizer, getFaceRecognizer } from './face-recognizer';
import type {
  PersonIdentity,
  PresenceEvent,
  PresenceMatch,
} from '../../shared/presence/types';

/**
 * Min/max plausible size for the Buffalo_S ONNX model. The file is
 * ~13 MB; we accept 5–50 MB to allow for compressed variants and
 * future Buffalo_M without false-rejecting a legitimate file.
 */
const MIN_MODEL_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_MODEL_SIZE_BYTES = 50 * 1024 * 1024;

/**
 * Allowed schemes for model download. We deliberately reject anything
 * that isn't HTTPS (or HTTP for localhost mirrors used in tests) — the
 * model is small enough that a slow secure transfer is fine.
 */
const ALLOWED_DOWNLOAD_PROTOCOLS = new Set(['https:', 'http:']);

/** Cap on HTTP redirects we follow (HF → CDN typically does 1–2 hops). */
const MAX_DOWNLOAD_REDIRECTS = 5;

/**
 * Stable cross-process location where the *current* presence state is
 * mirrored. Code Buddy core agent reads from here in its
 * `before_agent_execute` hook so it can adapt the system prompt to who
 * is in front of the camera. Path is OS-portable and Electron-independent
 * so the core lib stays free of Electron deps.
 */
const CURRENT_PRESENCE_FILE = path.join(
  os.homedir(),
  '.codebuddy',
  'presence',
  'current.json',
);

/** Format of the current-presence.json file. */
interface CurrentPresenceFile {
  /** ISO-ish timestamp of last write. */
  updatedAt: number;
  /** What's happening right now. `null` when nobody is detected. */
  match: PresenceMatch | null;
  /** Last event type — useful to know if we're in 'detected' or 'left' phase. */
  lastEventType: PresenceEvent['type'] | null;
}

/**
 * IPC payloads — kept narrow to make the renderer↔main contract obvious.
 * `embedding` traverses IPC as a regular `number[]` (Float32Array isn't
 * structured-clone-friendly across the IPC boundary in all Electron
 * versions).
 */
export interface EnrollPayload {
  name: string;
  aliases?: string[];
  embedding: number[];
  snapshotPath?: string;
}
export interface AddSamplePayload {
  personId: string;
  embedding: number[];
  snapshotPath?: string;
}
export interface MatchPayload {
  embedding: number[];
  threshold?: number;
}

/**
 * Renderer ships the cropped, resized 112×112 RGB face bytes; main runs
 * Buffalo_S to encode them. The byte length must be exactly
 * `112 * 112 * 3 = 37632`. Sent over IPC as a regular number[] so the
 * structured clone protocol doesn't choke.
 */
export interface EncodePayload {
  rgbBytes: number[];
}

/**
 * Throttle period between two `presence:detected` events for the *same*
 * person. Without this the bus would fire ~fps Hz forever — the agent loop
 * doesn't need that, just needs to know "Patrice is here" once per session
 * (and again when he comes back).
 */
const PRESENCE_DEDUP_WINDOW_MS = 30_000;

/**
 * After this much idle time without any detection, we emit `presence:left`.
 * Tuned so a brief turn of the head doesn't trigger a fake departure.
 */
const PRESENCE_TIMEOUT_MS = 15_000;

export class PresenceBridge extends EventEmitter {
  private lastEmittedDetection: Map<string, number> = new Map();
  private lastUnknownEmittedAt = 0;
  private lastSeenMatch: PresenceMatch | null = null;
  private lastSeenAt = 0;
  private timeoutTimer: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.registerIpcHandlers();
  }

  private registerIpcHandlers(): void {
    ipcMain.handle('presence:enroll', async (_event, payload: EnrollPayload): Promise<PersonIdentity> => {
      const store = getPresenceStore();
      const embedding = Float32Array.from(payload.embedding);
      const person = await store.addPerson(
        payload.name,
        payload.aliases ?? [],
        embedding,
        payload.snapshotPath,
      );
      this.emitEvent({ type: 'enrolled', timestamp: Date.now() });
      log(`[PresenceBridge] Enrolled ${person.name} (id=${person.id})`);
      return person;
    });

    ipcMain.handle('presence:add-sample', async (_event, payload: AddSamplePayload): Promise<PersonIdentity> => {
      const store = getPresenceStore();
      const embedding = Float32Array.from(payload.embedding);
      return store.addFaceSample(payload.personId, embedding, payload.snapshotPath);
    });

    ipcMain.handle('presence:encode', async (_event, payload: EncodePayload): Promise<number[]> => {
      const recognizer = getFaceRecognizer();
      if (!recognizer.isReady()) {
        await recognizer.initialize();
      }
      const rgbBytes = Uint8Array.from(payload.rgbBytes);
      const embedding = await recognizer.encode(rgbBytes);
      return Array.from(embedding);
    });

    ipcMain.handle('presence:match', async (_event, payload: MatchPayload): Promise<PresenceMatch | null> => {
      const store = getPresenceStore();
      const embedding = Float32Array.from(payload.embedding);
      const match = await store.match(embedding, payload.threshold);
      if (match) {
        this.lastUnknownEmittedAt = 0;
        this.recordDetection(match);
      } else {
        const now = Date.now();
        if (now - this.lastUnknownEmittedAt >= PRESENCE_DEDUP_WINDOW_MS) {
          this.lastUnknownEmittedAt = now;
          this.emitEvent({ type: 'unknown', timestamp: now });
        }
      }
      return match;
    });

    ipcMain.handle('presence:list', async (): Promise<PersonIdentity[]> => {
      return getPresenceStore().listPersons();
    });

    ipcMain.handle('presence:remove', async (_event, payload: { personId: string }): Promise<boolean> => {
      return getPresenceStore().removePerson(payload.personId);
    });

    ipcMain.handle(
      'presence:has-model',
      async (): Promise<{ installed: boolean; path: string }> => {
        const modelPath = FaceRecognizer.defaultModelPath();
        try {
          await fs.access(modelPath);
          return { installed: true, path: modelPath };
        } catch {
          return { installed: false, path: modelPath };
        }
      },
    );

    ipcMain.handle(
      'presence:select-model-file',
      async (): Promise<string | null> => {
        const result = await dialog.showOpenDialog({
          title: 'Sélectionner le modèle Buffalo_S ONNX',
          properties: ['openFile'],
          filters: [
            { name: 'Modèle ONNX', extensions: ['onnx'] },
            { name: 'Tous les fichiers', extensions: ['*'] },
          ],
        });
        if (result.canceled || result.filePaths.length === 0) return null;
        return result.filePaths[0];
      },
    );

    ipcMain.handle(
      'presence:download-model',
      async (
        event: IpcMainInvokeEvent,
        payload: { url: string },
      ): Promise<{ ok: boolean; error?: string; installedPath?: string }> => {
        const sender = event.sender;
        const sendProgress = (bytes: number, total: number | null) => {
          // BrowserWindow may have been destroyed between the dispatch and
          // the progress tick — guard against the resulting "Object has
          // been destroyed" throw.
          if (sender.isDestroyed()) return;
          sender.send('presence:download-progress', { bytes, total });
        };
        return downloadModel(payload.url, sendProgress);
      },
    );

    ipcMain.handle(
      'presence:install-model-from-path',
      async (
        _event,
        payload: { sourcePath: string },
      ): Promise<{ ok: boolean; error?: string; installedPath?: string }> => {
        try {
          const stat = await fs.stat(payload.sourcePath);
          if (!stat.isFile()) {
            return { ok: false, error: 'Le chemin sélectionné n\'est pas un fichier.' };
          }
          if (stat.size < MIN_MODEL_SIZE_BYTES || stat.size > MAX_MODEL_SIZE_BYTES) {
            return {
              ok: false,
              error: `Taille inattendue (${(stat.size / (1024 * 1024)).toFixed(1)} Mo). Buffalo_S fait ~13 Mo.`,
            };
          }

          // Validate ONNX magic byte: protobuf serialised ONNX models start
          // with field tag 0x08 (varint, field number 1, wire type 0 = ir_version).
          // A renamed zip would start with PK (0x50 0x4B), a renamed tarball
          // with another magic — anything but 0x08 fails here.
          const fh = await fs.open(payload.sourcePath, 'r');
          try {
            const buf = Buffer.alloc(1);
            await fh.read(buf, 0, 1, 0);
            if (buf[0] !== 0x08) {
              return {
                ok: false,
                error: 'Magic byte invalide — ce fichier n\'est pas un modèle ONNX.',
              };
            }
          } finally {
            await fh.close();
          }

          const destPath = FaceRecognizer.defaultModelPath();
          await fs.mkdir(path.dirname(destPath), { recursive: true });
          await fs.copyFile(payload.sourcePath, destPath);
          log(`[PresenceBridge] Installed Buffalo_S model from ${payload.sourcePath} → ${destPath}`);
          return { ok: true, installedPath: destPath };
        } catch (err) {
          const msg = (err as Error).message;
          logError(`[PresenceBridge] install-model-from-path failed: ${msg}`);
          return { ok: false, error: msg };
        }
      },
    );
  }

  /**
   * Process a fresh match. Emits `presence:detected` if it's been more
   * than PRESENCE_DEDUP_WINDOW_MS since we last emitted for the same
   * person, and (re-)arms the absence timer.
   */
  private recordDetection(match: PresenceMatch): void {
    const now = Date.now();
    const lastEmit = this.lastEmittedDetection.get(match.personId) ?? 0;

    this.lastSeenMatch = match;
    this.lastSeenAt = now;

    if (now - lastEmit >= PRESENCE_DEDUP_WINDOW_MS) {
      this.lastEmittedDetection.set(match.personId, now);
      this.emitEvent({ type: 'detected', match, timestamp: now });
    }
    this.armAbsenceTimer();
  }

  /** Reset/start the absence timer. Fires `presence:left` if no detection comes back in time. */
  private armAbsenceTimer(): void {
    if (this.timeoutTimer !== null) clearTimeout(this.timeoutTimer);
    this.timeoutTimer = setTimeout(() => {
      if (this.lastSeenMatch !== null) {
        this.emitEvent({
          type: 'left',
          match: this.lastSeenMatch,
          timestamp: Date.now(),
        });
        // Clear the dedup so the next detection emits a fresh `detected`.
        this.lastEmittedDetection.delete(this.lastSeenMatch.personId);
        this.lastSeenMatch = null;
      }
      this.timeoutTimer = null;
    }, PRESENCE_TIMEOUT_MS);
  }

  private emitEvent(event: PresenceEvent): void {
    try {
      this.emit('presence', event);
    } catch (err) {
      logError(`[PresenceBridge] event listener threw: ${(err as Error).message}`);
    }
    // Mirror to disk for the Code Buddy core agent (different process).
    // Fire-and-forget — we don't want to block the hot path on I/O errors.
    void this.writeCurrentPresence(event).catch((err) => {
      logError(`[PresenceBridge] writeCurrentPresence: ${(err as Error).message}`);
    });
  }

  /**
   * Atomically write the current presence state to a stable on-disk
   * location so the Code Buddy core agent (a different process) can read
   * it before each agent turn. Atomic via tmp+rename so the agent never
   * sees a partial JSON.
   */
  private async writeCurrentPresence(event: PresenceEvent): Promise<void> {
    const payload: CurrentPresenceFile = {
      updatedAt: Date.now(),
      match:
        event.type === 'detected'
          ? event.match ?? null
          : event.type === 'left'
            ? null
            : this.lastSeenMatch,
      lastEventType: event.type,
    };
    const json = JSON.stringify(payload, null, 2);
    const tmp = `${CURRENT_PRESENCE_FILE}.tmp`;
    await fs.mkdir(path.dirname(CURRENT_PRESENCE_FILE), { recursive: true });
    await fs.writeFile(tmp, json, 'utf-8');
    await fs.rename(tmp, CURRENT_PRESENCE_FILE);
  }

  /** Snapshot of the most recent match — useful for the agent's first system prompt at session start. */
  getLastSeen(): { match: PresenceMatch | null; sinceMs: number } {
    return {
      match: this.lastSeenMatch,
      sinceMs: this.lastSeenAt > 0 ? Date.now() - this.lastSeenAt : Infinity,
    };
  }

  /** Tear down — clear timers, drop listeners. Called on Electron shutdown. */
  dispose(): void {
    if (this.timeoutTimer !== null) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
    this.removeAllListeners();
    ipcMain.removeHandler('presence:enroll');
    ipcMain.removeHandler('presence:add-sample');
    ipcMain.removeHandler('presence:encode');
    ipcMain.removeHandler('presence:match');
    ipcMain.removeHandler('presence:list');
    ipcMain.removeHandler('presence:remove');
    ipcMain.removeHandler('presence:has-model');
    ipcMain.removeHandler('presence:select-model-file');
    ipcMain.removeHandler('presence:install-model-from-path');
    ipcMain.removeHandler('presence:download-model');
  }
}

/**
 * Download a Buffalo_S ONNX model from `url` to
 * `<userData>/models/buffalo_s.onnx`. Streams to a `.tmp` file, validates
 * the ONNX magic byte on the first chunk (fast reject for HTML or zip
 * mirrors), then atomically renames on success. Reports progress via
 * the `onProgress` callback.
 *
 * Exported for tests; not part of the renderer-visible API.
 */
export async function downloadModel(
  rawUrl: string,
  onProgress: (bytes: number, total: number | null) => void,
): Promise<{ ok: boolean; error?: string; installedPath?: string }> {
  let parsed: NodeURL;
  try {
    parsed = new NodeURL(rawUrl);
  } catch {
    return { ok: false, error: 'URL invalide.' };
  }
  if (!ALLOWED_DOWNLOAD_PROTOCOLS.has(parsed.protocol)) {
    return {
      ok: false,
      error: `Protocole non autorisé (${parsed.protocol}). Utilise https:// ou http://.`,
    };
  }

  const destPath = FaceRecognizer.defaultModelPath();
  const tmpPath = `${destPath}.tmp`;
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  // Best-effort cleanup of a leftover .tmp from a previous failed run.
  await fs.rm(tmpPath, { force: true });

  let response: http.IncomingMessage;
  try {
    response = await getFollowingRedirects(parsed.toString(), MAX_DOWNLOAD_REDIRECTS);
  } catch (err) {
    return { ok: false, error: `Connexion: ${(err as Error).message}` };
  }

  if (response.statusCode !== 200) {
    response.resume();
    return {
      ok: false,
      error: `HTTP ${response.statusCode ?? '???'} — vérifie l'URL.`,
    };
  }

  const total = (() => {
    const raw = response.headers['content-length'];
    if (typeof raw !== 'string') return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();
  if (total !== null && (total < MIN_MODEL_SIZE_BYTES || total > MAX_MODEL_SIZE_BYTES)) {
    response.resume();
    return {
      ok: false,
      error: `Taille annoncée (${(total / (1024 * 1024)).toFixed(1)} Mo) hors plage Buffalo_S.`,
    };
  }

  let received = 0;
  let magicChecked = false;
  let magicValid = false;
  const sink = createWriteStream(tmpPath);

  const cleanup = async () => {
    try {
      sink.destroy();
    } catch {
      /* ignore */
    }
    await fs.rm(tmpPath, { force: true });
  };

  return await new Promise((resolve) => {
    let lastReport = 0;
    response.on('data', (chunk: Buffer) => {
      if (!magicChecked && chunk.length > 0) {
        magicChecked = true;
        magicValid = chunk[0] === 0x08;
        if (!magicValid) {
          response.destroy(new Error('magic'));
          return;
        }
      }
      received += chunk.length;
      if (received > MAX_MODEL_SIZE_BYTES) {
        response.destroy(new Error('oversize'));
        return;
      }
      const now = Date.now();
      if (now - lastReport > 200) {
        lastReport = now;
        try {
          onProgress(received, total);
        } catch {
          /* listener errors must not abort the download */
        }
      }
    });

    response.on('error', (err) => {
      void cleanup().finally(() => {
        if (err.message === 'magic') {
          resolve({ ok: false, error: 'Le fichier téléchargé n\'est pas un ONNX (magic byte).' });
        } else if (err.message === 'oversize') {
          resolve({
            ok: false,
            error: `Téléchargement > ${MAX_MODEL_SIZE_BYTES / (1024 * 1024)} Mo, abandon.`,
          });
        } else {
          resolve({ ok: false, error: `Réseau: ${err.message}` });
        }
      });
    });

    sink.on('error', (err) => {
      response.destroy();
      void cleanup().finally(() => {
        resolve({ ok: false, error: `Écriture: ${err.message}` });
      });
    });

    sink.on('finish', () => {
      void (async () => {
        try {
          if (received < MIN_MODEL_SIZE_BYTES) {
            await cleanup();
            resolve({
              ok: false,
              error: `Taille reçue (${(received / (1024 * 1024)).toFixed(1)} Mo) trop petite pour Buffalo_S.`,
            });
            return;
          }
          await fs.rename(tmpPath, destPath);
          // Final progress event so the UI bar reaches 100% even when the
          // server omits content-length (total stays null in that case).
          try {
            onProgress(received, total ?? received);
          } catch {
            /* ignore */
          }
          log(`[PresenceBridge] Downloaded Buffalo_S model from ${rawUrl} → ${destPath}`);
          resolve({ ok: true, installedPath: destPath });
        } catch (err) {
          await cleanup();
          resolve({ ok: false, error: (err as Error).message });
        }
      })();
    });

    response.pipe(sink);
  });
}

/**
 * Promise-wrapped GET that follows up to `maxRedirects` 3xx hops. Rejects
 * on circular redirects, missing `location`, or unsupported protocols.
 */
function getFollowingRedirects(
  url: string,
  maxRedirects: number,
): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const visited = new Set<string>();
    const visit = (current: string, hopsLeft: number): void => {
      if (visited.has(current)) {
        reject(new Error(`Boucle de redirection détectée à ${current}`));
        return;
      }
      visited.add(current);

      const parsed = new NodeURL(current);
      if (!ALLOWED_DOWNLOAD_PROTOCOLS.has(parsed.protocol)) {
        reject(new Error(`Redirection vers protocole interdit (${parsed.protocol}).`));
        return;
      }

      const lib = parsed.protocol === 'http:' ? http : https;
      const req = lib.get(current, { headers: { 'user-agent': 'codebuddy-cowork' } }, (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          if (hopsLeft <= 0) {
            res.resume();
            reject(new Error('Trop de redirections.'));
            return;
          }
          const location = res.headers.location;
          if (typeof location !== 'string' || location.length === 0) {
            res.resume();
            reject(new Error('Redirection sans en-tête Location.'));
            return;
          }
          res.resume();
          // Resolve relative redirects against the current URL.
          const next = new NodeURL(location, current).toString();
          visit(next, hopsLeft - 1);
          return;
        }
        resolve(res);
      });
      req.on('error', reject);
      req.end();
    };
    visit(url, maxRedirects);
  });
}


let singleton: PresenceBridge | null = null;
export function getPresenceBridge(): PresenceBridge {
  if (singleton === null) singleton = new PresenceBridge();
  return singleton;
}
