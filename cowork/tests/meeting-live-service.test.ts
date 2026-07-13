import { createHash } from 'crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, rm } from 'fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeetingLiveService } from '../src/main/meeting/meeting-live-service';
import {
  MEETING_LIVE_CONSENT_STATEMENT,
  type MeetingLiveStartInput,
} from '../src/shared/meeting-live';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const CAPTURE_ID = 'capture-one';
const CONSENT = { accepted: true, statement: MEETING_LIVE_CONSENT_STATEMENT };
const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'meeting-live-'));
  roots.push(root);
  return root;
}

function startInput(overrides: Partial<MeetingLiveStartInput> = {}): MeetingLiveStartInput {
  return {
    title: 'Point équipe',
    language: 'fr',
    consent: CONSENT,
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('MeetingLiveService', () => {
  it('fails closed without the exact participant-consent statement', async () => {
    const service = new MeetingLiveService(await tempRoot(), { createId: () => SESSION_ID });

    await expect(service.start(startInput({
      consent: { accepted: false, statement: MEETING_LIVE_CONSENT_STATEMENT },
    }))).rejects.toThrow(/consent/i);
    await expect(service.start(startInput({
      consent: { accepted: true, statement: 'I agree personally.' },
    }))).rejects.toThrow(/consent/i);
  });

  it('writes SHA-protected atomic checkpoints, is idempotent, and keeps private modes', async () => {
    const root = await tempRoot();
    const service = new MeetingLiveService(root, { createId: () => SESSION_ID });
    const started = await service.start(startInput());
    const bytes = Uint8Array.from([1, 2, 3, 4]);
    const input = {
      sessionId: started.id,
      sequence: 1,
      captureId: CAPTURE_ID,
      mimeType: 'audio/webm;codecs=opus',
      bytes,
      startOffsetMs: 0,
      durationMs: 10_000,
    };

    const checkpointed = await service.appendSegment(input);
    const replayed = await service.appendSegment(input);

    expect(checkpointed).toMatchObject({
      localOnly: true,
      remoteEgress: false,
      totalBytes: 4,
      durationMs: 10_000,
      segments: [{
        sequence: 1,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      }],
    });
    expect(replayed.segments).toHaveLength(1);
    const directoryMode = (await stat(join(root, SESSION_ID))).mode & 0o777;
    const manifestMode = (await stat(join(root, SESSION_ID, 'manifest.json'))).mode & 0o777;
    const segmentMode = (await stat(join(root, SESSION_ID, 'segment-000001.json'))).mode & 0o777;
    expect(directoryMode).toBe(0o700);
    expect(manifestMode).toBe(0o600);
    expect(segmentMode).toBe(0o600);

    await expect(service.appendSegment({ ...input, bytes: Uint8Array.from([9]) }))
      .rejects.toThrow(/different audio/i);
    await expect(service.appendSegment({ ...input, sequence: 3 }))
      .rejects.toThrow(/must be 2/i);
  });

  it('recovers an interrupted recorder and rebuilds a stale manifest from checkpoint envelopes', async () => {
    const root = await tempRoot();
    const service = new MeetingLiveService(root, { createId: () => SESSION_ID });
    await service.start(startInput());
    await service.appendSegment({
      sessionId: SESSION_ID,
      sequence: 1,
      captureId: CAPTURE_ID,
      mimeType: 'audio/webm',
      bytes: Uint8Array.from([5, 6, 7]),
      startOffsetMs: 0,
      durationMs: 8_000,
    });

    const manifestPath = join(root, SESSION_ID, 'manifest.json');
    const stale = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    stale.segments = [];
    stale.totalBytes = 0;
    stale.durationMs = 0;
    await writeFile(manifestPath, `${JSON.stringify(stale)}\n`, { mode: 0o600 });

    const restarted = new MeetingLiveService(root);
    const [recovered] = await restarted.list();

    expect(recovered).toMatchObject({
      status: 'interrupted',
      segments: [{ sequence: 1, bytes: 3 }],
      totalBytes: 3,
      durationMs: 8_000,
    });
    expect(recovered?.lastError).toMatch(/checkpoint/i);
    await expect(restarted.resume({ sessionId: SESSION_ID, consent: CONSENT }))
      .resolves.toMatchObject({ status: 'recording', consentEvents: [{ reason: 'start' }, { reason: 'resume' }] });
  });

  it('turns an abandoned renderer lease into a resumable interruption without restarting main', async () => {
    const root = await tempRoot();
    const service = new MeetingLiveService(root, {
      createId: () => SESSION_ID,
      now: () => new Date('2020-01-01T08:00:00.000Z'),
    });
    await service.start(startInput());

    const [abandoned] = await service.list();

    expect(abandoned).toMatchObject({
      status: 'interrupted',
      lastError: expect.stringMatching(/inactive/i),
    });
  });

  it('finalizes each recoverable capture locally and sends only transcript JSON to Meeting Notes', async () => {
    const root = await tempRoot();
    const transcribedAudio: number[][] = [];
    const generateNotes = vi.fn(async (input: { value: unknown }) => ({
      notes: {
        title: 'Point équipe',
        summary: 'Deux fragments locaux ont été transcrits.',
        decisions: [{}],
        actionItems: [{}, {}],
        openQuestions: [],
        transcript: (input.value as { segments: unknown[] }).segments,
      },
      markdown: '# Point équipe',
      json: '{}',
    }));
    const writeReports = vi.fn(async (output: string, result: { markdown: string; json: string }) => {
      const markdown = `${output}.md`;
      const json = `${output}.json`;
      await mkdir(join(root, SESSION_ID, 'reports'), { recursive: true });
      await Promise.all([
        writeFile(markdown, result.markdown, { mode: 0o600 }),
        writeFile(json, result.json, { mode: 0o600 }),
      ]);
      return { markdown, json };
    });
    const service = new MeetingLiveService(root, {
      createId: () => SESSION_ID,
      transcribeCapture: async (path) => {
        const bytes = [...await readFile(path)];
        transcribedAudio.push(bytes);
        return `Parole ${transcribedAudio.length}`;
      },
      generateNotes,
      writeReports,
    });
    await service.start(startInput());
    await service.appendSegment({
      sessionId: SESSION_ID,
      sequence: 1,
      captureId: CAPTURE_ID,
      mimeType: 'audio/webm',
      bytes: Uint8Array.from([1, 2]),
      startOffsetMs: 0,
      durationMs: 5_000,
    });
    await service.appendSegment({
      sessionId: SESSION_ID,
      sequence: 2,
      captureId: CAPTURE_ID,
      mimeType: 'audio/webm',
      bytes: Uint8Array.from([3]),
      startOffsetMs: 5_000,
      durationMs: 5_000,
    });
    await service.appendSegment({
      sessionId: SESSION_ID,
      sequence: 3,
      captureId: 'capture-two',
      mimeType: 'audio/webm',
      bytes: Uint8Array.from([4, 5]),
      startOffsetMs: 10_000,
      durationMs: 4_000,
    });

    const completed = await service.finalize(SESSION_ID);

    expect(transcribedAudio).toEqual([[1, 2, 3], [4, 5]]);
    expect(generateNotes).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'json',
        value: {
          segments: [
            { startSeconds: 0, endSeconds: 10, text: 'Parole 1' },
            { startSeconds: 10, endSeconds: 14, text: 'Parole 2' },
          ],
        },
      }),
      { language: 'fr', useAI: false },
    );
    expect(completed).toMatchObject({
      status: 'completed',
      output: { decisions: 1, actionItems: 2, transcriptSegments: 2 },
    });
    expect((await stat(completed.output!.markdownPath)).mode & 0o777).toBe(0o600);
    const leftovers = (await readdirNames(join(root, SESSION_ID)))
      .filter((name) => name.includes('.transcribe'));
    expect(leftovers).toEqual([]);
  });

  it('aligns real local diarization turns with timestamped Whisper segments', async () => {
    const root = await tempRoot();
    const generateNotes = vi.fn(async (input: { value: unknown }) => ({
      notes: {
        title: 'Point diarizé',
        summary: 'Deux tours locaux.',
        decisions: [],
        actionItems: [],
        openQuestions: [],
        transcript: (input.value as { segments: unknown[] }).segments,
      },
      markdown: '# Point diarizé',
      json: '{}',
    }));
    const service = new MeetingLiveService(root, {
      createId: () => SESSION_ID,
      transcribeCaptureDetailed: async () => ({
        text: 'Bonjour. Je réponds.',
        segments: [
          { startSeconds: 0, endSeconds: 2, text: 'Bonjour.' },
          { startSeconds: 2, endSeconds: 4, text: 'Je réponds.' },
        ],
      }),
      probeDiarization: async () => ({
        available: true,
        provider: 'sherpa-onnx',
        reason: 'ready',
      }),
      diarizeCapture: async () => ({
        speakerCount: 2,
        segments: [
          { startSeconds: 0, endSeconds: 2, speaker: 0 },
          { startSeconds: 2, endSeconds: 4, speaker: 1 },
        ],
      }),
      generateNotes,
      writeReports: async (output, result) => {
        const markdown = `${output}.md`;
        const json = `${output}.json`;
        await Promise.all([
          writeFile(markdown, result.markdown, { mode: 0o600 }),
          writeFile(json, result.json, { mode: 0o600 }),
        ]);
        return { markdown, json };
      },
    });
    await service.start(startInput({ diarization: true }));
    await service.appendSegment({
      sessionId: SESSION_ID,
      sequence: 1,
      captureId: CAPTURE_ID,
      mimeType: 'audio/webm',
      bytes: Uint8Array.from([1, 2, 3]),
      startOffsetMs: 0,
      durationMs: 4_000,
    });

    const completed = await service.finalize(SESSION_ID);

    expect(generateNotes).toHaveBeenCalledWith(
      expect.objectContaining({
        value: {
          segments: [
            { startSeconds: 0, endSeconds: 2, speaker: 'Locuteur 1', text: 'Bonjour.' },
            { startSeconds: 2, endSeconds: 4, speaker: 'Locuteur 2', text: 'Je réponds.' },
          ],
        },
      }),
      { language: 'fr', useAI: false },
    );
    expect(completed.diarization).toMatchObject({
      status: 'applied',
      provider: 'sherpa-onnx',
      speakerCount: 2,
    });
    expect(completed.output?.diarization.status).toBe('applied');
  });

  it('completes with an explicit non-diarized fallback when Sherpa fails', async () => {
    const root = await tempRoot();
    const generateNotes = vi.fn(async (input: { value: unknown }) => ({
      notes: {
        title: 'Fallback local',
        summary: 'Transcript conservé.',
        decisions: [],
        actionItems: [],
        openQuestions: [],
        transcript: (input.value as { segments: unknown[] }).segments,
      },
      markdown: '# Fallback',
      json: '{}',
    }));
    const service = new MeetingLiveService(root, {
      createId: () => SESSION_ID,
      transcribeCaptureDetailed: async () => ({
        text: 'Texte local.',
        segments: [{ startSeconds: 0, endSeconds: 1, text: 'Texte local.' }],
      }),
      probeDiarization: async () => ({
        available: true,
        provider: 'sherpa-onnx',
        reason: 'ready',
      }),
      diarizeCapture: async () => {
        throw new Error('model execution failed');
      },
      generateNotes,
      writeReports: async (output, result) => {
        const markdown = `${output}.md`;
        const json = `${output}.json`;
        await Promise.all([
          writeFile(markdown, result.markdown, { mode: 0o600 }),
          writeFile(json, result.json, { mode: 0o600 }),
        ]);
        return { markdown, json };
      },
    });
    await service.start(startInput({ diarization: true }));
    await service.appendSegment({
      sessionId: SESSION_ID,
      sequence: 1,
      captureId: CAPTURE_ID,
      mimeType: 'audio/webm',
      bytes: Uint8Array.from([4, 5]),
      startOffsetMs: 0,
      durationMs: 1_000,
    });

    const completed = await service.finalize(SESSION_ID);

    expect(completed.status).toBe('completed');
    expect(completed.diarization).toMatchObject({ status: 'failed', speakerCount: 0 });
    expect(completed.diarization.reason).toMatch(/non diarizé.*model execution failed/i);
    expect(generateNotes).toHaveBeenCalledWith(
      expect.objectContaining({
        value: { segments: [{ startSeconds: 0, endSeconds: 1, text: 'Texte local.' }] },
      }),
      { language: 'fr', useAI: false },
    );
  });

  it('does not claim diarization when speech has zero Sherpa voice clusters', async () => {
    const root = await tempRoot();
    const generateNotes = vi.fn(async (input: { value: unknown }) => ({
      notes: {
        title: 'Fallback sans cluster',
        summary: 'Transcript conservé sans faux locuteur.',
        decisions: [],
        actionItems: [],
        openQuestions: [],
        transcript: (input.value as { segments: unknown[] }).segments,
      },
      markdown: '# Fallback sans cluster',
      json: '{}',
    }));
    const service = new MeetingLiveService(root, {
      createId: () => SESSION_ID,
      transcribeCaptureDetailed: async () => ({
        text: 'Parole détectée.',
        segments: [{ startSeconds: 0, endSeconds: 1, text: 'Parole détectée.' }],
      }),
      probeDiarization: async () => ({
        available: true,
        provider: 'sherpa-onnx',
        reason: 'ready',
      }),
      diarizeCapture: async () => ({ speakerCount: 0, segments: [] }),
      generateNotes,
      writeReports: async (output, result) => {
        const markdown = `${output}.md`;
        const json = `${output}.json`;
        await Promise.all([
          writeFile(markdown, result.markdown, { mode: 0o600 }),
          writeFile(json, result.json, { mode: 0o600 }),
        ]);
        return { markdown, json };
      },
    });
    await service.start(startInput({ diarization: true }));
    await service.appendSegment({
      sessionId: SESSION_ID,
      sequence: 1,
      captureId: CAPTURE_ID,
      mimeType: 'audio/webm',
      bytes: Uint8Array.from([8, 9]),
      startOffsetMs: 0,
      durationMs: 1_000,
    });

    const completed = await service.finalize(SESSION_ID);

    expect(completed.status).toBe('completed');
    expect(completed.diarization).toMatchObject({ status: 'failed', speakerCount: 0 });
    expect(completed.diarization.reason).toMatch(/aucun locuteur.*parole/i);
    expect(generateNotes).toHaveBeenCalledWith(
      expect.objectContaining({
        value: { segments: [{ startSeconds: 0, endSeconds: 1, text: 'Parole détectée.' }] },
      }),
      { language: 'fr', useAI: false },
    );
  });

  it('refuses to delete an active capture and removes an explicitly paused one', async () => {
    const root = await tempRoot();
    const service = new MeetingLiveService(root, { createId: () => SESSION_ID });
    await service.start(startInput());
    await expect(service.discard(SESSION_ID)).rejects.toThrow(/pause/i);
    await service.pause({ sessionId: SESSION_ID, reason: 'user' });
    await expect(service.discard(SESSION_ID)).resolves.toBe(true);
    await expect(stat(join(root, SESSION_ID))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

async function readdirNames(path: string): Promise<string[]> {
  return readdir(path);
}
