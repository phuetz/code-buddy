import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle, Loader2, Stethoscope } from 'lucide-react';
import { useApiConfigState } from '../../hooks/useApiConfigState';
import { useIPC } from '../../hooks/useIPC';
import { ApiConfigSetManager } from '../ApiConfigSetManager';
import ApiDiagnosticsPanel from '../ApiDiagnosticsPanel';
import { HermesProviderReadinessStrip } from '../hermes-provider-readiness-strip';
import { HermesRuntimeBackendsStrip } from '../hermes-runtime-backends-strip';
import { HermesBrowserBackendsStrip } from '../hermes-browser-backends-strip';
import { LLMConfigPanel } from '../LLMConfigPanel';
import { SettingsLocalProviders } from './SettingsLocalProviders';

// ==================== API Settings Tab ====================

export function SettingsAPI() {
  const { t } = useTranslation();
  const apiConfig = useApiConfigState();
  const { geminiOauthLogin, geminiOauthClear, codexOauthLogin, codexOauthClear, codexOauthStatus } =
    useIPC();

  if (apiConfig.isLoadingConfig) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
        <span className="ml-2 text-text-secondary">{t('common.loading')}</span>
      </div>
    );
  }

  const configSetManager = (
    <ApiConfigSetManager
      configSets={apiConfig.configSets}
      activeConfigSetId={apiConfig.activeConfigSetId}
      currentConfigSet={apiConfig.currentConfigSet}
      pendingConfigSetAction={apiConfig.pendingConfigSetAction}
      pendingConfigSet={apiConfig.pendingConfigSet}
      hasUnsavedChanges={apiConfig.hasUnsavedChanges}
      isMutatingConfigSet={apiConfig.isMutatingConfigSet}
      isSaving={apiConfig.isSaving}
      canDeleteCurrentConfigSet={apiConfig.canDeleteCurrentConfigSet}
      onSwitchSet={apiConfig.requestConfigSetSwitch}
      onRequestCreateBlankSet={apiConfig.requestCreateBlankConfigSet}
      onSaveCurrentSet={apiConfig.handleSave}
      onRenameSet={apiConfig.renameConfigSet}
      onDeleteSet={apiConfig.deleteConfigSet}
      onCancelPendingAction={apiConfig.cancelPendingConfigSetAction}
      onSaveAndContinuePendingAction={apiConfig.saveAndContinuePendingConfigSetAction}
      onDiscardAndContinuePendingAction={apiConfig.discardAndContinuePendingConfigSetAction}
    />
  );

  return (
    <div className="space-y-4">
      <LLMConfigPanel
        controller={apiConfig}
        configSetManager={configSetManager}
        auth={{
          chatgpt: {
            login: codexOauthLogin,
            clear: codexOauthClear,
            status: codexOauthStatus,
          },
          gemini: {
            login: geminiOauthLogin,
            clear: geminiOauthClear,
          },
        }}
      />

      <HermesProviderReadinessStrip />
      <HermesRuntimeBackendsStrip />
      <HermesBrowserBackendsStrip />

      <details className="rounded-xl border border-border-muted bg-background px-4 py-4">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-text-primary">
          <span>{t('api.localProvidersTitle', 'Local providers')}</span>
          <span className="text-xs font-normal text-text-muted">
            {t('api.llm.optional', 'Optional')}
          </span>
        </summary>
        <div className="mt-4">
          <SettingsLocalProviders
            onConnect={(providerKey, payload) => {
              apiConfig.applyLocalProviderProfile(providerKey, payload);
            }}
          />
        </div>
      </details>

      {apiConfig.error && (
        <div className="flex items-center gap-2 rounded-lg bg-error/10 px-4 py-3 text-sm text-error">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {apiConfig.error}
        </div>
      )}

      {apiConfig.successMessage && (
        <div className="flex items-center gap-2 rounded-lg bg-success/10 px-4 py-3 text-sm text-success">
          <CheckCircle className="h-4 w-4 flex-shrink-0" />
          {apiConfig.successMessage}
        </div>
      )}

      <section className="space-y-4 rounded-xl border border-border-muted bg-background px-4 py-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          <Stethoscope className="h-4 w-4 text-accent" />
          {t('api.llm.diagnostics', 'Diagnostics')}
        </div>
        <ApiDiagnosticsPanel
          result={apiConfig.diagnosticResult}
          isRunning={apiConfig.isDiagnosing}
          onRunDiagnostics={apiConfig.handleDiagnose}
          onRunDeepDiagnostics={apiConfig.isOllamaMode ? apiConfig.handleDeepDiagnose : undefined}
          disabled={apiConfig.requiresApiKey && !apiConfig.apiKey.trim()}
        />
      </section>
    </div>
  );
}
