import { FileMinus, FilePlus, RefreshCw } from 'lucide-react';
import type { ContextState } from './request-context.js';

export interface ContextCandidate {
  path: string;
  bytes: number;
  tokens: number;
}

export interface StudioContextPanelProps {
  candidates: ContextCandidate[];
  states: Record<string, ContextState>;
  onCycle: (path: string) => void;
  onRefresh: () => void;
  /** Estimation totale de la prochaine demande (enveloppe + contexte + texte). */
  totalTokens: number;
}

/**
 * Sélection du contexte envoyé (idée bolt.diy) : un clic inclut le fichier
 * (son contenu part avec la demande), un deuxième l'exclut (le modèle est
 * prié de ne pas l'ouvrir), un troisième le remet en neutre. Les `.env*`
 * ne sont jamais proposés (filtrés par le processus principal).
 */
export function StudioContextPanel({ candidates, states, onCycle, onRefresh, totalTokens }: StudioContextPanelProps) {
  const included = candidates.filter((c) => states[c.path] === 'inclus');
  const excluded = candidates.filter((c) => states[c.path] === 'exclu');
  const includedTokens = included.reduce((sum, c) => sum + c.tokens, 0);
  return (
    <div className="max-h-48 shrink-0 overflow-y-auto border-t border-border bg-surface px-3 py-2 text-xs" data-testid="studio-context-panel">
      <div className="mb-1 flex items-center gap-2 text-muted-foreground">
        <span>
          {included.length} inclus (~{includedTokens.toLocaleString('fr-FR')} jetons) · {excluded.length} exclu(s) · demande estimée (hors texte){' '}
          <strong className="text-foreground" data-testid="studio-context-total">~{totalTokens.toLocaleString('fr-FR')} jetons</strong>
        </span>
        <button type="button" onClick={onRefresh} className="ml-auto rounded p-0.5 hover:text-foreground" title="Actualiser la liste" aria-label="Actualiser">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      {candidates.length === 0 ? (
        <div className="text-muted-foreground">Aucun fichier texte dans le projet.</div>
      ) : (
        <ul className="space-y-0.5">
          {candidates.map((c) => {
            const state = states[c.path];
            return (
              <li key={c.path}>
                <button
                  type="button"
                  onClick={() => onCycle(c.path)}
                  data-testid="studio-context-file"
                  data-state={state ?? 'neutre'}
                  className={`flex w-full items-center gap-2 rounded px-1.5 py-0.5 text-left hover:bg-muted ${state === 'inclus' ? 'text-primary' : state === 'exclu' ? 'text-muted-foreground line-through' : 'text-foreground'}`}
                  title={state === 'inclus' ? 'Inclus (clic : exclure)' : state === 'exclu' ? 'Exclu (clic : neutre)' : 'Neutre (clic : inclure)'}
                >
                  {state === 'exclu' ? <FileMinus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <FilePlus className={`h-3.5 w-3.5 shrink-0 ${state === 'inclus' ? '' : 'opacity-40'}`} aria-hidden="true" />}
                  <span className="min-w-0 flex-1 truncate font-mono">{c.path}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">~{c.tokens.toLocaleString('fr-FR')}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
