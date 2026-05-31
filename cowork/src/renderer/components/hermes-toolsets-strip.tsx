import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, SlidersHorizontal, Terminal } from 'lucide-react';
import type { FleetDispatchProfile } from './fleet-command-center-helpers';

type PolicyAction = 'allow' | 'confirm' | 'deny';

interface FleetDispatchToolDecision {
  action: PolicyAction;
  groups: string[];
  matchedGroup?: string;
  reason: string;
  source: string;
  tool: string;
}

export interface FleetHermesToolsetReview {
  allowGroups: string[];
  allowedTools: string[];
  confirmGroups: string[];
  confirmTools: string[];
  decisions: FleetDispatchToolDecision[];
  defaultAction: PolicyAction;
  deniedTools: string[];
  denyGroups: string[];
  intent: string;
  label: string;
  policyProfile: string;
  profile: FleetDispatchProfile;
  summary: string;
  systemPrompt: string;
  toolsetId: string;
}

export interface HermesToolsetsCatalogReview {
  activeProfile: FleetDispatchProfile;
  activeToolset: FleetHermesToolsetReview;
  command: string;
  generatedAt: string;
  guidance: Array<{
    label: string;
    policySummary: string;
    profile: FleetDispatchProfile;
    useWhen: string;
  }>;
  kind: 'hermes_toolsets_catalog';
  notes: string[];
  officialSource: {
    inspectedCommit: string;
    repository: string;
    sourceFiles: string[];
  };
  previewTools: string[];
  requestedProfile: string;
  schemaVersion: 1;
  summary: {
    profiles: FleetDispatchProfile[];
    totalToolsets: number;
  };
  toolsets: FleetHermesToolsetReview[];
}

interface HermesToolsetsApi {
  get?: (options?: { profile?: FleetDispatchProfile | string }) => Promise<HermesToolsetsCatalogReview | null>;
}

export function buildHermesToolsetsCommand(profile: FleetDispatchProfile): string {
  return `buddy hermes toolsets ${profile} --json`;
}

export const HermesToolsetsStrip: React.FC<{
  catalog?: HermesToolsetsCatalogReview | null;
  error?: string | null;
  profile: FleetDispatchProfile;
}> = ({ catalog, error = null, profile }) => {
  const { t } = useTranslation();
  const [loadedCatalog, setLoadedCatalog] = useState<HermesToolsetsCatalogReview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const command = useMemo(() => buildHermesToolsetsCommand(profile), [profile]);
  const visibleCatalog = catalog ?? loadedCatalog;
  const visibleError = error ?? loadError;
  const activeToolset = visibleCatalog?.activeToolset;
  const profiles = visibleCatalog?.summary.profiles ?? [];

  useEffect(() => {
    if (catalog !== undefined) return;
    const api = getHermesToolsetsApi();
    if (!api?.get) return;
    let cancelled = false;

    void api
      .get({ profile })
      .then((result) => {
        if (cancelled) return;
        setLoadedCatalog(result);
        setLoadError(null);
      })
      .catch((loadErrorValue: unknown) => {
        if (cancelled) return;
        setLoadedCatalog(null);
        setLoadError(
          loadErrorValue instanceof Error ? loadErrorValue.message : String(loadErrorValue)
        );
      });

    return () => {
      cancelled = true;
    };
  }, [catalog, profile]);

  return (
    <section
      className="mt-3 rounded border border-border-muted bg-surface/60 p-2"
      data-testid="fleet-hermes-toolsets"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <SlidersHorizontal size={11} className="shrink-0 text-accent" />
          <span className="truncate text-[10px] uppercase tracking-wider text-accent">
            {t('fleet.hermesToolsets.title', 'Hermes toolsets')}
          </span>
        </div>
        <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
          {activeToolset?.toolsetId ?? t('fleet.hermesToolsets.loadingChip', 'toolsets')}
        </span>
      </div>

      {activeToolset ? (
        <>
          <div className="mt-1.5 flex flex-wrap gap-1">
            <span className="rounded bg-success/10 px-1 py-0.5 text-[9px] text-success">
              {t('fleet.hermesToolsets.allowChip', '{{count}} allow', {
                count: activeToolset.allowedTools.length,
              })}
            </span>
            <span className="rounded bg-warning/10 px-1 py-0.5 text-[9px] text-warning">
              {t('fleet.hermesToolsets.confirmChip', '{{count}} confirm', {
                count: activeToolset.confirmTools.length,
              })}
            </span>
            <span className="rounded bg-error/10 px-1 py-0.5 text-[9px] text-error">
              {t('fleet.hermesToolsets.denyChip', '{{count}} deny', {
                count: activeToolset.deniedTools.length,
              })}
            </span>
            <span className="rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent">
              {t('fleet.hermesToolsets.profilesChip', '{{count}} profiles', {
                count: profiles.length,
              })}
            </span>
          </div>

          <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-secondary">
            <ShieldCheck size={10} className="shrink-0 text-accent" />
            <span className="line-clamp-2">{activeToolset.summary}</span>
          </div>

          <ul className="mt-1.5 grid grid-cols-2 gap-1">
            {visibleCatalog.toolsets.map((toolset) => (
              <li
                key={toolset.toolsetId}
                className="min-w-0 rounded border border-border-muted bg-surface/80 px-2 py-1"
                title={toolset.intent}
              >
                <span className="block truncate text-[10px] text-text-secondary">
                  {toolset.toolsetId}
                </span>
                <span className="block truncate text-[9px] text-text-muted">
                  {toolset.allowedTools.length}/{toolset.confirmTools.length}/{toolset.deniedTools.length}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="mt-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
          {t('fleet.hermesToolsets.unavailable', 'Hermes toolsets are not loaded yet.')}
        </div>
      )}

      {visibleError && (
        <div className="mt-1.5 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] text-warning">
          {t('fleet.hermesToolsets.loadFailed', 'Hermes toolsets load failed')}: {visibleError}
        </div>
      )}

      <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded bg-surface/80 px-2 py-1 text-[10px] text-text-muted">
        <Terminal size={10} className="shrink-0 text-text-muted" />
        <code className="truncate">{visibleCatalog?.command ?? command}</code>
      </div>
    </section>
  );
};

function getHermesToolsetsApi(): HermesToolsetsApi | undefined {
  return (
    window as unknown as {
      electronAPI?: {
        tools?: {
          hermesToolsets?: HermesToolsetsApi;
        };
      };
    }
  ).electronAPI?.tools?.hermesToolsets;
}
