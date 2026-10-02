import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Clock3, ShieldCheck, TimerReset, X } from 'lucide-react';
import type {
  MaisonDataStatus,
  MaisonMode,
  MaisonRendererApi,
  MaisonSnapshotPayload,
} from '../../../shared/maison-ipc.js';
import { GuidedTooltip } from '../Tooltip.js';
import { MaisonCard } from './MaisonCard.js';
import { useCoworkTranslation } from '../../i18n/translator.js';

const REFRESH_MS = 15_000;

export function MaisonHomeCard() {
  const t = useCoworkTranslation();
  const [payload, setPayload] = useState<MaisonSnapshotPayload | null>(null);
  const [status, setStatus] = useState<MaisonDataStatus>('loading');
  const mounted = useRef(true);
  const requestSequence = useRef(0);
  const mutationInFlight = useRef(false);

  const api = (): MaisonRendererApi | null => window.electronAPI?.maison ?? null;

  const load = useCallback(async (showLoading = true) => {
    if (mutationInFlight.current) return;
    const maison = api();
    if (!maison) {
      if (mounted.current) setStatus('unknown');
      return;
    }
    const requestId = ++requestSequence.current;
    if (showLoading && mounted.current) setStatus('loading');
    try {
      const next = await maison.snapshot();
      if (!mounted.current || requestId !== requestSequence.current) return;
      setPayload(next);
      setStatus(next.status);
      window.dispatchEvent(new CustomEvent('codebuddy:maison-updated', { detail: next }));
    } catch {
      if (mounted.current && requestId === requestSequence.current) setStatus('offline');
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void load(false);
    };
    const timer = window.setInterval(refreshWhenVisible, REFRESH_MS);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [load]);

  const mutate = useCallback(async (
    operation: (maison: MaisonRendererApi) => Promise<MaisonSnapshotPayload>
  ) => {
    const maison = api();
    if (!maison || mutationInFlight.current) return;
    mutationInFlight.current = true;
    const requestId = ++requestSequence.current;
    setStatus('loading');
    try {
      const next = await operation(maison);
      if (!mounted.current || requestId !== requestSequence.current) return;
      setPayload(next);
      setStatus(next.status);
      window.dispatchEvent(new CustomEvent('codebuddy:maison-updated', { detail: next }));
    } catch {
      if (mounted.current && requestId === requestSequence.current) setStatus('offline');
    } finally {
      mutationInFlight.current = false;
    }
  }, []);

  const setMode = (mode: MaisonMode) => mutate((maison) => maison.setMode({ mode }));

  return (
    <div className="w-full max-w-3xl" data-testid="maison-home-card">
      <MaisonCard
        snapshot={payload?.snapshot}
        status={status}
        onModeChange={(mode) => void setMode(mode)}
        onSilenceChange={(silent) => void setMode(silent ? 'silent' : 'normal')}
        onStartCooking={() => void setMode('cooking')}
        onGuestsChange={(enabled) => void setMode(enabled ? 'guests' : 'normal')}
        onRefresh={() => void load()}
      />

      {payload && (payload.activeTimers.length > 0 || payload.foodProfile.configured || payload.warnings.length > 0) ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2" data-testid="maison-live-details">
          {payload.activeTimers.length > 0 ? (
            <div
              className="rounded-2xl border border-border bg-surface px-3 py-2 shadow-soft"
              role="status"
              aria-live="polite"
            >
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                {t('maisonCard.persistentTimers')}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {payload.activeTimers.map((timer) => (
                  <span
                    key={timer.id}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] ${
                      timer.state === 'due'
                        ? 'border-warning/30 bg-warning/10 text-warning'
                        : 'border-accent/20 bg-accent/5 text-text-secondary'
                    }`}
                  >
                    <TimerReset className="h-3 w-3" aria-hidden="true" />
                    <span>{timer.label}</span>
                    <span className="font-mono">
                      {timer.state === 'due' ? t('maisonCard.timerDue') : t('maisonCard.timerRemaining', { minutes: Math.ceil(timer.remainingMs / 60_000) })}
                    </span>
                    {timer.state === 'due' ? (
                      <GuidedTooltip
                        title={t('maisonCard.ackTimerTitle')}
                        description={t('maisonCard.ackTimerDescription')}
                        kicker={t('maisonCard.kitchenKicker')}
                        side="top"
                      >
                        <button
                          type="button"
                          disabled={status !== 'ready'}
                          className="rounded-full p-0.5 hover:bg-warning/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning disabled:cursor-not-allowed disabled:opacity-40"
                          onClick={() => void mutate((maison) => maison.timerAcknowledge(timer.id))}
                          aria-label={t('maisonCard.ackTimerAria', { label: timer.label })}
                        >
                          <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </GuidedTooltip>
                    ) : null}
                    <button
                      type="button"
                      disabled={status !== 'ready'}
                      className="rounded-full p-0.5 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
                      onClick={() => void mutate((maison) => maison.timerCancel(timer.id))}
                      aria-label={t('maisonCard.cancelTimerAria', { label: timer.label })}
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {payload.foodProfile.configured ? (
            <div className="[&>span]:flex [&>span]:h-full [&>span]:w-full">
              <GuidedTooltip
                title={t('maisonCard.privateMealProfileTitle')}
                description={t('maisonCard.privateMealProfileDescription')}
                kicker={t('maisonCard.privacyKicker')}
                side="top"
              >
                <div className="h-full w-full rounded-2xl border border-success/15 bg-success/5 px-3 py-2 text-[10px] text-text-secondary shadow-soft">
                  <div className="font-semibold text-success">{t('maisonCard.encryptedMealProfile')}</div>
                  <div className="mt-0.5">
                    {t('maisonCard.explicitConstraints', { count: payload.foodProfile.constraintCount })}
                    {payload.foodProfile.unknownCount > 0
                      ? ` · ${t('maisonCard.toConfirm', { count: payload.foodProfile.unknownCount })}`
                      : ` · ${t('maisonCard.allConfirmed')}`}
                  </div>
                </div>
              </GuidedTooltip>
            </div>
          ) : null}

          {payload.warnings.length > 0 ? (
            <div
              className="sm:col-span-2 flex items-start gap-2 rounded-xl border border-warning/20 bg-warning/5 px-3 py-2 text-[10px] text-warning"
              role="alert"
              aria-live="assertive"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{payload.warnings.slice(0, 2).join(' ')}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
