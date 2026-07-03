import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Power, Copy, AlertCircle } from 'lucide-react';
import { useAppStore } from '../../store';

export function SettingsTunnel() {
  const { t } = useTranslation();
  // Defensive default: a persisted store from an older version (or a partial
  // test harness) may lack the slice — the panel must render, not throw.
  const tunnel = useAppStore((s) => s.ngrokTunnel) ?? { active: false, authToken: '', domain: '', url: null };
  const setTunnel = useAppStore((s) => s.setNgrokTunnel);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [localToken, setLocalToken] = useState(tunnel.authToken);
  const [localDomain, setLocalDomain] = useState(tunnel.domain);

  useEffect(() => {
    setLocalToken(tunnel.authToken);
    setLocalDomain(tunnel.domain);
  }, [tunnel.authToken, tunnel.domain]);

  const toggle = async () => {
    setLoading(true);
    setError(null);
    try {
      // Stub logic for toggling tunnel. For real implementation, would call an IPC.
      setTunnel({ 
        active: !tunnel.active, 
        authToken: localToken, 
        domain: localDomain 
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    const url = `https://${localDomain}`;
    if (!localDomain) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="p-4 space-y-4 max-w-2xl" data-testid="settings-tunnel">
      <div className="flex items-center gap-2">
        <Globe size={16} className="text-text-muted" />
        <h3 className="text-sm font-semibold">{t('tunnel.title', 'Public tunnel')}</h3>
      </div>

      <p className="text-xs text-text-muted">
        {t(
          'tunnel.intro',
          'Expose the embedded Cowork server on the public internet via Ngrok tunnel. JWT and rate-limiting still apply.'
        )}
      </p>

      <div className="border border-border-subtle rounded-lg p-4 space-y-4">
        
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Ngrok Auth Token
            </label>
            <input
              type="password"
              value={localToken}
              onChange={(e) => {
                setLocalToken(e.target.value);
                setTunnel({ authToken: e.target.value });
              }}
              placeholder="Enter your ngrok auth token"
              className="w-full px-3 py-1.5 text-xs rounded bg-surface border border-border-subtle focus:outline-none focus:border-accent"
              disabled={tunnel.active || loading}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Ngrok Domain (Optional)
            </label>
            <input
              type="text"
              value={localDomain}
              onChange={(e) => {
                setLocalDomain(e.target.value);
                setTunnel({ domain: e.target.value });
              }}
              placeholder="e.g. my-custom-domain.ngrok-free.app"
              className="w-full px-3 py-1.5 text-xs rounded bg-surface border border-border-subtle focus:outline-none focus:border-accent"
              disabled={tunnel.active || loading}
            />
          </div>
        </div>

        <div className="pt-2 flex items-center justify-between border-t border-border-subtle">
          <div>
            <div className="text-xs font-medium">
              {tunnel.active
                ? t('tunnel.statusActive', 'Tunnel active')
                : t('tunnel.statusInactive', 'Tunnel inactive')}
            </div>
            {tunnel.active && (
              <div className="text-[11px] text-text-muted mt-0.5">
                Provider: ngrok
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggle}
              disabled={loading}
              className={`flex items-center gap-1 px-4 py-2 text-xs font-medium rounded-md ${
                tunnel.active
                  ? 'bg-error/15 text-error hover:bg-error/25'
                  : 'bg-accent text-background hover:bg-accent-hover'
              } disabled:opacity-40 transition-colors`}
              data-testid="tunnel-toggle"
            >
              <Power size={14} />
              {tunnel.active ? t('tunnel.stop', 'Stop') : t('tunnel.start', 'Start')}
            </button>
          </div>
        </div>

        {tunnel.active && localDomain && (
          <div className="pt-2">
            <label className="block text-[11px] text-text-secondary mb-1">
              {t('tunnel.publicUrl', 'Public URL')}
            </label>
            <div className="flex items-center gap-1.5">
              <input
                readOnly
                value={`https://${localDomain}`}
                className="flex-1 px-2 py-1 text-xs font-mono rounded bg-surface border border-border-subtle"
                onFocus={(e) => e.currentTarget.select()}
                data-testid="tunnel-public-url"
              />
              <button
                type="button"
                onClick={copy}
                className="px-2 py-1 text-xs rounded hover:bg-surface-hover transition-colors"
                title="Copy URL"
              >
                <Copy size={14} />
              </button>
            </div>
            {copied && <p className="text-[10px] text-success mt-1">{t('common.copied', 'Copied!')}</p>}
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-error/10 border border-error/30 text-error text-xs">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="bg-warning/5 border border-warning/20 rounded-lg p-3">
        <p className="text-[11px] text-text-secondary">
          {t(
            'tunnel.securityNote',
            'Security checklist before enabling: JWT_SECRET set, rate-limit enabled, IP allowlist if possible, and 2FA on the cloud endpoint hosting your tunnel.'
          )}
        </p>
      </div>
    </div>
  );
}
