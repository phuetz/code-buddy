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
import React, { useCallback, useEffect, useRef, useState } from 'react';
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

const FleetPeerSessionPanelView: React.FC<{ peerId: string }> = ({ peerId }) => {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<PeerSessionMeta[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<'start' | 'send' | 'end' | 'list' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The view on screen. The exported wrapper remounts this stateful view for each
  // peer, while these generations keep late answers with the mount and session
  // they came from. `selection` changes on every pick, even of the same session.
  const viewRef = useRef({ visit: 0, selection: 0, shown: false });
  const captureView = () => ({ visit: viewRef.current.visit, selection: viewRef.current.selection });
  type View = ReturnType<typeof captureView>;
  const isShownVisit = (view: View) => viewRef.current.shown && viewRef.current.visit === view.visit;
  const isShownSelection = (view: View) =>
    isShownVisit(view) && viewRef.current.selection === view.selection;

  const selectSession = (sessionId: string | null) => {
    viewRef.current = { ...viewRef.current, selection: viewRef.current.selection + 1 };
    setActiveSessionId(sessionId);
    setInput('');
  };

  const refreshList = useCallback(async () => {
    const api = getApi();
    if (!api) return;
    const visit = viewRef.current.visit;
    const isShown = () => viewRef.current.shown && viewRef.current.visit === visit;
    setBusy('list');
    try {
      const result = await api.peerSessionList(peerId);
      if (!isShown()) return;
      if (result.ok) {
        setSessions(result.sessions);
        setError(null);
      } else {
        setError(result.error ?? 'session list unavailable');
      }
    } catch (err) {
      if (isShown()) setError(String(err));
    } finally {
      if (isShown()) setBusy(null);
    }
  }, [peerId]);

  // Initialise this peer's local view and list its remote sessions.
  useEffect(() => {
    viewRef.current = {
      visit: viewRef.current.visit + 1,
      selection: viewRef.current.selection + 1,
      shown: true,
    };
    // The previous peer's rows must not stay clickable while this peer lists.
    setSessions([]);
    setActiveSessionId(null);
    setTranscript([]);
    setInput('');
    setError(null);
    // An operation still pending for the previous peer no longer blocks this one.
    setBusy(null);
    void refreshList();
    return () => {
      // Pending answers belong to a view that is gone (peer change, unmount, StrictMode).
      viewRef.current = { ...viewRef.current, visit: viewRef.current.visit + 1, shown: false };
    };
  }, [peerId, refreshList]);

  const startSession = async () => {
    const api = getApi();
    if (!api) return;
    const view = captureView();
    setBusy('start');
    setError(null);
    try {
      const result = await api.peerSessionStart(peerId);
      if (!isShownVisit(view)) return;
      if (result.ok && result.sessionId) {
        // Open it unless another session was picked meanwhile; it is listed either way.
        if (isShownSelection(view)) {
          selectSession(result.sessionId);
          setTranscript([]);
        }
        await refreshList();
      } else {
        setError(result.error ?? 'start failed');
      }
    } catch (err) {
      if (isShownVisit(view)) setError(String(err));
    } finally {
      if (isShownVisit(view)) setBusy(null);
    }
  };

  const attachSession = (sessionId: string) => {
    selectSession(sessionId);
    // Earlier turns live on the peer only — the local transcript starts empty.
    setTranscript([]);
    setError(null);
  };

  const sendTurn = async () => {
    const api = getApi();
    const inputAtSend = input;
    const prompt = inputAtSend.trim();
    const sessionId = activeSessionId;
    if (!api || !sessionId || !prompt || busy) return;
    const view = captureView();
    setBusy('send');
    setError(null);
    try {
      const result = await api.peerSessionSay(peerId, sessionId, prompt);
      if (!isShownVisit(view)) return;
      if (result.ok) {
        // The turn belongs to its selection: never append it to, or clear the draft of, another one.
        if (isShownSelection(view)) {
          setTranscript((prev) => [
            ...prev,
            { role: 'user', text: prompt },
            { role: 'assistant', text: result.text ?? '' },
          ]);
          setInput((current) => (current === inputAtSend ? '' : current));
        }
        await refreshList();
      } else if (isShownSelection(view)) {
        setError(result.error ?? 'turn failed');
      }
    } catch (err) {
      if (isShownSelection(view)) setError(String(err));
    } finally {
      if (isShownVisit(view)) setBusy(null);
    }
  };

  const endSession = async () => {
    const api = getApi();
    const sessionId = activeSessionId;
    if (!api || !sessionId) return;
    const view = captureView();
    setBusy('end');
    setError(null);
    try {
      const result = await api.peerSessionEnd(peerId, sessionId);
      if (!isShownVisit(view)) return;
      if (result.ok) {
        // Close the chat box only if it still shows the selection that was ended.
        if (isShownSelection(view)) {
          selectSession(null);
          setTranscript([]);
        }
        await refreshList();
      } else if (isShownSelection(view)) {
        setError(result.error ?? 'end failed');
      }
    } catch (err) {
      if (isShownSelection(view)) setError(String(err));
    } finally {
      if (isShownVisit(view)) setBusy(null);
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

export const FleetPeerSessionPanel: React.FC<{ peerId: string }> = ({ peerId }) => (
  <FleetPeerSessionPanelView key={peerId} peerId={peerId} />
);
