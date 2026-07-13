import { createHash, randomUUID } from 'crypto';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
} from 'fs/promises';
import { basename, dirname, extname, join, resolve } from 'path';
import {
  MEETING_LIVE_CONSENT_STATEMENT,
  MEETING_LIVE_SCHEMA_VERSION,
  type MeetingLiveAppendSegmentInput,
  type MeetingLiveCaptureSource,
  type MeetingLiveDiarizationView,
  type MeetingLiveOutput,
  type MeetingLivePauseInput,
  type MeetingLiveResumeInput,
  type MeetingLiveSegmentView,
  type MeetingLiveSessionView,
  type MeetingLiveStartInput,
} from '../../shared/meeting-live';
import { loadCoreModule } from '../utils/core-loader';
import {
  LocalSpeakerDiarizer,
  type LocalDiarizationCapability,
  type LocalDiarizationResult,
} from './local-speaker-diarization';

const MAX_SEGMENT_BYTES = 32 * 1024 * 1024;
const MAX_SESSION_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_SEGMENT_DURATION_MS = 10 * 60 * 1000;
const MAX_SEGMENT_RECORD_BYTES = Math.ceil((MAX_SEGMENT_BYTES * 4) / 3) + 64 * 1024;
const STALE_RECORDING_MS = 45_000;
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CAPTURE_ID_RE = /^[a-z0-9_-]{8,80}$/iu;
const MIME_TYPE_RE = /^audio\/(?:webm|ogg|mp4)(?:;\s*codecs=[a-z0-9.,_-]+)?$/iu;
const LANGUAGE_RE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/iu;

interface MeetingLiveSegmentEnvelope {
  schemaVersion: typeof MEETING_LIVE_SCHEMA_VERSION;
  sessionId: string;
  segment: MeetingLiveSegmentView;
  audioBase64: string;
}

interface MeetingNotesResultShape {
  notes: {
    title: string;
    summary: string;
    decisions: unknown[];
    actionItems: unknown[];
    openQuestions: unknown[];
    transcript: unknown[];
  };
  markdown: string;
  json: string;
}

interface MeetingCoreModule {
  generateMeetingNotes: (
    input: { kind: 'json'; value: unknown; sourceName: string },
    options: { language: string; useAI: false },
  ) => Promise<MeetingNotesResultShape>;
  writeMeetingOutputReports: (
    output: string,
    result: MeetingNotesResultShape,
    options: { overwrite: true },
  ) => Promise<{ markdown: string; json: string }>;
}

interface WhisperCoreModule {
  transcribeFile: (
    path: string,
    options: { language: string; timeoutMs: number },
  ) => Promise<string>;
  transcribeFileDetailed?: (
    path: string,
    options: { language: string; timeoutMs: number },
  ) => Promise<TranscribedCapture>;
}

interface TranscribedSegment {
  startSeconds: number;
  endSeconds: number;
  text: string;
}

interface TranscribedCapture {
  text: string;
  segments: TranscribedSegment[];
}

interface CaptureTranscription extends TranscribedCapture {
  timestamped: boolean;
}

export interface MeetingLiveServiceDependencies {
  now?: () => Date;
  createId?: () => string;
  transcribeCapture?: (path: string, language: string) => Promise<string>;
  transcribeCaptureDetailed?: (
    path: string,
    language: string,
  ) => Promise<TranscribedCapture>;
  probeDiarization?: () => Promise<LocalDiarizationCapability>;
  diarizeCapture?: (path: string) => Promise<LocalDiarizationResult>;
  generateNotes?: MeetingCoreModule['generateMeetingNotes'];
  writeReports?: MeetingCoreModule['writeMeetingOutputReports'];
}

interface CaptureGroup {
  captureId: string;
  mimeType: string;
  segments: MeetingLiveSegmentView[];
}

/**
 * Main-process trust boundary for microphone recordings.
 *
 * Every checkpoint is a self-contained JSON envelope written with an atomic
 * rename. The manifest is only an index and can therefore be rebuilt after a
 * crash by scanning and verifying the SHA-256 protected envelopes.
 */
export class MeetingLiveService {
  private readonly storageRoot: string;
  private readonly deps: MeetingLiveServiceDependencies;
  private readonly diarizer: LocalSpeakerDiarizer;
  private readonly locks = new Map<string, Promise<void>>();
  private initialization: Promise<void> | null = null;

  constructor(storageRoot: string, dependencies: MeetingLiveServiceDependencies = {}) {
    this.storageRoot = resolve(storageRoot);
    this.deps = dependencies;
    this.diarizer = new LocalSpeakerDiarizer();
  }

  async diarizationCapability(): Promise<LocalDiarizationCapability> {
    return this.deps.probeDiarization?.() ?? this.diarizer.probe();
  }

  async list(): Promise<MeetingLiveSessionView[]> {
    await this.initialize();
    const entries = await readdir(this.storageRoot, { withFileTypes: true });
    const sessions: MeetingLiveSessionView[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !SESSION_ID_RE.test(entry.name)) continue;
      try {
        const session = await this.withLock(entry.name, async () => {
          const manifest = await this.readManifest(entry.name);
          const reconciled = await this.reconcileSegments(manifest);
          if (
            reconciled.status === 'recording'
            && Date.now() - Date.parse(reconciled.updatedAt) > STALE_RECORDING_MS
          ) {
            const now = this.isoNow();
            const interrupted: MeetingLiveSessionView = {
              ...reconciled,
              status: 'interrupted',
              interruptedAt: now,
              updatedAt: now,
              lastError: 'Capture inactive détectée. Les checkpoints locaux peuvent être repris.',
            };
            await this.writeManifest(interrupted);
            return interrupted;
          }
          return reconciled;
        });
        sessions.push(session);
      } catch {
        // A corrupt/tampered directory is intentionally not exposed to the
        // renderer. Other valid local recordings remain available.
      }
    }
    return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async start(input: MeetingLiveStartInput): Promise<MeetingLiveSessionView> {
    await this.initialize();
    assertConsent(input.consent);
    const id = this.deps.createId?.() ?? randomUUID();
    assertSessionId(id);
    const now = this.isoNow();
    const captureSources = cleanCaptureSources(input.captureSources);
    const diarization: MeetingLiveDiarizationView = input.diarization
      ? {
          requested: true,
          provider: 'sherpa-onnx',
          status: 'pending',
          speakerCount: 0,
        }
      : {
          requested: false,
          provider: 'none',
          status: 'disabled',
          speakerCount: 0,
          reason: 'Diarisation non demandée.',
        };
    const session: MeetingLiveSessionView = {
      schemaVersion: MEETING_LIVE_SCHEMA_VERSION,
      id,
      title: cleanTitle(input.title),
      language: cleanLanguage(input.language),
      source: sourceLabel(captureSources),
      captureSources,
      status: 'recording',
      localOnly: true,
      remoteEgress: false,
      createdAt: now,
      updatedAt: now,
      consentEvents: [{
        accepted: true,
        statement: MEETING_LIVE_CONSENT_STATEMENT,
        acceptedAt: now,
        reason: 'start',
        actor: 'local-user',
      }],
      segments: [],
      totalBytes: 0,
      durationMs: 0,
      diarization,
    };
    const directory = this.sessionDirectory(id);
    await mkdir(directory, { recursive: false, mode: 0o700 });
    await chmod(directory, 0o700);
    await this.writeManifest(session);
    return cloneSession(session);
  }

  async appendSegment(input: MeetingLiveAppendSegmentInput): Promise<MeetingLiveSessionView> {
    await this.initialize();
    assertSessionId(input.sessionId);
    return this.withLock(input.sessionId, async () => {
      let session = await this.reconcileSegments(await this.readManifest(input.sessionId));
      if (session.status !== 'recording') {
        throw new Error(`Meeting recording is not active (${session.status}).`);
      }
      const audio = normalizeAudioBytes(input.bytes);
      if (audio.byteLength === 0 || audio.byteLength > MAX_SEGMENT_BYTES) {
        throw new Error(`Meeting audio checkpoint must contain 1-${MAX_SEGMENT_BYTES} bytes.`);
      }
      if (!Number.isSafeInteger(input.sequence) || input.sequence <= 0) {
        throw new Error('Meeting audio checkpoint sequence is invalid.');
      }
      const captureId = input.captureId?.trim() ?? '';
      if (!CAPTURE_ID_RE.test(captureId)) throw new Error('Meeting capture id is invalid.');
      const mimeType = input.mimeType?.trim().toLocaleLowerCase() ?? '';
      if (!MIME_TYPE_RE.test(mimeType)) throw new Error('Unsupported meeting audio format.');
      const captureSources = cleanCaptureSources(input.captureSources);
      assertTiming(input.startOffsetMs, input.durationMs);

      const sha256 = digest(audio);
      const existing = session.segments[input.sequence - 1];
      if (existing) {
        if (
          existing.sha256 === sha256
          && existing.captureId === captureId
          && existing.mimeType === mimeType
          && JSON.stringify(existing.captureSources) === JSON.stringify(captureSources)
        ) {
          return cloneSession(session);
        }
        throw new Error(`Meeting checkpoint ${input.sequence} already exists with different audio.`);
      }
      if (input.sequence !== session.segments.length + 1) {
        throw new Error(`Meeting checkpoint sequence must be ${session.segments.length + 1}.`);
      }
      const previous = session.segments.at(-1);
      const previousEnd = previous ? previous.startOffsetMs + previous.durationMs : 0;
      if (input.startOffsetMs + 1_000 < previousEnd) {
        throw new Error('Meeting checkpoint timing overlaps an earlier checkpoint.');
      }
      if (session.totalBytes + audio.byteLength > MAX_SESSION_BYTES) {
        throw new Error('Meeting recording exceeds the 4 GiB local safety limit.');
      }

      const segment: MeetingLiveSegmentView = {
        sequence: input.sequence,
        captureId,
        mimeType,
        bytes: audio.byteLength,
        sha256,
        startOffsetMs: Math.round(input.startOffsetMs),
        durationMs: Math.max(1, Math.round(input.durationMs)),
        captureSources,
        checkpointedAt: this.isoNow(),
      };
      const envelope: MeetingLiveSegmentEnvelope = {
        schemaVersion: MEETING_LIVE_SCHEMA_VERSION,
        sessionId: session.id,
        segment,
        audioBase64: Buffer.from(audio).toString('base64'),
      };
      await atomicWrite(
        this.segmentPath(session.id, segment.sequence),
        `${JSON.stringify(envelope)}\n`,
      );

      session = await this.reconcileSegments(session);
      session.captureSources = mergeCaptureSources(session.captureSources, captureSources);
      session.source = sourceLabel(session.captureSources);
      session.updatedAt = segment.checkpointedAt;
      await this.writeManifest(session);
      return cloneSession(session);
    });
  }

  async pause(input: MeetingLivePauseInput): Promise<MeetingLiveSessionView> {
    await this.initialize();
    assertSessionId(input.sessionId);
    return this.withLock(input.sessionId, async () => {
      const session = await this.reconcileSegments(await this.readManifest(input.sessionId));
      if (session.status === 'paused') return cloneSession(session);
      if (session.status !== 'recording') {
        throw new Error(`Meeting recording cannot be paused from ${session.status}.`);
      }
      session.status = 'paused';
      session.pauseReason = input.reason ?? 'user';
      session.updatedAt = this.isoNow();
      await this.writeManifest(session);
      return cloneSession(session);
    });
  }

  async resume(input: MeetingLiveResumeInput): Promise<MeetingLiveSessionView> {
    await this.initialize();
    assertSessionId(input.sessionId);
    assertConsent(input.consent);
    return this.withLock(input.sessionId, async () => {
      const session = await this.reconcileSegments(await this.readManifest(input.sessionId));
      if (!['paused', 'interrupted', 'failed'].includes(session.status)) {
        throw new Error(`Meeting recording cannot resume from ${session.status}.`);
      }
      const now = this.isoNow();
      session.status = 'recording';
      session.updatedAt = now;
      const captureSources = cleanCaptureSources(input.captureSources);
      session.captureSources = mergeCaptureSources(session.captureSources, captureSources);
      session.source = sourceLabel(session.captureSources);
      delete session.interruptedAt;
      delete session.pauseReason;
      delete session.lastError;
      session.consentEvents.push({
        accepted: true,
        statement: MEETING_LIVE_CONSENT_STATEMENT,
        acceptedAt: now,
        reason: 'resume',
        actor: 'local-user',
      });
      await this.writeManifest(session);
      return cloneSession(session);
    });
  }

  async finalize(sessionId: string): Promise<MeetingLiveSessionView> {
    await this.initialize();
    assertSessionId(sessionId);
    return this.withLock(sessionId, async () => {
      let session = await this.reconcileSegments(await this.readManifest(sessionId));
      if (session.status === 'completed') return cloneSession(session);
      if (!['recording', 'paused', 'interrupted', 'failed'].includes(session.status)) {
        throw new Error(`Meeting recording cannot be finalized from ${session.status}.`);
      }
      if (session.segments.length === 0) throw new Error('No meeting audio was captured.');

      session.status = 'finalizing';
      session.updatedAt = this.isoNow();
      delete session.lastError;
      await this.writeManifest(session);

      const temporaryCaptures: string[] = [];
      try {
        const transcript: Array<{
          startSeconds: number;
          endSeconds: number;
          speaker?: string;
          text: string;
        }> = [];
        const groups = groupCaptures(session.segments);
        const captures: Array<{
          group: CaptureGroup;
          path: string;
          transcription?: CaptureTranscription;
          diarization?: LocalDiarizationResult;
        }> = [];
        for (const group of groups) {
          const extension = extensionForMime(group.mimeType);
          const capturePath = join(
            this.sessionDirectory(session.id),
            `.${group.captureId}.${randomUUID()}.transcribe${extension}`,
          );
          const buffers: Buffer[] = [];
          for (const segment of group.segments) {
            buffers.push(await this.readSegmentAudio(session.id, segment));
          }
          await atomicWrite(capturePath, Buffer.concat(buffers));
          temporaryCaptures.push(capturePath);
          captures.push({ group, path: capturePath });
        }

        // Both faster-whisper and Sherpa-ONNX load sizeable local models. Run
        // capture groups sequentially so repeated pause/resume cycles cannot
        // multiply CPU/RAM usage with one model instance per group.
        for (const capture of captures) {
          capture.transcription = await this.transcribeCaptureDetailed(
            capture.path,
            session.language,
          );
        }

        let diarization = session.diarization;
        if (diarization.requested) {
          const capability = await this.diarizationCapability();
          if (!capability.available) {
            diarization = {
              ...diarization,
              status: 'unavailable',
              speakerCount: 0,
              reason: capability.reason,
            };
          } else {
            try {
              for (const capture of captures) {
                capture.diarization = await (
                  this.deps.diarizeCapture?.(capture.path)
                  ?? this.diarizer.diarize(capture.path)
                );
              }
              const missingVoiceClusters = captures.some((capture) => (
                Boolean(capture.transcription?.text.trim())
                && (capture.diarization?.speakerCount ?? 0) === 0
              ));
              if (missingVoiceClusters) {
                throw new Error(
                  'Sherpa-ONNX n’a détecté aucun locuteur alors que Whisper a détecté de la parole.',
                );
              }
              const missingTimestamps = captures.some((capture) => (
                (capture.diarization?.speakerCount ?? 0) > 1
                && capture.transcription?.timestamped !== true
              ));
              if (missingTimestamps) {
                throw new Error(
                  'Whisper local détaillé est indisponible : plusieurs locuteurs ne peuvent pas être alignés honnêtement.',
                );
              }
              diarization = {
                requested: true,
                provider: 'sherpa-onnx',
                status: 'applied',
                speakerCount: captures.reduce(
                  (total, capture) => total + (capture.diarization?.speakerCount ?? 0),
                  0,
                ),
                reason: 'Tours de parole calculés localement par Sherpa-ONNX.',
              };
            } catch (error) {
              captures.forEach((capture) => delete capture.diarization);
              diarization = {
                ...diarization,
                status: 'failed',
                speakerCount: 0,
                reason: `Diarisation ignorée, transcript non diarizé utilisé : ${cleanError(error)}`,
              };
            }
          }
        }

        captures.forEach((capture, captureIndex) => {
          const transcription = capture.transcription;
          if (!transcription?.text.trim()) return;
          const first = capture.group.segments[0]!;
          const last = capture.group.segments.at(-1)!;
          const captureStart = first.startOffsetMs / 1_000;
          const captureEnd = (last.startOffsetMs + last.durationMs) / 1_000;
          const pieces = transcription.segments.length > 0
            ? transcription.segments
            : [{
                startSeconds: 0,
                endSeconds: Math.max(0, captureEnd - captureStart),
                text: transcription.text,
              }];
          for (const piece of pieces) {
            const speaker = capture.diarization
              ? speakerForInterval(
                  capture.diarization,
                  piece.startSeconds,
                  piece.endSeconds,
                  captureIndex,
                  captures.length,
                )
              : undefined;
            transcript.push({
              startSeconds: captureStart + piece.startSeconds,
              endSeconds: Math.min(captureEnd, captureStart + piece.endSeconds),
              ...(speaker ? { speaker } : {}),
              text: piece.text,
            });
          }
        });
        if (transcript.length === 0) {
          throw new Error('Whisper local did not detect speech in the captured audio.');
        }

        const core = await this.meetingCore();
        const generate = this.deps.generateNotes ?? core.generateMeetingNotes;
        const writeReports = this.deps.writeReports ?? core.writeMeetingOutputReports;
        const result = await generate(
          { kind: 'json', value: { segments: transcript }, sourceName: session.title },
          { language: session.language, useAI: false },
        );
        const reportsDirectory = join(this.sessionDirectory(session.id), 'reports');
        await ensurePrivateDirectory(reportsDirectory);
        await chmod(reportsDirectory, 0o700);
        const targets = await writeReports(
          join(reportsDirectory, 'meeting-notes'),
          result,
          { overwrite: true },
        );
        const output: MeetingLiveOutput = {
          markdownPath: targets.markdown,
          jsonPath: targets.json,
          title: result.notes.title,
          summary: result.notes.summary,
          transcriptSegments: result.notes.transcript.length,
          decisions: result.notes.decisions.length,
          actionItems: result.notes.actionItems.length,
          openQuestions: result.notes.openQuestions.length,
          diarization,
        };
        session = await this.reconcileSegments(await this.readManifest(session.id));
        session.status = 'completed';
        session.diarization = diarization;
        session.output = output;
        session.updatedAt = this.isoNow();
        delete session.lastError;
        delete session.pauseReason;
        await this.writeManifest(session);
        return cloneSession(session);
      } catch (error) {
        session = await this.reconcileSegments(await this.readManifest(session.id));
        session.status = 'failed';
        session.updatedAt = this.isoNow();
        session.lastError = cleanError(error);
        await this.writeManifest(session);
        throw error;
      } finally {
        await Promise.all(temporaryCaptures.map((path) => unlink(path).catch(() => undefined)));
      }
    });
  }

  async discard(sessionId: string): Promise<boolean> {
    await this.initialize();
    assertSessionId(sessionId);
    return this.withLock(sessionId, async () => {
      const session = await this.readManifest(sessionId);
      if (session.status === 'recording' || session.status === 'finalizing') {
        throw new Error('Pause the meeting before deleting its private recording.');
      }
      const directory = await this.ensureSessionDirectory(sessionId);
      await rm(directory, { recursive: true, force: false });
      return true;
    });
  }

  private initialize(): Promise<void> {
    this.initialization ??= this.recoverInterruptedSessions();
    return this.initialization;
  }

  private async recoverInterruptedSessions(): Promise<void> {
    await mkdir(this.storageRoot, { recursive: true, mode: 0o700 });
    const rootInfo = await lstat(this.storageRoot);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
      throw new Error('Meeting Live private storage root is invalid.');
    }
    await chmod(this.storageRoot, 0o700);
    const entries = await readdir(this.storageRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !SESSION_ID_RE.test(entry.name)) continue;
      try {
        let session = await this.reconcileSegments(await this.readManifest(entry.name));
        if (session.status !== 'recording' && session.status !== 'finalizing') continue;
        const now = this.isoNow();
        session = {
          ...session,
          status: 'interrupted',
          interruptedAt: now,
          updatedAt: now,
          lastError: session.status === 'finalizing'
            ? 'Finalisation interrompue. Les checkpoints locaux sont intacts et peuvent être retraités.'
            : 'Capture interrompue. Le dernier checkpoint atomique peut être repris.',
        };
        await this.writeManifest(session);
      } catch {
        // Do not mutate a directory whose manifest or checkpoints fail validation.
      }
    }
  }

  private async reconcileSegments(session: MeetingLiveSessionView): Promise<MeetingLiveSessionView> {
    const directory = await this.ensureSessionDirectory(session.id);
    const entries = await readdir(directory, { withFileTypes: true });
    const paths = entries
      .filter((entry) => entry.isFile() && /^segment-\d{6}\.json$/u.test(entry.name))
      .map((entry) => join(directory, entry.name))
      .sort();
    const segments: MeetingLiveSegmentView[] = [];
    for (const path of paths) {
      const envelope = await readEnvelope(path, session.id);
      if (envelope.segment.sequence !== segments.length + 1) {
        throw new Error('Meeting checkpoints are not contiguous.');
      }
      segments.push(envelope.segment);
    }
    const totalBytes = segments.reduce((total, segment) => total + segment.bytes, 0);
    const last = segments.at(-1);
    const durationMs = last ? last.startOffsetMs + last.durationMs : 0;
    const captureSources = segments.reduce(
      (sources, segment) => mergeCaptureSources(sources, segment.captureSources),
      session.captureSources,
    );
    const source = sourceLabel(captureSources);
    const changed = JSON.stringify(session.segments) !== JSON.stringify(segments)
      || session.totalBytes !== totalBytes
      || session.durationMs !== durationMs
      || JSON.stringify(session.captureSources) !== JSON.stringify(captureSources)
      || session.source !== source;
    if (!changed) return session;
    const reconciled = {
      ...session,
      source,
      captureSources,
      segments,
      totalBytes,
      durationMs,
      updatedAt: this.isoNow(),
    };
    await this.writeManifest(reconciled);
    return reconciled;
  }

  private async readSegmentAudio(
    sessionId: string,
    expected: MeetingLiveSegmentView,
  ): Promise<Buffer> {
    const envelope = await readEnvelope(this.segmentPath(sessionId, expected.sequence), sessionId);
    if (envelope.segment.sha256 !== expected.sha256) {
      throw new Error(`Meeting checkpoint ${expected.sequence} changed after indexing.`);
    }
    return Buffer.from(envelope.audioBase64, 'base64');
  }

  private async readManifest(sessionId: string): Promise<MeetingLiveSessionView> {
    const directory = await this.ensureSessionDirectory(sessionId);
    const path = join(directory, 'manifest.json');
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 * 1024) {
      throw new Error('Meeting manifest is invalid.');
    }
    const stored = JSON.parse(await readFile(path, 'utf8')) as MeetingLiveSessionView;
    const legacyCaptureSources: MeetingLiveCaptureSource[] = stored.source === 'microphone+shared-audio'
      ? ['microphone', 'shared-audio']
      : ['microphone'];
    const parsed: MeetingLiveSessionView = {
      ...stored,
      captureSources: safeStoredCaptureSources(stored.captureSources, legacyCaptureSources),
      segments: Array.isArray(stored.segments)
        ? stored.segments.map((segment) => ({
            ...segment,
            captureSources: safeStoredCaptureSources(
              segment.captureSources,
              legacyCaptureSources,
            ),
          }))
        : stored.segments,
      diarization: normalizeStoredDiarization(stored.diarization),
      ...(stored.output
        ? {
            output: {
              ...stored.output,
              diarization: normalizeStoredDiarization(
                stored.output.diarization ?? stored.diarization,
              ),
            },
          }
        : {}),
    };
    const validStatuses = new Set(['recording', 'paused', 'interrupted', 'finalizing', 'completed', 'failed']);
    if (
      parsed.schemaVersion !== MEETING_LIVE_SCHEMA_VERSION
      || parsed.id !== sessionId
      || parsed.localOnly !== true
      || parsed.remoteEgress !== false
      || (parsed.source !== 'microphone' && parsed.source !== 'microphone+shared-audio')
      || sourceLabel(parsed.captureSources) !== parsed.source
      || !validStatuses.has(parsed.status)
      || !LANGUAGE_RE.test(parsed.language)
      || !parsed.title?.trim()
      || !Array.isArray(parsed.segments)
      || !Array.isArray(parsed.consentEvents)
      || !validDiarization(parsed.diarization)
      || parsed.consentEvents.length === 0
      || parsed.consentEvents.some((event) => (
        event.accepted !== true
        || event.statement !== MEETING_LIVE_CONSENT_STATEMENT
        || event.actor !== 'local-user'
        || (event.reason !== 'start' && event.reason !== 'resume')
        || !Number.isFinite(Date.parse(event.acceptedAt))
      ))
    ) {
      throw new Error('Meeting manifest failed validation.');
    }
    if (parsed.output) {
      const reportsDirectory = join(directory, 'reports');
      const markdownPath = resolve(parsed.output.markdownPath);
      const jsonPath = resolve(parsed.output.jsonPath);
      if (
        !validDiarization(parsed.output.diarization)
        ||
        dirname(markdownPath) !== reportsDirectory
        || dirname(jsonPath) !== reportsDirectory
        || extname(markdownPath).toLocaleLowerCase() !== '.md'
        || extname(jsonPath).toLocaleLowerCase() !== '.json'
      ) {
        throw new Error('Meeting report paths failed validation.');
      }
    }
    return parsed;
  }

  private async writeManifest(session: MeetingLiveSessionView): Promise<void> {
    await this.ensureSessionDirectory(session.id);
    await atomicWrite(
      join(this.sessionDirectory(session.id), 'manifest.json'),
      `${JSON.stringify(session, null, 2)}\n`,
    );
  }

  private async ensureSessionDirectory(sessionId: string): Promise<string> {
    assertSessionId(sessionId);
    const directory = this.sessionDirectory(sessionId);
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error('Meeting recording directory is invalid.');
    }
    const parent = dirname(directory);
    if (parent !== this.storageRoot) throw new Error('Meeting recording escaped private storage.');
    return directory;
  }

  private sessionDirectory(sessionId: string): string {
    assertSessionId(sessionId);
    const directory = resolve(this.storageRoot, sessionId);
    if (dirname(directory) !== this.storageRoot) throw new Error('Meeting session path is invalid.');
    return directory;
  }

  private segmentPath(sessionId: string, sequence: number): string {
    return join(this.sessionDirectory(sessionId), `segment-${String(sequence).padStart(6, '0')}.json`);
  }

  private isoNow(): string {
    const now = this.deps.now?.() ?? new Date();
    if (Number.isNaN(now.getTime())) throw new Error('Meeting clock returned an invalid date.');
    return now.toISOString();
  }

  private async transcribeCaptureDetailed(
    path: string,
    language: string,
  ): Promise<CaptureTranscription> {
    if (this.deps.transcribeCaptureDetailed) {
      const result = await this.deps.transcribeCaptureDetailed(path, language);
      return normalizeTranscription(result, true);
    }
    if (this.deps.transcribeCapture) {
      const text = await this.deps.transcribeCapture(path, language);
      return { text: text.trim(), segments: [], timestamped: false };
    }
    const module = await loadCoreModule<WhisperCoreModule>('voice/local-whisper.js');
    if (!module?.transcribeFile) {
      throw new Error('Whisper local is unavailable. Install the local voice stack, then retry.');
    }
    const options = { language, timeoutMs: 30 * 60 * 1000 };
    if (module.transcribeFileDetailed) {
      return normalizeTranscription(await module.transcribeFileDetailed(path, options), true);
    }
    const text = await module.transcribeFile(path, options);
    return { text: text.trim(), segments: [], timestamped: false };
  }

  private async meetingCore(): Promise<MeetingCoreModule> {
    if (this.deps.generateNotes && this.deps.writeReports) {
      return {
        generateMeetingNotes: this.deps.generateNotes,
        writeMeetingOutputReports: this.deps.writeReports,
      };
    }
    const module = await loadCoreModule<MeetingCoreModule>('meeting/index.js');
    if (!module?.generateMeetingNotes || !module.writeMeetingOutputReports) {
      throw new Error('Meeting Notes core is unavailable. Build Code Buddy core, then retry.');
    }
    return module;
  }

  private async withLock<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(sessionId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(operation);
    const marker = run.then(() => undefined, () => undefined);
    this.locks.set(sessionId, marker);
    try {
      return await run;
    } finally {
      if (this.locks.get(sessionId) === marker) this.locks.delete(sessionId);
    }
  }
}

function cloneSession(session: MeetingLiveSessionView): MeetingLiveSessionView {
  return structuredClone(session);
}

function cleanCaptureSources(
  value: MeetingLiveCaptureSource[] | undefined,
): MeetingLiveCaptureSource[] {
  const requested = value ?? ['microphone'];
  if (!Array.isArray(requested) || requested.length === 0) {
    throw new Error('At least one meeting audio source is required.');
  }
  if (requested.some((source) => source !== 'microphone' && source !== 'shared-audio')) {
    throw new Error('Meeting audio source is invalid.');
  }
  const normalized: MeetingLiveCaptureSource[] = ['microphone'];
  if (requested.includes('shared-audio')) normalized.push('shared-audio');
  if (!requested.includes('microphone')) {
    throw new Error('Microphone must remain enabled when shared audio is mixed.');
  }
  return normalized;
}

function safeStoredCaptureSources(
  value: MeetingLiveCaptureSource[] | undefined,
  fallback: MeetingLiveCaptureSource[],
): MeetingLiveCaptureSource[] {
  return value === undefined ? [...fallback] : cleanCaptureSources(value);
}

function mergeCaptureSources(
  left: MeetingLiveCaptureSource[],
  right: MeetingLiveCaptureSource[],
): MeetingLiveCaptureSource[] {
  return cleanCaptureSources([...left, ...right]);
}

function sourceLabel(
  sources: MeetingLiveCaptureSource[],
): MeetingLiveSessionView['source'] {
  return sources.includes('shared-audio') ? 'microphone+shared-audio' : 'microphone';
}

function normalizeStoredDiarization(
  value: MeetingLiveDiarizationView | undefined,
): MeetingLiveDiarizationView {
  return value ?? {
    requested: false,
    provider: 'none',
    status: 'disabled',
    speakerCount: 0,
    reason: 'Capture créée avant la prise en charge de la diarisation locale.',
  };
}

function validDiarization(value: MeetingLiveDiarizationView): boolean {
  return Boolean(
    value
    && typeof value.requested === 'boolean'
    && (value.provider === 'sherpa-onnx' || value.provider === 'none')
    && ['disabled', 'pending', 'applied', 'unavailable', 'failed'].includes(value.status)
    && Number.isSafeInteger(value.speakerCount)
    && value.speakerCount >= 0
    && (value.reason === undefined || typeof value.reason === 'string'),
  );
}

function normalizeTranscription(
  result: TranscribedCapture,
  timestamped: boolean,
): CaptureTranscription {
  if (!result || typeof result.text !== 'string' || !Array.isArray(result.segments)) {
    throw new Error('Whisper local returned an invalid detailed transcript.');
  }
  const segments = result.segments.map((segment) => {
    if (
      !Number.isFinite(segment.startSeconds)
      || !Number.isFinite(segment.endSeconds)
      || segment.startSeconds < 0
      || segment.endSeconds < segment.startSeconds
      || typeof segment.text !== 'string'
      || !segment.text.trim()
    ) {
      throw new Error('Whisper local returned an invalid timestamped segment.');
    }
    return { ...segment, text: segment.text.trim() };
  });
  return { text: result.text.trim(), segments, timestamped: timestamped && segments.length > 0 };
}

function speakerForInterval(
  diarization: LocalDiarizationResult,
  startSeconds: number,
  endSeconds: number,
  captureIndex: number,
  captureCount: number,
): string | undefined {
  let best: LocalDiarizationResult['segments'][number] | undefined;
  let bestOverlap = 0;
  for (const segment of diarization.segments) {
    const overlap = Math.max(
      0,
      Math.min(endSeconds, segment.endSeconds) - Math.max(startSeconds, segment.startSeconds),
    );
    if (overlap > bestOverlap) {
      best = segment;
      bestOverlap = overlap;
    }
  }
  if (!best && startSeconds === endSeconds) {
    best = diarization.segments.find((segment) => (
      startSeconds >= segment.startSeconds && startSeconds <= segment.endSeconds
    ));
  }
  if (!best) return undefined;
  const speaker = `Locuteur ${best.speaker + 1}`;
  return captureCount > 1 ? `Prise ${captureIndex + 1} · ${speaker}` : speaker;
}

function assertSessionId(sessionId: string): void {
  if (!SESSION_ID_RE.test(sessionId)) throw new Error('Meeting session id is invalid.');
}

function cleanTitle(value: string): string {
  if (typeof value !== 'string') throw new Error('Meeting title is required.');
  const title = value.replace(/\p{Cc}/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (!title || title.length > 160) throw new Error('Meeting title must contain 1-160 characters.');
  return title;
}

function cleanLanguage(value: string | undefined): string {
  const language = value?.trim() || 'fr';
  if (!LANGUAGE_RE.test(language)) throw new Error('Meeting language is invalid.');
  return language.toLocaleLowerCase();
}

function assertConsent(input: { accepted: boolean; statement: string }): void {
  if (input?.accepted !== true || input.statement !== MEETING_LIVE_CONSENT_STATEMENT) {
    throw new Error('Explicit participant recording consent is required.');
  }
}

function normalizeAudioBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) {
    if (value.some((byte: unknown) => (
      typeof byte !== 'number' || !Number.isInteger(byte) || byte < 0 || byte > 255
    ))) {
      throw new Error('Meeting audio bytes are invalid.');
    }
    return Uint8Array.from(value as number[]);
  }
  throw new Error('Meeting audio checkpoint bytes are invalid.');
}

function assertTiming(startOffsetMs: number, durationMs: number): void {
  if (!Number.isFinite(startOffsetMs) || startOffsetMs < 0) {
    throw new Error('Meeting checkpoint start offset is invalid.');
  }
  if (
    !Number.isFinite(durationMs)
    || durationMs < 0
    || durationMs > MAX_SEGMENT_DURATION_MS
  ) {
    throw new Error('Meeting checkpoint duration is invalid.');
  }
}

function digest(bytes: Uint8Array | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readEnvelope(path: string, sessionId: string): Promise<MeetingLiveSegmentEnvelope> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_SEGMENT_RECORD_BYTES) {
    throw new Error(`Meeting checkpoint is invalid: ${basename(path)}`);
  }
  const stored = JSON.parse(await readFile(path, 'utf8')) as MeetingLiveSegmentEnvelope;
  const parsed: MeetingLiveSegmentEnvelope = stored.segment
    ? {
        ...stored,
        segment: {
          ...stored.segment,
          captureSources: safeStoredCaptureSources(
            stored.segment.captureSources,
            ['microphone'],
          ),
        },
      }
    : stored;
  if (
    parsed.schemaVersion !== MEETING_LIVE_SCHEMA_VERSION
    || parsed.sessionId !== sessionId
    || !parsed.segment
    || typeof parsed.audioBase64 !== 'string'
  ) {
    throw new Error(`Meeting checkpoint failed validation: ${basename(path)}`);
  }
  const bytes = Buffer.from(parsed.audioBase64, 'base64');
  if (
    bytes.byteLength !== parsed.segment.bytes
    || bytes.byteLength === 0
    || bytes.byteLength > MAX_SEGMENT_BYTES
    || digest(bytes) !== parsed.segment.sha256
  ) {
    throw new Error(`Meeting checkpoint integrity check failed: ${basename(path)}`);
  }
  if (
    !Number.isSafeInteger(parsed.segment.sequence)
    || parsed.segment.sequence <= 0
    || !CAPTURE_ID_RE.test(parsed.segment.captureId)
    || !MIME_TYPE_RE.test(parsed.segment.mimeType)
    || JSON.stringify(cleanCaptureSources(parsed.segment.captureSources))
      !== JSON.stringify(parsed.segment.captureSources)
  ) {
    throw new Error(`Meeting checkpoint metadata is invalid: ${basename(path)}`);
  }
  if (
    basename(path) !== `segment-${String(parsed.segment.sequence).padStart(6, '0')}.json`
    || !Number.isFinite(Date.parse(parsed.segment.checkpointedAt))
  ) {
    throw new Error(`Meeting checkpoint identity is invalid: ${basename(path)}`);
  }
  assertTiming(parsed.segment.startOffsetMs, parsed.segment.durationMs);
  return parsed;
}

function groupCaptures(segments: MeetingLiveSegmentView[]): CaptureGroup[] {
  const groups: CaptureGroup[] = [];
  const seen = new Set<string>();
  for (const segment of segments) {
    const current = groups.at(-1);
    if (current?.captureId === segment.captureId) {
      if (current.mimeType !== segment.mimeType) {
        throw new Error('A meeting capture changed audio format mid-stream.');
      }
      if (
        JSON.stringify(current.segments[0]?.captureSources)
        !== JSON.stringify(segment.captureSources)
      ) {
        throw new Error('A meeting capture changed audio sources mid-stream.');
      }
      current.segments.push(segment);
      continue;
    }
    if (seen.has(segment.captureId)) {
      throw new Error('A meeting capture id appears in non-contiguous checkpoints.');
    }
    seen.add(segment.captureId);
    groups.push({
      captureId: segment.captureId,
      mimeType: segment.mimeType,
      segments: [segment],
    });
  }
  return groups;
}

function extensionForMime(mimeType: string): string {
  if (mimeType.startsWith('audio/ogg')) return '.ogg';
  if (mimeType.startsWith('audio/mp4')) return '.m4a';
  return '.webm';
}

function cleanError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\p{Cc}/gu, ' ')
    .slice(0, 600);
}

async function atomicWrite(path: string, data: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(data);
    await handle.chmod(0o600);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
    await chmod(path, 0o600);
    await syncDirectory(dirname(path));
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function syncDirectory(path: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, 'r');
    await handle.sync();
  } catch {
    // Directory fsync is not supported on every Electron target. The file was
    // still fsynced before rename, so this is a durability enhancement only.
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error(`Private meeting directory is invalid: ${basename(path)}`);
    }
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : '';
    if (code !== 'ENOENT') throw error;
    await mkdir(path, { recursive: false, mode: 0o700 });
  }
  await chmod(path, 0o700);
}

export function meetingLiveFileExtension(mimeType: string): string {
  return extname(`capture${extensionForMime(mimeType)}`);
}
