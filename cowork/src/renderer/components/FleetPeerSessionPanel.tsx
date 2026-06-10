/**
 * FleetPeerSessionPanel — interactive multi-turn chat with a remote peer.
 *
 * Drives the peer's `peer.chat-session.*` lifecycle (start / continue /
 * end / list) through the `fleet.peerSession*` IPC. The authoritative
 * transcript lives on the REMOTE peer; `list` returns metadata only
 * (never message content — core privacy guard). This panel keeps a local
 * transcript of the turns sent from this window, and attaching to a
 * pre-existing session shows new turns only.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, MessageSquarePlus, RefreshCw, Send, Square } from 'lucide-react';

interface PeerSessionMeta {
  sessionId: string;
  turnCount: number;
  model?: string;
  dispatchProfile?: string;
  expiresInMs?: number;
}

interface TranscriptTurn {
  role: 'user' | 'assistant';
  text: string;
}

interface PeerSessionApi {
  peerSessionStart: (
    peerId: string,
    options?: Record<string, unknown>
  ) => Promise<{ ok: boolean; error?: string; sessionId?: string }>;
  peerSessionSay: (
    peerId: string,
    sessionId: string,
    prompt: string
  ) => Promise<{ ok: boolean; error?: string; text?: string }>;
  peerSessionEnd: (
    peerId: string,
    sessionId: string
  ) => Promise<{ ok: boolean; error?: string; closed?: boolean }>;
  peerSessionList: (
    peerId: string
  ) => Promise<{ ok: boolean; error?: string; sessions: PeerSessionMeta[] }>;
}

function getApi(): PeerSessionApi | null {
  const api = (window as unknown as { electronAPI?: { fleet?: Partial<PeerSessionApi> } })
    .electronAPI;
  if (!api?.fleet?.peerSessionStart || !api.fleet.peerSessionSay || !api.fleet.peerSessionEnd || !api.fleet.peerSessionList) {
    return null;
  }
  return api.fleet as PeerSessionApi;
}

function shortSessionId(sessionId: string): string {
  return sessionId.length <= 14 ? sessionId : `${sessionId.slice(0, 14)}...`;
}

export const FleetPeerSessionPanel: React.FC<{ peerId: string }> = ({ peerId }) => {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<PeerSessionMeta[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<'start' | 'send' | 'end' | 'list' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    const api = getApi();
    if (!api) return;
    setBusy('list');
    try {
      const result = await api.peerSessionList(peerId);
      if (result.ok) {
        setSessions(result.sessions);
        setError(null);
      } else {
        setError(result.error ?? 'session list unavailable');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  }, [peerId]);

  // New peer selected — drop the local view and re-list.
  useEffect(() => {
    setActiveSessionId(null);
    setTranscript([]);
    setInput('');
    setError(null);
    void refreshList();
  }, [peerId, refreshList]);

  const startSession = async () => {
    const api = getApi();
    if (!api) return;
    setBusy('start');
    setError(null);
    try {
      const result = await api.peerSessionStart(peerId);
      if (result.ok && result.sessionId) {
        setActiveSessionId(result.sessionId);
        setTranscript([]);
        await refreshList();
      } else {
        setError(result.error ?? 'start failed');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  const attachSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
    // Earlier turns live on the peer only — the local transcript starts empty.
    setTranscript([]);
    setError(null);
  };

  const sendTurn = async () => {
    const api = getApi();
    const prompt = input.trim();
    if (!api || !activeSessionId || !prompt || busy) return;
    setBusy('send');
    setError(null);
    try {
      const result = await api.peerSessionSay(peerId, activeSessionId, prompt);
      if (result.ok) {
        setTranscript((prev) => [
          ...prev,
          { role: 'user', text: prompt },
          { role: 'assistant', text: result.text ?? '' },
        ]);
        setInput('');
        await refreshList();
      } else {
        setError(result.error ?? 'turn failed');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  const endSession = async () => {
    const api = getApi();
    if (!api || !activeSessionId) return;
    setBusy('end');
    setError(null);
    try {
      const result = await api.peerSessionEnd(peerId, activeSessionId);
      if (result.ok) {
        setActiveSessionId(null);
        setTranscript([]);
        await refreshList();
      } else {
        setError(result.error ?? 'end failed');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div data-testid="fleet-peer-session-panel">
      <div className="flex items-center gap-1.5 mb-1">
        <div className="text-[10px] uppercase tracking-wider text-text-muted">
          {t('fleet.session.title', 'Live session')}
        </div>
        <button
          onClick={() => void refreshList()}
          disabled={busy !== null}
          className="ml-auto p-1 text-text-muted hover:text-text-primary disabled:opacity-50"
          title={t('common.refresh', 'Refresh')}
          data-testid="fleet-peer-session-refresh"
        >
          {busy === 'list' ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
        </button>
        <button
          onClick={() => void startSession()}
          disabled={busy !== null}
          className="flex items-center gap-1 px-2 py-1 rounded border border-border text-text-secondary hover:text-text-primary hover:border-accent/50 disabled:opacity-50 text-[10px]"
          title={t('fleet.session.startHint', 'Open a multi-turn chat session on this peer')}
          data-testid="fleet-peer-session-start"
        >
          {busy === 'start' ? <Loader2 size={10} className="animate-spin" /> : <MessageSquarePlus size={10} />}
          {t('fleet.session.start', 'New session')}
        </button>
      </div>

      {sessions.length > 0 && (
        <ul className="space-y-1 mb-1.5">
          {sessions.map((session) => (
            <li key={session.sessionId}>
              <button
                onClick={() => attachSession(session.sessionId)}
                className={`w-full text-left rounded border px-2 py-1 text-[10px] ${
                  session.sessionId === activeSessionId
                    ? 'border-accent/60 bg-accent/10 text-text-primary'
                    : 'border-border-muted bg-surface/70 text-text-secondary hover:border-accent/40'
                }`}
                data-testid={`fleet-peer-session-row-${session.sessionId}`}
              >
                <span className="font-mono">{shortSessionId(session.sessionId)}</span>
                <span className="ml-2 text-text-muted">
                  {t('fleet.session.turns', '{{count}} turn(s)', { count: session.turnCount })}
                  {session.model ? ` · ${session.model}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {activeSessionId && (
        <div
          className="rounded border border-border-muted bg-surface/60 p-2 space-y-1.5"
          data-testid="fleet-peer-session-chat"
        >
          <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
            <span className="font-mono truncate">{shortSessionId(activeSessionId)}</span>
            <button
              onClick={() => void endSession()}
              disabled={busy !== null}
              className="ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded border border-border-muted hover:text-error hover:border-error/50 disabled:opacity-50"
              title={t('fleet.session.endHint', 'End the session on the peer')}
              data-testid="fleet-peer-session-end"
            >
              {busy === 'end' ? <Loader2 size={10} className="animate-spin" /> : <Square size={10} />}
              {t('fleet.session.end', 'End')}
            </button>
          </div>
          {transcript.length > 0 && (
            <div className="space-y-1 max-h-48 overflow-y-auto" data-testid="fleet-peer-session-transcript">
              {transcript.map((turn, index) => (
                <div
                  key={index}
                  className={`rounded px-2 py-1 text-[11px] whitespace-pre-wrap ${
                    turn.role === 'user'
                      ? 'bg-accent/10 text-text-primary'
                      : 'bg-surface/80 text-text-secondary'
                  }`}
                >
                  {turn.text}
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void sendTurn();
              }}
              placeholder={t('fleet.session.placeholder', 'Ask this peer…')}
              className="flex-1 px-2 py-1 rounded bg-background border border-border text-text-primary placeholder:text-text-muted text-[11px]"
              data-testid="fleet-peer-session-input"
            />
            <button
              onClick={() => void sendTurn()}
              disabled={busy !== null || !input.trim()}
              className="p-1.5 rounded border border-border text-text-secondary hover:text-text-primary hover:border-accent/50 disabled:opacity-50"
              title={t('fleet.session.send', 'Send')}
              data-testid="fleet-peer-session-send"
            >
              {busy === 'send' ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-1 text-[10px] text-error" data-testid="fleet-peer-session-error">
          {error}
        </p>
      )}
    </div>
  );
};
