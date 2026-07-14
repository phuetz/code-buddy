import { Activity, Box, CircleAlert, Radio, Waves } from 'lucide-react';
import type {
  CompanionAvatarRendererSnapshot,
  CompanionAvatarRendererView,
} from '../../../shared/avatar-renderer';

interface CompanionAvatarRendererStatusProps {
  snapshot: CompanionAvatarRendererSnapshot | null;
  error?: string | null;
}

const PHASE_LABELS: Record<CompanionAvatarRendererView['phase'], string> = {
  ready: 'prêt',
  buffering: 'mise en mémoire',
  playing: 'en parole',
  interrupted: 'interrompu',
  unavailable: 'indisponible',
  error: 'erreur',
};

function metric(value: number | undefined, suffix: string): string {
  return value === undefined ? '—' : `${Math.round(value)} ${suffix}`;
}

function RendererCard({ renderer }: { renderer: CompanionAvatarRendererView }) {
  const audioReady = renderer.connected
    && renderer.capabilities.wavStream
    && renderer.capabilities.audioDrivenAnimation;
  return (
    <div
      className="rounded border border-border bg-background/45 px-3 py-2"
      data-testid={`companion-avatar-renderer-${renderer.rendererId}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-text-primary">
            {renderer.displayName ?? renderer.rendererId}
          </p>
          <p className="mt-0.5 truncate text-[10px] text-text-muted">
            {renderer.runtime}{renderer.runtimeVersion ? ` ${renderer.runtimeVersion}` : ''}
            {renderer.project ? ` · ${renderer.project}` : ''}
          </p>
        </div>
        <span className={`rounded px-2 py-1 text-[10px] ${
          renderer.connected ? 'bg-success/10 text-success' : 'bg-error/10 text-error'
        }`}>
          {renderer.connected ? PHASE_LABELS[renderer.phase] : 'hors ligne'}
        </span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div>
          <p className="text-[9px] uppercase tracking-wide text-text-muted">Animation audio</p>
          <p className={`mt-0.5 text-[10px] font-medium ${audioReady ? 'text-success' : 'text-warning'}`}>
            {audioReady ? 'prouvée' : 'verrouillée'}
          </p>
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-wide text-text-muted">Rendu</p>
          <p className="mt-0.5 text-[10px] font-medium text-text-primary">
            {metric(renderer.fps, 'fps')}
          </p>
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-wide text-text-muted">Bouche / audio</p>
          <p className="mt-0.5 text-[10px] font-medium text-text-primary">
            {metric(renderer.mouthLatencyMs, 'ms')}
          </p>
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-wide text-text-muted">Chunks perdus</p>
          <p className={`mt-0.5 text-[10px] font-medium ${
            renderer.droppedAudioChunks > 0 ? 'text-error' : 'text-text-primary'
          }`}>
            {renderer.droppedAudioChunks}
          </p>
        </div>
      </div>

      {renderer.reason ? (
        <p className="mt-2 rounded bg-error/5 px-2 py-1 text-[10px] text-error">
          {renderer.reason}
        </p>
      ) : null}
    </div>
  );
}

export function CompanionAvatarRendererStatus({
  snapshot,
  error,
}: CompanionAvatarRendererStatusProps) {
  const active = snapshot?.audioStreamingActive === true;
  return (
    <div
      className="rounded-lg border border-border bg-surface/25 p-3"
      data-testid="companion-avatar-renderers"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold text-text-primary">
            <Box className="h-3.5 w-3.5 text-accent" /> Incarnation MetaHuman
          </p>
          <p className="mt-0.5 text-[10px] text-text-muted">
            Présence et télémétrie brute, sans texte, audio ni identifiant de connexion
          </p>
        </div>
        <span className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] ${
          active ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'
        }`}>
          {active ? <Waves className="h-3 w-3" /> : <Radio className="h-3 w-3" />}
          {active ? 'voix → visage active' : 'voix → visage en attente'}
        </span>
      </div>

      {error ? (
        <div className="mt-3 flex items-start gap-2 rounded border border-error/25 bg-error/5 px-3 py-2 text-[10px] text-error">
          <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{error}</span>
        </div>
      ) : snapshot && snapshot.renderers.length > 0 ? (
        <>
          <div className="mt-3 flex flex-wrap gap-1.5 text-[10px]">
            <span className="rounded bg-background px-2 py-1 text-text-secondary">
              {snapshot.connectedCount} connecté(s)
            </span>
            <span className="rounded bg-background px-2 py-1 text-text-secondary">
              {snapshot.readyCount} Audio Live Link prêt(s)
            </span>
            <span className="rounded bg-background px-2 py-1 text-text-secondary">
              politique {snapshot.audioPolicy}
            </span>
            {!snapshot.bridgeEnabled ? (
              <span className="rounded bg-error/10 px-2 py-1 text-error">pont désactivé</span>
            ) : null}
          </div>
          <div className="mt-2 space-y-2">
            {snapshot.renderers.map((renderer) => (
              <RendererCard key={renderer.rendererId} renderer={renderer} />
            ))}
          </div>
        </>
      ) : (
        <div className="mt-3 rounded border border-dashed border-border px-3 py-4 text-center">
          <Activity className="mx-auto h-4 w-4 text-text-muted" />
          <p className="mt-2 text-xs font-medium text-text-secondary">Aucun renderer Unreal connecté</p>
          <p className="mt-1 text-[10px] text-text-muted">
            Lance le Gateway Code Buddy puis AvatarStudio sur Darkstar. L’animation audio restera
            verrouillée jusqu’à ce que MetaHuman Audio Live Link soit réellement validé.
          </p>
        </div>
      )}
    </div>
  );
}
