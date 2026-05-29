/**
 * IdentityPanel — C3. Browse & edit the project's agent identity files
 * (SOUL.md, USER.md, AGENTS.md, …) via the `identity.*` IPC (core
 * IdentityManager). Project `.codebuddy/` markdown; project overrides global.
 *
 * @module renderer/components/IdentityPanel
 */

import { useCallback, useEffect, useState } from 'react';
import { X, Fingerprint, Save, RefreshCw, AlertCircle, FilePlus } from 'lucide-react';
import { useAppStore } from '../store';
import { EmptyState } from './LessonCandidatePanel';

interface IdentityFile {
  name: string;
  content: string;
  source: 'project' | 'global';
  path: string;
  lastModified: number;
}

const KNOWN_FILES = ['SOUL.md', 'USER.md', 'AGENTS.md', 'TOOLS.md', 'IDENTITY.md', 'INSTRUCTIONS.md'];

export function IdentityPanel() {
  const show = useAppStore((s) => s.showIdentityPanel);
  const setShow = useAppStore((s) => s.setShowIdentityPanel);

  const [items, setItems] = useState<IdentityFile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await window.electronAPI.identityFiles.list();
    setLoading(false);
    if (!res.ok) {
      setError(res.error ?? 'Failed to load identity files');
      setItems([]);
      return;
    }
    setItems(res.items);
    if (res.items.length && !selected) {
      setSelected(res.items[0].name);
      setDraft(res.items[0].content);
    }
  }, [selected]);

  useEffect(() => {
    if (show) void refresh();
  }, [show, refresh]);

  const select = (f: IdentityFile) => {
    setSelected(f.name);
    setDraft(f.content);
    setError(null);
  };

  const createNew = (name: string) => {
    setSelected(name);
    setDraft('');
    setError(null);
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    const res = await window.electronAPI.identityFiles.set(selected, draft);
    setSaving(false);
    if (!res.ok) {
      setError(res.error ?? 'Save failed');
      return;
    }
    await refresh();
  };

  if (!show) return null;

  const existingNames = new Set(items.map((i) => i.name));
  const creatable = KNOWN_FILES.filter((n) => !existingNames.has(n));

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/30 backdrop-blur-sm"
      data-testid="identity-panel"
    >
      <div className="flex h-full w-[640px] flex-col bg-background-secondary border-l border-border shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Fingerprint className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-semibold text-text-primary">Agent identity</h2>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => void refresh()} className="rounded p-1 hover:bg-surface" title="Refresh">
              <RefreshCw className={`w-4 h-4 text-text-muted ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={() => setShow(false)} className="rounded p-1 hover:bg-surface" aria-label="Close">
              <X className="w-4 h-4 text-text-muted" />
            </button>
          </div>
        </div>

        {error && (
          <div className="mx-4 mt-3 flex items-start gap-1.5 rounded border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex flex-1 overflow-hidden">
          {/* file list */}
          <div className="w-48 shrink-0 overflow-y-auto border-r border-border p-2 space-y-1">
            {items.length === 0 && !loading ? (
              <EmptyState
                icon={<Fingerprint className="w-7 h-7 text-text-muted" />}
                title="No identity files"
                hint="Create SOUL.md to define the agent's personality."
              />
            ) : (
              items.map((f) => (
                <button
                  key={f.name}
                  data-testid={`identity-file-${f.name}`}
                  onClick={() => select(f)}
                  className={`w-full text-left rounded px-2 py-1.5 text-xs transition-colors ${
                    selected === f.name ? 'bg-accent text-white' : 'text-text-secondary hover:bg-surface'
                  }`}
                >
                  <div className="font-medium">{f.name}</div>
                  <div className={`text-[10px] ${selected === f.name ? 'text-white/70' : 'text-text-muted'}`}>
                    {f.source}
                  </div>
                </button>
              ))
            )}
            {creatable.length > 0 && (
              <div className="pt-2 mt-2 border-t border-border-muted space-y-1">
                <div className="px-2 text-[10px] uppercase tracking-wide text-text-muted">Create</div>
                {creatable.map((n) => (
                  <button
                    key={n}
                    onClick={() => createNew(n)}
                    className="flex w-full items-center gap-1 rounded px-2 py-1 text-xs text-text-secondary hover:bg-surface"
                  >
                    <FilePlus className="w-3 h-3" />
                    {n}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* editor */}
          <div className="flex flex-1 flex-col p-3">
            {selected ? (
              <>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-text-primary">{selected}</span>
                  <button
                    onClick={() => void save()}
                    disabled={saving}
                    data-testid="identity-save"
                    className="flex items-center gap-1 rounded bg-accent px-2 py-1 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  data-testid="identity-editor"
                  className="flex-1 resize-none rounded border border-border bg-surface/40 p-2 font-mono text-xs text-text-primary focus:outline-none focus:border-accent"
                  placeholder={`# ${selected}\n\nDefine the agent's ${selected.replace('.md', '').toLowerCase()} here…`}
                />
              </>
            ) : (
              <EmptyState
                icon={<Fingerprint className="w-8 h-8 text-text-muted" />}
                title="Select a file"
                hint="Pick an identity file to view or edit."
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
