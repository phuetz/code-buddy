import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import type {
  BrowserWindow,
  DesktopCapturer,
  DisplayMediaRequestHandlerHandlerRequest,
  Session,
  Streams,
  WebContents,
} from 'electron';
import type {
  MeetingLiveCapability,
  MeetingLiveSharedAudioArmResult,
  MeetingLiveSharedAudioReleaseResult,
} from '../../shared/meeting-live';

const ARM_TTL_MS = 15_000;

interface ArmedDisplayCapture {
  webContentsId: number;
  frameTreeNodeId: number;
  expiresAt: number;
}

interface PipeWireLease {
  process: ChildProcess;
  sender: WebContents;
  onSenderDestroyed: () => void;
}

interface SyncCommandResult {
  status: number | null;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
  error?: Error;
}

interface SpawnOptions {
  stdio: 'ignore';
  windowsHide: true;
}

interface SpawnSyncOptions {
  encoding: 'utf8';
  timeout: number;
  windowsHide: true;
  maxBuffer: number;
}

type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

type SpawnSyncProcess = (
  command: string,
  args: readonly string[],
  options: SpawnSyncOptions,
) => SyncCommandResult;

export interface MeetingDisplayAudioOptions {
  platform?: NodeJS.Platform;
  now?: () => number;
  executableExists?: (path: string) => boolean;
  spawnProcess?: SpawnProcess;
  spawnSyncProcess?: SpawnSyncProcess;
  pwLoopbackPath?: string;
  wpctlPath?: string;
}

/**
 * One-shot capability broker for Electron loopback capture.
 *
 * Electron's display-media handler is session-global, so granting requests by
 * origin alone could expose audio to previews/webviews. This broker requires a
 * fresh IPC arm from the canonical main frame and consumes it on the very next
 * user-gesture display request.
 */
export class MeetingDisplayAudioBroker {
  private readonly platform: NodeJS.Platform;
  private readonly now: () => number;
  private readonly executableExists: (path: string) => boolean;
  private readonly spawnProcess: SpawnProcess;
  private readonly spawnSyncProcess: SpawnSyncProcess;
  private readonly pwLoopbackPath: string;
  private readonly wpctlPath: string;
  private readonly pipeWireLeases = new Map<string, PipeWireLease>();
  private armed: ArmedDisplayCapture | null = null;
  private installed = false;

  constructor(options: MeetingDisplayAudioOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.now = options.now ?? Date.now;
    this.executableExists = options.executableExists ?? existsSync;
    this.spawnProcess = options.spawnProcess
      ?? ((command, args, spawnOptions) => spawn(command, [...args], spawnOptions));
    this.spawnSyncProcess = options.spawnSyncProcess
      ?? ((command, args, spawnOptions) => spawnSync(command, [...args], spawnOptions));
    this.pwLoopbackPath = options.pwLoopbackPath
      ?? process.env.CODEBUDDY_PW_LOOPBACK_BIN?.trim()
      ?? '/usr/bin/pw-loopback';
    this.wpctlPath = options.wpctlPath
      ?? process.env.CODEBUDDY_WPCTL_BIN?.trim()
      ?? '/usr/bin/wpctl';
  }

  capability(): MeetingLiveCapability {
    if (this.platform === 'linux') {
      const missing = [this.pwLoopbackPath, this.wpctlPath]
        .filter((path) => !this.executableExists(path));
      if (missing.length > 0) {
        return {
          state: 'unavailable',
          reason: `Capture système Linux indisponible : ${missing.join(', ')} est absent.`,
        };
      }
      return {
        state: 'runtime-probe',
        reason: 'Source PipeWire éphémère, confirmée uniquement lorsqu’une piste audio apparaît.',
      };
    }
    if (this.platform !== 'win32') {
      return {
        state: 'unavailable',
        reason: `La capture audio système n’est pas prise en charge sur ${this.platform}.`,
      };
    }
    if (!this.installed) {
      return {
        state: 'unavailable',
        reason: 'Le handler Electron de partage audio n’est pas initialisé.',
      };
    }
    return {
      state: 'runtime-probe',
      reason: 'Disponible après autorisation utilisateur et vérification d’une piste audio réelle.',
    };
  }

  arm(sender: WebContents, mainWindow: BrowserWindow | null): MeetingLiveSharedAudioArmResult {
    const capability = this.capability();
    if (capability.state === 'unavailable') {
      return { ok: false, state: 'unavailable', error: capability.reason };
    }
    if (!mainWindow || mainWindow.isDestroyed() || sender.id !== mainWindow.webContents.id) {
      return {
        ok: false,
        state: 'unavailable',
        error: 'Le partage audio est réservé à la fenêtre principale Cowork.',
      };
    }
    const frame = sender.mainFrame;
    if (frame.isDestroyed()) {
      return { ok: false, state: 'unavailable', error: 'La fenêtre Meeting Live est fermée.' };
    }
    if (this.platform === 'linux') {
      return this.armPipeWire(sender);
    }
    this.armed = {
      webContentsId: sender.id,
      frameTreeNodeId: frame.frameTreeNodeId,
      expiresAt: this.now() + ARM_TTL_MS,
    };
    return { ok: true, state: 'runtime-probe', method: 'electron-loopback' };
  }

  release(leaseId: string): MeetingLiveSharedAudioReleaseResult {
    const lease = this.pipeWireLeases.get(leaseId);
    if (!lease) return { ok: true };
    this.pipeWireLeases.delete(leaseId);
    lease.sender.removeListener('destroyed', lease.onSenderDestroyed);
    try {
      lease.process.kill('SIGTERM');
      const forceKill = setTimeout(() => {
        if (lease.process.exitCode === null && lease.process.signalCode === null) {
          lease.process.kill('SIGKILL');
        }
      }, 1_000);
      forceKill.unref();
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: `La source PipeWire n’a pas pu être arrêtée : ${cleanError(error)}`,
      };
    }
  }

  dispose(): void {
    for (const leaseId of [...this.pipeWireLeases.keys()]) this.release(leaseId);
    this.armed = null;
  }

  isArmedFor(sender: WebContents): boolean {
    this.expireArm();
    return Boolean(
      this.armed
      && this.armed.webContentsId === sender.id
      && this.armed.frameTreeNodeId === sender.mainFrame.frameTreeNodeId,
    );
  }

  install(electronSession: Session, desktopCapturer: DesktopCapturer): void {
    this.installed = true;
    electronSession.setDisplayMediaRequestHandler((request, callback) => {
      void this.handleRequest(request, callback, desktopCapturer);
    });
  }

  private async handleRequest(
    request: DisplayMediaRequestHandlerHandlerRequest,
    callback: (streams: Streams) => void,
    desktopCapturer: DesktopCapturer,
  ): Promise<void> {
    this.expireArm();
    const arm = this.armed;
    this.armed = null;
    const topFrame = request.frame?.top ?? request.frame;
    if (
      this.platform !== 'win32'
      || !arm
      || !topFrame
      || topFrame.frameTreeNodeId !== arm.frameTreeNodeId
      || !request.userGesture
      || !request.audioRequested
    ) {
      callback({});
      return;
    }
    try {
      // Chromium still requests a display video stream as the transport for
      // getDisplayMedia. The renderer stops that track immediately and records
      // only the locally mixed audio destination.
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 0, height: 0 },
        fetchWindowIcons: false,
      });
      const screen = sources[0];
      if (!screen) {
        callback({});
        return;
      }
      callback({ video: screen, audio: 'loopback' });
    } catch {
      callback({});
    }
  }

  private expireArm(): void {
    if (this.armed && this.armed.expiresAt <= this.now()) this.armed = null;
  }

  private armPipeWire(sender: WebContents): MeetingLiveSharedAudioArmResult {
    for (const [leaseId, lease] of this.pipeWireLeases) {
      if (lease.sender.id === sender.id) this.release(leaseId);
    }
    const sinkResult = this.spawnSyncProcess(
      this.wpctlPath,
      ['inspect', '@DEFAULT_AUDIO_SINK@'],
      {
        encoding: 'utf8',
        timeout: 2_000,
        windowsHide: true,
        maxBuffer: 256 * 1024,
      },
    );
    if (sinkResult.error || sinkResult.status !== 0) {
      return {
        ok: false,
        state: 'unavailable',
        error: `PipeWire ne permet pas d’identifier la sortie audio par défaut : ${cleanError(
          sinkResult.error ?? sinkResult.stderr ?? `wpctl status ${sinkResult.status}`,
        )}`,
      };
    }
    const sinkName = /(?:^|\n)\s*\*?\s*node\.name\s*=\s*"([^"]+)"/u
      .exec(String(sinkResult.stdout ?? ''))?.[1];
    if (!sinkName || sinkName.length > 512 || !/^[-A-Za-z0-9_.:]+$/u.test(sinkName)) {
      return {
        ok: false,
        state: 'unavailable',
        error: 'PipeWire n’a retourné aucun nom de sortie audio exploitable.',
      };
    }

    const leaseId = randomUUID();
    const shortId = leaseId.slice(0, 8);
    const deviceLabel = `CodeBuddy-System-Audio-${shortId}`;
    let child: ChildProcess;
    try {
      child = this.spawnProcess(
        this.pwLoopbackPath,
        [
          '--name',
          `codebuddy-meeting-${shortId}`,
          '--capture',
          sinkName,
          `--playback-props=media.class=Audio/Source node.name=codebuddy_meeting_${shortId} node.description=${deviceLabel}`,
        ],
        { stdio: 'ignore', windowsHide: true },
      );
    } catch (error) {
      return {
        ok: false,
        state: 'unavailable',
        error: `La source PipeWire n’a pas démarré : ${cleanError(error)}`,
      };
    }

    const onSenderDestroyed = () => {
      this.release(leaseId);
    };
    const forgetExitedLease = () => {
      const lease = this.pipeWireLeases.get(leaseId);
      if (!lease || lease.process !== child) return;
      this.pipeWireLeases.delete(leaseId);
      sender.removeListener('destroyed', onSenderDestroyed);
    };
    child.once('error', forgetExitedLease);
    child.once('exit', forgetExitedLease);
    sender.once('destroyed', onSenderDestroyed);
    this.pipeWireLeases.set(leaseId, { process: child, sender, onSenderDestroyed });
    return {
      ok: true,
      state: 'runtime-probe',
      method: 'pipewire-virtual-source',
      leaseId,
      deviceLabel,
    };
  }
}

function cleanError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

export const meetingDisplayAudioBroker = new MeetingDisplayAudioBroker();
