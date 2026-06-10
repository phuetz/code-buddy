/**
 * FleetRoutePreview — "where would this goal go?" before dispatching.
 *
 * Dry-runs the privacy lint + classifier + TaskRouter (fleet.routePreview
 * IPC — no saga is created) and renders the routed lanes with their
 * scores and the router's rationale, so the operator can sanity-check
 * peer/model selection and privacy handling before spending anything.
 */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Route, X } from 'lucide-react';

interface PreviewLane {
  peerId: string;
  model: string;
  score?: number;
  role?: string;
}

interface RoutePreviewResult {
  ok: boolean;
  error?: string;
  privacyTag?: 'public' | 'sensitive';
  lintWarning?: string;
  rationale?: string;
  primary?: PreviewLane;
  fallback?: PreviewLane;
  parallel?: PreviewLane[];
  chain?: PreviewLane[];
}

export interface FleetRoutePreviewProps {
  goal: string;
  dispatchProfile: 'balanced' | 'research' | 'code' | 'review' | 'safe';
  privacyTag: 'public' | 'sensitive';
  parallelism: number;
  council: boolean;
  targetPeerIds: string[];
  disabled?: boolean;
}

function laneChips(label: string, lanes: PreviewLane[]): Array<{ label: string; lane: PreviewLane }> {
  return lanes.map((lane, index) => ({
    label: lanes.length > 1 ? `${label} ${index + 1}` : label,
    lane,
  }));
}

export const FleetRoutePreview: React.FC<FleetRoutePreviewProps> = ({
  goal,
  dispatchProfile,
  privacyTag,
  parallelism,
  council,
  targetPeerIds,
  disabled = false,
}) => {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<RoutePreviewResult | null>(null);
  const [loading, setLoading] = useState(false);

  const runPreview = async () => {
    if (!goal.trim() || loading) return;
    setLoading(true);
    try {
      const api = window.electronAPI as unknown as {
        fleet?: { routePreview?: (input: Record<string, unknown>) => Promise<RoutePreviewResult> };
      };
      if (!api?.fleet?.routePreview) {
        setPreview({ ok: false, error: 'Fleet IPC bridge unavailable' });
        return;
      }
      const effectiveParallelism = council ? Math.max(2, parallelism) : parallelism;
      const result = await api.fleet.routePreview({
        goal: goal.trim(),
        privacyTag,
        dispatchProfile,
        ...(effectiveParallelism > 1 ? { parallelism: effectiveParallelism } : {}),
        ...(council ? { council: true } : {}),
        ...(targetPeerIds.length > 0 ? { targetPeerIds } : {}),
      });
      setPreview(result);
    } catch (err) {
      setPreview({ ok: false, error: String(err) });
    } finally {
      setLoading(false);
    }
  };

  const lanes: Array<{ label: string; lane: PreviewLane }> = preview?.ok
    ? [
        ...(preview.chain ? laneChips(t('fleet.route.chain', 'chain'), preview.chain) : []),
        ...(preview.parallel ? laneChips(t('fleet.route.parallel', 'parallel'), preview.parallel) : []),
        ...(!preview.chain && !preview.parallel && preview.primary
          ? [{ label: t('fleet.route.primary', 'primary'), lane: preview.primary }]
          : []),
        ...(!preview.chain && !preview.parallel && preview.fallback
          ? [{ label: t('fleet.route.fallback', 'fallback'), lane: preview.fallback }]
          : []),
      ]
    : [];

  return (
    <div data-testid="fleet-route-preview">
      <button
        onClick={() => void runPreview()}
        disabled={disabled || loading || !goal.trim()}
        className="flex items-center gap-1 px-2 py-1 rounded border border-border text-text-secondary hover:text-text-primary hover:border-accent/50 disabled:opacity-50 text-xs"
        title={t(
          'fleet.route.previewHint',
          'Dry-run the router: see which peers/models would carry this goal — no saga is created.'
        )}
        data-testid="fleet-route-preview-button"
      >
        {loading ? <Loader2 size={11} className="animate-spin" /> : <Route size={11} />}
        {t('fleet.route.preview', 'Preview route')}
      </button>

      {preview && (
        <div
          className="mt-1.5 rounded border border-border-muted bg-surface/60 px-2.5 py-2 text-xs space-y-1.5"
          data-testid="fleet-route-preview-result"
        >
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-text-muted">
              {t('fleet.route.title', 'Planned route')}
            </span>
            {preview.privacyTag && (
              <span
                className={`text-[9px] px-1.5 py-0.5 rounded border uppercase ${
                  preview.privacyTag === 'sensitive'
                    ? 'border-warning/40 text-warning'
                    : 'border-border text-text-muted'
                }`}
              >
                {preview.privacyTag}
              </span>
            )}
            <button
              onClick={() => setPreview(null)}
              className="ml-auto p-0.5 text-text-muted hover:text-text-primary"
              title={t('common.close', 'Close')}
              data-testid="fleet-route-preview-close"
            >
              <X size={11} />
            </button>
          </div>
          {!preview.ok && (
            <p className="text-[11px] text-error" data-testid="fleet-route-preview-error">
              {preview.error}
            </p>
          )}
          {preview.lintWarning && (
            <p className="text-[10px] text-warning" data-testid="fleet-route-preview-lint">
              {preview.lintWarning}
            </p>
          )}
          {lanes.length > 0 && (
            <ol className="space-y-1">
              {lanes.map(({ label, lane }, index) => (
                <li
                  key={`${lane.peerId}-${lane.model}-${index}`}
                  className="flex items-center gap-2 rounded bg-surface/70 px-2 py-1 text-[11px]"
                  data-testid="fleet-route-preview-lane"
                >
                  <span className="shrink-0 text-[9px] uppercase tracking-wide text-text-muted">
                    {lane.role ?? label}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-text-secondary">{lane.peerId}</span>
                  <span className="min-w-0 max-w-[40%] truncate font-mono text-text-muted">{lane.model}</span>
                  {typeof lane.score === 'number' && (
                    <span className="shrink-0 tabular-nums text-[10px] text-text-muted">
                      {(lane.score * 100).toFixed(0)}%
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
          {preview.ok && preview.rationale && (
            <p className="text-[10px] leading-snug text-text-muted" data-testid="fleet-route-preview-rationale">
              {preview.rationale}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
