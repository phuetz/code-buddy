import { ImagePlus, Layers, LayoutGrid, Palette, Send, Sparkles, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { suggestTemplate, type StudioTemplateId } from './utils/studio-intent.js';
import { designSystemsByCategory, findDesignSystem } from './design-systems-catalog.js';
import { GENERATION_STACKS } from './generation-stacks.js';
import { DesignSystemGallery } from './DesignSystemGallery.js';
import { PromptEnhancer } from './PromptEnhancer.js';
import { enhancePrompt } from './prompt-enhance-model.js';

export interface TemplateCard {
  id: StudioTemplateId;
  label: string;
  description: string;
}

export interface StudioScaffoldRequest {
  template: StudioTemplateId;
  prompt: string;
  targetDir: string;
  vars: Record<string, string>;
  designSystem?: string;
  stack?: string;
  assetIds?: string[];
  materializedAssets?: Array<{ id: string; name: string; relativePath: string; kind: 'image' | 'video' | 'audio'; contentTier: 'safe' | 'sensual' | 'explicit' }>;
}

export interface StudioComposerProps {
  templates: TemplateCard[];
  onScaffold: (request: StudioScaffoldRequest) => void;
  onGenerateWithAI?: (request: StudioScaffoldRequest) => void;
  onPrompt: (text: string) => void;
  busy?: boolean;
  workingDir?: string;
  /** External seed for the prompt (e.g. picking a template vignette). */
  seedPrompt?: string;
}

const SUGGESTIONS = ['une todo app React', 'une API Express CRUD', 'une landing page'];

const VARS_BY_TEMPLATE: Record<StudioTemplateId, string[]> = {
  'react-ts': ['projectName', 'description'],
  'express-api': ['projectName', 'description'],
  'node-cli': ['projectName', 'binName', 'description'],
};

function slugify(value: string, fallback = 'app-studio-project'): string {
  const slug = value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || fallback;
}

function dirname(path: string): string {
  const normalized = path.replace(/\/+$/g, '');
  const index = normalized.lastIndexOf('/');
  return index > 0 ? normalized.slice(0, index) : normalized;
}

function joinPath(base: string, child: string): string {
  const cleanBase = base.trim().replace(/\/+$/g, '');
  return cleanBase ? `${cleanBase}/${child}` : child;
}

export function StudioComposer({ templates, onScaffold, onGenerateWithAI, onPrompt, busy = false, workingDir = '', seedPrompt }: StudioComposerProps) {
  const [prompt, setPrompt] = useState('');
  const [template, setTemplate] = useState<StudioTemplateId>('react-ts');
  const [projectName, setProjectName] = useState('app-studio-project');
  const [binName, setBinName] = useState('app-studio-project');
  const [description, setDescription] = useState('');
  const [targetDir, setTargetDir] = useState('app-studio-project');
  const [targetEdited, setTargetEdited] = useState(false);
  const [designSystem, setDesignSystem] = useState('');
  const [stack, setStack] = useState('static');
  const [showGallery, setShowGallery] = useState(false);
  const [creativeAssets, setCreativeAssets] = useState<Array<{ id: string; name: string; url: string; source: string }>>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const selectedTemplate = useMemo(
    () => templates.find((item) => item.id === template) ?? templates[0],
    [template, templates],
  );
  const designGroups = useMemo(() => designSystemsByCategory(), []);
  const selectedDesign = designSystem ? findDesignSystem(designSystem) : undefined;
  const requiredVars = VARS_BY_TEMPLATE[template];
  // bolt.new's "enhance prompt": offered only when the enrichment would
  // actually change the description (terse prompt missing stack/style/features).
  const enhancement = useMemo(() => enhancePrompt(prompt), [prompt]);
  const showEnhancer = Boolean(prompt.trim()) && enhancement.enriched !== prompt.trim();

  useEffect(() => {
    if (templates.length === 0) return;
    if (!templates.some((item) => item.id === template)) {
      setTemplate(templates[0]?.id ?? 'react-ts');
    }
  }, [template, templates]);

  useEffect(() => {
    let active = true;
    void window.electronAPI?.creativeAssets?.list({ kind: 'image', contentTier: 'safe', limit: 24 })
      .then((result) => { if (active && result.ok) setCreativeAssets(result.assets); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (targetEdited) return;
    setTargetDir(joinPath(workingDir, projectName));
  }, [projectName, targetEdited, workingDir]);

  const updatePrompt = (nextPrompt: string) => {
    setPrompt(nextPrompt);
    onPrompt(nextPrompt);
    setDescription(nextPrompt);
    const nextName = slugify(nextPrompt);
    setProjectName(nextName);
    setBinName(nextName);
    const suggestion = suggestTemplate(nextPrompt);
    if (templates.some((item) => item.id === suggestion)) {
      setTemplate(suggestion);
    }
  };

  // Seed the prompt from outside (e.g. a template vignette click) — fills the
  // composer as if the user typed it, so they can review and hit Generate.
  useEffect(() => {
    if (seedPrompt && seedPrompt.trim()) updatePrompt(seedPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedPrompt]);

  const handleTargetChange = (value: string) => {
    setTargetEdited(true);
    setTargetDir(value);
    const folder = value.replace(/\/+$/g, '').split('/').pop();
    if (folder) {
      const nextName = slugify(folder);
      setProjectName(nextName);
      setBinName(nextName);
    }
  };

  const updateProjectName = (value: string) => {
    const nextName = slugify(value);
    setProjectName(nextName);
    setBinName((current) => current || nextName);
    if (!targetEdited) setTargetDir(joinPath(workingDir, nextName));
  };

  const vars = {
    projectName,
    ...(template === 'node-cli' ? { binName } : {}),
    description: description || prompt,
  };
  const missingVars = requiredVars.filter((key) => !vars[key as keyof typeof vars]?.trim());
  const canGenerate = Boolean(prompt.trim() && targetDir.trim() && missingVars.length === 0 && !busy);

  const handleGenerate = () => {
    const text = prompt.trim();
    if (!text || !canGenerate) return;
    onScaffold({
      template,
      prompt: text,
      targetDir: targetDir.trim(),
      vars,
      ...(designSystem ? { designSystem } : {}),
      ...(stack ? { stack } : {}),
      ...(selectedAssetIds.length ? { assetIds: selectedAssetIds } : {}),
    });
  };

  // AI generation is lighter: it only needs a description + a destination folder
  // (the agent generates freely, no template variables required).
  const canGenerateAI = Boolean(prompt.trim() && targetDir.trim() && !busy && onGenerateWithAI);

  const handleGenerateWithAI = () => {
    const text = prompt.trim();
    if (!text || !canGenerateAI || !onGenerateWithAI) return;
    onGenerateWithAI({
      template,
      prompt: text,
      targetDir: targetDir.trim(),
      vars,
      ...(designSystem ? { designSystem } : {}),
      ...(stack ? { stack } : {}),
      ...(selectedAssetIds.length ? { assetIds: selectedAssetIds } : {}),
    });
  };

  return (
    <section className="border-b border-border bg-surface p-3">
      <div className="flex flex-col gap-3">
        <div className="flex min-w-0 items-start gap-2 rounded-md border border-border bg-background px-3 py-2 focus-within:border-accent">
          <Wand2 className="mt-1.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <textarea
            value={prompt}
            onChange={(event) => updatePrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                handleGenerate();
              }
            }}
            disabled={busy}
            rows={4}
            placeholder="Décris l'app à construire — ex. « une todo app React avec filtres, thème sombre et persistance locale ». Ctrl/⌘+Entrée pour générer."
            className="min-h-[104px] min-w-0 flex-1 resize-y bg-transparent py-1 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          />
        </div>
        {showEnhancer ? (
          <PromptEnhancer
            suggestions={enhancement.suggestions}
            enriched={enhancement.enriched}
            onApply={updatePrompt}
            busy={busy}
          />
        ) : null}
        <div className="grid gap-2 md:grid-cols-[180px_minmax(0,1fr)_auto]">
          <select
            value={selectedTemplate?.id ?? template}
            onChange={(event) => setTemplate(event.target.value as StudioTemplateId)}
            disabled={busy || templates.length === 0}
            className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Template"
          >
            {templates.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <input
            value={targetDir}
            onChange={(event) => handleTargetChange(event.target.value)}
            disabled={busy}
            placeholder="Dossier de destination"
            className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Dossier de destination"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!canGenerate}
              title="Générer depuis un template (rapide, sans IA)"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border bg-surface px-4 text-sm font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
              Template
            </button>
            {onGenerateWithAI ? (
              <button
                type="button"
                onClick={handleGenerateWithAI}
                disabled={!canGenerateAI}
                title="L'agent génère une app custom brandée en lisant le système de design choisi"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                Générer avec IA
              </button>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2" data-testid="stack-picker">
          <Layers className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <select
            value={stack}
            onChange={(event) => setStack(event.target.value)}
            disabled={busy}
            className="h-10 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Type d'application (stack)"
          >
            {GENERATION_STACKS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} — {s.description}
              </option>
            ))}
          </select>
        </div>
        {creativeAssets.length ? (
          <div className="rounded-md border border-border bg-background p-2" data-testid="studio-creative-assets">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium"><ImagePlus className="h-3.5 w-3.5" /> Assets visuels validés</span>
              <span className="text-[10px] text-muted-foreground">safe + approved · {selectedAssetIds.length} sélectionné(s)</span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {creativeAssets.map((asset) => {
                const selected = selectedAssetIds.includes(asset.id);
                return <button key={asset.id} type="button" onClick={() => setSelectedAssetIds((current) => selected ? current.filter((id) => id !== asset.id) : [...current, asset.id])} className={`w-20 shrink-0 overflow-hidden rounded-md border text-left ${selected ? 'border-primary ring-2 ring-primary/20' : 'border-border'}`} aria-pressed={selected} title={`${asset.name} · ${asset.source}`}><img src={asset.url} alt="" className="h-14 w-full object-cover" /><span className="block truncate px-1.5 py-1 text-[9px]">{asset.name}</span></button>;
              })}
            </div>
          </div>
        ) : null}
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2">
            <Palette className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <select
              value={designSystem}
              onChange={(event) => setDesignSystem(event.target.value)}
              disabled={busy}
              className="h-10 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Style de design"
            >
              <option value="">Style : aucun (neutre)</option>
              {designGroups.map((group) => (
                <optgroup key={group.category} label={group.category}>
                  {group.systems.map((system) => (
                    <option key={system.id} value={system.id}>
                      {system.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setShowGallery(true)}
              disabled={busy}
              title="Parcourir les 150 styles avec aperçu"
              className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Parcourir les styles"
            >
              <LayoutGrid className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            {selectedDesign ? (
              <>
                {selectedDesign.colors && selectedDesign.colors.length > 0 ? (
                  <span className="flex shrink-0 items-center gap-1" aria-hidden="true">
                    {selectedDesign.colors.slice(0, 5).map((color, index) => (
                      <span
                        key={`${color}-${index}`}
                        className="h-4 w-4 rounded-sm border border-border"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </span>
                ) : null}
                <span className="min-w-0 truncate" title={`${selectedDesign.name} — ${selectedDesign.tagline}`}>
                  {selectedDesign.name} — {selectedDesign.tagline}
                </span>
              </>
            ) : (
              "Choisis un style de marque : l'app générée en reprend couleurs, typo et géométrie."
            )}
          </div>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          <input
            value={projectName}
            onChange={(event) => updateProjectName(event.target.value)}
            disabled={busy}
            placeholder="projectName"
            className="h-9 rounded-md border border-border bg-background px-3 text-xs text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Nom du projet"
          />
          {template === 'node-cli' ? (
            <input
              value={binName}
              onChange={(event) => setBinName(slugify(event.target.value))}
              disabled={busy}
              placeholder="binName"
              className="h-9 rounded-md border border-border bg-background px-3 text-xs text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Nom du binaire"
            />
          ) : null}
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={busy}
            placeholder="description"
            className="h-9 rounded-md border border-border bg-background px-3 text-xs text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-50 md:col-span-1"
            aria-label="Description"
          />
        </div>
        {missingVars.length > 0 ? (
          <p className="text-xs text-destructive">Variables requises manquantes: {missingVars.join(', ')}</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => updatePrompt(suggestion)}
              disabled={busy}
              className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {suggestion}
            </button>
          ))}
          {targetDir ? <span className="text-xs text-muted-foreground">Racine prévue: {dirname(targetDir)}</span> : null}
        </div>
      </div>
      <DesignSystemGallery
        open={showGallery}
        selectedId={designSystem}
        onSelect={setDesignSystem}
        onClose={() => setShowGallery(false)}
      />
    </section>
  );
}
