/**
 * Bridges the Cowork « Assistant » panel to the core voice assistant
 * configuration module (`companion/assistant-config.js`). The core owns all
 * env-file parsing, persistence, voice discovery, preview synthesis, and daemon
 * restarts; Cowork only adapts it to IPC.
 */
import { loadCoreModule } from '../utils/core-loader.js';

export type AssistantSettingGroup = 'voice' | 'speech' | 'behavior' | 'companion';
export type AssistantSettingType = 'toggle' | 'enum' | 'text' | 'voice';
export type AssistantEnvFile = 'vision' | 'lisa' | 'both';

export interface AssistantSetting {
  key: string;
  label: string;
  group: AssistantSettingGroup;
  type: AssistantSettingType;
  options?: string[];
  default: string;
  envFile: AssistantEnvFile;
  help: string;
}

export interface AssistantRestartServiceResult {
  service: string;
  ok: boolean;
  error?: string;
}

export interface AssistantErrorResponse {
  ok: false;
  error: string;
}

export interface AssistantConfigSuccessResponse {
  settings: AssistantSetting[];
  values: Record<string, string>;
  voices: string[];
}

export interface AssistantConfigErrorResponse extends AssistantErrorResponse {
  settings: AssistantSetting[];
  values: Record<string, string>;
  voices: string[];
}

export type AssistantConfigResponse = AssistantConfigSuccessResponse | AssistantConfigErrorResponse;

export interface AssistantSaveSuccessResponse {
  vision: string[];
  lisa: string[];
}

export type AssistantSaveResponse = AssistantSaveSuccessResponse | AssistantErrorResponse;

export type AssistantVoicesResponse = string[] | (AssistantErrorResponse & { voices: string[] });

export type AssistantPreviewResponse = string | null | AssistantErrorResponse;

export type AssistantRestartResponse = AssistantRestartServiceResult[] | AssistantErrorResponse;

interface CoreAssistantConfigModule {
  ASSISTANT_SETTINGS?: AssistantSetting[];
  readAssistantConfig?: () => Record<string, string>;
  writeAssistantConfig?: (updates: Record<string, string>) => AssistantSaveSuccessResponse;
  listPocketVoices?: () => string[];
  previewVoice?: (name: string, text?: string) => Promise<string | null>;
  restartAssistantServices?: (
    services: Array<'buddy-vision-brain' | 'lisa-telegram'>
  ) => Promise<AssistantRestartServiceResult[]>;
  getSystemVolume?: () => Promise<number | null>;
  setSystemVolume?: (percent: number) => Promise<boolean>;
}

export type AssistantVolumeResponse = { volume: number | null } | AssistantErrorResponse;
export type AssistantSetVolumeResponse = { ok: true; volume: number } | AssistantErrorResponse;

type CoreLoader = () => Promise<CoreAssistantConfigModule | null>;

const ASSISTANT_DAEMONS = ['buddy-vision-brain', 'lisa-telegram'] as const;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function unavailableConfig(
  message = 'module assistant indisponible (moteur embarqué configuré ?)'
): AssistantConfigErrorResponse {
  return { ok: false, settings: [], values: {}, voices: [], error: message };
}

function unavailable(message: string): AssistantErrorResponse {
  return { ok: false, error: message };
}

export class AssistantService {
  private modPromise?: Promise<CoreAssistantConfigModule | null>;

  constructor(
    private readonly loader: CoreLoader = () =>
      loadCoreModule<CoreAssistantConfigModule>('companion/assistant-config.js')
  ) {}

  private async module(): Promise<CoreAssistantConfigModule | null> {
    this.modPromise ??= this.loader().catch(() => null);
    return this.modPromise;
  }

  async getConfig(): Promise<AssistantConfigResponse> {
    try {
      const mod = await this.module();
      if (!mod?.ASSISTANT_SETTINGS || !mod.readAssistantConfig || !mod.listPocketVoices) {
        return unavailableConfig();
      }

      return {
        settings: mod.ASSISTANT_SETTINGS,
        values: mod.readAssistantConfig(),
        voices: mod.listPocketVoices(),
      };
    } catch (err) {
      return unavailableConfig(errorMessage(err));
    }
  }

  async save(updates: Record<string, string>): Promise<AssistantSaveResponse> {
    try {
      const mod = await this.module();
      if (!mod?.writeAssistantConfig) {
        return unavailable('module assistant indisponible (écriture impossible)');
      }

      return mod.writeAssistantConfig(updates ?? {});
    } catch (err) {
      return unavailable(errorMessage(err));
    }
  }

  async voices(): Promise<AssistantVoicesResponse> {
    try {
      const mod = await this.module();
      if (!mod?.listPocketVoices) {
        return {
          ok: false,
          voices: [],
          error: 'module assistant indisponible (voix indisponibles)',
        };
      }

      return mod.listPocketVoices();
    } catch (err) {
      return { ok: false, voices: [], error: errorMessage(err) };
    }
  }

  async preview(name: string, text?: string): Promise<AssistantPreviewResponse> {
    try {
      const voiceName = (name ?? '').trim();
      if (!voiceName) return unavailable('voix requise');

      const mod = await this.module();
      if (!mod?.previewVoice) {
        return unavailable('module assistant indisponible (aperçu vocal impossible)');
      }

      const sample = (text ?? '').trim();
      return mod.previewVoice(voiceName, sample || undefined);
    } catch (err) {
      return unavailable(errorMessage(err));
    }
  }

  async getVolume(): Promise<AssistantVolumeResponse> {
    try {
      const mod = await this.module();
      if (!mod?.getSystemVolume) return unavailable('module assistant indisponible (volume)');
      return { volume: await mod.getSystemVolume() };
    } catch (err) {
      return unavailable(errorMessage(err));
    }
  }

  async setVolume(percent: number): Promise<AssistantSetVolumeResponse> {
    try {
      const pct = Math.max(0, Math.min(150, Math.round(Number(percent) || 0)));
      const mod = await this.module();
      if (!mod?.setSystemVolume) return unavailable('module assistant indisponible (volume)');
      const ok = await mod.setSystemVolume(pct);
      return ok ? { ok: true, volume: pct } : unavailable('réglage du volume impossible');
    } catch (err) {
      return unavailable(errorMessage(err));
    }
  }

  async restart(): Promise<AssistantRestartResponse> {
    try {
      const mod = await this.module();
      if (!mod?.restartAssistantServices) {
        return unavailable('module assistant indisponible (redémarrage impossible)');
      }

      return mod.restartAssistantServices([...ASSISTANT_DAEMONS]);
    } catch (err) {
      return unavailable(errorMessage(err));
    }
  }
}
