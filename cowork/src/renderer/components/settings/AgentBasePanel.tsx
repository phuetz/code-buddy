import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Import,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
} from 'lucide-react';
import type {
  AgentBaseAuditEvent,
  AgentBaseCodeBuddyImportCandidate,
  AgentBaseConnector,
  AgentBasePermission,
} from '../../../shared/agentbase-types';

const PERMISSION_LABELS: Record<AgentBasePermission, string> = {
  read: 'Lecture',
  write: 'Écriture',
  external: 'Action externe',
};

export function AgentBasePanel({ isActive }: { isActive: boolean }) {
  const [connectors, setConnectors] = useState<AgentBaseConnector[]>([]);
  const [audit, setAudit] = useState<AgentBaseAuditEvent[]>([]);
  const [imports, setImports] = useState<AgentBaseCodeBuddyImportCandidate[]>([]);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!window.electronAPI?.agentBase) return;
    setLoading(true);
    setError(null);
    try {
      const discovery = window.electronAPI.agentBase.discoverCodeBuddy
        ? window.electronAPI.agentBase.discoverCodeBuddy()
        : Promise.resolve({ ok: true as const, candidates: [], warnings: [] });
      const [nextConnectors, nextAudit, discovered] = await Promise.all([
        window.electronAPI.agentBase.list(),
        window.electronAPI.agentBase.audit(8),
        discovery,
      ]);
      setConnectors(nextConnectors);
      setAudit(nextAudit);
      setImports(discovered.candidates);
      setImportWarnings(discovered.warnings);
      if (!discovered.ok && discovered.error) setError(discovered.error);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isActive) void load();
  }, [isActive, load]);

  const configured = useMemo(
    () => connectors.filter((connector) => connector.installed),
    [connectors]
  );
  const availableCount = connectors.length - configured.length;

  const togglePermission = useCallback(
    async (connector: AgentBaseConnector, permission: AgentBasePermission) => {
      const next = await window.electronAPI.agentBase.setPermissions(connector.id, {
        [permission]: !connector.permissions[permission],
      });
      if (!next) return;
      setConnectors((current) =>
        current.map((candidate) =>
          candidate.id === connector.id ? { ...candidate, permissions: next } : candidate
        )
      );
      setAudit(await window.electronAPI.agentBase.audit(8));
    },
    []
  );

  const importCodeBuddyConnector = useCallback(async (candidateId: string) => {
    setImportingId(candidateId);
    setError(null);
    try {
      const result = await window.electronAPI.agentBase.importCodeBuddy(candidateId);
      if (!result.ok) throw new Error(result.error ?? 'Import MCP impossible.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setImportingId(null);
    }
  }, [load]);

  return (
    <section
      className="rounded-xl border border-accent/25 bg-accent/5 p-4 space-y-3"
      data-testid="agentbase-panel"
      aria-label="AgentBase connector control center"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <Sparkles className="w-4 h-4 text-accent" />
            AgentBase local
          </div>
          <p className="mt-1 text-xs text-text-muted">
            Vue unifiée des connecteurs MCP réellement installés. Les actions d’écriture ou
            externes exigent une permission puis une confirmation humaine fraîche.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="p-2 rounded-md text-text-muted hover:text-accent hover:bg-accent/10 disabled:opacity-50"
          title="Actualiser AgentBase"
          aria-label="Actualiser AgentBase"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Metric label="Configurés" value={configured.length} />
        <Metric label="Connectés" value={configured.filter((item) => item.status === 'connected').length} />
        <Metric label="Catalogue" value={availableCount} />
      </div>

      {error ? <div className="text-xs text-error">{error}</div> : null}

      {imports.length > 0 ? (
        <div className="rounded-lg border border-accent/25 bg-surface/70 p-3 space-y-2" data-testid="agentbase-codebuddy-imports">
          <div className="flex items-start gap-2">
            <Import className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <div>
              <div className="text-xs font-semibold text-text-primary">Configurations Code Buddy détectées</div>
              <p className="mt-0.5 text-[11px] text-text-muted">
                L’import crée un connecteur désactivé. Aucune commande n’est lancée et aucune valeur
                secrète n’est copiée ; relis ensuite sa fiche MCP avant de l’activer.
              </p>
            </div>
          </div>
          <div className="space-y-1.5">
            {imports.map((candidate) => (
              <div key={candidate.id} className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-2.5 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-text-primary">
                    <SquareTerminal className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{candidate.name}</span>
                    <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[9px] uppercase text-text-muted">{candidate.source}</span>
                  </div>
                  <div className="mt-1 truncate font-mono text-[10px] text-text-muted">
                    {candidate.command ?? candidate.url ?? candidate.transport}
                  </div>
                  {candidate.secretEnvKeys.length > 0 ? (
                    <div className="mt-1 text-[10px] text-warning">
                      Variables héritées sans copie : {candidate.secretEnvKeys.join(', ')}
                    </div>
                  ) : null}
                  {candidate.issue ? <div className="mt-1 text-[10px] text-error">{candidate.issue}</div> : null}
                </div>
                <button
                  type="button"
                  disabled={!candidate.importable || candidate.alreadyConfigured || importingId !== null}
                  onClick={() => void importCodeBuddyConnector(candidate.id)}
                  className="shrink-0 rounded-md border border-accent/35 bg-accent/10 px-2.5 py-1.5 text-[11px] font-medium text-accent hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid={`agentbase-import-${candidate.id}`}
                >
                  {candidate.alreadyConfigured
                    ? 'Déjà configuré'
                    : importingId === candidate.id
                      ? 'Import…'
                      : 'Importer désactivé'}
                </button>
              </div>
            ))}
          </div>
          {importWarnings.length > 0 ? (
            <details className="text-[10px] text-text-muted">
              <summary className="cursor-pointer">{importWarnings.length} avertissement(s) de découverte</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {importWarnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      {configured.length > 0 ? (
        <div className="space-y-2" data-testid="agentbase-configured-list">
          {configured.map((connector) => (
            <div key={connector.id} className="rounded-lg border border-border bg-surface/80 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-text-primary truncate">{connector.name}</div>
                  <div className="flex items-center gap-2 mt-1 text-[11px] text-text-muted">
                    <span className={connector.status === 'connected' ? 'text-success' : ''}>
                      {connector.status}
                    </span>
                    <span>·</span>
                    <span>{connector.tools.length} outils</span>
                    <span>·</span>
                    <span className="inline-flex items-center gap-1">
                      <KeyRound className="w-3 h-3" /> {connector.auth.mode}
                      {connector.auth.configured ? ' ✓' : ' requis'}
                    </span>
                  </div>
                </div>
                <ShieldCheck className="w-4 h-4 text-accent shrink-0" />
              </div>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {(Object.keys(PERMISSION_LABELS) as AgentBasePermission[]).map((permission) => {
                  const enabled = connector.permissions[permission];
                  return (
                    <button
                      key={permission}
                      type="button"
                      onClick={() => void togglePermission(connector, permission)}
                      className={`px-2 py-1 rounded-md border text-[11px] transition-colors ${
                        enabled
                          ? 'border-success/30 bg-success/10 text-success'
                          : 'border-border bg-surface-muted text-text-muted'
                      }`}
                      aria-pressed={enabled}
                      data-testid={`agentbase-permission-${connector.id}-${permission}`}
                    >
                      {PERMISSION_LABELS[permission]} {enabled ? 'autorisée' : 'bloquée'}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : loading ? null : (
        <div className="text-xs text-text-muted">Aucun connecteur MCP configuré.</div>
      )}

      {audit.length > 0 ? (
        <details className="rounded-lg border border-border bg-surface/60 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-text-secondary inline-flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5" /> Journal AgentBase ({audit.length})
          </summary>
          <div className="mt-2 space-y-1.5" data-testid="agentbase-audit-log">
            {audit.map((event) => (
              <div key={event.id} className="text-[11px] text-text-muted">
                <span className={event.success ? 'text-success' : 'text-error'}>{event.action}</span>
                {' · '}{event.detail}
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-surface/70 border border-border px-2 py-2">
      <div className="text-base font-semibold text-text-primary">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-text-muted">{label}</div>
    </div>
  );
}
