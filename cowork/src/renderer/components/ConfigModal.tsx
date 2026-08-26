import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, CheckCircle, Key, Loader2, Plug, Save, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AppConfig, ApiTestResult } from '../types';
import { useApiConfigState } from '../hooks/useApiConfigState';
import { useIPC } from '../hooks/useIPC';
import { ApiConfigSetManager } from './ApiConfigSetManager';
import { LLMConfigPanel } from './LLMConfigPanel';

interface ConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: Partial<AppConfig>) => Promise<AppConfig | void>;
  initialConfig?: AppConfig | null;
  isFirstRun?: boolean;
}

export function ConfigModal({
  isOpen,
  onClose,
  onSave,
  initialConfig,
  isFirstRun,
}: ConfigModalProps) {
  const { t } = useTranslation();
  const apiConfig = useApiConfigState({
    enabled: isOpen,
    initialConfig,
    onSave,
  });
  const { geminiOauthLogin, geminiOauthClear, codexOauthLogin, codexOauthClear, codexOauthStatus } =
    useIPC();

  useEffect(() => {
    if (!apiConfig.lastSaveCompletedAt) {
      return;
    }
    const timer = setTimeout(() => {
      onClose();
    }, 1000);
    return () => clearTimeout(timer);
  }, [apiConfig.lastSaveCompletedAt, onClose]);

  const modalRef = useRef<HTMLDivElement>(null);

  // Focus trap
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!isFirstRun) onClose();
      } else if (e.key === 'Tab') {
        if (!modalRef.current) return;
        const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length === 0) return;
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            lastElement.focus();
            e.preventDefault();
          }
        } else {
          if (document.activeElement === lastElement) {
            firstElement.focus();
            e.preventDefault();
          }
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, isFirstRun]);

  // Set initial focus
  useEffect(() => {
    if (isOpen && modalRef.current) {
      const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusableElements.length > 0) {
        setTimeout(() => focusableElements[0].focus(), 100);
      }
    }
  }, [isOpen]);

  // Removed if (!isOpen) return null; to handle AnimatePresence externally if needed, but since it's an overlay we can keep it inside AnimatePresence here.

  const testErrorMessage = (result: ApiTestResult) => {
    switch (result.errorType) {
      case 'missing_key':
        return t('api.testError.missing_key');
      case 'missing_base_url':
        return t('api.testError.missing_base_url');
      case 'unauthorized':
        return t('api.testError.unauthorized');
      case 'not_found':
        return t('api.testError.not_found');
      case 'rate_limited':
        return t('api.testError.rate_limited');
      case 'server_error':
        return t('api.testError.server_error');
      case 'network_error':
        return t('api.testError.network_error');
      case 'ollama_not_running':
        return t('api.testError.ollama_not_running');
      case 'lmstudio_not_running':
        return t('api.testError.lmstudio_not_running');
      default:
        return t('api.testError.unknown');
    }
  };

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
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-labelledby="config-modal-title"
        >
          <motion.div
            ref={modalRef}
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="flex max-h-[88vh] w-full max-w-[1040px] flex-col overflow-hidden rounded-[2rem] border border-border-subtle bg-background shadow-elevated mx-4"
          >
            <div className="flex items-center justify-between border-b border-border-muted bg-background/88 px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border-subtle bg-background-secondary/88 text-accent">
                  <Key className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.14em] text-text-muted">
                    {t('settings.title')}
                  </p>
                  <h2 id="config-modal-title" className="mt-1 text-[1.15rem] font-semibold tracking-[-0.02em] text-text-primary">
                    {isFirstRun ? t('api.firstRunTitle') : t('api.settingsTitle')}
                  </h2>
                  <p className="text-sm text-text-secondary">
                    {isFirstRun ? t('api.firstRunSubtitle') : t('api.settingsSubtitle')}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="rounded-xl p-2 transition-colors hover:bg-surface-hover"
                aria-label={t('common.close', 'Close')}
              >
                <X className="h-5 w-5 text-text-secondary" />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto bg-background/70 p-6">
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
                testResult={apiConfig.testResult}
                friendlyTestDetails={apiConfig.friendlyTestDetails}
                testErrorMessage={testErrorMessage}
              />

              {apiConfig.error && (
                <div className="flex items-center gap-2 rounded-xl bg-error/10 px-4 py-3 text-sm text-error">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  {apiConfig.error}
                </div>
              )}
            </div>

            <div className="border-t border-border bg-surface-hover px-6 py-4">
              {apiConfig.successMessage && (
                <div className="mb-3 flex items-center gap-2 rounded-xl bg-success/10 px-4 py-3 text-sm text-success">
                  <CheckCircle className="h-4 w-4 flex-shrink-0" />
                  {apiConfig.successMessage}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={apiConfig.handleTest}
                  disabled={apiConfig.isTesting || (apiConfig.requiresApiKey && !apiConfig.hasUsableApiKey)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-3 font-medium text-text-primary transition-all hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {apiConfig.isTesting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t('api.testingConnection')}
                    </>
                  ) : (
                    <>
                      <Plug className="h-4 w-4" />
                      {t('api.testConnection')}
                    </>
                  )}
                </button>
                <button
                  onClick={() => {
                    void apiConfig.handleSave();
                  }}
                  disabled={apiConfig.isSaving || (apiConfig.requiresApiKey && !apiConfig.hasUsableApiKey)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 font-medium text-white transition-all hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {apiConfig.isSaving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t('common.saving')}
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" />
                      {isFirstRun ? t('api.getStarted') : t('api.saveSettings')}
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
