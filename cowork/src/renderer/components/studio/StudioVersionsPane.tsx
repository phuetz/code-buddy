/**
 * StudioVersionsPane — versions PROPRES au projet App Studio.
 *
 * Avant : branché sur la chronologie globale des instantanés du moteur
 * (`checkpoint.list` sans cwd, donc une autre instance que celle du projet, et
 * aucun instantané pour un dossier hors git) — l'onglet restait vide. Il lit
 * maintenant `studio.versions.*` : un dépôt git séparé sous
 * `<projet>/.codebuddy/studio-versions.git`, alimenté à chaque tour par
 * NewShell. « Restaurer » garde d'abord l'état courant comme version, donc une
 * restauration s'annule en restaurant la version « Avant restauration ».
 */
import { useCallback, useEffect, useState } from 'react';

import { CheckpointTimeline } from './CheckpointTimeline';
import type { CheckpointEntry } from './checkpoint-timeline-model';
import { CheckpointDiffView } from './CheckpointDiffView';
import { sortDiff, type DiffFileEntry } from './checkpoint-diff-model';

interface VersionWire {
  id: string;
  label: string;
  createdAt: number;
  files: string[];
  changes?: DiffFileEntry[];
}

export function StudioVersionsPane({
  cwd,
  refreshKey = 0,
  onRestored,
}: {
  cwd?: string;
  /** Change à chaque nouvelle version prise par App Studio (recharge la liste). */
  refreshKey?: number;
  onRestored?: () => void;
}) {
  const [versions, setVersions] = useState<VersionWire[] | null>(null);
  const [diffEntries, setDiffEntries] = useState<DiffFileEntry[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const api = window.electronAPI?.studio?.versions;

  const refresh = useCallback(() => {
    if (!cwd || !api) {
      setVersions([]);
      return;
    }
    void api
      .list(cwd)
      .then((res) => {
        setVersions(res.ok ? res.data : []);
        if (!res.ok) setNote(`Versions indisponibles : ${res.error}`);
      })
      .catch(() => setVersions([]));
  }, [api, cwd]);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

  const restore = useCallback(
    (id: string) => {
      if (!cwd || !api) return;
      void api.restore(cwd, id).then((res) => {
        setNote(
          res.ok
            ? `Version ${id.slice(0, 7)} restaurée. L'état précédent est gardé comme version « Avant restauration ».`
            : `Restauration impossible : ${res.error}`,
        );
        refresh();
        if (res.ok) onRestored?.();
      });
    },
    [api, cwd, refresh, onRestored],
  );

  const showDiff = useCallback(
    (id: string) => {
      const version = versions?.find((v) => v.id === id);
      const changes = version?.changes ?? (version?.files ?? []).map((path) => ({ path, status: 'modified' as const }));
      setDiffEntries(sortDiff(changes));
    },
    [versions],
  );

  if (!api) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
        Versions indisponibles dans cette version de Cowork.
      </div>
    );
  }
  if (versions === null) {
    return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Chargement…</div>;
  }
  const entries: CheckpointEntry[] = versions.map((v) => ({
    id: v.id,
    label: v.label || v.id.slice(0, 7),
    createdAt: v.createdAt,
    files: v.files,
  }));

  return (
    <div className="relative h-full overflow-y-auto p-3" data-testid="studio-versions">
      {note ? (
        <div className="mb-2 rounded-md border border-border bg-muted px-3 py-2 text-xs text-foreground" data-testid="studio-versions-note">
          {note}
        </div>
      ) : null}
      <CheckpointTimeline checkpoints={entries} onRestore={restore} onDiff={showDiff} />
      {diffEntries !== null ? (
        <div className="absolute inset-0 z-10 bg-background/95 p-3">
          <CheckpointDiffView entries={diffEntries} onClose={() => setDiffEntries(null)} />
        </div>
      ) : null}
    </div>
  );
}
