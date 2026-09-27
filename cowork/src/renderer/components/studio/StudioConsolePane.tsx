import { Eraser, Paperclip, Wrench } from 'lucide-react';
import { useState } from 'react';
import type { LogSource } from './request-context.js';

export interface BrowserConsoleEntry {
  level: 'debug' | 'info' | 'warning' | 'error';
  message: string;
  source: string;
  line: number;
  at: number;
}

export interface StudioConsolePaneProps {
  browser: BrowserConsoleEntry[];
  server: string[];
  /** Joint les lignes (erreurs et avertissements, ou tout) à la prochaine demande. */
  onAttach: (source: LogSource, onlyProblems: boolean) => void;
  /** Envoie tout de suite une demande de correction avec ces journaux. */
  onFix: (source: LogSource) => void;
  onClear: (source: LogSource) => void;
  busy?: boolean;
}

const LEVEL_CLASS: Record<BrowserConsoleEntry['level'], string> = {
  error: 'text-red-500',
  warning: 'text-amber-500',
  info: 'text-foreground',
  debug: 'text-muted-foreground',
};

/**
 * Console du navigateur (aperçu) et journaux du serveur de dev, visibles dans
 * App Studio et joignables à une demande — bolt.new les montre dans son
 * panneau du bas. Les deux flux sont déjà MASQUÉS (secrets) par le processus
 * principal avant d'arriver ici.
 */
export function StudioConsolePane({ browser, server, onAttach, onFix, onClear, busy = false }: StudioConsolePaneProps) {
  const [source, setSource] = useState<LogSource>('navigateur');
  const problems = browser.filter((e) => e.level === 'error' || e.level === 'warning').length;
  const serverProblems = server.filter((l) => /error|erreur|failed|warn/i.test(l)).length;
  const count = source === 'navigateur' ? browser.length : server.length;

  return (
    <section className="flex h-full min-h-0 flex-col border border-border bg-surface" data-testid="studio-console">
      <header className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-muted px-2 text-xs">
        {(['navigateur', 'serveur'] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setSource(id)}
            aria-pressed={source === id}
            data-testid={`studio-console-tab-${id}`}
            className={`rounded px-2 py-1 ${source === id ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {id === 'navigateur' ? `Navigateur${problems ? ` (${problems} ⚠)` : ''}` : `Serveur de dev${serverProblems ? ` (${serverProblems} ⚠)` : ''}`}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            disabled={count === 0}
            onClick={() => onAttach(source, source === 'navigateur' ? problems > 0 : false)}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
            title="Joindre ces journaux à la prochaine demande du chat"
            data-testid="studio-console-attach"
          >
            <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
            Joindre au chat
          </button>
          <button
            type="button"
            disabled={count === 0 || busy}
            onClick={() => onFix(source)}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
            title="Demander tout de suite une correction avec ces journaux"
            data-testid="studio-console-fix"
          >
            <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
            Corriger
          </button>
          <button
            type="button"
            disabled={count === 0}
            onClick={() => onClear(source)}
            className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
            title="Effacer"
            aria-label="Effacer les journaux"
          >
            <Eraser className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-2 font-mono text-[11px] leading-relaxed" role="log">
        {count === 0 ? (
          <div className="text-muted-foreground">
            {source === 'navigateur' ? "Aucun message de la console de l'aperçu." : 'Aucun journal du serveur de dev.'}
          </div>
        ) : source === 'navigateur' ? (
          browser.map((e, i) => (
            <div key={`${e.at}-${i}`} className={`whitespace-pre-wrap break-words ${LEVEL_CLASS[e.level]}`}>
              [{e.level}] {e.message}
              {e.source ? <span className="text-muted-foreground"> — {e.source}{e.line ? `:${e.line}` : ''}</span> : null}
            </div>
          ))
        ) : (
          server.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-words text-foreground">
              {line}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
