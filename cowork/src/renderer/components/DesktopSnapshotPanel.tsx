/**
 * DesktopSnapshotPanel - passive screen inspection surface for GUI operation.
 *
 * Captures a smart snapshot through the desktopSnapshot preload bridge and
 * displays OCR/accessibility refs without executing any GUI action.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Image,
  Loader2,
  Monitor,
  MousePointer2,
  RefreshCw,
  Route,
  X,
} from 'lucide-react';
import { dialogA11yProps, trapFocus } from '../utils/a11y';
import type { DesktopSnapshotCaptureResult, DesktopSnapshotElement, DesktopSnapshotMethod } from '../types';
import { dispatchChatComposerInsert } from '../utils/chat-composer-events';
import { ScreenHelpButton } from './ScreenHelpButton';

interface DesktopSnapshotPanelProps {
  onClose: () => void;
}

type DesktopSnapshotApi = NonNullable<Window['electronAPI']>['desktopSnapshot'];

const METHOD_OPTIONS: DesktopSnapshotMethod[] = ['hybrid', 'accessibility', 'ocr'];

function getDesktopSnapshotApi(): DesktopSnapshotApi | undefined {
  return window.electronAPI?.desktopSnapshot;
}

function methodLabel(method: DesktopSnapshotMethod, t: ReturnType<typeof useTranslation>['t']): string {
  return t(`desktopSnapshot.method.${method}`, method);
}

function sortElements(elements: DesktopSnapshotElement[]): DesktopSnapshotElement[] {
  return [...elements].sort((a, b) => {
    if (a.interactive !== b.interactive) return a.interactive ? -1 : 1;
    return a.ref - b.ref;
  });
}

function formatTimestamp(value: string | undefined): string {
  if (!value) return '';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleString();
}

export function buildDesktopSnapshotActionPrompt(snapshotText: string): string {
  const context = snapshotText.trim();
  if (!context) return '';

  return [
    'Use this desktop snapshot as read-only GUI context.',
    '',
    context,
    '',
    'Task: identify the safest next GUI action and reference visible refs like [1] when possible.',
    'Guardrails: do not click, type, press keys, or mutate the desktop until I explicitly approve the exact action.',
  ].join('\n');
}

export function DesktopSnapshotPanel({ onClose }: DesktopSnapshotPanelProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const copyResetTimerRef = useRef<number | null>(null);
  const bridgeUnavailableLabel = t('desktopSnapshot.notAvailable', 'Desktop snapshot bridge is not available.');
  const [method, setMethod] = useState<DesktopSnapshotMethod>('hybrid');
  const [interactiveOnly, setInteractiveOnly] = useState(true);
  const [cropAnnotatedImage, setCropAnnotatedImage] = useState(true);
  const [status, setStatus] = useState<{ ok: boolean; platform?: string; error?: string } | null>(null);
  const [result, setResult] = useState<DesktopSnapshotCaptureResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [prepared, setPrepared] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (dialogRef.current) return trapFocus(dialogRef.current);
    return undefined;
  }, []);

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const api = getDesktopSnapshotApi();
    if (!api) {
      setStatus({ ok: false, error: bridgeUnavailableLabel });
      return;
    }
    void api
      .status()
      .then(setStatus)
      .catch((err) => {
        setStatus({ ok: false, error: err instanceof Error ? err.message : String(err) });
      });
  }, [bridgeUnavailableLabel]);

  const elements = useMemo(() => sortElements(result?.snapshot?.elements ?? []), [result]);
  const interactiveCount = elements.filter((element) => element.interactive).length;

  const capture = useCallback(async () => {
    const api = getDesktopSnapshotApi();
    if (!api) {
      setError(bridgeUnavailableLabel);
      return;
    }
    setLoading(true);
    setCopied(false);
    setPrepared(false);
    try {
      const next = await api.capture({
        method,
        interactiveOnly,
        includeAnnotatedImage: true,
        cropAnnotatedImage,
        ttlMs: 30_000,
      });
      if (!next.ok) throw new Error(next.error ?? 'Desktop snapshot failed.');
      setResult(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [bridgeUnavailableLabel, cropAnnotatedImage, interactiveOnly, method]);

  const copyContext = async () => {
    const text = result?.text;
    if (!text || !navigator.clipboard?.writeText) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current);
    copyResetTimerRef.current = window.setTimeout(() => {
      setCopied(false);
      copyResetTimerRef.current = null;
    }, 1500);
  };

  const prepareActionPrompt = () => {
    const prompt = buildDesktopSnapshotActionPrompt(result?.text ?? '');
    if (!dispatchChatComposerInsert(prompt)) return;
    setPrepared(true);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        ref={dialogRef}
        className="flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl"
        data-testid="desktop-snapshot-panel"
        {...dialogA11yProps(t('desktopSnapshot.title', 'Desktop Snapshot'))}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Monitor className="h-5 w-5 shrink-0 text-accent" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-text-primary">
                {t('desktopSnapshot.title', 'Desktop Snapshot')}
              </h2>
              <p className="truncate text-xs text-text-muted">
                {status?.platform
                  ? t('desktopSnapshot.platform', 'Platform {{value}}', { value: status.platform })
                  : t('desktopSnapshot.waiting', 'Waiting for desktop bridge')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
          <ScreenHelpButton screenId="desktop-snapshot" />
          <button
            aria-label={t('common.close', 'Close')}
            className="rounded p-1 text-text-muted hover:bg-surface hover:text-text-primary"
            onClick={onClose}
            type="button"
          >
            <X size={16} />
          </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
          <label className="flex items-center gap-1.5 text-xs text-text-muted">
            <span>{t('desktopSnapshot.method.label', 'Mode')}</span>
            <select
              className="rounded border border-border bg-surface px-2 py-1 text-xs text-text-primary"
              data-testid="desktop-snapshot-method"
              disabled={loading}
              onChange={(event) => setMethod(event.target.value as DesktopSnapshotMethod)}
              value={method}
            >
              {METHOD_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {methodLabel(option, t)}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs text-text-primary">
            <input
              checked={interactiveOnly}
              className="h-3.5 w-3.5"
              data-testid="desktop-snapshot-interactive-only"
              disabled={loading}
              onChange={(event) => setInteractiveOnly(event.target.checked)}
              type="checkbox"
            />
            {t('desktopSnapshot.interactiveOnly', 'Interactive refs')}
          </label>
          <label className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs text-text-primary">
            <input
              checked={cropAnnotatedImage}
              className="h-3.5 w-3.5"
              data-testid="desktop-snapshot-crop"
              disabled={loading}
              onChange={(event) => setCropAnnotatedImage(event.target.checked)}
              type="checkbox"
            />
            {t('desktopSnapshot.crop', 'Crop preview')}
          </label>
          <button
            className="inline-flex items-center gap-1.5 rounded bg-accent px-2.5 py-1.5 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50"
            data-testid="desktop-snapshot-capture"
            disabled={loading || status?.ok === false}
            onClick={() => void capture()}
            type="button"
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {loading ? t('desktopSnapshot.capturing', 'Capturing...') : t('desktopSnapshot.capture', 'Capture')}
          </button>
          <button
            className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-xs text-text-primary hover:bg-surface disabled:opacity-50"
            data-testid="desktop-snapshot-copy-context"
            disabled={!result?.text}
            onClick={() => void copyContext()}
            type="button"
          >
            {copied ? <CheckCircle2 size={13} className="text-green-500" /> : <Copy size={13} />}
            {copied ? t('desktopSnapshot.copied', 'Copied') : t('desktopSnapshot.copyContext', 'Copy context')}
          </button>
          <button
            className="inline-flex items-center gap-1.5 rounded border border-accent/50 px-2.5 py-1.5 text-xs text-accent hover:bg-accent/10 disabled:opacity-50"
            data-testid="desktop-snapshot-prepare-action"
            disabled={!result?.text}
            onClick={prepareActionPrompt}
            type="button"
          >
            {prepared ? <CheckCircle2 size={13} /> : <Route size={13} />}
            {prepared
              ? t('desktopSnapshot.preparedAction', 'Prompt ready')
              : t('desktopSnapshot.prepareAction', 'Prepare action')}
          </button>
        </div>

        {(error || status?.error) && (
          <div
            className="mx-4 mt-3 flex items-start gap-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200"
            data-testid="desktop-snapshot-error"
          >
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{error ?? status?.error}</span>
          </div>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
          <div className="min-h-0 overflow-auto border-b border-border bg-surface/30 p-4 lg:border-b-0 lg:border-r">
            {result?.annotatedImage?.dataUrl ? (
              <div className="flex min-h-full items-center justify-center">
                <img
                  alt={t('desktopSnapshot.imageAlt', 'Annotated desktop snapshot')}
                  className="max-h-[60vh] max-w-full rounded border border-border bg-background object-contain"
                  data-testid="desktop-snapshot-image"
                  src={result.annotatedImage.dataUrl}
                />
              </div>
            ) : (
              <div
                className="flex min-h-[320px] items-center justify-center rounded border border-dashed border-border text-xs text-text-muted"
                data-testid="desktop-snapshot-empty"
              >
                <div className="flex items-center gap-2">
                  <Image size={16} />
                  <span>{t('desktopSnapshot.empty', 'No snapshot captured')}</span>
                </div>
              </div>
            )}
          </div>

          <div className="flex min-h-0 flex-col overflow-hidden">
            <div className="border-b border-border px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold text-text-primary">{t('desktopSnapshot.refs', 'Refs')}</div>
                <div className="text-[11px] text-text-muted">
                  {t('desktopSnapshot.counts', '{{interactive}} / {{total}} interactive', {
                    interactive: interactiveCount,
                    total: elements.length,
                  })}
                </div>
              </div>
              {result?.snapshot && (
                <div className="mt-1 text-[11px] text-text-muted">
                  {formatTimestamp(result.snapshot.timestamp)} · {result.snapshot.screenSize.width}x
                  {result.snapshot.screenSize.height}
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-3">
              {elements.length === 0 ? (
                <div className="rounded border border-dashed border-border px-3 py-8 text-center text-xs text-text-muted">
                  {t('desktopSnapshot.noRefs', 'No refs detected')}
                </div>
              ) : (
                <div className="space-y-2">
                  {elements.slice(0, 120).map((element) => (
                    <div
                      className="rounded border border-border bg-background p-2"
                      data-testid="desktop-snapshot-element"
                      key={`${element.ref}-${element.name}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-white">
                              [{element.ref}]
                            </span>
                            <span className="truncate text-xs font-medium text-text-primary">
                              {element.name || t('desktopSnapshot.unnamed', 'Unnamed')}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-text-muted">
                            <span>{element.role}</span>
                            {element.interactive && (
                              <span className="inline-flex items-center gap-1 text-accent">
                                <MousePointer2 size={10} />
                                {t('desktopSnapshot.interactive', 'interactive')}
                              </span>
                            )}
                            {!element.enabled && <span>{t('desktopSnapshot.disabled', 'disabled')}</span>}
                          </div>
                        </div>
                        <div className="shrink-0 text-right text-[10px] text-text-muted">
                          {Math.round(element.center.x)}, {Math.round(element.center.y)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {result?.text && (
              <pre
                className="max-h-36 overflow-auto border-t border-border bg-surface/40 p-3 text-[10px] text-text-muted"
                data-testid="desktop-snapshot-text"
              >
                {result.text}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
