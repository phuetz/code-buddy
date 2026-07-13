import { Loader2, Sparkles } from 'lucide-react';
import type { FlowCameraMove, FlowIngredient, FlowMediaMode, FlowReferenceMode } from './flow-studio-model';

export function FlowInspector({
  mode,
  referenceMode,
  prompt,
  aspect,
  duration,
  outputs,
  camera,
  audioEnabled,
  voiceEnabled,
  selectedIngredient,
  startFrame,
  endFrame,
  busy,
  capabilities,
  onReferenceMode,
  onPrompt,
  onAspect,
  onDuration,
  onOutputs,
  onCamera,
  onAudio,
  onVoice,
  onStartFrame,
  onEndFrame,
  onGenerate,
}: {
  mode: FlowMediaMode;
  referenceMode: FlowReferenceMode;
  prompt: string;
  aspect: '1:1' | '16:9' | '9:16';
  duration: number;
  outputs: number;
  camera: FlowCameraMove;
  audioEnabled: boolean;
  voiceEnabled: boolean;
  selectedIngredient?: FlowIngredient;
  startFrame?: FlowIngredient;
  endFrame?: FlowIngredient;
  busy: boolean;
  capabilities?: { imageReferences: boolean; videoReferences: boolean; firstFrame: boolean; lastFrame: boolean; provider: string; model: string };
  onReferenceMode: (mode: FlowReferenceMode) => void;
  onPrompt: (prompt: string) => void;
  onAspect: (aspect: '1:1' | '16:9' | '9:16') => void;
  onDuration: (duration: number) => void;
  onOutputs: (outputs: number) => void;
  onCamera: (camera: FlowCameraMove) => void;
  onAudio: (enabled: boolean) => void;
  onVoice: (enabled: boolean) => void;
  onStartFrame: () => void;
  onEndFrame: () => void;
  onGenerate: () => void;
}) {
  return (
    <aside className="flex min-h-0 w-72 shrink-0 flex-col border-l border-border bg-surface" data-testid="flow-inspector">
      <div className="border-b border-border px-4 py-3"><h2 className="text-xs font-semibold">Réglages du plan</h2></div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-xs">
        <label className="block"><span className="mb-1.5 block font-medium">Prompt</span><textarea value={prompt} onChange={(event) => onPrompt(event.target.value)} rows={5} className="w-full resize-none rounded-lg border border-border bg-background p-2.5 leading-relaxed outline-none focus:border-orange-500" placeholder="Décris le sujet, l’action, la lumière et le style…" data-testid="flow-prompt" /></label>
        <div className="grid grid-cols-3 rounded-md border border-border p-0.5" role="group" aria-label="Mode de référence">
          {(['text', 'ingredients', 'frames'] as const).map((value) => <button key={value} type="button" onClick={() => onReferenceMode(value)} className={`rounded px-1 py-1.5 text-[10px] ${referenceMode === value ? 'bg-orange-500 text-white' : 'text-muted-foreground hover:bg-background'}`} aria-pressed={referenceMode === value}>{value === 'text' ? 'Texte' : value === 'ingredients' ? 'Ingrédients' : 'Images clés'}</button>)}
        </div>
        {referenceMode !== 'text' ? <p className="rounded-md border border-border bg-background px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground" data-testid="flow-capability-note">{mode === 'video' && capabilities?.videoReferences ? `Références transmises à ${capabilities.provider}/${capabilities.model}. ${capabilities.lastFrame ? 'Première et dernière images prises en charge.' : 'La première image est native ; la dernière reste une contrainte de prompt.'}` : mode === 'image' && capabilities?.imageReferences ? 'La référence avatar sélectionnée est transmise au moteur d’édition multimodale pour préserver son identité visuelle.' : mode === 'image' && capabilities && !capabilities.imageReferences ? 'Le moteur image actuel utilise les noms et le contrat visuel du prompt ; l’édition multimodale n’est pas encore disponible.' : 'Capacité de référence en cours de détection.'}</p> : null}
        {referenceMode === 'frames' ? <div className="grid grid-cols-2 gap-2"><button type="button" onClick={onStartFrame} disabled={!selectedIngredient} className="rounded-md border border-dashed border-border p-2 text-[10px] disabled:opacity-45">Début<br /><span className="font-medium">{startFrame?.name ?? 'Sélectionne un ingrédient'}</span></button><button type="button" onClick={onEndFrame} disabled={!selectedIngredient} className="rounded-md border border-dashed border-border p-2 text-[10px] disabled:opacity-45">Fin<br /><span className="font-medium">{endFrame?.name ?? 'Sélectionne un ingrédient'}</span></button></div> : null}
        <div className="grid grid-cols-2 gap-2"><SelectField label="Ratio" value={aspect} onChange={(value) => onAspect(value as '1:1' | '16:9' | '9:16')} options={['1:1', '16:9', '9:16']} /><SelectField label="Sorties" value={String(outputs)} onChange={(value) => onOutputs(Number(value))} options={mode === 'image' ? ['1', '2', '4'] : ['1', '2']} /></div>
        {mode === 'video' ? <SelectField label="Durée" value={String(duration)} onChange={(value) => onDuration(Number(value))} options={['4', '6', '8', '10']} suffix="s" /> : null}
        <SelectField label="Mouvement caméra" value={camera} onChange={(value) => onCamera(value as FlowCameraMove)} options={['static', 'pan-left', 'dolly-back', 'orbit']} labels={{ static: 'Caméra fixe', 'pan-left': 'Panoramique gauche', 'dolly-back': 'Travelling arrière', orbit: 'Orbite cinématique' }} />
        {mode === 'video' ? <div className="space-y-2 rounded-lg border border-border p-3"><Toggle label="Audio d’ambiance" checked={audioEnabled} onChange={onAudio} /><Toggle label="Voix cohérente" checked={voiceEnabled} disabled={!audioEnabled} onChange={onVoice} /></div> : null}
      </div>
      <div className="border-t border-border p-4"><button type="button" onClick={onGenerate} disabled={busy || !prompt.trim()} className="flex w-full items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 py-2.5 text-xs font-semibold text-white hover:bg-orange-600 disabled:opacity-45" data-testid="flow-generate">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} {busy ? 'Génération…' : `Générer ${outputs} variante${outputs > 1 ? 's' : ''}`}</button></div>
    </aside>
  );
}

function SelectField({ label, value, options, suffix = '', labels, onChange }: { label: string; value: string; options: string[]; suffix?: string; labels?: Record<string, string>; onChange: (value: string) => void }) {
  return <label className="block"><span className="mb-1.5 block text-[10px] font-medium text-muted-foreground">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-md border border-border bg-background px-2 py-2 text-[11px] outline-none">{options.map((option) => <option key={option} value={option}>{labels?.[option] ?? `${option}${suffix}`}</option>)}</select></label>;
}

function Toggle({ label, checked, disabled = false, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <label className="flex items-center justify-between gap-2 text-[11px]"><span>{label}</span><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="accent-orange-500" /></label>;
}
