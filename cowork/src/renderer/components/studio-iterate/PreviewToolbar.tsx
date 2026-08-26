import { ExternalLink, Monitor, Play, RefreshCw, Smartphone, Square, Tablet } from 'lucide-react';
import type { PreviewDevice, PreviewStatus } from './iterate-model.js';
import { deviceWidth } from './iterate-model.js';

export type { PreviewStatus };

export interface PreviewToolbarProps {
  url?: string;
  status: PreviewStatus;
  device: PreviewDevice;
  onReload?: () => void;
  onDevice?: (device: PreviewDevice) => void;
  onOpenExternal?: () => void;
  onToggle?: () => void;
}

const STATUS_META: Record<PreviewStatus, { label: string; className: string }> = {
  idle: { label: 'Stopped', className: 'border-border bg-muted text-muted-foreground' },
  starting: { label: 'Starting', className: 'border-amber-500/30 bg-amber-500/10 text-amber-500' },
  running: { label: 'Active', className: 'border-green-500/30 bg-green-500/10 text-green-500' },
  dead: { label: 'Error', className: 'border-red-500/30 bg-red-500/10 text-red-500' },
};

const DEVICES: { id: PreviewDevice; label: string; icon: typeof Monitor }[] = [
  { id: 'desktop', label: 'Desktop', icon: Monitor },
  { id: 'tablet', label: 'Tablet', icon: Tablet },
  { id: 'mobile', label: 'Mobile', icon: Smartphone },
];

function displayUrl(url?: string): string {
  if (!url) {
    return 'No preview';
  }

  try {
    const parsed = new URL(url);
    const isLoopback = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
    return isLoopback ? parsed.toString() : 'Non-local URL hidden';
  } catch {
    return 'Invalid URL';
  }
}

export function PreviewToolbar({ url, status, device, onReload, onDevice, onOpenExternal, onToggle }: PreviewToolbarProps) {
  const statusMeta = STATUS_META[status];
  const canUsePreview = status === 'running' && !!url;
  const toggleLabel = status === 'running' || status === 'starting' ? 'Stop the preview' : 'Start the preview';
  const ToggleIcon = status === 'running' || status === 'starting' ? Square : Play;

  return (
    <section className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background p-2" aria-label="Preview test bar">
      <button type="button" className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50" onClick={onToggle} disabled={!onToggle} aria-label={toggleLabel}>
        <ToggleIcon className="h-3.5 w-3.5" aria-hidden="true" />
        {status === 'running' || status === 'starting' ? 'Stop' : 'Start'}
      </button>

      <div className="flex rounded-md border border-border bg-surface p-0.5" role="group" aria-label="Preview size">
        {DEVICES.map((item) => {
          const Icon = item.icon;
          const selected = item.id === device;

          return (
            <button key={item.id} type="button" className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${selected ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`} onClick={() => onDevice?.(item.id)} aria-pressed={selected} title={`${item.label} · ${deviceWidth(item.id)} px`}>
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">{item.label}</span>
            </button>
          );
        })}
      </div>

      <button type="button" className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50" onClick={onReload} disabled={!canUsePreview || !onReload} aria-label="Reload preview">
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        Reload
      </button>

      <button type="button" className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50" onClick={onOpenExternal} disabled={!canUsePreview || !onOpenExternal} aria-label="Open the preview in the browser">
        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        Open
      </button>

      <div className="ml-auto flex min-w-0 items-center gap-2 text-xs">
        <span className={`shrink-0 rounded-full border px-2 py-0.5 tabular-nums ${statusMeta.className}`}>{statusMeta.label}</span>
        <span className="min-w-0 truncate font-mono text-muted-foreground" title={displayUrl(url)}>{displayUrl(url)}</span>
      </div>
    </section>
  );
}
