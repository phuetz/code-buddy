/**
 * SettingsAutomations — administer the robot's behaviors from Cowork: reminders + triggerable
 * sensory rules. Manage + observe (enable/disable, mark done, delete, view recent fires). It is a
 * THIN client: every action calls `window.electronAPI.automations.*`, which delegates to the same
 * core the `buddy remind` / `buddy rules` CLI uses — no duplicate logic. Creating complex rules
 * stays JSON-edit (validated + hot-reloaded); this panel does not build rules.
 *
 * @module renderer/components/settings/SettingsAutomations
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Bell, Zap, RefreshCw, Trash2, Check } from 'lucide-react';

interface Reminder {
  id: string;
  label?: string;
  time?: string;
  days?: number[];
  enabled?: boolean;
  lastDoneAt?: string;
}
interface Rule {
  id: string;
  name?: string;
  enabled?: boolean;
  match?: { kind?: string };
  action?: { type?: string };
}
interface Run {
  ts?: number;
  rule?: string;
  action?: string;
  ok?: boolean;
  detail?: string | null;
}

export const SettingsAutomations: React.FC<{ isActive?: boolean }> = ({ isActive }) => {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const api = window.electronAPI?.automations;
    if (!api) {
      setError('automations bridge unavailable');
      return;
    }
    setLoading(true);
    try {
      const res = await api.list();
      if (!res.ok) setError(res.error ?? 'failed to load');
      else setError(null);
      setReminders((res.reminders as unknown as Reminder[]) ?? []);
      setRules((res.rules as unknown as Rule[]) ?? []);
      setRuns((res.runs as unknown as Run[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isActive) void load();
  }, [isActive, load]);

  const toggle = async (kind: 'rule' | 'reminder', id: string, enabled: boolean) => {
    await window.electronAPI?.automations?.toggle(kind, id, enabled);
    await load();
  };
  const remove = async (kind: 'rule' | 'reminder', id: string) => {
    await window.electronAPI?.automations?.remove(kind, id);
    await load();
  };
  const done = async (id: string) => {
    await window.electronAPI?.automations?.reminderDone(id);
    await load();
  };

  return (
    <div className="p-4 space-y-6 text-text-primary">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Automatisations</h2>
        <button
          type="button"
          onClick={() => void load()}
          className="flex items-center gap-1 text-sm text-text-muted hover:text-text-primary"
          title="Recharger"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Recharger
        </button>
      </div>
      {error && <div className="text-sm text-error bg-error/10 rounded px-3 py-2">{error}</div>}

      <section>
        <h3 className="flex items-center gap-2 text-sm font-medium mb-2">
          <Bell className="w-4 h-4" /> Rappels ({reminders.length})
        </h3>
        {reminders.length === 0 ? (
          <p className="text-sm text-text-muted">Aucun rappel. Crée-en un : <code>buddy remind add …</code></p>
        ) : (
          <ul className="space-y-1">
            {reminders.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-sm bg-surface rounded px-3 py-1.5">
                <input
                  type="checkbox"
                  checked={r.enabled !== false}
                  onChange={(e) => void toggle('reminder', r.id, e.target.checked)}
                  title="Activer/désactiver"
                />
                <span className="font-mono text-xs w-12">{r.time}</span>
                <span className="text-xs text-text-muted w-16">{r.days?.length ? `[${r.days.join(',')}]` : 'tous'}</span>
                <span className="flex-1 truncate">{r.label}</span>
                <button type="button" onClick={() => void done(r.id)} title="Marquer fait" className="text-success hover:opacity-80">
                  <Check className="w-4 h-4" />
                </button>
                <button type="button" onClick={() => void remove('reminder', r.id)} title="Supprimer" className="text-text-muted hover:text-error">
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="flex items-center gap-2 text-sm font-medium mb-2">
          <Zap className="w-4 h-4" /> Actions déclenchables ({rules.length})
        </h3>
        {rules.length === 0 ? (
          <p className="text-sm text-text-muted">Aucune règle. Édite <code>~/.codebuddy/sensory-rules.json</code> ou <code>buddy rules add …</code></p>
        ) : (
          <ul className="space-y-1">
            {rules.map((x) => (
              <li key={x.id} className="flex items-center gap-2 text-sm bg-surface rounded px-3 py-1.5">
                <input
                  type="checkbox"
                  checked={x.enabled !== false}
                  onChange={(e) => void toggle('rule', x.id, e.target.checked)}
                  title="Activer/désactiver (effet à chaud)"
                />
                <span className="flex-1 truncate">
                  <span className="font-mono text-xs">{x.id}</span>
                  <span className="text-text-muted"> · {x.match?.kind} → {x.action?.type}</span>
                  {x.name && <span className="text-text-muted"> ({x.name})</span>}
                </span>
                <button type="button" onClick={() => void remove('rule', x.id)} title="Supprimer" className="text-text-muted hover:text-error">
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-sm font-medium mb-2">Derniers déclenchements</h3>
        {runs.length === 0 ? (
          <p className="text-sm text-text-muted">Aucun déclenchement enregistré.</p>
        ) : (
          <ul className="space-y-0.5 font-mono text-xs">
            {runs.map((run, i) => (
              <li key={i} className="text-text-muted">
                {run.ts ? new Date(run.ts).toLocaleString() : '—'} {run.ok ? '✅' : '❌'} {run.rule} ({run.action})
                {run.detail ? ` — ${String(run.detail).slice(0, 50)}` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

export default SettingsAutomations;
