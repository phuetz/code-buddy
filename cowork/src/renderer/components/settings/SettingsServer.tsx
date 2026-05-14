/**
 * SettingsServer — UI for the embedded Code Buddy HTTP server (the one
 * the titlebar power button starts). Lets users configure port, host,
 * websocket toggle, and a persistent JWT secret. Apply triggers a
 * stop/start cycle so the server picks up the new settings.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Save, Power, RefreshCw, Key, AlertCircle, CheckCircle2, RotateCcw, Loader2 } from 'lucide-react';

interface ServerSettings {
  port: number;
  host: string;
  websocketEnabled: boolean;
  jwtSecret: string;
}

interface ServerStatusShape {
  running: boolean;
  port: number | null;
  host: string | null;
  websocket: boolean;
  startedAt: number | null;
  error?: string | null;
}

const DEFAULTS: ServerSettings = {
  port: 3000,
  host: '127.0.0.1',
  websocketEnabled: true,
  jwtSecret: '',
};

export function SettingsServer() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<ServerSettings>(DEFAULTS);
  const [status, setStatus] = useState<ServerStatusShape | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!window.electronAPI?.server) return;
    try {
      const s = await window.electronAPI.server.status();
      setStatus(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const loadConfig = useCallback(async () => {
    if (!window.electronAPI?.config) return;
    setLoading(true);
    try {
      const cfg = await window.electronAPI.config.get();
      setSettings({
        port: cfg.server?.port ?? DEFAULTS.port,
        host: cfg.server?.host ?? DEFAULTS.host,
        websocketEnabled: cfg.server?.websocketEnabled ?? DEFAULTS.websocketEnabled,
        jwtSecret: cfg.server?.jwtSecret ?? '',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
    void refreshStatus();
    const id = setInterval(refreshStatus, 5000);
    return () => clearInterval(id);
  }, [loadConfig, refreshStatus]);

  const generateSecret = () => {
    // 64 random bytes hex-encoded — same shape as `crypto.randomBytes(64).toString('hex')`.
    const arr = new Uint8Array(64);
    crypto.getRandomValues(arr);
    const hex = Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
    setSettings((prev) => ({ ...prev, jwtSecret: hex }));
  };

  const handleSave = async () => {
    if (!window.electronAPI?.config) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await window.electronAPI.config.save({
        server: {
          port: settings.port,
          host: settings.host,
          websocketEnabled: settings.websocketEnabled,
          jwtSecret: settings.jwtSecret || undefined,
        },
      });
      if (!result.success) {
        setError('Save failed');
        return;
      }
      setNotice(t('settingsServer.saved', 'Server settings saved'));
      setTimeout(() => setNotice(null), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleApplyAndRestart = async () => {
    if (!window.electronAPI?.server) return;
    setRestarting(true);
    setError(null);
    try {
      await handleSave();
      // Stop then start so the server picks up the new persisted config.
      await window.electronAPI.server.stop();
      await window.electronAPI.server.start({});
      await refreshStatus();
      setNotice(t('settingsServer.applied', 'Settings applied — server restarted'));
      setTimeout(() => setNotice(null), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRestarting(false);
    }
  };

  const handleResetDefaults = () => {
    setSettings(DEFAULTS);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-text-muted py-8">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t('common.loading', 'Loading…')}
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="settings-server">
      <div>
        <h3 className="text-sm font-semibold text-text-primary">
          {t('settingsServer.title', 'Embedded HTTP server')}
        </h3>
        <p className="text-xs text-text-muted mt-1">
          {t(
            'settingsServer.hint',
            'Configure the Code Buddy HTTP server that the titlebar power button starts. Changes only apply after Apply & restart.'
          )}
        </p>
      </div>

      {/* Live status */}
      {status && (
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface/40 border border-border-muted">
          <Power
            size={14}
            className={status.running ? 'text-success' : 'text-text-muted'}
          />
          <div className="flex-1 text-xs">
            {status.running ? (
              <span>
                {t('settingsServer.running', 'Running')}{' '}
                <span className="font-mono text-text-secondary">
                  {status.host}:{status.port}
                  {status.websocket ? ' (+WS)' : ''}
                </span>
                {status.startedAt && (
                  <span className="text-text-muted ml-2">
                    {t('settingsServer.uptime', 'uptime')}{' '}
                    {Math.floor((Date.now() - status.startedAt) / 1000)}s
                  </span>
                )}
              </span>
            ) : (
              <span className="text-text-muted">
                {t('settingsServer.stopped', 'Stopped')}
                {status.error && (
                  <span className="text-error ml-2">— {status.error}</span>
                )}
              </span>
            )}
          </div>
          <button
            onClick={() => void refreshStatus()}
            className="text-text-muted hover:text-text-primary"
            title={t('common.refresh', 'Refresh')}
          >
            <RefreshCw size={12} />
          </button>
        </div>
      )}

      {notice && (
        <div className="flex items-center gap-2 text-xs text-success bg-success/10 border border-success/30 rounded-md px-3 py-2">
          <CheckCircle2 size={14} /> {notice}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-xs text-error bg-error/10 border border-error/30 rounded-md px-3 py-2">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {/* Settings fields */}
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              {t('settingsServer.port', 'Port')}
            </label>
            <input
              type="number"
              min={1}
              max={65535}
              value={settings.port}
              onChange={(e) =>
                setSettings((p) => ({ ...p, port: Number(e.target.value) || 3000 }))
              }
              className="w-full px-2 py-1.5 text-xs font-mono bg-surface border border-border rounded-md text-text-primary focus:outline-none focus:border-accent"
            />
            <div className="text-[10px] text-text-muted mt-1">
              {t('settingsServer.portHint', 'WebSocket uses the same port at /ws.')}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              {t('settingsServer.host', 'Host')}
            </label>
            <input
              type="text"
              value={settings.host}
              onChange={(e) => setSettings((p) => ({ ...p, host: e.target.value }))}
              placeholder="127.0.0.1"
              className="w-full px-2 py-1.5 text-xs font-mono bg-surface border border-border rounded-md text-text-primary focus:outline-none focus:border-accent"
            />
            <div className="text-[10px] text-text-muted mt-1">
              {t(
                'settingsServer.hostHint',
                '127.0.0.1 = local-only. Use 0.0.0.0 to expose on the LAN.'
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 px-3 py-2 rounded-md bg-surface/40 border border-border-muted">
          <input
            type="checkbox"
            id="websocketEnabled"
            checked={settings.websocketEnabled}
            onChange={(e) =>
              setSettings((p) => ({ ...p, websocketEnabled: e.target.checked }))
            }
            className="w-3.5 h-3.5"
          />
          <label htmlFor="websocketEnabled" className="text-xs text-text-secondary flex-1">
            {t('settingsServer.websocket', 'Enable WebSocket gateway')}
            <span className="text-text-muted ml-2">
              {t('settingsServer.websocketHint', '(needed for Code Buddy fleet peers)')}
            </span>
          </label>
        </div>

        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1 flex items-center gap-2">
            <Key size={12} />
            {t('settingsServer.jwt', 'JWT secret (auth tokens)')}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={settings.jwtSecret}
              onChange={(e) => setSettings((p) => ({ ...p, jwtSecret: e.target.value }))}
              placeholder={t(
                'settingsServer.jwtPlaceholder',
                '(empty = runtime-generated, lost on restart)'
              )}
              className="flex-1 px-2 py-1.5 text-xs font-mono bg-surface border border-border rounded-md text-text-primary focus:outline-none focus:border-accent"
            />
            <button
              onClick={generateSecret}
              className="px-3 py-1.5 text-xs bg-surface border border-border rounded-md text-text-secondary hover:bg-surface-hover whitespace-nowrap"
              title={t('settingsServer.jwtGenerate', 'Generate a fresh 64-byte secret')}
            >
              {t('settingsServer.jwtGenerate', 'Generate')}
            </button>
          </div>
          <div className="text-[10px] text-text-muted mt-1">
            {t(
              'settingsServer.jwtHint',
              'Persisted hex secret. Empty value falls back to a random secret minted at boot (auth tokens lost on Cowork restart).'
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2">
        <button
          onClick={() => void handleSave()}
          disabled={saving || restarting}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-surface border border-border text-text-primary hover:bg-surface-hover disabled:opacity-50 transition-colors"
        >
          <Save size={12} />
          {saving ? t('common.saving', 'Saving…') : t('common.save', 'Save')}
        </button>
        <button
          onClick={() => void handleApplyAndRestart()}
          disabled={saving || restarting}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
        >
          {restarting ? <Loader2 size={12} className="animate-spin" /> : <Power size={12} />}
          {restarting
            ? t('settingsServer.restarting', 'Restarting…')
            : t('settingsServer.applyRestart', 'Apply & restart')}
        </button>
        <button
          onClick={handleResetDefaults}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-surface border border-border text-text-secondary hover:bg-surface-hover ml-auto"
        >
          <RotateCcw size={12} />
          {t('common.reset', 'Reset')}
        </button>
      </div>
    </div>
  );
}
