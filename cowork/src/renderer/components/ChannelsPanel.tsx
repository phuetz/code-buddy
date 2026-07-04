/**
 * ChannelsPanel — the delivery-channels surface. Three tabs:
 *
 *  - **Status** (read-only): the core ChannelManager's per-channel runtime
 *    connection status (`channels.status`). Unchanged from the original panel.
 *  - **Configure**: add / enable / disable a channel and set its secret. The
 *    non-secret config lands in `~/.codebuddy/channels.json`; the token is
 *    stored in the core's ENCRYPTED secret store via `channels.setSecret`. The
 *    secret field is MASKED and WRITE-ONLY — the value is never read back
 *    (`listConfig` reports only `hasSecret`).
 *  - **Pairing**: the DM allowlist ("who is allowed to DM the agent") backed by
 *    the core `DMPairingManager` — list / approve / revoke approved senders.
 *
 * @module renderer/components/ChannelsPanel
 */

import { useCallback, useEffect, useState } from 'react';
import {
  X,
  Radio,
  RefreshCw,
  AlertCircle,
  Wifi,
  WifiOff,
  ShieldCheck,
  ShieldOff,
  KeyRound,
  Plus,
  Trash2,
  UserCheck,
  UserX,
  Power,
} from 'lucide-react';
import { useAppStore } from '../store';
import { EmptyState } from './LessonCandidatePanel';

interface ChannelStatus {
  type: string;
  connected: boolean;
  authenticated: boolean;
  lastActivity?: number;
  error?: string;
}

interface ChannelStatusReport {
  config: { configuredCount: number; disabledCount: number; enabledCount: number; path?: string };
  recommendations: string[];
  runtime: { authenticatedCount: number; connectedCount: number; registeredCount: number };
}

interface ChannelConfigView {
  type: string;
  enabled: boolean;
  configured: boolean;
  hasSecret: boolean;
  hasWebhookUrl: boolean;
  webhookUrl?: string;
  allowedUsers: string[];
  allowedChannels: string[];
  optionKeys: string[];
  connected: boolean;
  authenticated: boolean;
  lastActivity?: number;
  error?: string;
}

interface ChannelCatalogEntry {
  type: string;
  label: string;
  secretLabel: string;
  needsSecret: boolean;
  supportsWebhook: boolean;
}

interface ApprovedSenderView {
  channelType: string;
  senderId: string;
  displayName?: string;
  approvedAt: string;
  approvedBy: string;
  notes?: string;
}

interface PendingRequestView {
  code: string;
  channelType: string;
  senderId: string;
  displayName?: string;
  createdAt: string;
  expiresAt: string;
  attempts: number;
}

type Tab = 'status' | 'configure' | 'pairing';

export function ChannelsPanel() {
  const show = useAppStore((s) => s.showChannelsPanel);
  const setShow = useAppStore((s) => s.setShowChannelsPanel);

  const [tab, setTab] = useState<Tab>('status');
  const [loading, setLoading] = useState(false);

  if (!show) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/30 backdrop-blur-sm"
      data-testid="channels-panel"
    >
      <div className="flex h-full w-[560px] flex-col bg-background-secondary border-l border-border shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-semibold text-text-primary">Delivery channels</h2>
          </div>
          <div className="flex items-center gap-1">
            {loading && <RefreshCw className="w-4 h-4 text-text-muted animate-spin" />}
            <button onClick={() => setShow(false)} className="rounded p-1 hover:bg-surface" aria-label="Close">
              <X className="w-4 h-4 text-text-muted" />
            </button>
          </div>
        </div>

        <div className="flex border-b border-border px-2 text-xs">
          <TabButton active={tab === 'status'} onClick={() => setTab('status')} testId="channels-tab-status">
            Status
          </TabButton>
          <TabButton active={tab === 'configure'} onClick={() => setTab('configure')} testId="channels-tab-configure">
            Configure
          </TabButton>
          <TabButton active={tab === 'pairing'} onClick={() => setTab('pairing')} testId="channels-tab-pairing">
            Pairing
          </TabButton>
        </div>

        {tab === 'status' && <StatusTab onLoading={setLoading} />}
        {tab === 'configure' && <ConfigureTab onLoading={setLoading} />}
        {tab === 'pairing' && <PairingTab onLoading={setLoading} />}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className={`px-3 py-2 border-b-2 -mb-px transition-colors ${
        active ? 'border-accent text-text-primary' : 'border-transparent text-text-muted hover:text-text-primary'
      }`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Status tab (read-only) — the original panel content.
// ---------------------------------------------------------------------------
function StatusTab({ onLoading }: { onLoading: (b: boolean) => void }) {
  const [items, setItems] = useState<ChannelStatus[]>([]);
  const [report, setReport] = useState<ChannelStatusReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    onLoading(true);
    setError(null);
    const res = await window.electronAPI.channels.status();
    onLoading(false);
    if (!res.ok) {
      setError(res.error ?? 'Failed to load channel status');
      setItems([]);
      setReport(null);
      return;
    }
    setItems(res.items);
    setReport((res.report as ChannelStatusReport | null) ?? null);
  }, [onLoading]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <>
      <div className="flex items-center justify-between border-b border-border px-4 py-2 text-[11px] text-text-muted">
        <span>Runtime connection status.</span>
        <button onClick={() => void refresh()} className="rounded p-1 hover:bg-surface" title="Refresh">
          <RefreshCw className="w-3.5 h-3.5 text-text-muted" />
        </button>
      </div>

      {report && (
        <div className="border-b border-border px-4 py-3">
          <div className="grid grid-cols-3 gap-2 text-[11px]">
            <Metric label="Configured" value={String(report.config.configuredCount)} />
            <Metric label="Enabled" value={`${report.config.enabledCount}/${report.config.configuredCount}`} />
            <Metric label="Runtime" value={`${report.runtime.connectedCount}/${report.runtime.registeredCount}`} />
          </div>
          {report.config.path && <div className="mt-2 truncate text-[10px] text-text-muted">{report.config.path}</div>}
          {report.recommendations[0] && (
            <div className="mt-2 flex items-start gap-1.5 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] text-warning">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{report.recommendations[0]}</span>
            </div>
          )}
        </div>
      )}

      {error && <ErrorBanner message={error} />}

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {items.length === 0 ? (
          <EmptyState
            icon={<Radio className="w-8 h-8 text-text-muted" />}
            title={report?.config.configuredCount ? 'No runtime channels registered' : 'No channels configured'}
            hint={
              report?.config.configuredCount
                ? 'Run buddy channels start (or buddy server) to attach configured channels.'
                : 'Add a channel in the Configure tab, then start it from the CLI.'
            }
          />
        ) : (
          items.map((c) => (
            <div key={c.type} className="rounded border border-border bg-surface/40 p-3 space-y-1" data-testid="channel-status">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {c.connected ? <Wifi className="w-3.5 h-3.5 text-success" /> : <WifiOff className="w-3.5 h-3.5 text-text-muted" />}
                  <span className="text-xs font-medium text-text-primary capitalize">{c.type}</span>
                </div>
                <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-accent">
                  {c.authenticated ? <ShieldCheck className="w-3 h-3" /> : <ShieldOff className="w-3 h-3" />}
                  {c.connected ? 'connected' : 'offline'}
                </span>
              </div>
              {c.error && <div className="text-[10px] text-error">{c.error}</div>}
              <div className="text-[10px] text-text-muted">
                Last activity: {c.lastActivity ? new Date(c.lastActivity).toLocaleString() : '—'}
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Configure tab — add / enable / disable + secret (masked, write-only).
// ---------------------------------------------------------------------------
function ConfigureTab({ onLoading }: { onLoading: (b: boolean) => void }) {
  const [channels, setChannels] = useState<ChannelConfigView[]>([]);
  const [catalog, setCatalog] = useState<ChannelCatalogEntry[]>([]);
  const [path, setPath] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [addType, setAddType] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    onLoading(true);
    setError(null);
    const res = await window.electronAPI.channels.listConfig();
    onLoading(false);
    if (!res.ok) {
      setError(res.error ?? 'Failed to load channel config');
      return;
    }
    setChannels(res.channels as ChannelConfigView[]);
    setCatalog(res.catalog as ChannelCatalogEntry[]);
    setPath(res.path);
  }, [onLoading]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const configuredTypes = new Set(channels.map((c) => c.type));
  const addable = catalog.filter((c) => !configuredTypes.has(c.type));

  const addChannel = async () => {
    if (!addType) return;
    setBusy(true);
    const res = await window.electronAPI.channels.setConfig(addType, { enabled: false });
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? 'Failed to add channel');
      return;
    }
    setAddType('');
    await refresh();
  };

  return (
    <>
      <div className="flex items-center justify-between border-b border-border px-4 py-2 text-[11px] text-text-muted">
        <span className="truncate">{path || 'channels.json'}</span>
        <button onClick={() => void refresh()} className="rounded p-1 hover:bg-surface" title="Refresh">
          <RefreshCw className="w-3.5 h-3.5 text-text-muted" />
        </button>
      </div>

      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <select
          value={addType}
          onChange={(e) => setAddType(e.target.value)}
          data-testid="channel-add-select"
          className="flex-1 rounded border border-border bg-surface px-2 py-1 text-xs text-text-primary"
        >
          <option value="">Add a channel…</option>
          {addable.map((c) => (
            <option key={c.type} value={c.type}>
              {c.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => void addChannel()}
          disabled={!addType || busy}
          data-testid="channel-add-button"
          className="flex items-center gap-1 rounded bg-accent/90 px-2 py-1 text-xs text-white disabled:opacity-40 hover:bg-accent"
        >
          <Plus className="w-3 h-3" /> Add
        </button>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {channels.length === 0 ? (
          <EmptyState
            icon={<Radio className="w-8 h-8 text-text-muted" />}
            title="No channels configured"
            hint="Pick a channel above to add it, then set its token and enable it."
          />
        ) : (
          channels.map((c) => (
            <ChannelConfigRow
              key={c.type}
              channel={c}
              catalog={catalog.find((e) => e.type === c.type)}
              onChanged={refresh}
              onError={setError}
            />
          ))
        )}
      </div>
    </>
  );
}

function ChannelConfigRow({
  channel,
  catalog,
  onChanged,
  onError,
}: {
  channel: ChannelConfigView;
  catalog?: ChannelCatalogEntry;
  onChanged: () => Promise<void>;
  onError: (e: string | null) => void;
}) {
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const needsSecret = catalog?.needsSecret ?? true;
  const secretLabel = catalog?.secretLabel || 'Token';

  const toggle = async () => {
    setBusy(true);
    onError(null);
    const res = await window.electronAPI.channels.setEnabled(channel.type, !channel.enabled);
    setBusy(false);
    if (!res.ok) onError(res.error ?? 'Failed to toggle channel');
    else await onChanged();
  };

  const saveSecret = async () => {
    if (!secret.trim()) return;
    setBusy(true);
    onError(null);
    const res = await window.electronAPI.channels.setSecret(channel.type, secret);
    setBusy(false);
    setSecret(''); // never keep the plaintext secret in renderer state
    if (!res.ok) onError(res.error ?? 'Failed to save secret');
    else await onChanged();
  };

  const clearSecret = async () => {
    setBusy(true);
    onError(null);
    const res = await window.electronAPI.channels.deleteSecret(channel.type);
    setBusy(false);
    if (!res.ok) onError(res.error ?? 'Failed to clear secret');
    else await onChanged();
  };

  const remove = async () => {
    setBusy(true);
    onError(null);
    const res = await window.electronAPI.channels.removeChannel(channel.type);
    setBusy(false);
    if (!res.ok) onError(res.error ?? 'Failed to remove channel');
    else await onChanged();
  };

  return (
    <div className="rounded border border-border bg-surface/40 p-3 space-y-2" data-testid="channel-config-row">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-text-primary capitalize">{catalog?.label ?? channel.type}</span>
          {channel.connected && <span className="text-[9px] uppercase tracking-wide text-success">live</span>}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => void toggle()}
            disabled={busy}
            data-testid="channel-toggle"
            title={channel.enabled ? 'Disable' : 'Enable'}
            className={`flex items-center gap-1 rounded px-2 py-1 text-[10px] uppercase tracking-wide ${
              channel.enabled ? 'bg-success/15 text-success' : 'bg-surface text-text-muted'
            }`}
          >
            <Power className="w-3 h-3" />
            {channel.enabled ? 'enabled' : 'disabled'}
          </button>
          <button onClick={() => void remove()} disabled={busy} className="rounded p-1 hover:bg-surface" title="Remove channel">
            <Trash2 className="w-3.5 h-3.5 text-error" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 text-[10px] text-text-muted">
        <span className="flex items-center gap-1">
          <KeyRound className="w-3 h-3" />
          {channel.hasSecret ? <span className="text-success">secret set</span> : <span>no secret</span>}
        </span>
        {channel.hasWebhookUrl && <span className="truncate">webhook: {channel.webhookUrl}</span>}
      </div>

      {needsSecret && (
        <div className="flex items-center gap-2">
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={channel.hasSecret ? `Replace ${secretLabel.toLowerCase()}…` : `${secretLabel}…`}
            data-testid="channel-secret-input"
            autoComplete="off"
            className="flex-1 rounded border border-border bg-surface px-2 py-1 text-xs text-text-primary"
          />
          <button
            onClick={() => void saveSecret()}
            disabled={!secret.trim() || busy}
            data-testid="channel-secret-save"
            className="rounded bg-accent/90 px-2 py-1 text-xs text-white disabled:opacity-40 hover:bg-accent"
          >
            Save
          </button>
          {channel.hasSecret && (
            <button onClick={() => void clearSecret()} disabled={busy} className="rounded border border-border px-2 py-1 text-xs text-text-muted hover:bg-surface">
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pairing tab — the DM allowlist.
// ---------------------------------------------------------------------------
function PairingTab({ onLoading }: { onLoading: (b: boolean) => void }) {
  const [enabled, setEnabled] = useState(false);
  const [stats, setStats] = useState<{ totalApproved: number; totalPending: number; totalBlocked: number }>({
    totalApproved: 0,
    totalPending: 0,
    totalBlocked: 0,
  });
  const [approved, setApproved] = useState<ApprovedSenderView[]>([]);
  const [pending, setPending] = useState<PendingRequestView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [addChannel, setAddChannel] = useState('telegram');
  const [addSender, setAddSender] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    onLoading(true);
    setError(null);
    const [s, l, p] = await Promise.all([
      window.electronAPI.pairing.status(),
      window.electronAPI.pairing.list(),
      window.electronAPI.pairing.pending(),
    ]);
    onLoading(false);
    if (!s.ok && !l.ok) {
      setError(s.error ?? l.error ?? 'Failed to load pairing state');
      return;
    }
    setEnabled(s.enabled);
    setStats({ totalApproved: s.totalApproved, totalPending: s.totalPending, totalBlocked: s.totalBlocked });
    setApproved((l.approved as ApprovedSenderView[]) ?? []);
    setPending((p.pending as PendingRequestView[]) ?? []);
  }, [onLoading]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addDirect = async () => {
    if (!addSender.trim()) return;
    setBusy(true);
    setError(null);
    const res = await window.electronAPI.pairing.approveDirect(addChannel, addSender.trim());
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? 'Failed to add sender');
      return;
    }
    setAddSender('');
    await refresh();
  };

  const approveCode = async (channelType: string, code: string) => {
    setBusy(true);
    setError(null);
    const res = await window.electronAPI.pairing.approve(channelType, code);
    setBusy(false);
    if (!res.ok) setError(res.error ?? 'Failed to approve');
    else await refresh();
  };

  const revoke = async (channelType: string, senderId: string) => {
    setBusy(true);
    setError(null);
    const res = await window.electronAPI.pairing.revoke(channelType, senderId);
    setBusy(false);
    if (!res.ok) setError(res.error ?? 'Failed to revoke');
    else await refresh();
  };

  return (
    <>
      <div className="flex items-center justify-between border-b border-border px-4 py-2 text-[11px] text-text-muted">
        <span>
          Who may DM the agent · pairing{' '}
          <span className={enabled ? 'text-success' : 'text-warning'}>{enabled ? 'ON' : 'OFF'}</span>
        </span>
        <button onClick={() => void refresh()} className="rounded p-1 hover:bg-surface" title="Refresh">
          <RefreshCw className="w-3.5 h-3.5 text-text-muted" />
        </button>
      </div>

      <div className="border-b border-border px-4 py-3">
        <div className="grid grid-cols-3 gap-2 text-[11px]">
          <Metric label="Approved" value={String(stats.totalApproved)} />
          <Metric label="Pending" value={String(stats.totalPending)} />
          <Metric label="Blocked" value={String(stats.totalBlocked)} />
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <input
          value={addChannel}
          onChange={(e) => setAddChannel(e.target.value)}
          placeholder="channel"
          data-testid="pairing-add-channel"
          className="w-24 rounded border border-border bg-surface px-2 py-1 text-xs text-text-primary"
        />
        <input
          value={addSender}
          onChange={(e) => setAddSender(e.target.value)}
          placeholder="sender id"
          data-testid="pairing-add-sender"
          className="flex-1 rounded border border-border bg-surface px-2 py-1 text-xs text-text-primary"
        />
        <button
          onClick={() => void addDirect()}
          disabled={!addSender.trim() || busy}
          data-testid="pairing-add-button"
          className="flex items-center gap-1 rounded bg-accent/90 px-2 py-1 text-xs text-white disabled:opacity-40 hover:bg-accent"
        >
          <UserCheck className="w-3 h-3" /> Allow
        </button>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {pending.length > 0 && (
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wide text-text-muted">Pending requests</div>
            {pending.map((p) => (
              <div key={`${p.channelType}:${p.senderId}`} className="rounded border border-warning/30 bg-warning/5 p-2 text-xs" data-testid="pairing-pending-row">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-text-primary">
                    <span className="capitalize">{p.channelType}</span> · {p.senderId}
                  </span>
                  <button
                    onClick={() => void approveCode(p.channelType, p.code)}
                    disabled={busy}
                    className="rounded bg-success/15 px-2 py-0.5 text-[10px] text-success hover:bg-success/25"
                  >
                    Approve
                  </button>
                </div>
                <div className="mt-1 font-mono text-[10px] text-text-muted">code {p.code}</div>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wide text-text-muted">Allowlist</div>
          {approved.length === 0 ? (
            <EmptyState
              icon={<UserCheck className="w-8 h-8 text-text-muted" />}
              title="No approved senders"
              hint="Add a sender above, or approve a pending request. With pairing OFF, everyone can DM the agent."
            />
          ) : (
            approved.map((a) => (
              <div key={`${a.channelType}:${a.senderId}`} className="rounded border border-border bg-surface/40 p-2 text-xs" data-testid="pairing-approved-row">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-text-primary">
                      <span className="capitalize">{a.channelType}</span> · {a.displayName || a.senderId}
                    </div>
                    <div className="text-[10px] text-text-muted">
                      by {a.approvedBy} · {a.approvedAt ? new Date(a.approvedAt).toLocaleDateString() : '—'}
                    </div>
                  </div>
                  <button
                    onClick={() => void revoke(a.channelType, a.senderId)}
                    disabled={busy}
                    data-testid="pairing-revoke"
                    className="flex items-center gap-1 rounded border border-error/40 px-2 py-0.5 text-[10px] text-error hover:bg-error/10"
                  >
                    <UserX className="w-3 h-3" /> Revoke
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared bits.
// ---------------------------------------------------------------------------
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border bg-surface/40 px-2 py-1">
      <div className="text-[9px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className="truncate text-xs font-medium text-text-primary">{value}</div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mx-4 mt-3 flex items-start gap-1.5 rounded border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      <span>{message}</span>
    </div>
  );
}
