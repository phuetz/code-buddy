import { KeyRound, Trash2 } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useState } from 'react';

interface SecretEntry {
  key: string;
  length: number;
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export interface StudioSecretsPaneProps {
  cwd?: string;
  /** Prévenu quand la liste des NOMS change (le chat les rappelle au modèle). */
  onChange?: (names: string[]) => void;
}

/**
 * Secrets du projet (bolt.new : onglet Secrets). Saisis ici, rangés par le
 * processus principal HORS du projet, injectés seulement dans le serveur de
 * dev et le build. Cette vue ne reçoit jamais une valeur : seulement les noms
 * et une longueur ; le champ de saisie est vidé dès l'enregistrement.
 */
export function StudioSecretsPane({ cwd, onChange }: StudioSecretsPaneProps) {
  const api = window.electronAPI?.studio?.secrets;
  const [entries, setEntries] = useState<SecretEntry[]>([]);
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const apply = useCallback(
    (res: Result<SecretEntry[]> | null | undefined) => {
      if (!res) return;
      if (res.ok) {
        setEntries(res.data);
        setError(null);
        onChange?.(res.data.map((e) => e.key));
      } else setError(res.error);
    },
    [onChange],
  );

  useEffect(() => {
    if (!cwd || !api) return;
    void api.list(cwd).then(apply).catch(() => undefined);
  }, [cwd, api, apply]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!cwd || !api) return;
    const name = key.trim();
    const res = await api.set(cwd, name, value).catch((e: unknown) => ({ ok: false as const, error: String(e) }));
    setValue('');
    apply(res);
    if (res.ok) {
      setKey('');
      setSaved(`${name} enregistré — redémarrez l'aperçu pour qu'il le lise.`);
    }
  };

  if (!api) return <div className="p-4 text-xs text-muted-foreground">Secrets indisponibles.</div>;
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4 text-xs" data-testid="studio-secrets">
      <div className="flex items-start gap-2 text-muted-foreground">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          Clés d'API et jetons du projet. Rangés hors du dossier du projet : jamais envoyés au modèle (seul le nom lui est
          donné), jamais journalisés, absents des versions et de l'export. Le serveur de dev les reçoit comme variables
          d'environnement (préfixe <code>VITE_</code> pour le navigateur — une telle variable devient publique une fois le
          site construit, l'export du site est alors refusé).
        </p>
      </div>
      <form onSubmit={(e) => void submit(e)} className="flex flex-wrap items-center gap-2">
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="VITE_API_KEY"
          aria-label="Nom du secret"
          data-testid="studio-secret-key"
          className="w-48 rounded-md border border-border bg-background px-2 py-1 font-mono"
        />
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="valeur"
          aria-label="Valeur du secret"
          autoComplete="off"
          data-testid="studio-secret-value"
          className="w-64 rounded-md border border-border bg-background px-2 py-1 font-mono"
        />
        <button
          type="submit"
          disabled={!key.trim() || !value}
          data-testid="studio-secret-save"
          className="rounded-md bg-primary px-3 py-1 text-primary-foreground disabled:opacity-50"
        >
          Enregistrer
        </button>
      </form>
      {error ? <div className="text-destructive">{error}</div> : null}
      {saved ? <div className="text-muted-foreground">{saved}</div> : null}
      {entries.length === 0 ? (
        <div className="text-muted-foreground">Aucun secret pour ce projet.</div>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border" data-testid="studio-secret-list">
          {entries.map((entry) => (
            <li key={entry.key} className="flex items-center gap-2 px-3 py-1.5">
              <span className="font-mono text-foreground">{entry.key}</span>
              <span className="font-mono text-muted-foreground">{'•'.repeat(Math.min(12, Math.max(4, entry.length)))}</span>
              <button
                type="button"
                onClick={() => cwd && void api.remove(cwd, entry.key).then(apply)}
                className="ml-auto rounded p-1 text-muted-foreground hover:text-destructive"
                title={`Supprimer ${entry.key}`}
                aria-label={`Supprimer ${entry.key}`}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
