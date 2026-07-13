import { app, ipcMain, type BrowserWindow } from 'electron';
import { join } from 'path';
import { MeetingLiveService } from '../meeting/meeting-live-service';
import {
  MEETING_LIVE_CHANNELS,
  type MeetingLiveCapabilitiesResult,
  type MeetingLiveAppendSegmentInput,
  type MeetingLiveDiscardResult,
  type MeetingLiveListResult,
  type MeetingLivePauseInput,
  type MeetingLiveResult,
  type MeetingLiveResumeInput,
  type MeetingLiveSessionInput,
  type MeetingLiveSharedAudioReleaseInput,
  type MeetingLiveSharedAudioReleaseResult,
  type MeetingLiveStartInput,
} from '../../shared/meeting-live';
import {
  meetingDisplayAudioBroker,
  type MeetingDisplayAudioBroker,
} from '../meeting/meeting-display-audio';

export interface MeetingLiveIpcOptions {
  service?: MeetingLiveService;
  storageRoot?: string;
  displayAudioBroker?: MeetingDisplayAudioBroker;
  getMainWindow?: () => BrowserWindow | null;
}

/** Register the renderer → private local meeting recorder trust boundary. */
export function registerMeetingLiveIpcHandlers(
  options: MeetingLiveIpcOptions = {},
): MeetingLiveService {
  const service = options.service ?? new MeetingLiveService(
    options.storageRoot ?? join(app.getPath('userData'), 'meeting-live'),
  );
  const displayAudioBroker = options.displayAudioBroker ?? meetingDisplayAudioBroker;

  ipcMain.handle(
    MEETING_LIVE_CHANNELS.capabilities,
    async (): Promise<MeetingLiveCapabilitiesResult> => {
      try {
        const diarization = await service.diarizationCapability();
        return {
          ok: true,
          capabilities: {
            microphone: {
              state: 'runtime-probe',
              reason: 'Vérifié uniquement après accord du système et présence d’une piste micro.',
            },
            sharedAudio: displayAudioBroker.capability(),
            localMixing: {
              state: 'runtime-probe',
              reason: 'Vérifié dans le renderer avec AudioContext avant le démarrage.',
            },
            diarization: {
              state: diarization.available ? 'available' : 'unavailable',
              provider: diarization.available ? 'sherpa-onnx' : 'none',
              reason: diarization.reason,
            },
          },
        };
      } catch (error) {
        return {
          ok: false,
          capabilities: unavailableCapabilities(cleanError(error)),
          error: cleanError(error),
        };
      }
    },
  );
  ipcMain.on(MEETING_LIVE_CHANNELS.armSharedAudio, (event) => {
    // Synchronous IPC is intentionally limited to this in-memory arm token:
    // getDisplayMedia must run in the same Chromium user-activation task.
    event.returnValue = displayAudioBroker.arm(
      event.sender,
      options.getMainWindow?.() ?? null,
    );
  });
  ipcMain.handle(
    MEETING_LIVE_CHANNELS.releaseSharedAudio,
    async (event, input?: MeetingLiveSharedAudioReleaseInput): Promise<MeetingLiveSharedAudioReleaseResult> => {
      if (!input?.leaseId) return { ok: false, error: 'Le bail audio partagé est requis.' };
      const mainWindow = options.getMainWindow?.() ?? null;
      if (
        !mainWindow
        || mainWindow.isDestroyed()
        || event.sender.id !== mainWindow.webContents.id
      ) {
        return { ok: false, error: 'Le partage audio est réservé à la fenêtre principale Cowork.' };
      }
      return displayAudioBroker.release(input.leaseId);
    },
  );

  ipcMain.handle(MEETING_LIVE_CHANNELS.list, async (): Promise<MeetingLiveListResult> => {
    try {
      return { ok: true, sessions: await service.list() };
    } catch (error) {
      return listFailure(error);
    }
  });
  ipcMain.handle(
    MEETING_LIVE_CHANNELS.start,
    async (_event, input?: MeetingLiveStartInput): Promise<MeetingLiveResult> => {
      try {
        if (!input) throw new Error('Meeting start payload is required.');
        return { ok: true, session: await service.start(input) };
      } catch (error) {
        return failure(error);
      }
    },
  );
  ipcMain.handle(
    MEETING_LIVE_CHANNELS.appendSegment,
    async (_event, input?: MeetingLiveAppendSegmentInput): Promise<MeetingLiveResult> => {
      try {
        if (!input) throw new Error('Meeting audio checkpoint payload is required.');
        return { ok: true, session: await service.appendSegment(input) };
      } catch (error) {
        return failure(error);
      }
    },
  );
  ipcMain.handle(
    MEETING_LIVE_CHANNELS.pause,
    async (_event, input?: MeetingLivePauseInput): Promise<MeetingLiveResult> => {
      try {
        if (!input) throw new Error('Meeting pause payload is required.');
        return { ok: true, session: await service.pause(input) };
      } catch (error) {
        return failure(error);
      }
    },
  );
  ipcMain.handle(
    MEETING_LIVE_CHANNELS.resume,
    async (_event, input?: MeetingLiveResumeInput): Promise<MeetingLiveResult> => {
      try {
        if (!input) throw new Error('Meeting resume payload is required.');
        return { ok: true, session: await service.resume(input) };
      } catch (error) {
        return failure(error);
      }
    },
  );
  ipcMain.handle(
    MEETING_LIVE_CHANNELS.finalize,
    async (_event, input?: MeetingLiveSessionInput): Promise<MeetingLiveResult> => {
      try {
        if (!input) throw new Error('Meeting finalization payload is required.');
        return { ok: true, session: await service.finalize(input.sessionId) };
      } catch (error) {
        return failure(error);
      }
    },
  );
  ipcMain.handle(
    MEETING_LIVE_CHANNELS.discard,
    async (_event, input?: MeetingLiveSessionInput): Promise<MeetingLiveDiscardResult> => {
      try {
        if (!input) throw new Error('Meeting deletion payload is required.');
        return { ok: true, deleted: await service.discard(input.sessionId) };
      } catch (error) {
        return { ok: false, deleted: false, error: cleanError(error) };
      }
    },
  );

  return service;
}

function failure(error: unknown): MeetingLiveResult {
  return { ok: false, error: cleanError(error), session: null };
}

function listFailure(error: unknown): MeetingLiveListResult {
  return { ok: false, error: cleanError(error), sessions: [] };
}

function cleanError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 800);
}

function unavailableCapabilities(reason: string): MeetingLiveCapabilitiesResult['capabilities'] {
  return {
    microphone: { state: 'unavailable', reason },
    sharedAudio: { state: 'unavailable', reason },
    localMixing: { state: 'unavailable', reason },
    diarization: { state: 'unavailable', provider: 'none', reason },
  };
}
