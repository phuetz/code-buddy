import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useBackendStatus, type BackendStatus } from '../hooks/use-backend-status';

/**
 * Small permanent badge showing the Code Buddy backend status. Mirrors
 * the chat-ui gitnexus-rs `BackendStatus` UX: a colored dot in a
 * compact pill, click to open a tooltip-popup with the endpoint, last
 * success time, and the latest error if any.
 *
 * Hidden entirely when the CodeBuddy integration is disabled in
 * config (no need to occupy precious titlebar real estate for a
 * never-going-to-light-up badge).
 */
export function HealthBadge() {
  const { t } = useTranslation();
  const status = useBackendStatus();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  if (status.status === 'disabled') return null;

  const style = badgeStyleFor(status.status);
  const labelKey = `healthBadge.status.${status.status}`;
  const label = t(labelKey, defaultLabelFor(status.status));

  return (
    <div ref={containerRef} className="relative" data-testid="health-badge">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] transition-colors ${style.pill}`}
        aria-label={label}
        aria-expanded={open}
        title={label}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
        <span className="hidden sm:inline">{label}</span>
      </button>
      {open && <HealthPopup status={status} />}
    </div>
  );
}

function HealthPopup({ status }: { status: BackendStatus }) {
  const { t } = useTranslation();
  const lastSuccess = status.lastSuccessAt
    ? new Date(status.lastSuccessAt).toLocaleTimeString()
    : t('healthBadge.never', 'jamais');

  return (
    <div
      role="dialog"
      className="absolute right-0 top-full mt-1 w-72 z-50 rounded-lg border border-border bg-surface shadow-lg p-3 text-[12px]"
    >
      <div className="font-medium text-text-primary mb-2">
        {t('healthBadge.title', 'Backend Code Buddy')}
      </div>
      <div className="space-y-1 text-text-muted">
        <Row label={t('healthBadge.endpoint', 'Endpoint')} value={status.endpoint ?? '—'} />
        <Row
          label={t('healthBadge.statusLabel', 'État')}
          value={t(`healthBadge.status.${status.status}`, defaultLabelFor(status.status))}
        />
        {status.version && (
          <Row label={t('healthBadge.version', 'Version')} value={status.version} />
        )}
        <Row label={t('healthBadge.lastSuccess', 'Dernier OK')} value={lastSuccess} />
        {status.lastError && (
          <Row
            label={t('healthBadge.lastError', 'Dernière erreur')}
            value={status.lastError}
            isError
          />
        )}
      </div>
    </div>
  );
}

function Row({ label, value, isError }: { label: string; value: string; isError?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-text-muted/80">{label}</span>
      <span
        className={`text-right break-all ${isError ? 'text-error' : 'text-text-primary'}`}
        style={{ maxWidth: '70%' }}
      >
        {value}
      </span>
    </div>
  );
}

interface BadgeStyle {
  pill: string;
  dot: string;
}

function badgeStyleFor(status: BackendStatus['status']): BadgeStyle {
  switch (status) {
    case 'online':
      return {
        pill: 'border-success/40 bg-success/10 text-success hover:bg-success/15',
        dot: 'bg-success animate-pulse',
      };
    case 'checking':
    case 'unknown':
      return {
        pill: 'border-warning/40 bg-warning/10 text-warning hover:bg-warning/15',
        dot: 'bg-warning animate-pulse',
      };
    case 'offline':
      return {
        pill: 'border-error/40 bg-error/10 text-error hover:bg-error/15',
        dot: 'bg-error',
      };
    case 'disabled':
    default:
      return {
        pill: 'border-border-subtle bg-surface text-text-muted',
        dot: 'bg-text-muted/40',
      };
  }
}

function defaultLabelFor(status: BackendStatus['status']): string {
  switch (status) {
    case 'online':
      return 'En ligne';
    case 'checking':
      return 'Vérification…';
    case 'offline':
      return 'Hors ligne';
    case 'disabled':
      return 'Désactivé';
    case 'unknown':
    default:
      return 'Inconnu';
  }
}
