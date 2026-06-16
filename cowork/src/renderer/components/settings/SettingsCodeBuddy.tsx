import { useTranslation } from "react-i18next";
import { useState, useEffect, useCallback, useRef } from 'react';
import { Zap, CheckCircle, XCircle, Loader2, RefreshCw, Globe, Server } from 'lucide-react';

interface CodeBuddyConfig {
  enabled: boolean;
  endpoint: string;
  apiKey: string;
  model: string;
  /**
   * Activate Gemini's native server-side Google Search grounding when
   * the active model is Gemini. Persisted in the codebuddy.* config
   * branch and hot-applied via IPC after save.
   */
  geminiGroundingEnabled: boolean;
  /**
   * Activate visual grounding fallback using a Set-of-Marks annotated
   * screenshot and a multimodal LLM call when UI Automation fails.
   */
  visionGroundingEnabled: boolean;
  /**
   * Specific model to use specifically for visual grounding fallback calls.
   */
  visionGroundingModel?: string;
}

interface HealthStatus {
  status: 'unknown' | 'starting' | 'connected' | 'error';
  version?: string;
  models?: string[];
  tools?: number;
  message?: string;
}

interface ConnectionProbeSuccess {
  version: string;
  models: string[];
  tools: number;
}

interface EndpointPreset {
  id: string;
  label: string;
  badge: string;
  endpoint: string;
}

const ENDPOINT_PRESETS: EndpointPreset[] = [
  {
    id: 'local',
    label: 'Local',
    badge: 'Auto-start',
    endpoint: 'http://localhost:3000',
  },
  {
    id: 'darkstar',
    label: 'DARKSTAR',
    badge: 'Remote',
    endpoint: 'http://100.73.222.64:3000',
  },
  {
    id: 'ministar-linux',
    label: 'Ministar Linux',
    badge: 'Remote',
    endpoint: 'http://100.98.18.76:3000',
  },
];

function parseLocalServerEndpoint(endpoint: string): { host: string; port: number } | null {
  try {
    const url = new URL(endpoint);
    const hostname = url.hostname.toLowerCase();
    if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) return null;
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return {
      host: hostname === '::1' ? '::1' : '127.0.0.1',
      port,
    };
  } catch {
    return null;
  }
}

async function wait(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

export function SettingsCodeBuddy() {
    const { t } = useTranslation();
  const [config, setConfig] = useState<CodeBuddyConfig>({
    enabled: false,
    endpoint: 'http://localhost:3000',
    apiKey: '',
    model: '',
    geminiGroundingEnabled: false,
    visionGroundingEnabled: false,
    visionGroundingModel: '',
  });
  const [health, setHealth] = useState<HealthStatus>({ status: 'unknown' });
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelsMessage, setModelsMessage] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const latestConfigRef = useRef(config);

  const updateConfig = useCallback((
    nextConfig: CodeBuddyConfig | ((current: CodeBuddyConfig) => CodeBuddyConfig),
  ) => {
    const next = typeof nextConfig === 'function'
      ? nextConfig(latestConfigRef.current)
      : nextConfig;
    latestConfigRef.current = next;
    setConfig(next);
  }, []);

  useEffect(() => {
    latestConfigRef.current = config;
  }, [config]);

  // Load config on mount
  useEffect(() => {
    window.electronAPI?.config.get().then((appConfig) => {
      const cb = (appConfig as unknown as { codebuddy?: Partial<CodeBuddyConfig> })?.codebuddy;
      if (cb) {
        updateConfig({
          enabled: cb.enabled ?? false,
          endpoint: cb.endpoint || 'http://localhost:3000',
          apiKey: cb.apiKey || '',
          model: cb.model || '',
          geminiGroundingEnabled: cb.geminiGroundingEnabled ?? false,
          visionGroundingEnabled: cb.visionGroundingEnabled ?? false,
          visionGroundingModel: cb.visionGroundingModel || '',
        });
      }
    }).catch(() => {});
  }, [updateConfig]);

  const probeConnection = useCallback(async (): Promise<ConnectionProbeSuccess> => {
    const currentConfig = latestConfigRef.current;
    const codeBuddyApi = window.electronAPI?.codebuddy;
    if (!codeBuddyApi?.probeConnection) {
      throw new Error('Code Buddy connection IPC is unavailable.');
    }
    return codeBuddyApi.probeConnection({
      endpoint: currentConfig.endpoint,
      apiKey: currentConfig.apiKey || undefined,
    });
  }, []);

  const refreshModels = useCallback(async () => {
    setIsLoadingModels(true);
    setModelsMessage('');
    const currentConfig = latestConfigRef.current;
    try {
      const codeBuddyApi = window.electronAPI?.codebuddy;
      if (!codeBuddyApi?.listModels) {
        throw new Error('Code Buddy model discovery IPC is unavailable.');
      }
      const models = (await codeBuddyApi.listModels({
        endpoint: currentConfig.endpoint,
        apiKey: currentConfig.apiKey || undefined,
      })).map((model) => model.id);
      setAvailableModels(models);
      setHealth(h => ({ ...h, models }));
      setModelsMessage(
        models.length > 0
          ? `${models.length} model${models.length > 1 ? 's' : ''} detected.`
          : 'No models exposed by this Code Buddy server.',
      );
    } catch (err) {
      setModelsMessage(err instanceof Error ? err.message : 'Model refresh failed');
      setAvailableModels([]);
    } finally {
      setIsLoadingModels(false);
    }
  }, []);

  const probeAfterStart = useCallback(async (): Promise<ConnectionProbeSuccess> => {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        return await probeConnection();
      } catch (err) {
        lastError = err;
        await wait(500);
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Code Buddy server did not become reachable.');
  }, [probeConnection]);

  const testConnection = useCallback(async () => {
    setIsTesting(true);
    setHealth({ status: 'unknown' });
    try {
      const connected = await probeConnection();
      setHealth({
        status: 'connected',
        version: connected.version,
        models: connected.models,
        tools: connected.tools,
      });
      setAvailableModels(connected.models);
    } catch (initialErr) {
      const localEndpoint = parseLocalServerEndpoint(latestConfigRef.current.endpoint);
      const serverApi = window.electronAPI?.server;
      if (!localEndpoint || !serverApi?.start) {
        setHealth({
          status: 'error',
          message: initialErr instanceof Error ? initialErr.message : 'Connection failed',
        });
        setIsTesting(false);
        return;
      }

      setHealth({
        status: 'starting',
        message: 'Code Buddy is not responding; starting the local backend...',
      });

      const started = await serverApi.start({
        host: localEndpoint.host,
        port: localEndpoint.port,
      });
      if (!started.running) {
        setHealth({
          status: 'error',
          message: started.error || 'Code Buddy backend failed to start.',
        });
        setIsTesting(false);
        return;
      }

      try {
        const connected = await probeAfterStart();
        setHealth({
          status: 'connected',
          version: connected.version,
          models: connected.models,
          tools: connected.tools,
          message: 'Started local Code Buddy backend automatically.',
        });
        setAvailableModels(connected.models);
      } catch (err) {
        setHealth({
          status: 'error',
          message: err instanceof Error ? err.message : 'Connection failed',
        });
      }
    } finally {
      setIsTesting(false);
    }
  }, [probeConnection, probeAfterStart]);

  const saveConfig = useCallback(async () => {
    setIsSaving(true);
    setSavedMsg('');
    const currentCodeBuddyConfig = latestConfigRef.current;
    try {
      const currentConfig = await window.electronAPI?.config.get();
      const base = (currentConfig ?? {}) as unknown as Record<string, unknown>;
      await window.electronAPI?.config.save({
        ...base,
        codebuddy: {
          enabled: currentCodeBuddyConfig.enabled,
          endpoint: currentCodeBuddyConfig.endpoint,
          apiKey: currentCodeBuddyConfig.apiKey || undefined,
          model: currentCodeBuddyConfig.model || undefined,
          geminiGroundingEnabled: currentCodeBuddyConfig.geminiGroundingEnabled,
          visionGroundingEnabled: currentCodeBuddyConfig.visionGroundingEnabled,
          visionGroundingModel: currentCodeBuddyConfig.visionGroundingModel || undefined,
        },
      } as Parameters<NonNullable<typeof window.electronAPI>['config']['save']>[0]);

      // Hot-apply grounding to the live engine adapter so the user
      // doesn't need to restart Cowork to see the toggle take effect
      // on the next turn. Failures here are non-fatal — the toggle is
      // already persisted to config and will apply at next boot.
      try {
        await window.electronAPI?.codebuddy?.setGeminiGrounding?.({
          enabled: currentCodeBuddyConfig.geminiGroundingEnabled,
        });
      } catch {
        /* hot-apply best-effort; persisted setting is the source of truth */
      }

      try {
        await window.electronAPI?.codebuddy?.setVisionGrounding?.({
          enabled: currentCodeBuddyConfig.visionGroundingEnabled,
          model: currentCodeBuddyConfig.visionGroundingModel || undefined,
        });
      } catch {
        /* hot-apply best-effort; persisted setting is the source of truth */
      }

      setSavedMsg('Configuration saved!');
      setTimeout(() => setSavedMsg(''), 3000);
    } catch (err) {
      setSavedMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSaving(false);
    }
  }, []);

  const modelChoices = config.model && !availableModels.includes(config.model)
    ? [config.model, ...availableModels]
    : availableModels;

  const recommendedVisionModels = ['gemini-2.5-flash', 'gpt-4o-mini', 'gemini-1.5-flash', 'gpt-4o'];
  const visionModelChoices = Array.from(new Set([
    ...(config.visionGroundingModel ? [config.visionGroundingModel] : []),
    ...availableModels,
    ...recommendedVisionModels
  ]));

  return (
    <div className="space-y-6" data-testid="settings-codebuddy">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
          <Zap className="w-5 h-5 text-accent" />
          Code Buddy Backend
                          </h3>
        <p className="text-sm text-text-muted mt-1">
          Connect to a Code Buddy server for 110+ tools, MCTSr reasoning, multi-agent orchestration,
                            and TurboQuant local inference.
                          </p>
      </div>

      {/* Enable toggle */}
      <div className="flex items-center justify-between p-4 rounded-lg bg-surface-secondary border border-border-muted">
        <div>
          <p className="text-sm font-medium text-text-primary">{t('settings.enableCodeBuddyBackend', `Enable Code Buddy Backend`)}</p>
          <p className="text-xs text-text-muted mt-0.5">
            Route LLM calls through Code Buddy instead of direct API
                                </p>
        </div>
        <button
          onClick={() => updateConfig(c => ({ ...c, enabled: !c.enabled }))}
          className={`relative w-11 h-6 rounded-full transition-colors ${
            config.enabled ? 'bg-accent' : 'bg-gray-400'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
              config.enabled ? 'translate-x-5' : ''
            }`}
          />
        </button>
      </div>

      {/* Connection settings */}
      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between gap-3 mb-1.5">
            <label className="block text-sm font-medium text-text-primary">
              Server Endpoint
                                      </label>
            <div className="flex flex-wrap justify-end gap-1.5">
              {ENDPOINT_PRESETS.map((preset) => {
                const isActive = config.endpoint.trim().replace(/\/+$/, '') === preset.endpoint;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    data-testid={`codebuddy-endpoint-preset-${preset.id}`}
                    onClick={() => {
                      updateConfig(c => ({ ...c, endpoint: preset.endpoint }));
                      setHealth({ status: 'unknown' });
                      setAvailableModels([]);
                      setModelsMessage('');
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors ${
                      isActive
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-border-muted text-text-secondary hover:bg-surface-hover'
                    }`}
                    title={preset.endpoint}
                  >
                    <Server className="h-3.5 w-3.5" />
                    <span>{preset.label}</span>
                    <span className="rounded bg-surface-secondary px-1 text-[10px] text-text-muted">
                      {preset.badge}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <input
            type="url"
            data-testid="codebuddy-endpoint-input"
            value={config.endpoint}
            onChange={e => {
              updateConfig(c => ({ ...c, endpoint: e.target.value }));
              setHealth({ status: 'unknown' });
              setAvailableModels([]);
              setModelsMessage('');
            }}
            placeholder={t('settings.httpLocalhost3000', `http://localhost:3000`)}
            className="w-full px-3 py-2 rounded-lg bg-background border border-border-muted text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
          <p className="text-xs text-text-muted mt-1">
            Start Code Buddy with: <code className="bg-surface-secondary px-1 rounded">{t('settings.buddyServer', `buddy server`)}</code>
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-primary mb-1.5">
            API Key <span className="text-text-muted">{t('settings.optional', `(optional)`)}</span>
          </label>
          <input
            type="password"
            value={config.apiKey}
            onChange={e => updateConfig(c => ({ ...c, apiKey: e.target.value }))}
            placeholder={t('settings.leaveEmptyForLocalServer', `Leave empty for local server`)}
            className="w-full px-3 py-2 rounded-lg bg-background border border-border-muted text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
        </div>

        <div>
          <div className="flex items-center justify-between gap-3 mb-1.5">
            <label className="block text-sm font-medium text-text-primary">
              Model Override <span className="text-text-muted">{t('settings.optional', `(optional)`)}</span>
            </label>
            <button
              type="button"
              data-testid="codebuddy-models-refresh"
              onClick={() => void refreshModels()}
              disabled={isLoadingModels}
              className="inline-flex items-center gap-1.5 rounded-md border border-border-muted px-2.5 py-1 text-xs text-text-secondary hover:bg-surface-hover disabled:opacity-50"
            >
              {isLoadingModels
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <RefreshCw className="h-3.5 w-3.5" />}
              Models
                                      </button>
          </div>
          {modelChoices.length > 0 ? (
            <select
              data-testid="codebuddy-model-select"
              value={config.model}
              onChange={e => updateConfig(c => ({ ...c, model: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg bg-background border border-border-muted text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
            >
              <option value="">{t('settings.useServerDefault', `Use server default`)}</option>
              {modelChoices.map(model => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              data-testid="codebuddy-model-input"
              value={config.model}
              onChange={e => updateConfig(c => ({ ...c, model: e.target.value }))}
              placeholder={t('settings.usesServerDefaultEGGemi', `Uses server default (e.g. gemini-3.1-flash-lite-preview)`)}
              className="w-full px-3 py-2 rounded-lg bg-background border border-border-muted text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          )}
          {modelsMessage && (
            <p className={`text-xs mt-1 ${
              availableModels.length > 0 ? 'text-green-400' : 'text-text-muted'
            }`}>
              {modelsMessage}
            </p>
          )}
        </div>
      </div>

      {/* Advanced: provider-specific feature flags. Only relevant when
          the Code Buddy backend is enabled — hidden otherwise to keep
          the panel focused on connection setup. */}
      {config.enabled && (
        <div className="space-y-3 pt-3 border-t border-border-muted">
          <h4 className="text-sm font-medium text-text-primary flex items-center gap-2">
            <Globe className="w-4 h-4 text-accent" />
            Advanced
                                </h4>
          <div className="flex items-center justify-between p-4 rounded-lg bg-surface-secondary border border-border-muted">
            <div className="flex-1 min-w-0 mr-4">
              <p className="text-sm font-medium text-text-primary">
                Gemini Google Search grounding
                                            </p>
              <p className="text-xs text-text-muted mt-0.5">
                When the active model is a Gemini family member, let it search
                                              the web server-side and append cited sources to its replies.
                                              Ignored for non-Gemini models — safe to leave on.
                                            </p>
            </div>
            <button
              onClick={() => updateConfig(c => ({ ...c, geminiGroundingEnabled: !c.geminiGroundingEnabled }))}
              className={`shrink-0 relative w-11 h-6 rounded-full transition-colors ${
                config.geminiGroundingEnabled ? 'bg-accent' : 'bg-gray-400'
              }`}
              aria-label="Toggle Gemini Google Search grounding"
              role="switch"
              aria-checked={config.geminiGroundingEnabled}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  config.geminiGroundingEnabled ? 'translate-x-5' : ''
                }`}
              />
            </button>
          </div>

          <div className="p-4 rounded-lg bg-surface-secondary border border-border-muted space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0 mr-4">
                <p className="text-sm font-medium text-text-primary">
                  Visual Grounding Fallback
                                                  </p>
                <p className="text-xs text-text-muted mt-0.5">
                  When standard UI Automation fails to find a control (e.g. custom canvases or Skia),
                                                    take an annotated screenshot (Set-of-Marks) and ask a multimodal vision model to locate it.
                                                  </p>
              </div>
              <button
                onClick={() => updateConfig(c => ({ ...c, visionGroundingEnabled: !c.visionGroundingEnabled }))}
                className={`shrink-0 relative w-11 h-6 rounded-full transition-colors ${
                  config.visionGroundingEnabled ? 'bg-accent' : 'bg-gray-400'
                }`}
                aria-label="Toggle Visual Grounding Fallback"
                role="switch"
                aria-checked={config.visionGroundingEnabled}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    config.visionGroundingEnabled ? 'translate-x-5' : ''
                  }`}
                />
              </button>
            </div>

            {config.visionGroundingEnabled && (
              <div className="pt-3 border-t border-border-muted">
                <label className="block text-xs font-medium text-text-primary mb-1.5">
                  Vision Grounding Model
                                                  </label>
                <select
                  value={config.visionGroundingModel || ''}
                  onChange={e => updateConfig(c => ({ ...c, visionGroundingModel: e.target.value }))}
                  className="w-full px-3 py-1.5 rounded-lg bg-background border border-border-muted text-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-accent/40"
                >
                  <option value="">{t('settings.useServerDefault', `Use server default`)}</option>
                  {visionModelChoices.map(model => (
                    <option key={model} value={model}>
                      {model} {recommendedVisionModels.includes(model) ? '(Recommended)' : ''}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-text-muted mt-1">
                  Fallback calls require a multimodal (vision-capable) model like Gemini Flash or GPT-4o-mini.
                                                  </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Test connection */}
      <div className="flex gap-3">
        <button
          onClick={testConnection}
          data-testid="codebuddy-test-connection"
          disabled={isTesting}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-secondary border border-border-muted text-text-primary text-sm hover:bg-surface-hover transition-colors disabled:opacity-50"
        >
          {isTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Test Connection
                          </button>
        <button
          onClick={saveConfig}
          data-testid="codebuddy-save"
          disabled={isSaving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white text-sm hover:bg-accent/90 transition-colors disabled:opacity-50"
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Save
                          </button>
        {savedMsg && (
          <span className={`self-center text-sm ${savedMsg.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>
            {savedMsg}
          </span>
        )}
      </div>

      {/* Connection status */}
      {health.status !== 'unknown' && (
        <div className={`p-4 rounded-lg border ${
          health.status === 'connected'
            ? 'bg-green-500/10 border-green-500/30'
            : health.status === 'starting'
              ? 'bg-accent/10 border-accent/30'
            : 'bg-red-500/10 border-red-500/30'
        }`}>
          <div className="flex items-center gap-2 mb-2">
            {health.status === 'connected'
              ? <CheckCircle className="w-5 h-5 text-green-400" />
              : health.status === 'starting'
                ? <Loader2 className="w-5 h-5 text-accent animate-spin" />
              : <XCircle className="w-5 h-5 text-red-400" />
            }
            <span className="font-medium text-sm text-text-primary">
              {health.status === 'connected'
                ? 'Connected to Code Buddy'
                : health.status === 'starting'
                  ? 'Starting Code Buddy'
                  : 'Connection Failed'}
            </span>
          </div>
          {health.status === 'connected' && (
            <div className="text-xs text-text-muted space-y-1 ml-7">
              {health.version && <p>{t('settings.version', `Version:`)}{health.version}</p>}
              {health.tools ? <p>{t('settings.tools', `Tools:`)}{health.tools} available</p> : null}
              {health.models && health.models.length > 0 && (
                <p>{t('settings.models1', `Models:`)}{health.models.slice(0, 5).join(', ')}{health.models.length > 5 ? ` +${health.models.length - 5} more` : ''}</p>
              )}
            </div>
          )}
          {health.status === 'starting' && health.message && (
            <p className="text-xs text-text-muted ml-7">{health.message}</p>
          )}
          {health.status === 'connected' && health.message && (
            <p className="text-xs text-green-400 ml-7">{health.message}</p>
          )}
          {health.status === 'error' && health.message && (
            <p className="text-xs text-red-400 ml-7">{health.message}</p>
          )}
        </div>
      )}

      {/* Features info */}
      {config.enabled && (
        <div className="p-4 rounded-lg bg-accent/5 border border-accent/20">
          <p className="text-sm font-medium text-text-primary mb-2">{t('settings.whenEnabledYouGet', `When enabled, you get:`)}</p>
          <ul className="text-xs text-text-muted space-y-1">
            <li>{t('settings.110ToolsFileOpsSearch', `• 110+ tools (file ops, search, git, web, code analysis, documents)`)}</li>
            <li>{t('settings.mCTSrReasoningTreeOfTho', `• MCTSr reasoning (Tree-of-Thought + Monte Carlo search)`)}</li>
            <li>{t('settings.15LLMProvidersGeminiCl', `• 15 LLM providers (Gemini, Claude, GPT, Grok, Ollama, vLLM...)`)}</li>
            <li>{t('settings.multiAgentOrchestrationS', `• Multi-agent orchestration (spawn, send, wait, close, resume)`)}</li>
            <li>{t('settings.turboQuantLocalInference', `• TurboQuant local inference (4-8x KV cache compression)`)}</li>
            <li>{t('settings.documentGenerationPPTXD', `• Document generation (PPTX, DOCX, XLSX, PDF) — native TypeScript`)}</li>
            <li>{t('settings.gUIAutomationScreenshot', `• GUI automation (screenshot, click, type, key combos)`)}</li>
          </ul>
        </div>
      )}
    </div>
  );
}
