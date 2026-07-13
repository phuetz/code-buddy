/**
 * SettingsProfiles (Phase A1) — manage isolated Code Buddy config profiles
 * (`[profiles.<name>]` sections in the user toml) from Cowork.
 *
 * A profile is a named subset of config keys deep-merged over the base config
 * (the CLI activates it with `buddy --profile <name>`). Switching the active
 * profile takes effect on the embedded agent runtime only after a restart —
 * we surface that with the same restart-notice pattern as SettingsCoreEngine.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle2, Download, Layers, Plus, RotateCcw, Upload } from 'lucide-react';

interface ProfileSummary {
  name: string;
  active: boolean;
}

export function SettingsProfiles() {
  const { t } = useTranslation();
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newName, setNewName] = useState('');

  const load = useCallback(async () => {
    if (!window.electronAPI?.profiles) return;
    setLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.profiles.list();
      if (!result.ok) {
        setError(result.error ?? 'Failed to load profiles');
        return;
      }
      setProfiles(result.profiles);
      setActive(result.active);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async () => {
    if (!window.electronAPI?.profiles) return;
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await window.electronAPI.profiles.create(name);
      if (!result.ok) {
        setError(result.error ?? 'Create failed');
        return;
      }
      setProfiles(result.profiles ?? []);
      setActive(result.active ?? null);
      setNewName('');
      setNotice(
        t('profiles.created', 'Profile "{{name}}" created.', { name }),
      );
      setTimeout(() => setNotice(null), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSwitch = async (name: string | null) => {
    if (!window.electronAPI?.profiles) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await window.electronAPI.profiles.switch(name);
      if (!result.ok) {
        setError(result.error ?? 'Switch failed');
        return;
      }
      setProfiles(result.profiles ?? []);
      setActive(result.active ?? null);
      setNotice(
        t(
          'profiles.switched',
          'Profile selected and saved. Restart Cowork to apply it — the agent boots with this profile’s config overrides.',
        ),
      );
      setTimeout(() => setNotice(null), 6000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async (name: string) => {
    const result = await window.electronAPI?.profiles?.export(name);
    if (!result?.ok || !result.profile) {
      setError(result?.error ?? 'Export failed');
      return;
    }
    const blob = new Blob([JSON.stringify(result.profile, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${name}.codebuddy-profile.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice(`Profil « ${name} » exporté et signé.`);
  };

  const handleImport = async (file?: File) => {
    if (!file) return;
    try {
      const result = await window.electronAPI?.profiles?.import(JSON.parse(await file.text()));
      if (!result?.ok) {
        setError(result?.error ?? 'Import failed');
        return;
      }
      setProfiles(result.profiles ?? []);
      setActive(result.active ?? null);
      setNotice('Signature vérifiée. Profil importé sans secret embarqué.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="p-4 space-y-4 max-w-2xl">
      <div className="flex items-center gap-2">
        <Layers size={16} className="text-text-muted" />
        <h3 className="text-sm font-semibold">{t('profiles.title', 'Config profiles')}</h3>
      </div>

      <p className="text-xs text-text-muted">
        {t(
          'profiles.intro',
          'Profiles are named, isolated sets of config overrides ([profiles.<name>] in your user config.toml) deep-merged over the base config. The CLI activates one with `buddy --profile <name>`. Switching here selects the profile for Cowork\'s embedded agent runtime.',
        )}
      </p>

      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-border-muted px-2.5 py-1.5 text-xs text-text-secondary hover:bg-surface-hover">
        <Upload size={12} /> Importer un profil signé
        <input type="file" accept="application/json" className="hidden" onChange={(event) => void handleImport(event.target.files?.[0])} />
      </label>

      {/* Restart notice (mirrors SettingsCoreEngine) */}
      <div className="p-2 rounded bg-warning/10 border border-warning/30 text-warning text-[11px] flex gap-2 items-start">
        <RotateCcw size={11} className="mt-0.5 shrink-0" />
        <div>
          {t(
            'profiles.restartRequired',
            'Switching a profile takes effect after a Cowork restart. Active sessions keep their current profile.',
          )}
        </div>
      </div>

      {/* Create profile */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-text-primary">
          {t('profiles.create', 'Create profile')}
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCreate();
            }}
            placeholder={t('profiles.namePlaceholder', 'e.g. deep-review')}
            className="flex-1 px-2.5 py-1.5 text-xs rounded border border-border-muted bg-surface focus:outline-none focus:border-accent text-text-primary placeholder:text-text-muted"
            data-testid="profiles-new-name"
          />
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={busy || !newName.trim()}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-accent text-background disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent-hover transition-colors"
            data-testid="profiles-create-btn"
          >
            <Plus size={12} />
            {t('profiles.create', 'Create profile')}
          </button>
        </div>
        <p className="text-[11px] text-text-muted">
          {t(
            'profiles.createHint',
            'A new profile is seeded from the default config (its active model) so you can refine it in your config.toml.',
          )}
        </p>
      </div>

      {/* Profile list */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-text-primary">
          {t('profiles.listTitle', 'Profiles')}
        </div>
        {loading && (
          <p className="text-[11px] text-text-muted italic">{t('common.loading', 'Loading…')}</p>
        )}
        {!loading && profiles.length === 0 && (
          <p className="text-[11px] text-text-muted italic">
            {t('profiles.empty', 'No profiles defined yet. Create one above.')}
          </p>
        )}
        {profiles.map((profile) => (
          <div
            key={profile.name}
            className={`flex items-center justify-between gap-3 p-3 rounded border ${
              profile.active ? 'border-accent bg-accent/5' : 'border-border-muted'
            }`}
            data-testid={`profiles-row-${profile.name}`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-mono text-text-primary truncate">{profile.name}</span>
              {profile.active && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-accent/15 text-accent">
                  <CheckCircle2 size={10} />
                  {t('profiles.active', 'Active')}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => void handleExport(profile.name)} className="rounded border border-border-muted p-1.5 text-text-muted hover:bg-surface-hover" title="Exporter et signer"><Download size={12} /></button>
              <button
                type="button"
                onClick={() => void handleSwitch(profile.name)}
                disabled={busy || profile.active}
                className="px-2.5 py-1 text-xs rounded border border-border-muted text-text-secondary hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                data-testid={`profiles-switch-${profile.name}`}
              >
                {t('profiles.switch', 'Switch')}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Use base config (clear active profile) */}
      {active !== null && (
        <button
          type="button"
          onClick={() => void handleSwitch(null)}
          disabled={busy}
          className="text-[11px] text-text-muted hover:text-text-primary underline disabled:opacity-50"
        >
          {t('profiles.useBase', 'Use base config (no profile)')}
        </button>
      )}

      {error && (
        <div className="p-2 rounded bg-error/10 border border-error/30 text-error text-xs flex gap-2 items-start">
          <AlertCircle size={12} className="mt-0.5" />
          <div>{error}</div>
        </div>
      )}

      {notice && (
        <div className="p-2 rounded bg-success/10 border border-success/30 text-success text-xs">
          {notice}
        </div>
      )}
    </div>
  );
}
