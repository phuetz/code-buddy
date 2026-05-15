import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import {
  Key,
  Plug,
  Server,
  Cpu,
  Loader2,
  Edit3,
  AlertCircle,
  CheckCircle,
  RefreshCw,
} from 'lucide-react';
import { useApiConfigState } from '../../hooks/useApiConfigState';
import { useIPC } from '../../hooks/useIPC';
import { useAppStore } from '../../store';
import type { NotificationEntry, NotificationPriority } from '../../types';

interface ChatGptStatus {
  signedIn: boolean;
  email?: string | null;
  plan_type?: string | null;
  account_id?: string | null;
  is_fedramp?: boolean;
}
import { ApiConfigSetManager } from '../ApiConfigSetManager';
import { CommonProviderSetupsCard, GuidanceInlineHint } from '../ProviderGuidance';
import ApiDiagnosticsPanel from '../ApiDiagnosticsPanel';
import { SettingsLocalProviders } from './SettingsLocalProviders';

interface ModelOptionItem {
  id: string;
  name: string;
}

// ==================== API Settings Tab ====================

export function SettingsAPI() {
  const { t } = useTranslation();
  const {
    provider,
    customProtocol,
    apiKey,
    baseUrl,
    model,
    customModel,
    useCustomModel,
    contextWindow,
    maxTokens,
    modelInputPlaceholder,
    modelInputHint,
    presets,
    currentPreset,
    modelOptions,
    isSaving,
    isLoadingConfig,
    error,
    successMessage,
    isRefreshingModels,
    isDiscoveringLocalOllama,
    isDiscoveringLocalLmStudio,
    enableThinking,
    isOllamaMode,
    isLmStudioMode,
    isLocalOpenAIProviderMode,
    requiresApiKey,
    protocolGuidanceText,
    protocolGuidanceTone,
    baseUrlGuidanceText,
    commonProviderSetups,
    configSets,
    activeConfigSetId,
    currentConfigSet,
    pendingConfigSetAction,
    pendingConfigSet,
    hasUnsavedChanges,
    isMutatingConfigSet,
    canDeleteCurrentConfigSet,
    setApiKey,
    setBaseUrl,
    setModel,
    setCustomModel,
    setContextWindow,
    setMaxTokens,
    toggleCustomModel,
    setEnableThinking,
    applyCommonProviderSetup,
    changeProvider,
    changeProtocol,
    requestConfigSetSwitch,
    requestCreateBlankConfigSet,
    cancelPendingConfigSetAction,
    saveAndContinuePendingConfigSetAction,
    discardAndContinuePendingConfigSetAction,
    renameConfigSet,
    deleteConfigSet,
    handleSave,
    refreshModelOptions,
    discoverLocalOllama,
    discoverLocalLmStudio,
    applyLocalProviderProfile,
    diagnosticResult,
    isDiagnosing,
    handleDiagnose,
    handleDeepDiagnose,
    shouldShowOllamaManualModelToggle,
  } = useApiConfigState();
  const { geminiOauthLogin, geminiOauthClear, codexOauthLogin, codexOauthClear, codexOauthStatus } = useIPC();
  const addNotification = useAppStore((s) => s.addNotification);

  // Phase d.23 — display the connected ChatGPT account next to the
  // Sign In button, plus auto-refresh the badge after login/logout.
  const [chatgptStatus, setChatgptStatus] = useState<ChatGptStatus>({ signedIn: false });

  /** Non-blocking toast helper — replaces window.alert() so the user can
   *  keep navigating Settings while the notification auto-dismisses. */
  const toast = (
    title: string,
    body: string,
    priority: NotificationPriority = 'normal',
  ): void => {
    const entry: NotificationEntry = {
      id: `chatgpt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title,
      body,
      priority,
      timestamp: Date.now(),
      read: false,
    };
    addNotification(entry);
  };

  useEffect(() => {
    let cancelled = false;
    if (provider !== 'chatgpt') return;
    (async () => {
      const res = await codexOauthStatus();
      if (cancelled) return;
      if (res.success) {
        setChatgptStatus({
          signedIn: !!res.signedIn,
          email: res.email,
          plan_type: res.plan_type,
          account_id: res.account_id,
          is_fedramp: res.is_fedramp,
        });
      } else {
        setChatgptStatus({ signedIn: false });
      }
    })();
    return () => { cancelled = true; };
  }, [provider, codexOauthStatus]);

  // Phase d.24 M — when the user picks the ChatGPT preset, the API key
  // sentinel is auto-set so CodeBuddyClient routes to the OAuth backend.
  // Only sets it when the field is empty/wrong, so we don't trample
  // user customizations.
  useEffect(() => {
    if (provider === 'chatgpt' && apiKey !== 'oauth-chatgpt') {
      setApiKey('oauth-chatgpt');
    }
  }, [provider, apiKey, setApiKey]);

  if (isLoadingConfig) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-accent" />
        <span className="ml-2 text-text-secondary">{t('common.loading')}</span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SettingsLocalProviders
        onConnect={(providerKey, payload) => {
          applyLocalProviderProfile(providerKey, payload);
        }}
      />

      {/* Config Set Switcher */}
      <ApiConfigSetManager
        configSets={configSets}
        activeConfigSetId={activeConfigSetId}
        currentConfigSet={currentConfigSet}
        pendingConfigSetAction={pendingConfigSetAction}
        pendingConfigSet={pendingConfigSet}
        hasUnsavedChanges={hasUnsavedChanges}
        isMutatingConfigSet={isMutatingConfigSet}
        isSaving={isSaving}
        canDeleteCurrentConfigSet={canDeleteCurrentConfigSet}
        onSwitchSet={requestConfigSetSwitch}
        onRequestCreateBlankSet={requestCreateBlankConfigSet}
        onSaveCurrentSet={handleSave}
        onRenameSet={renameConfigSet}
        onDeleteSet={deleteConfigSet}
        onCancelPendingAction={cancelPendingConfigSetAction}
        onSaveAndContinuePendingAction={saveAndContinuePendingConfigSetAction}
        onDiscardAndContinuePendingAction={discardAndContinuePendingConfigSetAction}
      />

      {/* Provider Selection */}
      <div className="space-y-3 py-5 border-b border-border-muted">
        <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <Server className="w-4 h-4" />
          {t('api.provider')}
        </label>
        <p className="text-xs leading-5 text-text-muted">{t('api.providerDescription')}</p>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2">
          {(['chatgpt', 'openrouter', 'anthropic', 'openai', 'gemini', 'ollama', 'lmstudio', 'custom'] as const).map(
            (p) => (
              <button
                key={p}
                onClick={() => changeProvider(p)}
                disabled={isLoadingConfig}
                className={`px-3 py-2 rounded-lg text-sm transition-colors border ${
                  provider === p
                    ? 'border-accent bg-accent/10 text-accent font-medium'
                    : 'border-border-muted text-text-secondary hover:border-border hover:text-text-primary disabled:opacity-50'
                }`}
              >
                {p === 'custom' ? t('api.moreModels') : presets?.[p]?.name || p}
              </button>
            )
          )}
        </div>
      </div>

      {/* API Key — hidden for chatgpt (OAuth replaces it) */}
      {provider !== 'chatgpt' && (
        <div className="space-y-3 py-5 border-b border-border-muted">
          <label
            htmlFor="api-key-input"
            className="flex items-center gap-2 text-sm font-medium text-text-primary"
          >
            <Key className="w-4 h-4" />
            {t('api.apiKey')}
          </label>
          <p className="text-xs leading-5 text-text-muted">{t('api.apiKeyDescription')}</p>
          <input
            id="api-key-input"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={currentPreset?.keyPlaceholder || t('api.enterApiKey')}
            className="w-full px-4 py-3 rounded-lg bg-background border border-border text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all"
          />
          {currentPreset?.keyHint && (
            <p className="text-xs text-text-muted">{currentPreset.keyHint}</p>
          )}
        </div>
      )}

      {/* Gemini OAuth Section */}
      {provider === 'gemini' && (
        <div className="space-y-3 py-5 border-b border-border-muted">
          <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
            <Key className="w-4 h-4" />
            Sign in to Google AI Ultra (OAuth)
          </label>
          <p className="text-xs leading-5 text-text-muted">
            Authenticate directly with your Google account to access Gemini Advanced models without an API key. This will use your active Google session in the browser.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={async () => {
                const res = await geminiOauthLogin();
                if (!res.success) {
                  alert('Login failed: ' + res.error);
                } else {
                  alert('Successfully authenticated with Google AI Ultra!');
                }
              }}
              className="px-4 py-2 bg-accent text-white rounded-lg text-sm hover:bg-accent-hover transition-colors shadow-sm"
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={async () => {
                const res = await geminiOauthClear();
                if (!res.success) {
                  alert('Failed to clear credentials: ' + res.error);
                } else {
                  alert('Successfully cleared Google credentials.');
                }
              }}
              className="px-4 py-2 border border-border-muted text-text-secondary rounded-lg text-sm hover:bg-surface-hover transition-colors"
            >
              Clear Credentials
            </button>
          </div>
        </div>
      )}

      {/* ChatGPT Codex OAuth Section — provider 'chatgpt' (Phase d.24 M) */}
      {provider === 'chatgpt' && (
        <div className="space-y-3 py-5 border-b border-border-muted">
          <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
            <Key className="w-4 h-4" />
            Sign in to ChatGPT (Codex OAuth)
          </label>
          <p className="text-xs leading-5 text-text-muted">
            Authentifie-toi avec ton compte ChatGPT pour utiliser ton abonnement Plus/Pro sans clé API. Le chat est routé vers le backend Codex (chatgpt.com/backend-api/codex/responses).
          </p>
          {chatgptStatus.signedIn && (
            <div className="flex items-center gap-2 px-3 py-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-xs">
              <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
              <div className="flex flex-col gap-0.5">
                <span className="text-emerald-300 font-medium">
                  Connecté{chatgptStatus.email ? ` · ${chatgptStatus.email}` : ''}
                </span>
                {(chatgptStatus.plan_type || chatgptStatus.is_fedramp) && (
                  <span className="text-text-muted">
                    {chatgptStatus.plan_type ? `Plan : ${chatgptStatus.plan_type}` : ''}
                    {chatgptStatus.plan_type && chatgptStatus.is_fedramp ? ' · ' : ''}
                    {chatgptStatus.is_fedramp ? 'FedRAMP' : ''}
                  </span>
                )}
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={async () => {
                const res = await codexOauthLogin();
                if (!res.success) {
                  toast('ChatGPT — Échec du login', res.error ?? 'Erreur inconnue', 'high');
                  return;
                }
                setChatgptStatus({
                  signedIn: true,
                  email: res.email,
                  plan_type: res.plan_type,
                  account_id: res.account_id,
                  is_fedramp: res.is_fedramp,
                });
                const detail = res.email ? ` · ${res.email}` : '';
                const planSuffix = res.plan_type ? ` (Plan ${res.plan_type})` : '';
                toast('ChatGPT — Connecté', `Authentifié${detail}${planSuffix}`);
              }}
              className="px-4 py-2 bg-accent text-white rounded-lg text-sm hover:bg-accent-hover transition-colors shadow-sm"
            >
              {chatgptStatus.signedIn ? 'Reconnecter' : 'Sign In'}
            </button>
            <button
              type="button"
              onClick={async () => {
                const res = await codexOauthClear();
                if (!res.success) {
                  toast('ChatGPT — Échec', res.error ?? 'Erreur inconnue', 'high');
                  return;
                }
                setChatgptStatus({ signedIn: false });
                toast('ChatGPT — Déconnecté', 'Credentials effacés.');
              }}
              className="px-4 py-2 border border-border-muted text-text-secondary rounded-lg text-sm hover:bg-surface-hover transition-colors"
            >
              Clear Credentials
            </button>
          </div>
        </div>
      )}

      {/* Custom Protocol */}
      {provider === 'custom' && (
        <div className="space-y-3 py-5 border-b border-border-muted">
          <label
            id="api-protocol-label"
            className="flex items-center gap-2 text-sm font-medium text-text-primary"
          >
            <Server className="w-4 h-4" />
            {t('api.protocol')}
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {(
              [
                { id: 'anthropic', label: 'Anthropic' },
                { id: 'openai', label: 'OpenAI' },
                { id: 'gemini', label: 'Gemini' },
              ] as const
            ).map((mode) => (
              <button
                key={mode.id}
                onClick={() => changeProtocol(mode.id)}
                className={`px-3 py-2 rounded-lg text-sm transition-colors border ${
                  customProtocol === mode.id
                    ? 'border-accent bg-accent/10 text-accent font-medium'
                    : 'border-border-muted text-text-secondary hover:border-border hover:text-text-primary'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-text-muted">{t('api.selectProtocol')}</p>
          <GuidanceInlineHint text={protocolGuidanceText} tone={protocolGuidanceTone} />
        </div>
      )}

      {(provider === 'custom' || provider === 'ollama' || provider === 'lmstudio') && (
        <div className="space-y-3 py-5 border-b border-border-muted">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="api-base-url-input"
              className="flex items-center gap-2 text-sm font-medium text-text-primary"
            >
              <Server className="w-4 h-4" />
              {t('api.baseUrl')}
            </label>
            {isOllamaMode ? (
              <button
                type="button"
                onClick={() => {
                  void discoverLocalOllama();
                }}
                disabled={isDiscoveringLocalOllama}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors active:scale-95 bg-accent-muted text-accent hover:bg-accent-muted/80 disabled:opacity-50"
              >
                <Plug className="w-3 h-3" />
                {isDiscoveringLocalOllama
                  ? t('api.discoveringLocalOllama')
                  : t('api.discoverLocalOllama')}
              </button>
            ) : isLmStudioMode ? (
              <button
                type="button"
                onClick={() => {
                  void discoverLocalLmStudio();
                }}
                disabled={isDiscoveringLocalLmStudio}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors active:scale-95 bg-accent-muted text-accent hover:bg-accent-muted/80 disabled:opacity-50"
              >
                <Plug className="w-3 h-3" />
                {isDiscoveringLocalLmStudio
                  ? t('api.discoveringLocalLmStudio')
                  : t('api.discoverLocalLmStudio')}
              </button>
            ) : null}
          </div>
          <input
            id="api-base-url-input"
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={
              provider === 'ollama'
                ? 'http://localhost:11434/v1'
                : provider === 'lmstudio'
                  ? 'http://localhost:1234/v1'
                : customProtocol === 'openai'
                  ? 'https://api.openai.com/v1'
                  : customProtocol === 'gemini'
                    ? 'https://generativelanguage.googleapis.com'
                    : currentPreset?.baseUrl || 'https://api.anthropic.com'
            }
            className="w-full px-4 py-3 rounded-lg bg-background border border-border text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all"
          />
          <p className="text-xs text-text-muted">
            {provider === 'ollama'
              ? t('api.enterOllamaUrl')
              : provider === 'lmstudio'
                ? t('api.enterLmStudioUrl')
              : customProtocol === 'openai'
                ? t('api.enterOpenAIUrl')
                : customProtocol === 'gemini'
                  ? t('api.enterGeminiUrl')
                  : t('api.enterAnthropicUrl')}
          </p>
          {isOllamaMode ? (
            <p className="text-xs text-text-muted">{t('api.discoverLocalOllamaHint')}</p>
          ) : isLmStudioMode ? (
            <p className="text-xs text-text-muted">{t('api.discoverLocalLmStudioHint')}</p>
          ) : null}
          {provider === 'custom' && <GuidanceInlineHint text={baseUrlGuidanceText} />}
        </div>
      )}

      {/* Model Selection */}
      <div className="space-y-3 py-5 border-b border-border-muted">
        <div className="flex items-center justify-between">
          <label
            htmlFor="api-model-input"
            className="flex items-center gap-2 text-sm font-medium text-text-primary"
          >
            <Cpu className="w-4 h-4" />
            {t('api.model')}
          </label>
          <div className="flex items-center gap-2">
            {isLocalOpenAIProviderMode && (
              <button
                type="button"
                onClick={() => {
                  void refreshModelOptions();
                }}
                disabled={isRefreshingModels}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors active:scale-95 bg-surface-hover text-text-secondary hover:bg-surface-active disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${isRefreshingModels ? 'animate-spin' : ''}`} />
                {isRefreshingModels ? t('api.refreshingModels') : t('api.refreshModels')}
              </button>
            )}
            {shouldShowOllamaManualModelToggle && (
              <button
                type="button"
                onClick={toggleCustomModel}
                className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors active:scale-95 ${
                  useCustomModel
                    ? 'bg-accent-muted text-accent'
                    : 'border border-border-muted bg-background text-text-secondary hover:bg-surface-hover'
                }`}
              >
                <Edit3 className="w-3 h-3" />
                {isLocalOpenAIProviderMode
                  ? useCustomModel
                    ? t('api.useDetectedModels')
                    : t('api.manualModel')
                  : useCustomModel
                    ? t('api.usePreset')
                    : t('api.custom')}
              </button>
            )}
          </div>
        </div>
        {useCustomModel ? (
          <input
            id="api-model-input"
            type="text"
            value={customModel}
            onChange={(e) => setCustomModel(e.target.value)}
            placeholder={modelInputPlaceholder}
            className="w-full px-4 py-3 rounded-lg bg-background border border-border text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all"
          />
        ) : (
          <select
            id="api-model-input"
            value={modelOptions.length ? model : ''}
            onChange={(e) => setModel(e.target.value)}
            className="w-full px-4 py-3 rounded-lg bg-background border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all appearance-none cursor-pointer"
          >
            {modelOptions.length ? (
              (modelOptions as ModelOptionItem[]).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))
            ) : (
              <option value="" disabled>
                {t('api.noModelsAvailable')}
              </option>
            )}
          </select>
        )}
        {useCustomModel && <p className="text-xs text-text-muted">{modelInputHint}</p>}

        {/* Context Window & Max Tokens — only for non-registry providers */}
        {(provider === 'ollama' || provider === 'lmstudio' || provider === 'custom') && (
          <div className="grid grid-cols-2 gap-3 pt-2">
            <div>
              <label
                htmlFor="api-context-window-input"
                className="block text-xs font-medium text-text-secondary mb-1"
              >
                {t('api.contextWindow')}
              </label>
              <input
                id="api-context-window-input"
                type="number"
                value={contextWindow}
                onChange={(e) => setContextWindow(e.target.value)}
                placeholder={t('api.contextWindowPlaceholder')}
                min={1024}
                step={1024}
                className="w-full px-3 py-2 rounded-lg bg-background border border-border text-text-primary text-sm placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all"
              />
            </div>
            <div>
              <label
                htmlFor="api-max-tokens-input"
                className="block text-xs font-medium text-text-secondary mb-1"
              >
                {t('api.maxOutputTokens')}
              </label>
              <input
                id="api-max-tokens-input"
                type="number"
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
                placeholder={t('api.maxOutputTokensPlaceholder')}
                min={256}
                step={256}
                className="w-full px-3 py-2 rounded-lg bg-background border border-border text-text-primary text-sm placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all"
              />
            </div>
            <p className="col-span-2 text-xs text-text-muted">{t('api.contextWindowHint')}</p>
          </div>
        )}
      </div>

      {provider === 'custom' && (
        <CommonProviderSetupsCard
          setups={commonProviderSetups}
          onApplySetup={applyCommonProviderSetup}
        />
      )}

      {/* Enable Thinking Mode */}
      <div className="space-y-3 py-5 border-b border-border-muted">
        <div className="flex items-start gap-2 text-xs text-text-muted">
          <input
            type="checkbox"
            id="enable-thinking"
            checked={enableThinking}
            onChange={(e) => setEnableThinking(e.target.checked)}
            className="mt-0.5 w-4 h-4 rounded border-border text-accent focus:ring-accent"
          />
          <label htmlFor="enable-thinking" className="space-y-0.5 flex-1">
            <div className="text-text-primary font-medium">{t('api.enableThinking')}</div>
            <div>{t('api.enableThinkingHint')}</div>
            {isOllamaMode ? (
              <div className="text-amber-500 dark:text-amber-400 text-xs mt-1">
                {t('api.enableThinkingOllamaHint')}
              </div>
            ) : isLmStudioMode ? (
              <div className="text-amber-500 dark:text-amber-400 text-xs mt-1">
                {t('api.enableThinkingLocalHint')}
              </div>
            ) : null}
          </label>
        </div>
      </div>

      {/* Error/Success Messages */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-error/10 text-error text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}
      {successMessage && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-success/10 text-success text-sm">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          {successMessage}
        </div>
      )}
      {/* Diagnostics Panel */}
      <ApiDiagnosticsPanel
        result={diagnosticResult}
        isRunning={isDiagnosing}
        onRunDiagnostics={handleDiagnose}
        onRunDeepDiagnostics={isOllamaMode ? handleDeepDiagnose : undefined}
        disabled={requiresApiKey && !apiKey.trim()}
      />

      {/* Save Button */}
      <div className="space-y-3 py-5 border-b border-border-muted">
        <div className="grid grid-cols-1 gap-2">
          <button
            onClick={() => {
              void handleSave();
            }}
            disabled={isSaving || (requiresApiKey && !apiKey.trim())}
            className="w-full py-3 px-4 rounded-lg bg-accent text-white font-medium hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:scale-[0.98] flex items-center justify-center gap-2"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t('common.saving')}
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4" />
                {t('api.saveSettings')}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
