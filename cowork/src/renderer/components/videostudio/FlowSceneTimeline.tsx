import { Clock3, Download, Film, Plus, WandSparkles } from 'lucide-react';
import { sourceVideoClips, type FlowScene } from './flow-studio-model';

export function FlowSceneTimeline({
  scenes,
  selectedId,
  onSelect,
  onAdd,
  onExtend,
  onExportAll,
  onAssemble,
}: {
  scenes: FlowScene[];
  selectedId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onExtend: () => void;
  onExportAll: () => void;
  onAssemble: () => void;
}) {
  const total = scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
  const sourceClipCount = sourceVideoClips(scenes).length;
  return (
    <section className="shrink-0 border-t border-border bg-surface" data-testid="flow-scene-timeline">
      <div className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-2"><h2 className="text-xs font-semibold">Scènes</h2><span className="text-[10px] text-muted-foreground">{scenes.length} plans · {total}s</span></div>
        <div className="flex gap-2">
          <button type="button" onClick={onAssemble} disabled={sourceClipCount < 2} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] hover:bg-background disabled:opacity-40" data-testid="flow-assemble"><Film className="h-3 w-3" /> Monter</button>
          <button type="button" onClick={onExportAll} disabled={!scenes.some((scene) => scene.path)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] hover:bg-background disabled:opacity-40" data-testid="flow-export-all"><Download className="h-3 w-3" /> Exporter</button>
          <button type="button" onClick={onAdd} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] hover:bg-background"><Plus className="h-3 w-3" /> Ajouter un plan</button>
          <button type="button" onClick={onExtend} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] hover:bg-background" data-testid="flow-extend-scene"><WandSparkles className="h-3 w-3" /> Étendre le plan</button>
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto px-4 pb-3">
        {scenes.map((scene, index) => (
          <button key={scene.id} type="button" onClick={() => onSelect(scene.id)} className={`w-44 shrink-0 overflow-hidden rounded-lg border text-left ${selectedId === scene.id ? 'border-orange-500 ring-2 ring-orange-500/10' : 'border-border'}`} aria-pressed={selectedId === scene.id} data-testid={`flow-scene-${index + 1}`}>
            <div className="relative aspect-video bg-slate-900">
              {scene.url ? (scene.mediaType === 'video' ? <video src={scene.url} className="h-full w-full object-cover" muted /> : <img src={scene.url} alt="" className="h-full w-full object-cover" />) : <span className="flex h-full items-center justify-center text-[10px] text-slate-400">{scene.status === 'generating' ? 'Génération…' : 'Plan vide'}</span>}
              <span className="absolute bottom-1 right-1 rounded bg-black/65 px-1.5 py-0.5 text-[9px] text-white">{scene.durationSeconds}s</span>
            </div>
            <span className="flex items-center justify-between px-2 py-1.5"><span className="text-[10px] font-medium">{scene.title}</span><Clock3 className="h-3 w-3 text-muted-foreground" /></span>
          </button>
        ))}
      </div>
    </section>
  );
}
