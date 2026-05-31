import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ClipboardCheck, GitCompareArrows, ListChecks, Terminal } from 'lucide-react';
import type { TFunction } from 'i18next';

type HermesFeatureParityStatus = 'covered' | 'covered-partial' | 'partial' | 'gap';

export interface HermesFeatureParityItem {
  area: string;
  id: string;
  nextWork?: string;
  officialSurface: string;
  status: HermesFeatureParityStatus;
  verificationCommands: string[];
}

export interface HermesFeatureParitySummary {
  auditDocument: string;
  command: string;
  generatedAt: string;
  inspectedCommit: string;
  latestTagObserved: string;
  source: string;
  summary: {
    covered: number;
    coveredPartial: number;
    gaps: number;
    partial: number;
    total: number;
  };
  topWork: HermesFeatureParityItem[];
}

interface HermesFeatureParityApi {
  get?: () => Promise<HermesFeatureParitySummary | null>;
}

export function buildHermesFeatureParityCommand(): string {
  return 'buddy hermes parity --json';
}

function formatHermesFeatureParityStatus(
  status: HermesFeatureParityStatus,
  t: TFunction,
): string {
  switch (status) {
    case 'covered':
      return t('fleet.hermesFeatureParity.status.covered', 'covered');
    case 'covered-partial':
      return t('fleet.hermesFeatureParity.status.covered-partial', 'covered/partial');
    case 'partial':
      return t('fleet.hermesFeatureParity.status.partial', 'partial');
    case 'gap':
      return t('fleet.hermesFeatureParity.status.gap', 'gap');
    default:
      return status;
  }
}

export const HermesFeatureParityStrip: React.FC<{
  error?: string | null;
  parity?: HermesFeatureParitySummary | null;
}> = ({ error = null, parity }) => {
  const { t } = useTranslation();
  const [loadedParity, setLoadedParity] = useState<HermesFeatureParitySummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const command = useMemo(() => buildHermesFeatureParityCommand(), []);
  const visibleParity = parity ?? loadedParity;
  const visibleError = error ?? loadError;
  const summary = visibleParity?.summary;
  const substantiallyCovered = summary ? summary.covered + summary.coveredPartial : 0;
  const gapCount = summary?.gaps ?? 0;

  useEffect(() => {
    if (parity !== undefined) return;
    const api = getHermesFeatureParityApi();
    if (!api?.get) return;
    let cancelled = false;

    void api
      .get()
      .then((result) => {
        if (cancelled) return;
        setLoadedParity(result);
        setLoadError(null);
      })
      .catch((loadErrorValue: unknown) => {
        if (cancelled) return;
        setLoadedParity(null);
        setLoadError(
          loadErrorValue instanceof Error ? loadErrorValue.message : String(loadErrorValue)
        );
      });

    return () => {
      cancelled = true;
    };
  }, [parity]);

  return (
    <section
      className="mt-3 rounded border border-border-muted bg-surface/60 p-2"
      data-testid="fleet-hermes-feature-parity"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <GitCompareArrows size={11} className="shrink-0 text-accent" />
          <span className="truncate text-[10px] uppercase tracking-wider text-accent">
            {t('fleet.hermesFeatureParity.title', 'Hermes feature parity')}
          </span>
        </div>
        <span
          className={
            gapCount > 0
              ? 'shrink-0 rounded bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning'
              : 'shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent'
          }
        >
          {summary
            ? t('fleet.hermesFeatureParity.countChip', '{{covered}}/{{total}} major areas', {
                covered: substantiallyCovered,
                total: summary.total,
              })
            : t('fleet.hermesFeatureParity.loadingChip', 'parity')}
        </span>
      </div>

      {summary ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          <span className="rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent">
            {t('fleet.hermesFeatureParity.coveredChip', '{{count}} covered', {
              count: summary.covered,
            })}
          </span>
          <span className="rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent">
            {t('fleet.hermesFeatureParity.coveredPartialChip', '{{count}} covered/partial', {
              count: summary.coveredPartial,
            })}
          </span>
          <span className="rounded bg-warning/10 px-1 py-0.5 text-[9px] text-warning">
            {t('fleet.hermesFeatureParity.partialChip', '{{count}} partial', {
              count: summary.partial,
            })}
          </span>
          <span className="rounded bg-warning/10 px-1 py-0.5 text-[9px] text-warning">
            {t('fleet.hermesFeatureParity.gapChip', '{{count}} gaps', {
              count: summary.gaps,
            })}
          </span>
        </div>
      ) : null}

      {visibleError && (
        <div className="mt-1.5 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] text-warning">
          {t('fleet.hermesFeatureParity.loadFailed', 'Hermes feature parity load failed')}: {visibleError}
        </div>
      )}

      {visibleParity?.topWork.length ? (
        <ul className="mt-1.5 space-y-1">
          {visibleParity.topWork.slice(0, 6).map((feature) => (
            <li key={feature.id} className="min-w-0 rounded bg-surface/80 px-2 py-1">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="truncate text-[10px] text-text-secondary">
                  {feature.area}
                </span>
                <span
                  className={
                    feature.status === 'gap'
                      ? 'shrink-0 rounded bg-warning/10 px-1 py-0.5 text-[9px] text-warning'
                      : 'shrink-0 rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent'
                  }
                >
                  {formatHermesFeatureParityStatus(feature.status, t)}
                </span>
              </div>
              <div className="mt-0.5 truncate text-[9px] text-text-muted">
                {feature.nextWork || feature.officialSurface}
              </div>
              {feature.verificationCommands[0] ? (
                <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[9px] text-text-muted">
                  <ClipboardCheck size={9} className="shrink-0" />
                  <code className="truncate">{feature.verificationCommands[0]}</code>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
          {visibleParity ? (
            <ListChecks size={10} className="shrink-0 text-text-muted" />
          ) : (
            <AlertTriangle size={10} className="shrink-0 text-warning" />
          )}
          <span className="truncate">
            {visibleParity
              ? t('fleet.hermesFeatureParity.empty', 'No prioritized Hermes feature gaps.')
              : t('fleet.hermesFeatureParity.unavailable', 'Hermes feature parity is not loaded yet.')}
          </span>
        </div>
      )}

      <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
        <Terminal size={10} className="shrink-0 text-text-muted" />
        <code className="truncate">{visibleParity?.command || command}</code>
      </div>
    </section>
  );
};

function getHermesFeatureParityApi(): HermesFeatureParityApi | undefined {
  return (
    window as unknown as {
      electronAPI?: {
        tools?: {
          hermesFeatureParity?: HermesFeatureParityApi;
        };
      };
    }
  ).electronAPI?.tools?.hermesFeatureParity;
}
