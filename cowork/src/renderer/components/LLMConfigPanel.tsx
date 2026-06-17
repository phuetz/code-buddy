import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  Bot,
  CheckCircle,
  ChevronDown,
  Cloud,
  Cpu,
  Edit3,
  Key,
  Laptop,
  Loader2,
  Plug,
  RefreshCw,
  Save,
  Server,
  ShieldCheck,
  Sparkles,
  Wrench,
} from 'lucide-react';
import type { useApiConfigState } from '../hooks/useApiConfigState';
import type { ApiTestResult, ProviderType } from '../types';
import { CommonProviderSetupsCard, GuidanceInlineHint } from './ProviderGuidance';

type ApiConfigController = ReturnType<typeof useApiConfigState>;

interface ChatGptStatus {
  signedIn: boolean;
  email?: string | null;
  plan_type?: string | null;
  account_id?: string | null;
  is_fedramp?: boolean;
}

interface OAuthResult {
  success: boolean;
  error?: string;
  email?: string | null;
  plan_type?: string | null;
  account_id?: string | null;
  is_fedramp?: boolean;
  signedIn?: boolean;
}

interface LLMAuthActions {
  chatgpt?: {
    login: () => Promise<OAuthResult>;
    clear: () => Promise<OAuthResult>;
    status: () => Promise<OAuthResult>;
  };
  gemini?: {
    login: () => Promise<OAuthResult>;
    clear: () => Promise<OAuthResult>;
  };
}

interface LLMConfigPanelProps {
  controller: ApiConfigController;
  configSetManager?: ReactNode;
  auth?: LLMAuthActions;
  testResult?: ApiTestResult | null;
  friendlyTestDetails?: string;
  testErrorMessage?: (result: ApiTestResult) => string;
  className?: string;
}

const PROVIDER_GROUPS: Array<{
  id: 'primary' | 'local' | 'advanced';
  titleKey: string;
  fallback: string;
  providers: ProviderType[];
}> = [
  {
    id: 'primary',
    titleKey: 'api.llm.primaryProviders',
    fallback: 'Cloud',
    providers: ['chatgpt', 'openrouter', 'openai', 'anthropic', 'gemini', 'grok', 'groq', 'together', 'fireworks', 'mistral'],
  },
  {
    id: 'local',
    titleKey: 'api.llm.localProviders',
    fallback: 'Local',
    providers: ['ollama', 'lmstudio', 'vllm'],
  },
  {
    id: 'advanced',
    titleKey: 'api.llm.advancedProviders',
    fallback: 'Advanced',
    providers: ['custom'],
  },
];

const PROVIDER_ICONS: Record<ProviderType, typeof Bot> = {
  chatgpt: Sparkles,
  openrouter: Cloud,
  openai: Bot,
  anthropic: ShieldCheck,
  gemini: Sparkles,
  ollama: Laptop,
  lmstudio: Cpu,
  custom: Wrench,
  grok: Sparkles,
  groq: Cloud,
  together: Cloud,
  fireworks: Cloud,
  vllm: Cpu,
  mistral: Cloud,
};

const PROVIDER_ORDER: ProviderType[] = [
  'chatgpt',
  'openrouter',
  'openai',
  'anthropic',
  'gemini',
  'grok',
  'groq',
  'together',
  'fireworks',
  'mistral',
  'ollama',
  'lmstudio',
  'vllm',
  'custom',
];

function providerLabel(
  controller: ApiConfigController,
  provider: ProviderType,
  t?: ReturnType<typeof useTranslation>['t']
): string {
  if (provider === 'custom') {
    return t?.('api.moreModels') || controller.presets?.custom?.name || 'Custom';
  }
  return controller.presets?.[provider]?.name || provider;
}

function selectedModelLabel(controller: ApiConfigController): string {
  const selected = controller.useCustomModel ? controller.customModel : controller.model;
  return selected.trim() || controller.modelOptions[0]?.id || '';
}

function endpointLabel(controller: ApiConfigController): string {
  if (controller.provider === 'chatgpt') {
    return 'ChatGPT OAuth';
  }
  if (controller.provider === 'ollama' || controller.provider === 'lmstudio') {
    return controller.baseUrl || controller.currentPreset?.baseUrl || 'Local';
  }
  if (controller.provider === 'custom') {
    return controller.baseUrl || controller.currentPreset?.baseUrl || 'Custom endpoint';
  }
  return controller.currentPreset?.baseUrl || '';
}

function baseUrlPlaceholder(controller: ApiConfigController): string {
  if (controller.provider === 'ollama') {
    return 'http://localhost:11434/v1';
  }
  if (controller.provider === 'lmstudio') {
    return 'http://localhost:1234/v1';
  }
  if (controller.customProtocol === 'openai') {
    return 'https://api.openai.com/v1';
  }
  if (controller.customProtocol === 'gemini') {
    return 'https://generativelanguage.googleapis.com';
  }
  return controller.currentPreset?.baseUrl || 'https://api.anthropic.com';
}

function baseUrlHint(controller: ApiConfigController, t: ReturnType<typeof useTranslation>['t']): string {
  if (controller.provider === 'ollama') {
    return t('api.enterOllamaUrl');
  }
  if (controller.provider === 'lmstudio') {
    return t('api.enterLmStudioUrl');
  }
  if (controller.customProtocol === 'openai') {
    return t('api.enterOpenAIUrl');
  }
  if (controller.customProtocol === 'gemini') {
    return t('api.enterGeminiUrl');
  }
  return t('api.enterAnthropicUrl');
}

function apiKeyHint(controller: ApiConfigController, t: ReturnType<typeof useTranslation>['t']): string {
  return t(`api.llm.keyHint.${controller.provider}`, controller.currentPreset?.keyHint || '');
}

function modelInputHint(controller: ApiConfigController, t: ReturnType<typeof useTranslation>['t']): string {
  return t('api.llm.modelHint', controller.modelInputHint);
}

function AuthNotice({
  kind,
  title,
  body,
}: {
  kind: 'success' | 'error';
  title: string;
  body?: string;
}) {
  const Icon = kind === 'success' ? CheckCircle : AlertCircle;
  const tone = kind === 'success'
    ? 'border-success/30 bg-success/10 text-success'
    : 'border-error/30 bg-error/10 text-error';

  return (
    <div className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${tone}`}>
      <Icon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
      <div className="min-w-0">
        <div className="font-medium">{title}</div>
        {body && <div className="mt-0.5 text-text-secondary">{body}</div>}
      </div>
    </div>
  );
}

export function LLMConfigPanel({
  controller,
  configSetManager,
  auth,
  testResult,
  friendlyTestDetails,
  testErrorMessage,
  className = '',
}: LLMConfigPanelProps) {
  const { t } = useTranslation();
  const [chatgptStatus, setChatgptStatus] = useState<ChatGptStatus>({ signedIn: false });
  const [authNotice, setAuthNotice] = useState<{
    kind: 'success' | 'error';
    title: string;
    body?: string;
  } | null>(null);

  useEffect(() => {
    if (controller.provider === 'chatgpt' && controller.apiKey !== 'oauth-chatgpt') {
      controller.setApiKey('oauth-chatgpt');
    }
  }, [controller]);

  useEffect(() => {
    let cancelled = false;
    if (controller.provider !== 'chatgpt' || !auth?.chatgpt?.status) {
      return () => {
        cancelled = true;
      };
    }

    void auth.chatgpt.status().then((result) => {
      if (cancelled || !result.success) {
        return;
      }
      setChatgptStatus({
        signedIn: Boolean(result.signedIn),
        email: result.email,
        plan_type: result.plan_type,
        account_id: result.account_id,
        is_fedramp: result.is_fedramp,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [auth?.chatgpt, controller.provider]);

  const selectedModel = selectedModelLabel(controller);
  const currentProviderLabel = providerLabel(controller, controller.provider, t);
  const selectedProviderIndex = Math.max(0, PROVIDER_ORDER.indexOf(controller.provider) + 1);
  const showApiKeyMain =
    controller.provider !== 'chatgpt' &&
    !controller.isOllamaMode &&
    !controller.isLmStudioMode;
  const showEndpointMain =
    controller.provider === 'custom' || controller.isOllamaMode || controller.isLmStudioMode;
  const showLocalOptionalKey =
    controller.provider !== 'chatgpt' &&
    (controller.isOllamaMode || controller.isLmStudioMode);
  const saveChoiceDisabled =
    controller.isSaving ||
    !controller.hasUnsavedChanges ||
    (controller.requiresApiKey && !controller.apiKey.trim());
  const testChoiceDisabled =
    controller.isTesting || (controller.requiresApiKey && !controller.apiKey.trim());

  const providerStatus = useMemo(() => {
    if (controller.provider === 'chatgpt') {
      return chatgptStatus.signedIn
        ? t('api.llm.connected', 'Connected')
        : t('api.llm.oauthRequired', 'Sign in');
    }
    if (!controller.requiresApiKey || controller.apiKey.trim()) {
      return t('api.llm.ready', 'Ready');
    }
    return t('api.llm.needsKey', 'Needs key');
  }, [
    chatgptStatus.signedIn,
    controller.apiKey,
    controller.provider,
    controller.requiresApiKey,
    t,
  ]);

  const runChatGptLogin = async () => {
    if (!auth?.chatgpt) {
      return;
    }
    const result = await auth.chatgpt.login();
    if (!result.success) {
      setAuthNotice({
        kind: 'error',
        title: t('api.llm.chatgptLoginFailed', 'ChatGPT sign-in failed'),
        body: result.error,
      });
      return;
    }
    setChatgptStatus({
      signedIn: true,
      email: result.email,
      plan_type: result.plan_type,
      account_id: result.account_id,
      is_fedramp: result.is_fedramp,
    });
    setAuthNotice({
      kind: 'success',
      title: t('api.llm.chatgptConnected', 'ChatGPT connected'),
      body: result.email || undefined,
    });
  };

  const clearChatGptLogin = async () => {
    if (!auth?.chatgpt) {
      return;
    }
    const result = await auth.chatgpt.clear();
    if (!result.success) {
      setAuthNotice({
        kind: 'error',
        title: t('api.llm.chatgptClearFailed', 'Could not clear ChatGPT credentials'),
        body: result.error,
      });
      return;
    }
    setChatgptStatus({ signedIn: false });
    setAuthNotice({
      kind: 'success',
      title: t('api.llm.chatgptDisconnected', 'ChatGPT disconnected'),
    });
  };

  const runGeminiLogin = async () => {
    if (!auth?.gemini) {
      return;
    }
    const result = await auth.gemini.login();
    setAuthNotice(
      result.success
        ? {
            kind: 'success',
            title: t('api.llm.geminiConnected', 'Gemini OAuth connected'),
          }
        : {
            kind: 'error',
            title: t('api.llm.geminiLoginFailed', 'Gemini sign-in failed'),
            body: result.error,
          }
    );
  };

  const clearGeminiLogin = async () => {
    if (!auth?.gemini) {
      return;
    }
    const result = await auth.gemini.clear();
    setAuthNotice(
      result.success
        ? {
            kind: 'success',
            title: t('api.llm.geminiDisconnected', 'Gemini credentials cleared'),
          }
        : {
            kind: 'error',
            title: t('api.llm.geminiClearFailed', 'Could not clear Gemini credentials'),
            body: result.error,
          }
    );
  };

  return (
    <div className={`space-y-4 ${className}`}>
      <section className="rounded-xl border border-border bg-background px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">
              {t('api.llm.activeConfig', 'Active configuration')}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-base font-semibold text-text-primary">
              <span>{currentProviderLabel}</span>
              {selectedModel && (
                <>
                  <span className="text-text-muted">/</span>
                  <span className="font-mono text-sm">{selectedModel}</span>
                </>
              )}
            </div>
            <div className="mt-1 truncate text-xs text-text-muted">{endpointLabel(controller)}</div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-border-muted px-2.5 py-1 text-text-secondary">
                {selectedProviderIndex}/{PROVIDER_ORDER.length}
              </span>
              <span className="rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-accent">
                {providerStatus}
              </span>
              {controller.hasUnsavedChanges && (
                <span className="rounded-full border border-warning/30 bg-warning/10 px-2.5 py-1 text-warning">
                  {t('api.unsavedBadge')}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                void controller.handleTest();
              }}
              disabled={testChoiceDisabled}
              data-testid="llm-test-connection"
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border-muted bg-background px-3 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {controller.isTesting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plug className="h-4 w-4" />
              )}
              {controller.isTesting ? t('api.testingConnection') : t('api.testConnection')}
            </button>
            <button
              type="button"
              onClick={() => {
                void controller.handleSave();
              }}
              disabled={saveChoiceDisabled}
              data-testid="llm-save-choice"
              className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                controller.hasUnsavedChanges
                  ? 'bg-accent text-white hover:bg-accent-hover'
                  : 'border border-success/30 bg-success/10 text-success'
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {controller.isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : controller.hasUnsavedChanges ? (
                <Save className="h-4 w-4" />
              ) : (
                <CheckCircle className="h-4 w-4" />
              )}
              {controller.isSaving
                ? t('common.saving')
                : controller.hasUnsavedChanges
                  ? t('api.llm.saveChoice', 'Save this choice')
                  : t('api.llm.choiceSaved', 'Choice saved')}
            </button>
            {controller.requiresApiKey && !controller.apiKey.trim() && (
              <div className="basis-full text-right text-[11px] text-warning">
                {t('api.testError.missing_key')}
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(360px,1.05fr)]">
        <section className="space-y-4 rounded-xl border border-border-muted bg-background px-4 py-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <Server className="h-4 w-4 text-accent" />
            {t('api.provider')}
          </div>

          <div className="space-y-4">
            {PROVIDER_GROUPS.map((group) => (
              <div key={group.id} className="space-y-2">
                <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">
                  {t(group.titleKey, group.fallback)}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {group.providers.map((option) => {
                    const Icon = PROVIDER_ICONS[option];
                    const isSelected = controller.provider === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => controller.changeProvider(option)}
                        disabled={controller.isLoadingConfig}
                        data-testid={`llm-provider-${option}`}
                        className={`min-h-[76px] rounded-xl border px-3 py-3 text-left transition-colors ${
                          isSelected
                            ? 'border-accent bg-accent/10 text-text-primary'
                            : 'border-border-muted bg-background text-text-secondary hover:border-border hover:bg-surface-hover'
                        } disabled:cursor-not-allowed disabled:opacity-50`}
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border ${
                              isSelected
                                ? 'border-accent/30 bg-accent/10 text-accent'
                                : 'border-border-muted text-text-muted'
                            }`}
                          >
                            <Icon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2 text-sm font-medium">
                              <span className="truncate">{providerLabel(controller, option, t)}</span>
                              {isSelected && <CheckCircle className="h-3.5 w-3.5 text-accent" />}
                            </span>
                            <span className="mt-1 block text-xs leading-5 text-text-muted">
                              {t(`api.llm.providerHint.${option}`, '') ||
                                controller.presets?.[option]?.models[0]?.name ||
                                option}
                            </span>
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-4 rounded-xl border border-border-muted bg-background px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
              <Key className="h-4 w-4 text-accent" />
              {t('api.llm.connectionModel', 'Connection and model')}
            </div>
            {controller.provider === 'custom' && (
              <div className="flex gap-1 rounded-lg border border-border-muted bg-background-secondary p-1">
                {(
                  [
                    { id: 'anthropic', label: 'Anthropic' },
                    { id: 'openai', label: 'OpenAI' },
                    { id: 'gemini', label: 'Gemini' },
                  ] as const
                ).map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => controller.changeProtocol(mode.id)}
                    className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      controller.customProtocol === mode.id
                        ? 'bg-accent text-white'
                        : 'text-text-secondary hover:bg-surface-hover'
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {authNotice && <AuthNotice {...authNotice} />}

          {controller.provider === 'chatgpt' && (
            <div className="space-y-3 rounded-xl border border-border-subtle bg-background-secondary px-3 py-3">
              {chatgptStatus.signedIn && (
                <div className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
                  <CheckCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="font-medium">
                      {t('api.llm.connectedAs', 'Connected')}
                      {chatgptStatus.email ? ` · ${chatgptStatus.email}` : ''}
                    </div>
                    {(chatgptStatus.plan_type || chatgptStatus.is_fedramp) && (
                      <div className="mt-0.5 text-text-secondary">
                        {chatgptStatus.plan_type ? `Plan: ${chatgptStatus.plan_type}` : ''}
                        {chatgptStatus.plan_type && chatgptStatus.is_fedramp ? ' · ' : ''}
                        {chatgptStatus.is_fedramp ? 'FedRAMP' : ''}
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void runChatGptLogin();
                  }}
                  className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover"
                >
                  <Key className="h-4 w-4" />
                  {chatgptStatus.signedIn
                    ? t('api.llm.reconnect', 'Reconnect')
                    : t('api.llm.signIn', 'Sign in')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void clearChatGptLogin();
                  }}
                  className="rounded-lg border border-border-muted px-3 py-2 text-sm text-text-secondary hover:bg-surface-hover"
                >
                  {t('api.llm.clearCredentials', 'Clear credentials')}
                </button>
              </div>
            </div>
          )}

          {controller.provider === 'gemini' && auth?.gemini && (
            <div className="flex flex-wrap gap-2 rounded-xl border border-border-subtle bg-background-secondary px-3 py-3">
              <button
                type="button"
                onClick={() => {
                  void runGeminiLogin();
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover"
              >
                <Key className="h-4 w-4" />
                {t('api.llm.googleSignIn', 'Google sign in')}
              </button>
              <button
                type="button"
                onClick={() => {
                  void clearGeminiLogin();
                }}
                className="rounded-lg border border-border-muted px-3 py-2 text-sm text-text-secondary hover:bg-surface-hover"
              >
                {t('api.llm.clearCredentials', 'Clear credentials')}
              </button>
            </div>
          )}

          {controller.provider === 'custom' && (
            <GuidanceInlineHint
              text={controller.protocolGuidanceText}
              tone={controller.protocolGuidanceTone}
            />
          )}

          {showApiKeyMain && (
            <div className="space-y-2">
              <label
                htmlFor="api-key-input"
                className="flex items-center gap-2 text-sm font-medium text-text-primary"
              >
                <Key className="h-4 w-4" />
                {t('api.apiKey')}
              </label>
              <input
                id="api-key-input"
                type="password"
                value={controller.apiKey}
                onChange={(event) => controller.setApiKey(event.target.value)}
                placeholder={controller.currentPreset?.keyPlaceholder || t('api.enterApiKey')}
                className="w-full rounded-lg border border-border bg-background px-4 py-3 text-text-primary placeholder-text-muted transition-all focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
              {apiKeyHint(controller, t) && (
                <p className="text-xs text-text-muted">{apiKeyHint(controller, t)}</p>
              )}
            </div>
          )}

          {showEndpointMain && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="api-base-url-input"
                  className="flex items-center gap-2 text-sm font-medium text-text-primary"
                >
                  <Server className="h-4 w-4" />
                  {t('api.baseUrl')}
                </label>
                {controller.isOllamaMode || controller.isLmStudioMode ? (
                  <button
                    type="button"
                    onClick={() => {
                      void (controller.isOllamaMode
                        ? controller.discoverLocalOllama()
                        : controller.discoverLocalLmStudio());
                    }}
                    disabled={
                      controller.isOllamaMode
                        ? controller.isDiscoveringLocalOllama
                        : controller.isDiscoveringLocalLmStudio
                    }
                    className="inline-flex items-center gap-1 rounded-md bg-accent-muted px-2 py-1 text-xs text-accent transition-colors hover:bg-accent-muted/80 disabled:opacity-50"
                  >
                    <Plug className="h-3 w-3" />
                    {controller.isOllamaMode
                      ? controller.isDiscoveringLocalOllama
                        ? t('api.discoveringLocalOllama')
                        : t('api.discoverLocalOllama')
                      : controller.isDiscoveringLocalLmStudio
                        ? t('api.discoveringLocalLmStudio')
                        : t('api.discoverLocalLmStudio')}
                  </button>
                ) : null}
              </div>
              <input
                id="api-base-url-input"
                type="text"
                value={controller.baseUrl}
                onChange={(event) => controller.setBaseUrl(event.target.value)}
                placeholder={baseUrlPlaceholder(controller)}
                className="w-full rounded-lg border border-border bg-background px-4 py-3 text-text-primary placeholder-text-muted transition-all focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
              <p className="text-xs text-text-muted">{baseUrlHint(controller, t)}</p>
              {controller.isOllamaMode ? (
                <p className="text-xs text-text-muted">{t('api.discoverLocalOllamaHint')}</p>
              ) : controller.isLmStudioMode ? (
                <p className="text-xs text-text-muted">{t('api.discoverLocalLmStudioHint')}</p>
              ) : null}
              {controller.provider === 'custom' && (
                <GuidanceInlineHint text={controller.baseUrlGuidanceText} />
              )}
            </div>
          )}

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label
                htmlFor="api-model-input"
                className="flex items-center gap-2 text-sm font-medium text-text-primary"
              >
                <Cpu className="h-4 w-4" />
                {t('api.model')}
              </label>
              <div className="flex flex-wrap items-center gap-2">
                {controller.isLocalOpenAIProviderMode && (
                  <button
                    type="button"
                    onClick={() => {
                      void controller.refreshModelOptions();
                    }}
                    disabled={controller.isRefreshingModels}
                    className="inline-flex items-center gap-1 rounded-md bg-surface-hover px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-active disabled:opacity-50"
                  >
                    <RefreshCw
                      className={`h-3 w-3 ${controller.isRefreshingModels ? 'animate-spin' : ''}`}
                    />
                    {controller.isRefreshingModels
                      ? t('api.refreshingModels')
                      : t('api.refreshModels')}
                  </button>
                )}
                {controller.shouldShowOllamaManualModelToggle && (
                  <button
                    type="button"
                    onClick={controller.toggleCustomModel}
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
                      controller.useCustomModel
                        ? 'bg-accent-muted text-accent'
                        : 'border border-border-muted bg-background text-text-secondary hover:bg-surface-hover'
                    }`}
                  >
                    <Edit3 className="h-3 w-3" />
                    {controller.isLocalOpenAIProviderMode
                      ? controller.useCustomModel
                        ? t('api.useDetectedModels')
                        : t('api.manualModel')
                      : controller.useCustomModel
                        ? t('api.usePreset')
                        : t('api.custom')}
                  </button>
                )}
              </div>
            </div>
            {controller.useCustomModel ? (
              <input
                id="api-model-input"
                type="text"
                value={controller.customModel}
                onChange={(event) => controller.setCustomModel(event.target.value)}
                placeholder={controller.modelInputPlaceholder}
                className="w-full rounded-lg border border-border bg-background px-4 py-3 text-text-primary placeholder-text-muted transition-all focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
            ) : (
              <select
                id="api-model-input"
                value={controller.modelOptions.length ? controller.model : ''}
                onChange={(event) => controller.setModel(event.target.value)}
                className="w-full cursor-pointer appearance-none rounded-lg border border-border bg-background px-4 py-3 text-text-primary transition-all focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              >
                {controller.modelOptions.length ? (
                  controller.modelOptions.map((modelOption) => (
                    <option key={modelOption.id} value={modelOption.id}>
                      {modelOption.name}
                    </option>
                  ))
                ) : (
                  <option value="" disabled>
                    {t('api.noModelsAvailable')}
                  </option>
                )}
              </select>
            )}
            {controller.useCustomModel && (
              <p className="text-xs text-text-muted">{modelInputHint(controller, t)}</p>
            )}
          </div>

          {testResult && (
            <div
              className={`flex gap-2 rounded-xl px-4 py-3 text-sm ${
                testResult.ok ? 'bg-success/10 text-success' : 'bg-error/10 text-error'
              }`}
            >
              {testResult.ok ? (
                <CheckCircle className="h-4 w-4 flex-shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div>
                  {testResult.ok
                    ? t('api.testSuccess', {
                        ms: typeof testResult.latencyMs === 'number'
                          ? testResult.latencyMs
                          : '--',
                      })
                    : testErrorMessage?.(testResult) || t('api.testError.unknown')}
                </div>
                {!testResult.ok && friendlyTestDetails && (
                  <div className="mt-1 text-xs leading-5 text-text-primary">
                    {friendlyTestDetails}
                  </div>
                )}
                {!testResult.ok && testResult.details && (
                  <div className="mt-1 text-xs text-text-muted">{testResult.details}</div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      <details className="rounded-xl border border-border-muted bg-background px-4 py-4">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-text-primary">
          <span className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-accent" />
            {t('api.llm.advancedSettings', 'Advanced settings')}
          </span>
          <ChevronDown className="h-4 w-4 text-text-muted" />
        </summary>

        <div className="mt-4 space-y-4">
          {configSetManager}

          {showLocalOptionalKey && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                <Key className="h-4 w-4" />
                {t('api.llm.optionalApiKey', 'Optional API key')}
              </label>
              <input
                type="password"
                value={controller.apiKey}
                onChange={(event) => controller.setApiKey(event.target.value)}
                placeholder={controller.currentPreset?.keyPlaceholder || t('api.enterApiKey')}
                className="w-full rounded-lg border border-border bg-background px-4 py-3 text-text-primary placeholder-text-muted transition-all focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
              {apiKeyHint(controller, t) && (
                <p className="text-xs text-text-muted">{apiKeyHint(controller, t)}</p>
              )}
            </div>
          )}

          {(controller.provider === 'ollama' ||
            controller.provider === 'lmstudio' ||
            controller.provider === 'custom') && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label
                  htmlFor="api-context-window-input"
                  className="block text-xs font-medium text-text-secondary"
                >
                  {t('api.contextWindow')}
                </label>
                <input
                  id="api-context-window-input"
                  type="number"
                  value={controller.contextWindow}
                  onChange={(event) => controller.setContextWindow(event.target.value)}
                  placeholder={t('api.contextWindowPlaceholder')}
                  min={1024}
                  step={1024}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary placeholder-text-muted transition-all focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              </div>
              <div className="space-y-1">
                <label
                  htmlFor="api-max-tokens-input"
                  className="block text-xs font-medium text-text-secondary"
                >
                  {t('api.maxOutputTokens')}
                </label>
                <input
                  id="api-max-tokens-input"
                  type="number"
                  value={controller.maxTokens}
                  onChange={(event) => controller.setMaxTokens(event.target.value)}
                  placeholder={t('api.maxOutputTokensPlaceholder')}
                  min={256}
                  step={256}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary placeholder-text-muted transition-all focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              </div>
              <p className="sm:col-span-2 text-xs text-text-muted">
                {t('api.contextWindowHint')}
              </p>
            </div>
          )}

          {controller.provider === 'custom' && (
            <CommonProviderSetupsCard
              setups={controller.commonProviderSetups}
              onApplySetup={controller.applyCommonProviderSetup}
            />
          )}

          <label className="flex items-start gap-2 text-xs text-text-muted">
            <input
              type="checkbox"
              id="enable-thinking"
              checked={controller.enableThinking}
              onChange={(event) => controller.setEnableThinking(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border text-accent focus:ring-accent"
            />
            <span className="space-y-0.5">
              <span className="block font-medium text-text-primary">{t('api.enableThinking')}</span>
              <span className="block">{t('api.enableThinkingHint')}</span>
              {controller.isOllamaMode ? (
                <span className="mt-1 block text-warning">
                  {t('api.enableThinkingOllamaHint')}
                </span>
              ) : controller.isLmStudioMode ? (
                <span className="mt-1 block text-warning">
                  {t('api.enableThinkingLocalHint')}
                </span>
              ) : null}
            </span>
          </label>
        </div>
      </details>
    </div>
  );
}
