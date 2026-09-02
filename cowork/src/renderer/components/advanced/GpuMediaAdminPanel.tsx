import {
  CheckCircle2,
  CircleAlert,
  Download,
  Gauge,
  Image as ImageIcon,
  Loader2,
  Plus,
  RefreshCcw,
  Square,
  Trash2,
  Video,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type {
  GpuMediaCapabilities,
  GpuMediaJobKind,
  GpuMediaJobView,
} from '../../../shared/gpu-media-admin';

const STORAGE_KEY = 'codebuddy.gpu-media.jobs.v1';

function storedJobIds(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string').slice(0, 50)
      : [];
  } catch {
    return [];
  }
}

function statusLabel(status: GpuMediaJobView['status']): string {
  return {
    queued: 'En file',
    running: 'En cours',
    succeeded: 'Terminée',
    failed: 'Échouée',
    cancelled: 'Annulée',
  }[status];
}

function statusClass(status: GpuMediaJobView['status']): string {
  if (status === 'succeeded') return 'border-success/40 bg-success/10 text-success';
  if (status === 'failed') return 'border-error/40 bg-error/10 text-error';
  if (status === 'queued' || status === 'running')
    return 'border-accent/40 bg-accent/10 text-accent';
  return 'border-border bg-surface text-text-muted';
}

function upsertJob(jobs: GpuMediaJobView[], next: GpuMediaJobView): GpuMediaJobView[] {
  return [next, ...jobs.filter((job) => job.id !== next.id)].slice(0, 50);
}

export function GpuMediaAdminPanel() {
  const [capabilities, setCapabilities] = useState<GpuMediaCapabilities | null>(null);
  const [kind, setKind] = useState<GpuMediaJobKind>('panoworld_reconstruct');
  const [jobs, setJobs] = useState<GpuMediaJobView[]>([]);
  const [trackedIds, setTrackedIds] = useState<string[]>(storedJobIds);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [manualId, setManualId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [sceneId, setSceneId] = useState('lisa-room');
  const [roomId, setRoomId] = useState('room');
  const [imagePath, setImagePath] = useState('');
  const [outputDir, setOutputDir] = useState('');
  const [turnId, setTurnId] = useState('lisa-turn');
  const [audioPath, setAudioPath] = useState('');
  const [referenceImagePath, setReferenceImagePath] = useState('');
  const [prompt, setPrompt] = useState('Lisa répond naturellement face caméra.');

  const selected = jobs.find((job) => job.id === selectedId) ?? null;
  const activeIds = jobs
    .filter((job) => job.status === 'queued' || job.status === 'running')
    .map((job) => job.id)
    .join(',');

  const remember = useCallback((job: GpuMediaJobView) => {
    setJobs((current) => upsertJob(current, job));
    setTrackedIds((current) => [job.id, ...current.filter((id) => id !== job.id)].slice(0, 50));
    setSelectedId((current) => current ?? job.id);
  }, []);

  const refresh = useCallback(async (jobId: string, quiet = false) => {
    try {
      const job = await window.electronAPI.gpuMedia.status(jobId);
      setJobs((current) => upsertJob(current, job));
      return job;
    } catch (cause) {
      if (!quiet) setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trackedIds));
  }, [trackedIds]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      window.electronAPI.gpuMedia.capabilities(),
      Promise.allSettled(trackedIds.map((jobId) => window.electronAPI.gpuMedia.status(jobId))),
    ])
      .then(([nextCapabilities, snapshots]) => {
        if (cancelled) return;
        setCapabilities(nextCapabilities);
        const restored = snapshots.flatMap((snapshot) =>
          snapshot.status === 'fulfilled' ? [snapshot.value] : []
        );
        setJobs(restored);
        setSelectedId((current) => current ?? restored[0]?.id ?? null);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
    // Job IDs are restored once; later additions are already represented in `jobs`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeIds) return undefined;
    const ids = activeIds.split(',');
    const timer = window.setInterval(() => {
      for (const id of ids) void refresh(id, true);
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [activeIds, refresh]);

  const selectFile = useCallback(async (apply: (path: string) => void) => {
    const [path] = await window.electronAPI.selectFiles();
    if (path) apply(path);
  }, []);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const job =
        kind === 'panoworld_reconstruct'
          ? await window.electronAPI.gpuMedia.submit({
              kind,
              sceneId,
              roomId,
              imagePath,
              outputDir,
            })
          : await window.electronAPI.gpuMedia.submit({
              kind,
              turnId,
              audioPath,
              referenceImagePath,
              prompt,
            });
      remember(job);
      setSelectedId(job.id);
      setNotice(`Job ${job.id} envoyé à GPU node.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [
    audioPath,
    imagePath,
    kind,
    outputDir,
    prompt,
    referenceImagePath,
    remember,
    roomId,
    sceneId,
    turnId,
  ]);

  const addExisting = useCallback(async () => {
    const id = manualId.trim();
    if (!id) return;
    const job = await refresh(id);
    if (job) {
      remember(job);
      setSelectedId(job.id);
      setManualId('');
    }
  }, [manualId, refresh, remember]);

  const cancel = useCallback(
    async (jobId: string) => {
      setError(null);
      try {
        remember(await window.electronAPI.gpuMedia.cancel(jobId));
        setNotice('Demande d’annulation transmise au worker.');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [remember]
  );

  const download = useCallback(async (job: GpuMediaJobView) => {
    setError(null);
    const result = await window.electronAPI.gpuMedia.download(job.id);
    if (result.ok) {
      setNotice(
        result.format === 'mp4'
          ? `Vidéo enregistrée dans ${result.path}`
          : `Manifeste PanoWorld enregistré dans ${result.path}`
      );
    } else if (!result.cancelled) {
      setError(result.error ?? 'Le résultat n’a pas pu être enregistré.');
    }
  }, []);

  const forget = useCallback((jobId: string) => {
    setJobs((current) => current.filter((job) => job.id !== jobId));
    setTrackedIds((current) => current.filter((id) => id !== jobId));
    setSelectedId((current) => (current === jobId ? null : current));
  }, []);

  const submitDisabled =
    busy ||
    (kind === 'panoworld_reconstruct'
      ? !sceneId.trim() || !roomId.trim() || !imagePath.trim() || !outputDir.trim()
      : !turnId.trim() || !audioPath.trim() || !referenceImagePath.trim() || !prompt.trim());

  return (
    <div
      className="grid min-h-0 flex-1 lg:grid-cols-[minmax(360px,0.9fr)_minmax(420px,1.1fr)]"
      data-testid="gpu-media-admin"
    >
      <section className="min-h-0 overflow-y-auto border-r border-border p-5">
        <div className="rounded-xl border border-border bg-surface/30 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Gauge size={15} className="text-accent" /> Worker GPU GPU node
              </h2>
              <p className="mt-1 text-xs text-text-muted">
                {capabilities
                  ? `${capabilities.workerId} · file ${capabilities.queueDepth ?? 0}`
                  : 'Connexion au worker…'}
              </p>
            </div>
            {capabilities ? (
              <CheckCircle2 size={16} className="text-success" aria-label="Worker disponible" />
            ) : (
              <Loader2 size={16} className="animate-spin text-text-muted" />
            )}
          </div>
          {capabilities?.gpus?.map((gpu) => (
            <div
              key={gpu.name}
              className="mt-3 flex justify-between rounded-lg border border-border bg-background px-3 py-2 text-[10px]"
            >
              <span>{gpu.name}</span>
              <span className={gpu.busy ? 'text-warning' : 'text-success'}>
                {Math.round(gpu.vramMb / 1024)} Gio · {gpu.busy ? 'occupé' : 'disponible'}
              </span>
            </div>
          ))}
        </div>

        {(error || notice) && (
          <div
            className={`mt-3 flex gap-2 rounded-lg border px-3 py-2 text-xs ${error ? 'border-error/40 bg-error/10 text-error' : 'border-success/40 bg-success/10 text-success'}`}
          >
            {error ? <CircleAlert size={14} /> : <CheckCircle2 size={14} />}
            <span className="break-all">{error ?? notice}</span>
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setKind('panoworld_reconstruct')}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs ${kind === 'panoworld_reconstruct' ? 'border-accent/60 bg-accent/10 text-accent' : 'border-border text-text-secondary'}`}
          >
            <ImageIcon size={14} /> PanoWorld
          </button>
          <button
            type="button"
            onClick={() => setKind('avatar_video_render')}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs ${kind === 'avatar_video_render' ? 'border-accent/60 bg-accent/10 text-accent' : 'border-border text-text-secondary'}`}
          >
            <Video size={14} /> Avatar vidéo
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {kind === 'panoworld_reconstruct' ? (
            <>
              <div className="rounded-lg border border-border bg-background px-3 py-2 text-[10px] text-text-muted">
                Profil verrouillé : <strong className="text-text-primary">single-2048</strong> · une
                image équirectangulaire 2048×1024.
              </div>
              <TextField
                label="Scène"
                value={sceneId}
                onChange={setSceneId}
                testId="gpu-scene-id"
              />
              <TextField label="Pièce" value={roomId} onChange={setRoomId} testId="gpu-room-id" />
              <PathField
                label="Panorama"
                value={imagePath}
                onChange={setImagePath}
                onBrowse={() => selectFile(setImagePath)}
                testId="gpu-image-path"
              />
              <TextField
                label="Dossier de sortie GPU node"
                value={outputDir}
                onChange={setOutputDir}
                testId="gpu-output-dir"
              />
            </>
          ) : (
            <>
              <div className="rounded-lg border border-border bg-background px-3 py-2 text-[10px] text-text-muted">
                Profil verrouillé : <strong className="text-text-primary">480p</strong> · rendu
                asynchrone LongCat.
              </div>
              <TextField
                label="Identifiant du tour"
                value={turnId}
                onChange={setTurnId}
                testId="gpu-turn-id"
              />
              <PathField
                label="Audio"
                value={audioPath}
                onChange={setAudioPath}
                onBrowse={() => selectFile(setAudioPath)}
                testId="gpu-audio-path"
              />
              <PathField
                label="Image de référence"
                value={referenceImagePath}
                onChange={setReferenceImagePath}
                onBrowse={() => selectFile(setReferenceImagePath)}
                testId="gpu-reference-path"
              />
              <label className="block text-[10px] text-text-muted">
                Prompt
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  rows={3}
                  className="mt-1 block w-full resize-y rounded border border-border bg-background px-2 py-1.5 text-xs text-text-primary"
                  data-testid="gpu-avatar-prompt"
                />
              </label>
            </>
          )}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitDisabled}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-background disabled:cursor-not-allowed disabled:opacity-40"
            data-testid="gpu-submit"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Envoyer à
            GPU node
          </button>
        </div>
      </section>

      <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
        <div className="border-b border-border p-4">
          <div className="flex gap-2">
            <input
              value={manualId}
              onChange={(event) => setManualId(event.target.value)}
              placeholder="Reprendre un job par son ID"
              className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1.5 font-mono text-xs"
              data-testid="gpu-existing-id"
            />
            <button
              type="button"
              onClick={() => void addExisting()}
              disabled={!manualId.trim()}
              className="rounded border border-border px-3 py-1.5 text-xs text-text-secondary disabled:opacity-40"
              data-testid="gpu-existing-add"
            >
              Ajouter
            </button>
            <button
              type="button"
              onClick={() => selectedId && void refresh(selectedId)}
              disabled={!selectedId}
              className="rounded border border-border p-2 text-text-muted disabled:opacity-40"
              aria-label="Actualiser le job"
            >
              <RefreshCcw size={13} />
            </button>
          </div>
        </div>

        <div className="grid min-h-0 md:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-y-auto border-r border-border p-3">
            {jobs.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-5 text-center text-xs text-text-muted">
                Aucun job suivi.
              </p>
            ) : (
              jobs.map((job) => (
                <button
                  key={job.id}
                  type="button"
                  onClick={() => setSelectedId(job.id)}
                  className={`mb-2 w-full rounded-lg border p-3 text-left ${selectedId === job.id ? 'border-accent/50 bg-accent/10' : 'border-border bg-background'}`}
                  data-testid={`gpu-job-${job.id}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[10px] font-medium">
                      {job.kind === 'panoworld_reconstruct' ? 'PanoWorld' : 'Avatar vidéo'}
                    </span>
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[9px] ${statusClass(job.status)}`}
                    >
                      {statusLabel(job.status)}
                    </span>
                  </div>
                  <code className="mt-2 block truncate text-[9px] text-text-muted">{job.id}</code>
                </button>
              ))
            )}
          </aside>

          <main className="min-h-0 overflow-y-auto p-5">
            {!selected ? (
              <div className="flex h-full min-h-48 items-center justify-center rounded-xl border border-dashed border-border text-xs text-text-muted">
                Sélectionne ou ajoute un job.
              </div>
            ) : (
              <div className="space-y-4" data-testid="gpu-job-detail">
                <div className="rounded-xl border border-border bg-surface/30 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <span
                        className={`rounded border px-2 py-0.5 text-[10px] ${statusClass(selected.status)}`}
                      >
                        {statusLabel(selected.status)}
                      </span>
                      <h2 className="mt-3 font-mono text-sm">{selected.id}</h2>
                      <p className="mt-1 text-xs text-text-muted">
                        {selected.progressMessage ?? 'En attente de progression'}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {(selected.status === 'queued' || selected.status === 'running') && (
                        <button
                          type="button"
                          onClick={() => void cancel(selected.id)}
                          className="flex items-center gap-1 rounded border border-error/40 px-2 py-1.5 text-xs text-error"
                          data-testid="gpu-cancel"
                        >
                          <Square size={12} /> Annuler
                        </button>
                      )}
                      {selected.status === 'succeeded' && (
                        <button
                          type="button"
                          onClick={() => void download(selected)}
                          className="flex items-center gap-1 rounded border border-accent/40 px-2 py-1.5 text-xs text-accent"
                          data-testid="gpu-download"
                        >
                          <Download size={12} />{' '}
                          {selected.kind === 'avatar_video_render'
                            ? 'Télécharger MP4'
                            : 'Exporter manifeste'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => forget(selected.id)}
                        className="rounded border border-border p-1.5 text-text-muted"
                        aria-label="Retirer de la liste"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                  <div className="mt-4 h-1.5 overflow-hidden rounded bg-background">
                    <div
                      className="h-full bg-accent transition-[width]"
                      style={{ width: `${Math.round((selected.progress ?? 0) * 100)}%` }}
                    />
                  </div>
                  {selected.error && (
                    <p className="mt-3 rounded border border-error/30 bg-error/10 p-2 text-xs text-error">
                      {selected.error}
                    </p>
                  )}
                </div>
                <pre
                  className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-background p-4 text-[10px] text-text-secondary"
                  data-testid="gpu-job-output"
                >
                  {selected.output
                    ? JSON.stringify(selected.output, null, 2)
                    : 'Le manifeste apparaîtra ici à la fin du job.'}
                </pre>
              </div>
            )}
          </main>
        </div>
      </section>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  testId: string;
}) {
  return (
    <label className="block text-[10px] text-text-muted">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 block w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-text-primary"
        data-testid={testId}
      />
    </label>
  );
}

function PathField({
  label,
  value,
  onChange,
  onBrowse,
  testId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBrowse: () => void;
  testId: string;
}) {
  return (
    <label className="block text-[10px] text-text-muted">
      {label}
      <span className="mt-1 flex gap-2">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1.5 font-mono text-xs text-text-primary"
          data-testid={testId}
        />
        <button
          type="button"
          onClick={onBrowse}
          className="rounded border border-border px-2 text-[10px] text-text-secondary"
        >
          Parcourir
        </button>
      </span>
    </label>
  );
}
