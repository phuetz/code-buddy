/**
 * VideoStudioView — the full-page « Video Studio » rail category: type a topic,
 * Code Buddy plans the scenes, narrates them (Piper), renders premium 1080p
 * clips with karaoke captions + auto Mermaid diagrams, assembles a narrated
 * presentation video, and previews it inline. Drives the core prompt→video
 * engine via `window.electronAPI.film` (main: src/main/film/film-ipc.ts).
 */
import { useEffect, useRef, useState } from 'react';
import { Clapperboard, Loader2, Sparkles } from 'lucide-react';

interface Progress {
  phase: string;
  scene?: number;
  total?: number;
  message?: string;
}
interface ProduceResult {
  ok: boolean;
  url?: string;
  filmPath?: string;
  sceneCount?: number;
  duration?: number;
  qualityPass?: boolean;
  warnings?: string[];
  error?: string;
}

const PHASE_LABEL: Record<string, string> = {
  planning: 'Écriture du scénario…',
  narration: 'Voix off',
  visual: 'Diagramme',
  render: 'Rendu des scènes',
  assemble: 'Montage final…',
  quality: 'Contrôle qualité…',
  done: 'Terminé',
};

function phasePercent(p: Progress | null): number {
  if (!p) return 0;
  if (p.phase === 'planning') return 5;
  if (p.phase === 'assemble') return 88;
  if (p.phase === 'quality') return 95;
  if (p.phase === 'done') return 100;
  if (p.scene && p.total) return Math.min(82, 8 + (p.scene / p.total) * 74);
  return 10;
}

export function VideoStudioView() {
  const [pitch, setPitch] = useState('');
  const [scenes, setScenes] = useState(6);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<ProduceResult | null>(null);
  const offRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const film = window.electronAPI?.film;
    if (!film?.onProgress) return;
    offRef.current = film.onProgress((p) => setProgress(p));
    return () => {
      offRef.current?.();
    };
  }, []);

  const produce = async (): Promise<void> => {
    const film = window.electronAPI?.film;
    const topic = pitch.trim();
    if (!film?.produce || !topic || busy) return;
    setBusy(true);
    setResult(null);
    setProgress({ phase: 'planning' });
    try {
      const res = await film.produce({ pitch: topic, scenes });
      setResult(res);
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const pct = phasePercent(progress);
  const phaseText = progress
    ? `${PHASE_LABEL[progress.phase] ?? progress.phase}${progress.scene && progress.total ? ` (${progress.scene}/${progress.total})` : ''}`
    : '';

  return (
    <main
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
      data-testid="video-studio-view"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-4 py-2.5">
        <Clapperboard className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-sm font-semibold">Video Studio</h1>
        <span className="text-xs text-muted-foreground">
          Un sujet → une vidéo de présentation narrée (voix off, sous-titres karaoké, diagrammes).
          100% local.
        </span>
      </header>

      <div className="mx-auto flex w-full max-w-3xl min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
        <label className="text-xs font-medium text-muted-foreground">Sujet de la vidéo</label>
        <textarea
          data-testid="video-studio-prompt"
          value={pitch}
          onChange={(e) => setPitch(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void produce();
          }}
          placeholder="Ex : Explique l'architecture d'une application web moderne — ou : présente notre produit, résume ce concept…"
          rows={3}
          disabled={busy}
          className="w-full resize-none rounded-lg border border-border bg-surface p-3 text-sm outline-none focus:border-primary disabled:opacity-60"
        />

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Scènes</span>
            <input
              type="number"
              min={3}
              max={12}
              value={scenes}
              disabled={busy}
              onChange={(e) => setScenes(Math.max(3, Math.min(12, Number(e.target.value) || 6)))}
              className="w-16 rounded-md border border-border bg-surface px-2 py-1 text-sm"
            />
          </label>
          <button
            type="button"
            data-testid="video-studio-generate"
            onClick={() => void produce()}
            disabled={busy || !pitch.trim()}
            className="ml-auto inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {busy ? 'Production…' : 'Générer la vidéo'}
          </button>
        </div>

        {busy && (
          <div
            className="rounded-lg border border-border bg-surface p-4"
            data-testid="video-studio-progress"
          >
            <div className="mb-2 flex items-center justify-between text-sm">
              <span>{phaseText}</span>
              <span className="text-muted-foreground">{Math.round(pct)}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-border">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            {progress?.message && (
              <div className="mt-2 truncate text-xs text-muted-foreground">{progress.message}</div>
            )}
          </div>
        )}

        {result && !busy && (
          <div
            className="rounded-lg border border-border bg-surface p-4"
            data-testid="video-studio-result"
          >
            {result.ok && result.url ? (
              <>
                <video
                  controls
                  src={result.url}
                  className="w-full rounded-lg bg-black"
                  data-testid="video-studio-player"
                />
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>🎬 {result.sceneCount} scène(s)</span>
                  {result.duration != null && <span>· {Math.round(result.duration)}s</span>}
                  {result.qualityPass != null && (
                    <span>· qualité {result.qualityPass ? 'PASS' : 'REVIEW'}</span>
                  )}
                  <span className="truncate">· {result.filmPath}</span>
                </div>
              </>
            ) : (
              <div className="text-sm text-error">✗ {result.error ?? 'échec de la production'}</div>
            )}
            {result.warnings && result.warnings.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {result.warnings.map((w, i) => (
                  <li key={i}>⚠ {w}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
