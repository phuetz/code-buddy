import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store';
import { APP_NAME } from '../../brand';
import { SettingsImportExport } from './SettingsImportExport';

export function SettingsGeneral() {
  const { i18n, t } = useTranslation();
  const settings = useAppStore((s) => s.settings);
  const appConfig = useAppStore((s) => s.appConfig);
  const setAppConfig = useAppStore((s) => s.setAppConfig);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const setSettings = useAppStore((s) => s.setSettings);
  const currentLang = i18n.language.startsWith('zh')
    ? 'zh'
    : i18n.language.startsWith('fr')
      ? 'fr'
      : 'en';
  const [appVer, setAppVer] = useState('');
  const [savingContextOptimization, setSavingContextOptimization] = useState(false);
  useEffect(() => {
    try {
      const v = window.electronAPI?.getVersion?.();
      if (v instanceof Promise) v.then(setAppVer);
      else if (v) setAppVer(v);
    } catch {
      /* ignore */
    }
  }, []);

  const languages = [
    { code: 'en', nativeName: 'English' },
    { code: 'fr', nativeName: 'Français' },
    { code: 'zh', nativeName: '中文' },
  ];

  const themeOptions = [
    { value: 'light' as const, label: t('general.themeLight') },
    { value: 'dark' as const, label: t('general.themeDark') },
    { value: 'ember' as const, label: t('general.themeEmber', 'Ember') },
    { value: 'genspark' as const, label: t('general.themeGenspark', 'Genspark') },
    { value: 'codex' as const, label: t('general.themeCodex', 'Codex') },
    { value: 'anthropic' as const, label: t('general.themeAnthropic', 'Anthropic') },
    { value: 'system' as const, label: t('general.themeSystem', 'System') },
  ];

  const activityDisplayOptions = [
    { value: 'compact_worklog' as const, label: t('general.compactWorklog', 'Compact Worklog') },
    {
      value: 'transparent_stream' as const,
      label: t('general.transparentStream', 'Transparent Stream'),
    },
  ];

  const memoryStrategyOptions = [
    { value: 'auto' as const, label: t('general.memoryAuto', 'Auto recall') },
    { value: 'manual' as const, label: t('general.memoryManual', 'Manual only') },
    { value: 'rolling' as const, label: t('general.memoryRolling', 'Rolling window') },
  ];

  const setActivityDisplayMode = (mode: 'compact_worklog' | 'transparent_stream') => {
    setSettings({ chatActivityDisplayMode: mode });
    try {
      window.localStorage?.setItem('cowork.chatActivityDisplayMode', mode);
    } catch {
      /* local persistence is best-effort */
    }
  };

  const setMemoryStrategy = (strategy: 'auto' | 'manual' | 'rolling') => {
    updateSettings({ memoryStrategy: strategy });
    try {
      window.localStorage?.setItem('cowork.memory.strategy', strategy);
    } catch {
      /* local persistence is best-effort */
    }
  };

  const [providers, setProviders] = useState<string[]>(['local', 'mem0', 'honcho', 'supermemory']);
  const [activeProvider, setActiveProvider] = useState<string>('local');

  useEffect(() => {
    if (window.electronAPI?.memoryProvider) {
      window.electronAPI.memoryProvider
        .list()
        .then(setProviders)
        .catch(() => {});
      window.electronAPI.memoryProvider
        .getActive()
        .then(setActiveProvider)
        .catch(() => {});
    }
  }, []);

  const handleProviderChange = async (providerId: string) => {
    if (window.electronAPI?.memoryProvider) {
      const res = await window.electronAPI.memoryProvider.setActive(providerId);
      if (res.success) {
        setActiveProvider(providerId);
      }
    }
  };
  const currentMemoryStrategy = settings.memoryStrategy ?? 'auto';
  const contextOptimizationMode = appConfig?.contextOptimizationMode ?? 'auto';

  const setContextOptimizationMode = async (mode: 'auto' | 'off') => {
    if (!window.electronAPI?.config || savingContextOptimization) return;
    setSavingContextOptimization(true);
    try {
      const result = await window.electronAPI.config.save({ contextOptimizationMode: mode });
      if (result.success && result.config) {
        setAppConfig(result.config);
      }
    } finally {
      setSavingContextOptimization(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Theme */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-text-primary">{t('general.appearance')}</h4>
        <div className="flex gap-2">
          {themeOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => updateSettings({ theme: opt.value })}
              className={`flex-1 px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                settings.theme === opt.value
                  ? 'border-accent bg-accent/5 text-text-primary'
                  : 'border-border bg-surface hover:border-accent/50 text-text-secondary'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Language */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-text-primary">{t('general.language')}</h4>
        <div className="flex gap-2">
          {languages.map((lang) => (
            <button
              key={lang.code}
              onClick={() => i18n.changeLanguage(lang.code)}
              className={`flex-1 px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                currentLang === lang.code
                  ? 'border-accent bg-accent/5 text-text-primary'
                  : 'border-border bg-surface hover:border-accent/50 text-text-secondary'
              }`}
            >
              {lang.nativeName}
            </button>
          ))}
        </div>
      </div>

      {/* Chat activity display */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-text-primary">
          {t('general.activityDisplay', 'Activity display')}
        </h4>
        <div className="flex gap-2">
          {activityDisplayOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setActivityDisplayMode(opt.value)}
              className={`flex-1 px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                (settings.chatActivityDisplayMode ?? 'compact_worklog') === opt.value
                  ? 'border-accent bg-accent/5 text-text-primary'
                  : 'border-border bg-surface hover:border-accent/50 text-text-secondary'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Memory strategy */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-text-primary">
          {t('general.memoryStrategy', 'Memory strategy')}
        </h4>
        <p className="text-xs text-text-muted">
          {t(
            'general.memoryStrategyDesc',
            'Controls when session recall is injected into new prompts.'
          )}
        </p>
        <div className="flex gap-2">
          {memoryStrategyOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setMemoryStrategy(opt.value)}
              className={`flex-1 px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                currentMemoryStrategy === opt.value
                  ? 'border-accent bg-accent/5 text-text-primary'
                  : 'border-border bg-surface hover:border-accent/50 text-text-secondary'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Memory Provider (GAP-10) */}
      <div className="space-y-3 pt-4 border-t border-border">
        <h4 className="text-sm font-medium text-text-primary">
          {t('general.memoryProvider', 'Memory Provider')}
        </h4>
        <p className="text-xs text-text-muted">
          {t(
            'general.memoryProviderDesc',
            'Select the active memory layer. Local SQLite is default; network providers are strictly opt-in.'
          )}
        </p>
        <select
          value={activeProvider}
          onChange={(e) => handleProviderChange(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border-2 border-border bg-surface text-sm text-text-primary focus:border-accent outline-none"
        >
          {providers.map((p) => (
            <option key={p} value={p}>
              {p.toUpperCase()}
            </option>
          ))}
        </select>
      </div>

      {/* Recoverable context optimization */}
      <div className="space-y-3 pt-4 border-t border-border">
        <h4 className="text-sm font-medium text-text-primary">
          {t('general.contextOptimization', 'Context optimization')}
        </h4>
        <p className="text-xs text-text-muted">
          {t(
            'general.contextOptimizationDesc',
            'Auto uses local lm-resizer to reduce noisy tool output before it reaches the model. The exact raw result remains recoverable by tool call ID.'
          )}
        </p>
        <div
          className="flex gap-2"
          role="group"
          aria-label={t('general.contextOptimization', 'Context optimization')}
        >
          {(['auto', 'off'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              disabled={savingContextOptimization}
              onClick={() => void setContextOptimizationMode(mode)}
              className={`flex-1 px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all disabled:opacity-50 ${
                contextOptimizationMode === mode
                  ? 'border-accent bg-accent/5 text-text-primary'
                  : 'border-border bg-surface hover:border-accent/50 text-text-secondary'
              }`}
            >
              {mode === 'auto'
                ? t('general.contextOptimizationAuto', 'Auto (recommended)')
                : t('general.contextOptimizationOff', 'Off')}
            </button>
          ))}
        </div>
      </div>

      {/* Settings sync (Phase 2 step 19) */}
      <div className="pt-4 border-t border-border">
        <SettingsImportExport />
      </div>

      {/* About */}
      {appVer && (
        <div className="pt-4 border-t border-border">
          <p className="text-xs text-text-muted">
            {APP_NAME} v{appVer}
          </p>
        </div>
      )}
    </div>
  );
}
