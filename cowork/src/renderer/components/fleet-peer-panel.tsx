import React from 'react';
import { useTranslation } from 'react-i18next';
import { Cloud, HardDrive, Loader2, RefreshCw, Wifi } from 'lucide-react';
import type { FleetPeer } from '../types';
import { formatPeerSeenAt, peerStatusTone } from './fleet-command-center-helpers';

export const PeerRow: React.FC<{
  peer: FleetPeer;
  selected: boolean;
  onSelect: () => void;
}> = ({ peer, selected, onSelect }) => {
  const cap = peer.capability;
  const egress = cap?.egress ?? 'local';
  const status = peer.status;
  const chatSessionCount = peer.chatSessions?.length ?? 0;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`w-full text-left px-4 py-2 border-b border-border-muted transition-colors ${
          selected ? 'bg-accent/15' : 'hover:bg-surface-hover'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-text-primary font-medium truncate">
            {peer.label ?? cap?.machineLabel ?? peer.id}
          </span>
          <StatusDot status={status} />
        </div>
        <div className="flex items-center gap-1.5 mt-1 text-[10px] text-text-muted">
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
          {chatSessionCount > 0 && (
            <span>
              · {chatSessionCount} {chatSessionCount === 1 ? 'chat' : 'chats'}
            </span>
          )}
        </div>
      </button>
    </li>
  );
};

export const PeerDetail: React.FC<{
  peer?: FleetPeer;
  onRefreshCapabilities: (peerId: string) => void;
  refreshing: boolean;
}> = ({ peer, onRefreshCapabilities, refreshing }) => {
  const { t } = useTranslation();
  if (!peer) return null;
  const cap = peer.capability;
  const chatSessions = peer.chatSessions ?? [];
  const load =
    cap && cap.maxConcurrency
      ? `${cap.activeRequests ?? 0}/${cap.maxConcurrency}`
      : cap?.activeRequests !== undefined
        ? String(cap.activeRequests)
        : null;
  return (
    <div className="p-4 space-y-3 text-xs">
      <div>
        <div className="text-text-primary font-medium">
          {peer.label ?? cap?.machineLabel ?? peer.id}
        </div>
        <div className="text-text-muted text-[11px] truncate">{peer.url}</div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[10px]">
        <PeerStat
          label={t('fleet.detail.status', 'Status')}
          value={peer.status}
          tone={peerStatusTone(peer.status)}
        />
        <PeerStat label={t('fleet.detail.load', 'Load')} value={load ?? '-'} />
        <PeerStat
          label={t('fleet.detail.lastSeen', 'Last seen')}
          value={formatPeerSeenAt(peer.lastSeenAt)}
        />
        <PeerStat
          label={t('fleet.detail.lastEvent', 'Last event')}
          value={peer.lastEventType ?? '-'}
        />
      </div>
      {peer.lastError && (
        <div className="rounded border border-error/30 bg-error/10 px-2 py-1.5 text-[11px] text-error">
          {peer.lastError}
        </div>
      )}
      {cap && (
        <>
          <div className="flex items-center gap-1.5 text-[11px]">
            <EgressChip egress={cap.egress} />
            {peer.peerChatProvider && (
              <span className="min-w-0 truncate text-text-secondary">
                {peer.peerChatProvider.provider} / {peer.peerChatProvider.model}
                {peer.peerChatProvider.isLocal ? ' local' : ''}
              </span>
            )}
            {cap.machineSpec?.gpu && (
              <span className="text-text-secondary">{cap.machineSpec.gpu}</span>
            )}
            {cap.machineSpec?.ramGb && (
              <span className="text-text-muted">
                {t('fleet.detail.ramGb', '{{count}} GB', {
                  count: cap.machineSpec.ramGb,
                })}
              </span>
            )}
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">
              {t('fleet.detail.models', 'Models')} ({cap.models.length})
            </div>
            <ul className="space-y-1.5">
              {cap.models.map((m) => (
                <li key={m.id} className="p-2 rounded border border-border-muted bg-surface/70">
                  <div className="font-mono text-[11px] text-text-primary">{m.id}</div>
                  <div className="text-[10px] text-text-muted mt-0.5">
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
      {chatSessions.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">
            {t('fleet.detail.chatSessions', 'Chat sessions')} ({chatSessions.length})
          </div>
          <ul className="space-y-1.5">
            {chatSessions.map((session) => (
              <li
                key={session.sessionId}
                className="rounded border border-border-muted bg-surface/70 px-2 py-1.5"
              >
                <div className="flex items-center gap-1.5">
                  <span className="min-w-0 truncate font-mono text-[10px] text-text-secondary">
                    {shortSessionId(session.sessionId)}
                  </span>
                  {session.dispatchProfile && (
                    <span className="ml-auto rounded bg-accent/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-accent">
                      {session.dispatchProfile}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-[10px] text-text-muted">
                  {t('fleet.detail.turnCount', '{{count}} turn(s)', {
                    count: session.turnCount,
                  })}
                  {session.model ? ` · ${session.model}` : ''}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!cap && (
        <div className="rounded border border-warning/30 bg-warning/10 px-3 py-2">
          <div className="text-[11px] text-warning">
            {t('fleet.detail.capabilitiesMissing', 'Capabilities not yet received from this peer.')}
          </div>
          <button
            type="button"
            onClick={() => onRefreshCapabilities(peer.id)}
            disabled={refreshing}
            className="mt-2 inline-flex items-center gap-1 rounded border border-warning/40 px-2 py-1 text-[10px] text-warning hover:bg-warning/10 disabled:opacity-50"
          >
            {refreshing ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
            {t('fleet.detail.refreshThisPeer', 'Refresh this peer')}
          </button>
        </div>
      )}
    </div>
  );
};

function shortSessionId(sessionId: string): string {
  return sessionId.length <= 14 ? sessionId : `${sessionId.slice(0, 14)}...`;
}

export const PeerStat: React.FC<{
  label: string;
  value: string;
  tone?: string;
}> = ({ label, value, tone }) => (
  <div className="rounded border border-border-muted bg-surface/70 px-2 py-1.5">
    <div className="uppercase tracking-wide text-text-muted">{label}</div>
    <div className={`mt-0.5 truncate ${tone ?? 'text-text-secondary'}`}>{value}</div>
  </div>
);

const StatusDot: React.FC<{ status: FleetPeer['status'] }> = ({ status }) => {
  const color =
    status === 'authenticated' || status === 'connected'
      ? 'bg-success'
      : status === 'reconnecting' || status === 'connecting'
        ? 'bg-warning animate-pulse'
        : status === 'error' || status === 'disconnected'
          ? 'bg-error'
          : 'bg-border';
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
