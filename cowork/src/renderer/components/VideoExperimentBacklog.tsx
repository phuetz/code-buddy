import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  VideoExperimentListResult,
  VideoExperimentReviewInput,
  VideoExperimentReviewResult,
  VideoExperimentReviewStatus,
  VideoExperimentView,
} from '../../shared/video-experiments';
import { VIDEO_EXPERIMENT_STATUSES } from '../../shared/video-experiments';

interface VideoExperimentApi {
  list: (cwd?: string) => Promise<unknown>;
  review: (input: VideoExperimentReviewInput) => Promise<VideoExperimentReviewResult>;
}

const STATUS_LABELS: Record<VideoExperimentReviewStatus, string> = {
  candidate: 'À étudier',
  planned: 'Planifiée',
  running: 'En cours',
  validated: 'Validée',
  rejected: 'Écartée',
};

const STATUS_COLORS: Record<VideoExperimentReviewStatus, string> = {
  candidate: 'bg-slate-500/15 text-slate-400',
  planned: 'bg-blue-500/15 text-blue-400',
  running: 'bg-amber-500/15 text-amber-400',
  validated: 'bg-green-500/15 text-green-400',
  rejected: 'bg-red-500/15 text-red-400',
};

function videoExperimentApi(): VideoExperimentApi | undefined {
  return (window as unknown as { electronAPI?: { videoExperiments?: VideoExperimentApi } })
    .electronAPI?.videoExperiments;
}

function isListResult(value: unknown): value is VideoExperimentListResult {
  return (
    !!value &&
    typeof value === 'object' &&
    Array.isArray((value as VideoExperimentListResult).experiments)
  );
}

function formatTimestamp(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(value / 60);
  return `${minutes}:${String(value % 60).padStart(2, '0')}`;
}

function sourceLabel(source: string): string {
  try {
    const url = new URL(source);
    return url.hostname.replace(/^www\./, '') + url.pathname;
  } catch {
    return source;
  }
}

function ExperimentRow({
  experiment,
  updating,
  onReview,
}: {
  experiment: VideoExperimentView;
  updating: boolean;
  onReview: (
    experiment: VideoExperimentView,
    status: VideoExperimentReviewStatus,
    note?: string
  ) => void;
}) {
  const [note, setNote] = useState(experiment.reviewNote ?? '');

  return (
    <li className="rounded-lg border border-border bg-background p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] ${STATUS_COLORS[experiment.reviewStatus]}`}
        >
          {STATUS_LABELS[experiment.reviewStatus]}
        </span>
        <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] text-violet-400">
          {experiment.category}
        </span>
        <span className="text-[10px] text-muted-foreground">
          non vérifié · confiance {experiment.confidence === 'medium' ? 'moyenne' : 'faible'}
        </span>
        <select
          aria-label={`Statut de ${experiment.title}`}
          className="ml-auto rounded-md border border-border bg-background px-2 py-1 text-xs disabled:opacity-50"
          disabled={updating}
          value={experiment.reviewStatus}
          onChange={(event) =>
            onReview(experiment, event.target.value as VideoExperimentReviewStatus, note)
          }
        >
          {VIDEO_EXPERIMENT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </div>

      <h3 className="mt-2 font-medium">{experiment.title}</h3>
      <div className="mt-1 text-xs text-muted-foreground">
        {formatTimestamp(experiment.evidence.t_start)} · {sourceLabel(experiment.source)}
      </div>
      <p className="mt-2 text-xs leading-relaxed">{experiment.evidence.transcript}</p>

      <div className="mt-2 rounded-md border border-border/70 bg-muted/25 px-2.5 py-2 text-xs">
        <span className="font-medium">Expérience minimale : </span>
        {experiment.minimumExperiment || 'À définir après vérification des sources.'}
      </div>

      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Préparation et risques
        </summary>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <div>
            <div className="font-medium">Pré-requis</div>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
              {experiment.requirements.map((requirement) => (
                <li key={requirement}>{requirement}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="font-medium">Risques</div>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
              {experiment.risks.map((risk) => (
                <li key={risk}>{risk}</li>
              ))}
            </ul>
          </div>
        </div>
        <div
          className="mt-2 truncate text-[10px] text-muted-foreground/70"
          title={experiment.artifactPath}
        >
          Artefact : {experiment.artifactPath}
        </div>
        {experiment.links.length > 0 && (
          <div className="mt-3">
            <div className="font-medium">Sources primaires à vérifier</div>
            <ul className="mt-1 space-y-1">
              {experiment.links.map((link) => (
                <li key={link} className="min-w-0">
                  <a
                    className="block truncate text-blue-500 hover:underline"
                    href={link}
                    rel="noreferrer"
                    target="_blank"
                    title={link}
                  >
                    {sourceLabel(link)}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-3 space-y-1.5">
          <label className="block font-medium" htmlFor={`review-note-${experiment.id}`}>
            Note de vérification
          </label>
          <textarea
            id={`review-note-${experiment.id}`}
            className="min-h-16 w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            maxLength={2_000}
            placeholder="Sources primaires, contraintes Darkstar, résultat du benchmark…"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <button
            type="button"
            className="rounded-md border border-border px-2 py-1 hover:bg-accent disabled:opacity-50"
            disabled={updating || note === (experiment.reviewNote ?? '')}
            onClick={() => onReview(experiment, experiment.reviewStatus, note)}
          >
            Enregistrer la note
          </button>
        </div>
      </details>
    </li>
  );
}

export function VideoExperimentBacklog({ workingDir }: { workingDir?: string }) {
  const [data, setData] = useState<VideoExperimentListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<VideoExperimentReviewStatus | 'all'>('all');
  const [query, setQuery] = useState('');
  const [updatingKey, setUpdatingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const api = videoExperimentApi();
      if (!api) throw new Error('API des expériences vidéo indisponible.');
      const result = await api.list(workingDir);
      if (!isListResult(result)) throw new Error('Réponse des expériences vidéo invalide.');
      setData(result);
    } catch (loadError) {
      setData(null);
      setError(
        loadError instanceof Error ? loadError.message : 'Impossible de lire les découvertes vidéo.'
      );
    } finally {
      setLoading(false);
    }
  }, [workingDir]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleExperiments = useMemo(() => {
    if (!data) return [];
    const normalizedQuery = query.trim().toLocaleLowerCase('fr');
    return data.experiments.filter((experiment) => {
      if (statusFilter !== 'all' && experiment.reviewStatus !== statusFilter) return false;
      if (!normalizedQuery) return true;
      return [
        experiment.title,
        experiment.category,
        experiment.evidence.transcript,
        ...experiment.namesToVerify,
      ]
        .join(' ')
        .toLocaleLowerCase('fr')
        .includes(normalizedQuery);
    });
  }, [data, query, statusFilter]);

  const review = useCallback(
    async (
      experiment: VideoExperimentView,
      status: VideoExperimentReviewStatus,
      note = experiment.reviewNote ?? ''
    ) => {
      const api = videoExperimentApi();
      if (!api) return;
      setUpdatingKey(experiment.key);
      setError(null);
      try {
        const trimmedNote = note.trim();
        const result = await api.review({
          cwd: workingDir,
          key: experiment.key,
          status,
          ...(trimmedNote ? { note: trimmedNote } : {}),
        });
        if (!result.ok) throw new Error(result.error || 'La mise à jour du statut a échoué.');
        setData((current) =>
          current
            ? {
                ...current,
                experiments: current.experiments.map((item) =>
                  item.key === experiment.key
                    ? {
                        ...item,
                        reviewStatus: status,
                        reviewNote: trimmedNote || undefined,
                        reviewedAt: result.review?.reviewedAt,
                      }
                    : item
                ),
                summary: {
                  ...current.summary,
                  byStatus:
                    status === experiment.reviewStatus
                      ? current.summary.byStatus
                      : {
                          ...current.summary.byStatus,
                          [experiment.reviewStatus]: Math.max(
                            0,
                            current.summary.byStatus[experiment.reviewStatus] - 1
                          ),
                          [status]: current.summary.byStatus[status] + 1,
                        },
                },
              }
            : current
        );
      } catch (reviewError) {
        setError(
          reviewError instanceof Error ? reviewError.message : 'La mise à jour du statut a échoué.'
        );
      } finally {
        setUpdatingKey(null);
      }
    },
    [workingDir]
  );

  if (loading)
    return <div className="text-sm text-muted-foreground">Chargement des découvertes vidéo…</div>;

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        Les pistes viennent des transcripts complets. Elles restent non vérifiées jusqu’à une
        reproduction contrôlée ; changer leur statut n’exécute aucun code.
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400"
        >
          {error}
        </div>
      )}

      {data && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span>
            {data.summary.total} piste(s) · {data.summary.sources} vidéo(s)
          </span>
          <span className="text-muted-foreground">
            {data.summary.byStatus.validated} validée(s)
          </span>
          <input
            aria-label="Rechercher une découverte vidéo"
            className="ml-auto min-w-44 rounded-md border border-border bg-background px-2 py-1"
            type="search"
            placeholder="Projet, catégorie, transcript…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">Filtre</span>
            <select
              aria-label="Filtrer les découvertes vidéo"
              className="rounded-md border border-border bg-background px-2 py-1"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as VideoExperimentReviewStatus | 'all')
              }
            >
              <option value="all">Tous les statuts</option>
              {VIDEO_EXPERIMENT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="rounded-md border border-border px-2 py-1 hover:bg-accent"
            onClick={() => void load()}
          >
            ↻ Rafraîchir
          </button>
        </div>
      )}

      {!data || data.summary.total === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          Aucune découverte vidéo enregistrée. Partage une vidéo à Lisa et demande-lui d’en extraire
          les technologies utiles.
        </div>
      ) : visibleExperiments.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          Aucune piste avec ces critères.
        </div>
      ) : (
        <ul className="space-y-2">
          {visibleExperiments.map((experiment) => (
            <ExperimentRow
              key={experiment.key}
              experiment={experiment}
              updating={updatingKey === experiment.key}
              onReview={(item, status, note) => void review(item, status, note)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
