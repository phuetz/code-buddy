import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store';
import { APP_NAME } from '../../brand';
import { SettingsImportExport } from './SettingsImportExport';

export function SettingsGeneral() {
  const { i18n, t } = useTranslation();
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const currentLang = i18n.language.startsWith('zh')
    ? 'zh'
    : i18n.language.startsWith('fr')
      ? 'fr'
      : 'en';
  const [appVer, setAppVer] = useState('');
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
    { value: 'system' as const, label: t('general.themeSystem', 'System') },
  ];

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
