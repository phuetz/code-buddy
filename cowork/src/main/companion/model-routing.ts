/**
 * Cowork adapter for the core evidence-backed companion model route.
 * Only explicitly linked Lisa sessions participate; ordinary coding sessions
 * and deliberate per-session model overrides remain untouched.
 */
import type { Session } from '../../renderer/types';
import { isCompanionThreadTags } from '../../shared/companion-thread';
import { loadCoreModule } from '../utils/core-loader';
import { logWarn } from '../utils/logger';
import type { ModelEgress } from '@codebuddy/providers/model-egress';

export interface CoworkCompanionRuntimeConfig {
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface CoworkCompanionModelRoute {
  profileId: string;
  lane: string;
  model: string;
  provider: string;
  apiKey: string;
  baseURL: string;
  egress?: ModelEgress;
  reason: string;
}

export interface CoworkCompanionConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

interface CoreRoutingModule {
  resolveCompanionModelRoute?: (options: {
    surface: 'cowork';
    text: string;
    history: CoworkCompanionConversationTurn[];
    env: NodeJS.ProcessEnv;
  }) => Promise<CoworkCompanionModelRoute | null>;
}

interface CoreConversationBridgeModule {
  CrossChannelConversationBridge?: new (config: CoreConversationBridgeConfig) => {
    history: (limit?: number) => CoworkCompanionConversationTurn[];
    isActive: () => boolean;
  };
  resolveCrossChannelBridgeConfig?: (
    env: Record<string, string | undefined>,
  ) => CoreConversationBridgeConfig;
}

interface CoreConversationBridgeConfig {
  enabled: boolean;
  coworkEnabled: boolean;
}

interface CoreAssistantConfigModule {
  readAssistantConfig?: () => Record<string, string>;
  readAssistantRuntimeEnv?: () => Record<string, string>;
}

type CoreLoader = <T>(relativePath: string) => Promise<T | null>;

export class CoworkCompanionModelRouting {
  constructor(
    private readonly coreLoader: CoreLoader = <T>(relativePath: string) =>
      loadCoreModule<T>(relativePath),
  ) {}

  async resolve(
    session: Session,
    prompt: string,
    runtime: CoworkCompanionRuntimeConfig,
    history?: CoworkCompanionConversationTurn[],
  ): Promise<CoworkCompanionModelRoute | null> {
    if (!isCompanionThreadTags(session.tags)) return null;
    // Session model differs from the current config only when the user chose a
    // deliberate session-level override. Manual intent outranks the pilot.
    if (session.model && session.model !== runtime.model) return null;
    try {
      const [module, sharedHistory] = await Promise.all([
        this.coreLoader<CoreRoutingModule>('conversation/companion-model-routing.js'),
        this.loadSharedHistory(prompt),
      ]);
      const localHistory = this.boundedHistory(history ?? [], prompt);
      const localFingerprints = new Set(localHistory.map((turn) => this.turnFingerprint(turn)));
      const routingHistory = [
        ...sharedHistory.filter((turn) => !localFingerprints.has(this.turnFingerprint(turn))),
        ...localHistory,
      ].slice(-16);
      return (
        (await module?.resolveCompanionModelRoute?.({
          surface: 'cowork',
          text: prompt,
          history: routingHistory,
          env: process.env,
        })) ?? null
      );
    } catch (error) {
      logWarn(
        '[CoworkCompanionRouting] pilot route unavailable:',
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  }

  private async loadSharedHistory(prompt: string): Promise<CoworkCompanionConversationTurn[]> {
    try {
      const [bridgeModule, assistantModule] = await Promise.all([
        this.coreLoader<CoreConversationBridgeModule>('conversation/cross-channel-bridge.js'),
        this.coreLoader<CoreAssistantConfigModule>('companion/assistant-config.js'),
      ]);
      if (
        !bridgeModule?.CrossChannelConversationBridge ||
        !bridgeModule.resolveCrossChannelBridgeConfig
      ) {
        return [];
      }
      const runtimeEnv = assistantModule?.readAssistantRuntimeEnv?.() ?? {};
      const saved = assistantModule?.readAssistantConfig?.() ?? {};
      const env = { ...process.env, ...runtimeEnv, ...saved };
      const config = bridgeModule.resolveCrossChannelBridgeConfig(env);
      if (!config.enabled || !config.coworkEnabled) return [];
      const bridge = new bridgeModule.CrossChannelConversationBridge(config);
      if (!bridge.isActive()) return [];
      return this.boundedHistory(bridge.history(16), prompt);
    } catch {
      return [];
    }
  }

  private boundedHistory(
    history: CoworkCompanionConversationTurn[],
    prompt: string,
  ): CoworkCompanionConversationTurn[] {
    const bounded = history
      .filter(
        (turn): turn is CoworkCompanionConversationTurn =>
          (turn?.role === 'user' || turn?.role === 'assistant') &&
          typeof turn.content === 'string' &&
          Boolean(turn.content.trim()),
      )
      .map((turn) => ({ role: turn.role, content: turn.content.trim() }))
      .slice(-16);
    const latest = bounded.at(-1);
    if (
      latest?.role === 'user' &&
      latest.content.replace(/\s+/g, ' ').toLocaleLowerCase('fr') ===
        prompt.trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr')
    ) {
      bounded.pop();
    }
    return bounded;
  }

  private turnFingerprint(turn: CoworkCompanionConversationTurn): string {
    return `${turn.role}:${turn.content.replace(/\s+/g, ' ').trim().toLocaleLowerCase('fr')}`;
  }
}
