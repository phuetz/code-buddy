import {
  ArrowDown,
  ArrowUp,
  Copy,
  Loader2,
  MousePointer2,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import type { ParsedDeck } from './deck-block-model.js';
import type { ParsedDoc } from './doc-block-model.js';
import type { DocBlockType, DocPreviewBlock } from './doc-preview-model.js';
import type { SlidePreviewItem } from './slide-deck-preview-model.js';

const BLOCK_TYPES: DocBlockType[] = ['h1', 'h2', 'p', 'quote', 'code', 'list'];

function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length || from === to) return [...items];
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

export function DocDesignEditor({ value, onChange }: { value: ParsedDoc; onChange: (value: ParsedDoc) => void }) {
  const [selected, setSelected] = useState(0);
  const block = value.blocks[selected] ?? value.blocks[0];

  useEffect(() => {
    if (selected >= value.blocks.length) setSelected(Math.max(0, value.blocks.length - 1));
  }, [selected, value.blocks.length]);

  const replaceBlock = (next: DocPreviewBlock) => {
    onChange({ ...value, blocks: value.blocks.map((entry, index) => (index === selected ? next : entry)) });
  };
  const remove = () => {
    if (value.blocks.length <= 1) return;
    onChange({ ...value, blocks: value.blocks.filter((_entry, index) => index !== selected) });
  };

  return (
    <div className="grid h-full min-h-[24rem] grid-cols-[minmax(12rem,0.8fr)_minmax(18rem,1.4fr)] gap-3" data-testid="doc-design-view">
      <aside className="min-h-0 overflow-y-auto rounded-xl border border-border bg-muted/20 p-2">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-xs font-semibold">Blocs du document</span>
          <button
            type="button"
            onClick={() => {
              onChange({ ...value, blocks: [...value.blocks, { type: 'p', text: 'Nouveau paragraphe' }] });
              setSelected(value.blocks.length);
            }}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Ajouter un bloc"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        {value.blocks.map((entry, index) => (
          <button
            key={`${entry.type}-${index}`}
            type="button"
            onClick={() => setSelected(index)}
            className={`mb-1 w-full rounded-lg border px-3 py-2 text-left text-xs transition ${
              index === selected ? 'border-primary bg-primary/10 text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted'
            }`}
          >
            <span className="mr-2 font-mono text-[10px] uppercase text-primary">{entry.type}</span>
            <span className="line-clamp-2">{entry.text ?? entry.items?.join(' · ') ?? 'Bloc vide'}</span>
          </button>
        ))}
      </aside>

      <section className="min-h-0 overflow-y-auto rounded-xl border border-border bg-surface p-4">
        {block ? (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <label className="text-xs text-muted-foreground">
                Type
                <select
                  value={block.type}
                  onChange={(event) => replaceBlock({
                    type: event.target.value as DocBlockType,
                    ...(event.target.value === 'list'
                      ? { items: block.items ?? (block.text ? [block.text] : ['Nouvel élément']) }
                      : { text: block.text ?? block.items?.join('\n') ?? '' }),
                  })}
                  className="ml-2 rounded-md border border-border bg-background px-2 py-1"
                >
                  {BLOCK_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </label>
              <div className="ml-auto flex items-center gap-1">
                <EditorIconButton label="Monter" onClick={() => {
                  onChange({ ...value, blocks: moveItem(value.blocks, selected, selected - 1) });
                  setSelected(Math.max(0, selected - 1));
                }} disabled={selected === 0}><ArrowUp /></EditorIconButton>
                <EditorIconButton label="Descendre" onClick={() => {
                  onChange({ ...value, blocks: moveItem(value.blocks, selected, selected + 1) });
                  setSelected(Math.min(value.blocks.length - 1, selected + 1));
                }} disabled={selected === value.blocks.length - 1}><ArrowDown /></EditorIconButton>
                <EditorIconButton label="Dupliquer" onClick={() => {
                  const blocks = [...value.blocks];
                  blocks.splice(selected + 1, 0, structuredClone(block));
                  onChange({ ...value, blocks });
                  setSelected(selected + 1);
                }}><Copy /></EditorIconButton>
                <EditorIconButton label="Supprimer" onClick={remove} disabled={value.blocks.length <= 1}><Trash2 /></EditorIconButton>
              </div>
            </div>
            <label className="block text-xs font-medium text-muted-foreground">
              {block.type === 'list' ? 'Un élément par ligne' : 'Contenu du bloc'}
              <textarea
                value={block.type === 'list' ? (block.items ?? []).join('\n') : (block.text ?? '')}
                onChange={(event) => replaceBlock(block.type === 'list'
                  ? { type: 'list', items: event.target.value.split('\n').filter((line) => line.trim()) }
                  : { type: block.type, text: event.target.value })}
                rows={14}
                className="mt-2 w-full resize-y rounded-lg border border-border bg-background p-3 text-sm leading-relaxed outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </label>
          </>
        ) : null}
      </section>
    </div>
  );
}

export function DeckDesignEditor({ value, onChange }: { value: ParsedDeck; onChange: (value: ParsedDeck) => void }) {
  const [selected, setSelected] = useState(0);
  const slide = value.slides[selected] ?? value.slides[0];

  useEffect(() => {
    if (selected >= value.slides.length) setSelected(Math.max(0, value.slides.length - 1));
  }, [selected, value.slides.length]);

  const replaceSlide = (next: SlidePreviewItem) => {
    onChange({ ...value, slides: value.slides.map((entry, index) => (index === selected ? next : entry)) });
  };

  return (
    <div className="grid h-full min-h-[26rem] grid-cols-[minmax(12rem,0.75fr)_minmax(20rem,1.5fr)] gap-3" data-testid="deck-design-view">
      <aside className="min-h-0 overflow-y-auto rounded-xl border border-border bg-muted/20 p-2">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-xs font-semibold">Slides</span>
          <button type="button" onClick={() => {
            onChange({ ...value, slides: [...value.slides, { title: 'Nouvelle slide', bullets: [] }] });
            setSelected(value.slides.length);
          }} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Ajouter une slide">
            <Plus className="h-4 w-4" />
          </button>
        </div>
        {value.slides.map((entry, index) => (
          <button key={`${entry.title ?? 'slide'}-${index}`} type="button" onClick={() => setSelected(index)}
            className={`mb-1 w-full rounded-lg border px-3 py-2 text-left text-xs ${index === selected ? 'border-primary bg-primary/10' : 'border-transparent text-muted-foreground hover:bg-muted'}`}>
            <span className="mr-2 font-mono text-[10px] text-primary">{index + 1}</span>
            {entry.title || 'Sans titre'}
          </button>
        ))}
      </aside>
      <section className="min-h-0 overflow-y-auto rounded-xl border border-border bg-surface p-4">
        {slide ? (
          <>
            <div className="mb-4 flex items-center gap-1">
              <EditorIconButton label="Monter" onClick={() => {
                onChange({ ...value, slides: moveItem(value.slides, selected, selected - 1) });
                setSelected(Math.max(0, selected - 1));
              }} disabled={selected === 0}><ArrowUp /></EditorIconButton>
              <EditorIconButton label="Descendre" onClick={() => {
                onChange({ ...value, slides: moveItem(value.slides, selected, selected + 1) });
                setSelected(Math.min(value.slides.length - 1, selected + 1));
              }} disabled={selected === value.slides.length - 1}><ArrowDown /></EditorIconButton>
              <EditorIconButton label="Dupliquer" onClick={() => {
                const slides = [...value.slides];
                slides.splice(selected + 1, 0, structuredClone(slide));
                onChange({ ...value, slides });
                setSelected(selected + 1);
              }}><Copy /></EditorIconButton>
              <EditorIconButton label="Supprimer" disabled={value.slides.length <= 1} onClick={() => {
                onChange({ ...value, slides: value.slides.filter((_entry, index) => index !== selected) });
              }}><Trash2 /></EditorIconButton>
              <span className="ml-auto text-xs text-muted-foreground">Slide {selected + 1}/{value.slides.length}</span>
            </div>
            <label className="block text-xs font-medium text-muted-foreground">
              Titre
              <input value={slide.title ?? ''} onChange={(event) => replaceSlide({ ...slide, title: event.target.value })}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold outline-none focus:border-primary" />
            </label>
            <label className="mt-4 block text-xs font-medium text-muted-foreground">
              Points — un par ligne
              <textarea value={(slide.bullets ?? []).join('\n')} onChange={(event) => replaceSlide({ ...slide, bullets: event.target.value.split('\n').filter((line) => line.trim()) })}
                rows={8} className="mt-1 w-full resize-y rounded-lg border border-border bg-background p-3 text-sm outline-none focus:border-primary" />
            </label>
            <label className="mt-4 block text-xs font-medium text-muted-foreground">
              Notes orateur
              <textarea value={slide.notes ?? ''} onChange={(event) => replaceSlide({ ...slide, notes: event.target.value })}
                rows={4} className="mt-1 w-full resize-y rounded-lg border border-border bg-background p-3 text-sm outline-none focus:border-primary" />
            </label>
          </>
        ) : null}
      </section>
    </div>
  );
}

interface ImageMark {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  instruction: string;
}

interface DragPoint { x: number; y: number }

interface PersistentImageVersion {
  id: string;
  parentId: string | null;
  path: string;
  createdAt: number;
}

export function ImageDesignEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const imageRef = useRef<HTMLImageElement>(null);
  const dragStartRef = useRef<DragPoint | null>(null);
  const [drag, setDrag] = useState<{ start: DragPoint; end: DragPoint } | null>(null);
  const [marks, setMarks] = useState<ImageMark[]>([]);
  const [globalInstruction, setGlobalInstruction] = useState('');
  const [versions, setVersions] = useState<PersistentImageVersion[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [alphaMasking, setAlphaMasking] = useState<boolean | null>(null);
  const [imageEditingAvailable, setImageEditingAvailable] = useState<boolean | null>(null);
  const knownVersionPathsRef = useRef(new Set<string>());
  const loadingHistoryPathRef = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let active = true;
    void window.electronAPI.media.capabilities()
      .then((capabilities) => {
        if (!active) return;
        setImageEditingAvailable(capabilities.imageEditing);
        setAlphaMasking(capabilities.imageMasking);
      })
      .catch(() => {
        if (!active) return;
        setImageEditingAvailable(false);
        setAlphaMasking(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (knownVersionPathsRef.current.has(value) || loadingHistoryPathRef.current === value) return;
    let active = true;
    loadingHistoryPathRef.current = value;
    void window.electronAPI.media.imageEditHistory({ imagePath: value })
      .then((response) => {
        if (!active) return;
        knownVersionPathsRef.current.add(value);
        if (!response.ok || !response.history) {
          if (!response.ok && response.error) setNotice(`Historique indisponible : ${response.error}`);
          return;
        }
        setVersions(response.history.versions);
        for (const version of response.history.versions) knownVersionPathsRef.current.add(version.path);
        const head = response.history.versions.find((version) => version.id === response.history!.headVersionId);
        if (head && head.path !== value) onChangeRef.current(head.path);
      })
      .catch((error) => {
        if (active) setNotice(`Historique indisponible : ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        if (loadingHistoryPathRef.current === value) loadingHistoryPathRef.current = null;
      });
    return () => { active = false; };
  }, [value]);

  useEffect(() => {
    setMarks([]);
    setDrag(null);
  }, [value]);

  const pointFromEvent = (event: ReactPointerEvent<SVGSVGElement>): DragPoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  };

  const finishDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    const start = dragStartRef.current;
    if (!start) return;
    const end = pointFromEvent(event);
    dragStartRef.current = null;
    setDrag(null);
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);
    if (width < 0.01 || height < 0.01) return;
    setMarks((current) => [...current, { id: crypto.randomUUID(), x, y, width, height, instruction: '' }].slice(-12));
  };

  const createMask = useCallback((): string => {
    const image = imageRef.current;
    if (!image?.naturalWidth || !image.naturalHeight) throw new Error('Image source non chargée');
    if (image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error('Image trop grande pour un masque local (40 mégapixels maximum)');
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas indisponible');
    context.fillStyle = 'rgba(255,255,255,1)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (const mark of marks) {
      context.clearRect(mark.x * canvas.width, mark.y * canvas.height, mark.width * canvas.width, mark.height * canvas.height);
    }
    return canvas.toDataURL('image/png');
  }, [marks]);

  const runEdit = async () => {
    if (busy || marks.length === 0 || imageEditingAvailable !== true) return;
    const perRegion = marks.map((mark, index) => `Zone ${index + 1}: ${mark.instruction.trim() || globalInstruction.trim() || 'appliquer la modification demandée'}`);
    const prompt = [globalInstruction.trim(), ...perRegion].filter(Boolean).join('\n');
    if (!prompt) {
      setNotice('Décris la modification globale ou celle de chaque zone.');
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const response = await window.electronAPI.media.editImage({
        prompt,
        imagePath: value,
        ...(alphaMasking ? { maskDataUrl: createMask() } : {}),
        selections: marks.map(({ x, y, width, height }) => ({ x, y, width, height })),
      });
      if (!response.ok || !response.outputPath) throw new Error(response.error || 'Aucune image éditée reçue');
      if (response.history) {
        setVersions(response.history.versions);
        for (const version of response.history.versions) knownVersionPathsRef.current.add(version.path);
      } else {
        // A mixed-version preload may omit the inline history. Let the new
        // canonical output trigger the confined read IPC as a compatibility
        // fallback instead of keeping a renderer-only stack.
        knownVersionPathsRef.current.delete(response.outputPath);
      }
      onChange(response.outputPath);
      setNotice('Nouvelle version créée et ajoutée à l’historique durable.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const currentVersion = versions.find((version) => version.path === value);
  const previousVersion = currentVersion?.parentId
    ? versions.find((version) => version.id === currentVersion.parentId)
    : undefined;

  return (
    <div className="grid h-full min-h-[28rem] grid-cols-[minmax(20rem,1.5fr)_minmax(16rem,0.8fr)] gap-3" data-testid="image-design-view">
      <section className="flex min-h-0 items-center justify-center overflow-auto rounded-xl border border-border bg-[radial-gradient(circle_at_center,hsl(var(--muted))_1px,transparent_1px)] bg-[length:18px_18px] p-4">
        <div className="relative inline-block max-h-full max-w-full select-none">
          <img ref={imageRef} src={`file://${value}`} alt="Image à éditer" draggable={false} className="block max-h-[68vh] max-w-full rounded-lg object-contain" />
          <svg
            className="absolute inset-0 h-full w-full cursor-crosshair touch-none rounded-lg"
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              const start = pointFromEvent(event);
              dragStartRef.current = start;
              setDrag({ start, end: start });
            }}
            onPointerMove={(event) => {
              if (!dragStartRef.current) return;
              setDrag({ start: dragStartRef.current, end: pointFromEvent(event) });
            }}
            onPointerUp={finishDrag}
            onPointerCancel={() => { dragStartRef.current = null; setDrag(null); }}
            aria-label="Tracer une zone à modifier"
          >
            {marks.map((mark, index) => (
              <g key={mark.id}>
                <rect x={mark.x} y={mark.y} width={mark.width} height={mark.height} fill="rgba(124,58,237,0.22)" stroke="rgb(167,139,250)" strokeWidth="0.004" />
                <text x={mark.x + 0.008} y={mark.y + 0.025} fontSize="0.025" fill="white" stroke="black" strokeWidth="0.002">{index + 1}</text>
              </g>
            ))}
            {drag ? <rect x={Math.min(drag.start.x, drag.end.x)} y={Math.min(drag.start.y, drag.end.y)} width={Math.abs(drag.end.x - drag.start.x)} height={Math.abs(drag.end.y - drag.start.y)} fill="rgba(56,189,248,0.18)" stroke="rgb(56,189,248)" strokeWidth="0.004" strokeDasharray="0.012 0.008" /> : null}
          </svg>
        </div>
      </section>

      <aside className="min-h-0 overflow-y-auto rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-primary/10 p-3 text-xs text-foreground">
          <MousePointer2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          {imageEditingAvailable === false
            ? 'Édition indisponible avec la configuration actuelle. Pour ComfyUI, configure un workflow API d’inpainting compatible ; aucun fallback de régénération n’est utilisé.'
            : alphaMasking === true
            ? 'Trace une ou plusieurs zones. Le fournisseur actif reçoit un masque alpha exact ; chaque résultat devient une nouvelle version.'
            : alphaMasking === false
              ? 'Trace une ou plusieurs zones. Le fournisseur actif ne prend pas de masque alpha : les zones sont transmises comme contraintes normalisées dans la consigne.'
              : 'Trace une ou plusieurs zones. Vérification des capacités du fournisseur actif…'}
        </div>
        <label className="block text-xs font-medium text-muted-foreground">
          Intention générale
          <textarea value={globalInstruction} onChange={(event) => setGlobalInstruction(event.target.value)} rows={3}
            placeholder="Ex. conserver la lumière et le cadrage" className="mt-1 w-full resize-y rounded-lg border border-border bg-background p-2 text-sm outline-none focus:border-primary" />
        </label>
        <div className="mt-4 space-y-2">
          {marks.map((mark, index) => (
            <div key={mark.id} className="rounded-lg border border-border bg-muted/20 p-2">
              <div className="mb-1 flex items-center justify-between text-xs font-medium">
                <span>Zone {index + 1}</span>
                <button type="button" onClick={() => setMarks((current) => current.filter((entry) => entry.id !== mark.id))} className="text-muted-foreground hover:text-destructive" aria-label={`Supprimer la zone ${index + 1}`}><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
              <input value={mark.instruction} onChange={(event) => setMarks((current) => current.map((entry) => entry.id === mark.id ? { ...entry, instruction: event.target.value } : entry))}
                placeholder="Que faut-il changer ici ?" className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary" />
            </div>
          ))}
          {marks.length === 0 ? <p className="py-4 text-center text-xs text-muted-foreground">Aucune zone marquée.</p> : null}
        </div>
        {notice ? <p role="status" className="mt-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">{notice}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => void runEdit()} disabled={busy || marks.length === 0 || imageEditingAvailable !== true}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Appliquer aux zones
          </button>
          <button type="button" onClick={() => setMarks([])} disabled={marks.length === 0} className="rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-50">Effacer</button>
          <button type="button" disabled={!previousVersion || busy} onClick={() => {
            if (!previousVersion) return;
            onChange(previousVersion.path);
            setNotice(`Version du ${new Date(previousVersion.createdAt).toLocaleString()} restaurée.`);
          }} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-50">
            <RotateCcw className="h-3.5 w-3.5" /> Version précédente
          </button>
        </div>
        {versions.length > 0 ? (
          <p className="mt-2 text-[11px] text-muted-foreground" data-testid="image-version-count">
            {versions.length} version{versions.length > 1 ? 's' : ''} conservée{versions.length > 1 ? 's' : ''} localement.
          </p>
        ) : null}
      </aside>
    </div>
  );
}

function EditorIconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactElement<{ className?: string }> }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled}
      className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40">
      {children}
    </button>
  );
}
