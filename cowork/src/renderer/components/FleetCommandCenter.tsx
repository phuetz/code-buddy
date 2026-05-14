/**
 * FleetCommandCenter — Cowork's multi-AI command center (Fleet P5).
 *
 * Three-column layout:
 *   - LEFT  (35%): peer list with status badge, egress chip
 *                 (local/lan/cloud), model count, drag handle.
 *   - CENTER(40%): goal input + dispatch button. Lists active sagas
 *                 with progress bars and final results.
 *   - RIGHT (25%): currently-selected peer detail (capability, model
 *                 list with strengths chips, cost-per-Mtok).
 *
 * Activated from a Network icon in the titlebar (already imported).
 *
 * @module renderer/components/FleetCommandCenter
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Network,
  Cloud,
  HardDrive,
  Wifi,
  X,
  Send,
  AlertCircle,
  Loader2,
  CheckCircle2,
  CircleDashed,
  XCircle,
} from 'lucide-react';
import { useAppStore } from '../store';
import type { FleetPeer } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

interface SagaSummary {
  id: string;
  goal: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  steps: Array<{
    peerId: string;
    model: string;
    lane: 'primary' | 'fallback' | 'parallel';
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  }>;
  finalResult?: string;
  createdAt: number;
}

export const FleetCommandCenter: React.FC<Props> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const fleetPeers = useAppStore((s) => s.fleetPeers);
  const peers = useMemo(() => Object.values(fleetPeers), [fleetPeers]);
  // Wiring W7 — bumped on every fleet.saga.update event so we re-fetch
  // sagas reactively instead of waiting for the 3s polling cycle.
  const sagaUpdateToken = useAppStore((s) => s.fleetSagaUpdateToken);

  const [selectedPeerId, setSelectedPeerId] = useState<string | null>(null);
  const [goalText, setGoalText] = useState('');
  const [sagas, setSagas] = useState<SagaSummary[]>([]);
  const [dispatching, setDispatching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parallelism, setParallelism] = useState(1);
  const [privacyTag, setPrivacyTag] = useState<'public' | 'sensitive'>('public');

  // ESC closes
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // Refresh sagas every 3s while open.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const api = (
          window as unknown as {
            electronAPI?: {
              fleet?: { listSagas?: () => Promise<SagaSummary[]> };
            };
          }
        ).electronAPI;
        if (!api?.fleet?.listSagas) return;
        const list = await api.fleet.listSagas();
        if (!cancelled) setSagas(list);
      } catch {
        /* polish feature */
      }
    };
    void tick();
    const id = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isOpen, sagaUpdateToken]);

  const handleDispatch = async () => {
    if (!goalText.trim() || dispatching) return;
    setDispatching(true);
    setError(null);
    try {
      const api = (
        window as unknown as {
          electronAPI?: {
            fleet?: {
              dispatch?: (input: {
                goal: string;
                parallelism?: number;
                privacyTag?: 'public' | 'sensitive';
              }) => Promise<{ ok: boolean; sagaId?: string; error?: string }>;
            };
          };
        }
      ).electronAPI;
      if (!api?.fleet?.dispatch) {
        setError(t('fleet.bridgeUnavailable', 'Fleet IPC bridge unavailable'));
        return;
      }
      const result = await api.fleet.dispatch({
        goal: goalText.trim(),
        parallelism: parallelism > 1 ? parallelism : undefined,
        privacyTag,
      });
      if (!result.ok) {
        setError(result.error ?? 'dispatch failed');
        return;
      }
      setGoalText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDispatching(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      data-testid="fleet-command-center"
    >
      <div
        className="m-6 w-full max-w-7xl bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2">
            <Network size={14} className="text-accent" />
            <h2 className="text-sm font-medium text-zinc-200">
              {t('fleet.title', 'Fleet Command Center')}
            </h2>
            <span className="text-[10px] text-zinc-500 ml-2">
              {peers.length} {t('fleet.peers', 'peers')}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
            aria-label={t('common.close', 'Close')}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 flex min-h-0">
          {/* Left — peer list */}
          <div className="w-[35%] border-r border-zinc-800 overflow-y-auto">
            <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-zinc-500 sticky top-0 bg-zinc-900 border-b border-zinc-800">
              {t('fleet.peerList', 'Peers')}
            </div>
            {peers.length === 0 ? (
              <div className="p-6 text-xs text-zinc-500 text-center">
                  {t(
                    'fleet.noPeers',
                    'Aucun peer configuré. Ouvre le panneau Fleet pour scanner ou ajouter un peer Code Buddy.',
                  )}
                </div>
            ) : (
              <ul>
                {peers.map((p) => (
                  <PeerRow
                    key={p.id}
                    peer={p}
                    selected={p.id === selectedPeerId}
                    onSelect={() => setSelectedPeerId(p.id)}
                  />
                ))}
              </ul>
            )}
          </div>

          {/* Center — dispatch + sagas */}
          <div className="w-[40%] flex flex-col min-h-0">
            <div className="px-4 py-3 border-b border-zinc-800">
              <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">
                {t('fleet.dispatchGoal', 'Dispatch a goal to the fleet')}
              </label>
              <textarea
                value={goalText}
                onChange={(e) => setGoalText(e.target.value)}
                placeholder={t(
                  'fleet.goalPlaceholder',
                  'Décris ton objectif… le router choisira le meilleur peer × modèle (Cmd+Enter pour lancer)',
                )}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void handleDispatch();
                  }
                }}
                rows={3}
                className="w-full bg-zinc-800 border border-zinc-700 rounded p-2 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-accent resize-none"
              />
              <div className="flex items-center gap-2 mt-2">
                <label className="text-[10px] text-zinc-500">
                  {t('fleet.parallelism', 'Parallel')}:
                </label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={parallelism}
                  onChange={(e) =>
                    setParallelism(Math.max(1, Math.min(5, Number(e.target.value) || 1)))
                  }
                  className="w-12 bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5 text-[11px] text-zinc-200 focus:outline-none focus:border-accent"
                />
                <label className="text-[10px] text-zinc-500 ml-2">
                  {t('fleet.privacy', 'Privacy')}:
                </label>
                <select
                  value={privacyTag}
                  onChange={(e) =>
                    setPrivacyTag(e.target.value as 'public' | 'sensitive')
                  }
                  className="bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5 text-[11px] text-zinc-200 focus:outline-none focus:border-accent"
                >
                  <option value="public">public</option>
                  <option value="sensitive">sensitive (no cloud)</option>
                </select>
                <button
                  type="button"
                  onClick={() => void handleDispatch()}
                  disabled={!goalText.trim() || dispatching || peers.length === 0}
                  className="ml-auto flex items-center gap-1 px-3 py-1 text-xs rounded bg-accent text-background hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {dispatching ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <Send size={11} />
                  )}
                  {t('fleet.dispatch', 'Dispatch')}
                </button>
              </div>
              {error && (
                <div className="mt-2 p-2 bg-error/10 border border-error/30 rounded text-error text-[11px] flex items-start gap-1.5">
                  <AlertCircle size={11} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-zinc-500 sticky top-0 bg-zinc-900 border-b border-zinc-800">
                {t('fleet.activeSagas', 'Active sagas')} ({sagas.length})
              </div>
              {sagas.length === 0 ? (
                <div className="p-6 text-xs text-zinc-500 text-center">
                  {t('fleet.noSagas', 'Aucune saga en cours.')}
                </div>
              ) : (
                <ul className="px-2 py-1 space-y-1">
                  {sagas.map((s) => (
                    <SagaRow key={s.id} saga={s} />
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Right — peer detail */}
          <div className="w-[25%] border-l border-zinc-800 overflow-y-auto">
            <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-zinc-500 sticky top-0 bg-zinc-900 border-b border-zinc-800">
              {t('fleet.peerDetail', 'Peer detail')}
            </div>
            {!selectedPeerId ? (
              <div className="p-6 text-xs text-zinc-500 text-center">
                {t('fleet.selectPeerHint', 'Sélectionne un peer pour voir ses modèles.')}
              </div>
            ) : (
              <PeerDetail peer={fleetPeers[selectedPeerId]} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const PeerRow: React.FC<{
  peer: FleetPeer;
  selected: boolean;
  onSelect: () => void;
}> = ({ peer, selected, onSelect }) => {
  const cap = peer.capability;
  const egress = cap?.egress ?? 'local';
  const status = peer.status;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`w-full text-left px-4 py-2 border-b border-zinc-800/40 transition-colors ${
          selected ? 'bg-accent/15' : 'hover:bg-zinc-800/40'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-zinc-200 font-medium truncate">
            {peer.label ?? cap?.machineLabel ?? peer.id}
          </span>
          <StatusDot status={status} />
        </div>
        <div className="flex items-center gap-1.5 mt-1 text-[10px] text-zinc-500">
          <EgressChip egress={egress} />
          {cap && (
            <span>
              {cap.models.length} {cap.models.length === 1 ? 'model' : 'models'}
            </span>
          )}
          {cap?.machineSpec?.gpu && (
            <span className="truncate" title={cap.machineSpec.gpu}>
              · {cap.machineSpec.gpu}
            </span>
          )}
        </div>
      </button>
    </li>
  );
};

const PeerDetail: React.FC<{ peer?: FleetPeer }> = ({ peer }) => {
  if (!peer) return null;
  const cap = peer.capability;
  return (
    <div className="p-4 space-y-3 text-xs">
      <div>
        <div className="text-zinc-200 font-medium">
          {peer.label ?? cap?.machineLabel ?? peer.id}
        </div>
        <div className="text-zinc-500 text-[11px] truncate">{peer.url}</div>
      </div>
      {cap && (
        <>
          <div className="flex items-center gap-1.5 text-[11px]">
            <EgressChip egress={cap.egress} />
            {cap.machineSpec?.gpu && (
              <span className="text-zinc-400">{cap.machineSpec.gpu}</span>
            )}
            {cap.machineSpec?.ramGb && (
              <span className="text-zinc-500">{cap.machineSpec.ramGb} GB</span>
            )}
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
              Models ({cap.models.length})
            </div>
            <ul className="space-y-1.5">
              {cap.models.map((m) => (
                <li
                  key={m.id}
                  className="p-2 rounded border border-zinc-800 bg-zinc-800/40"
                >
                  <div className="font-mono text-[11px] text-zinc-200">{m.id}</div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">
                    {m.provider} · {(m.contextWindow / 1000).toFixed(0)}k ctx
                    {m.costInputUsdPerMtok !== undefined && (
                      <span> · ${m.costInputUsdPerMtok}/Mtok in</span>
                    )}
                  </div>
                  {m.strengths.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {m.strengths.map((s) => (
                        <span
                          key={s}
                          className="px-1.5 py-0.5 rounded bg-accent/10 text-accent text-[9px] uppercase tracking-wide"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
      {!cap && (
        <div className="text-zinc-500 italic">
          Capabilities not yet received from this peer.
        </div>
      )}
    </div>
  );
};

const SagaRow: React.FC<{ saga: SagaSummary }> = ({ saga }) => {
  const total = saga.steps.length;
  const done = saga.steps.filter((s) => s.status === 'completed').length;
  const failed = saga.steps.filter((s) => s.status === 'failed').length;
  const running = saga.steps.filter((s) => s.status === 'running').length;
  return (
    <li className="p-2 rounded border border-zinc-800 bg-zinc-800/30">
      <div className="flex items-center gap-2">
        <SagaStatusIcon status={saga.status} />
        <span className="text-xs text-zinc-200 truncate flex-1">{saga.goal}</span>
        <span className="text-[10px] text-zinc-500 tabular-nums">
          {done}/{total}
        </span>
      </div>
      <div className="mt-1.5 h-1 bg-zinc-800 rounded overflow-hidden flex">
        <div
          className="bg-success transition-all"
          style={{ width: `${(done / Math.max(1, total)) * 100}%` }}
        />
        <div
          className="bg-accent transition-all"
          style={{ width: `${(running / Math.max(1, total)) * 100}%` }}
        />
        <div
          className="bg-error transition-all"
          style={{ width: `${(failed / Math.max(1, total)) * 100}%` }}
        />
      </div>
      {saga.finalResult && (
        <details className="mt-1.5">
          <summary className="text-[10px] text-zinc-500 cursor-pointer hover:text-zinc-300">
            Voir le résultat final
          </summary>
          <pre className="mt-1 p-2 text-[11px] bg-zinc-900 rounded text-zinc-300 whitespace-pre-wrap overflow-x-auto max-h-32">
            {saga.finalResult}
          </pre>
        </details>
      )}
    </li>
  );
};

const StatusDot: React.FC<{ status: FleetPeer['status'] }> = ({ status }) => {
  const color =
    status === 'authenticated' || status === 'connected'
      ? 'bg-success'
      : status === 'reconnecting' || status === 'connecting'
        ? 'bg-warning animate-pulse'
        : status === 'error' || status === 'disconnected'
          ? 'bg-error'
          : 'bg-zinc-600';
  return <span className={`w-2 h-2 rounded-full shrink-0 ${color}`} />;
};

const EgressChip: React.FC<{ egress: 'local' | 'lan' | 'cloud' }> = ({ egress }) => {
  const Icon = egress === 'cloud' ? Cloud : egress === 'lan' ? Wifi : HardDrive;
  const color =
    egress === 'cloud' ? 'text-warning' : egress === 'lan' ? 'text-accent' : 'text-success';
  return (
    <span className={`flex items-center gap-0.5 ${color}`}>
      <Icon size={9} />
      <span className="uppercase tracking-wide">{egress}</span>
    </span>
  );
};

const SagaStatusIcon: React.FC<{ status: SagaSummary['status'] }> = ({ status }) => {
  if (status === 'running') {
    return <Loader2 size={11} className="text-accent animate-spin shrink-0" />;
  }
  if (status === 'completed') {
    return <CheckCircle2 size={11} className="text-success shrink-0" />;
  }
  if (status === 'failed' || status === 'cancelled') {
    return <XCircle size={11} className="text-error shrink-0" />;
  }
  return <CircleDashed size={11} className="text-zinc-500 shrink-0" />;
};
