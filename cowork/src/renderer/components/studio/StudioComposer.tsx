import { Palette, Send, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { suggestTemplate, type StudioTemplateId } from './utils/studio-intent.js';
import { designSystemsByCategory, findDesignSystem } from './design-systems-catalog.js';

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
}

export interface StudioComposerProps {
  templates: TemplateCard[];
  onScaffold: (request: StudioScaffoldRequest) => void;
  onPrompt: (text: string) => void;
  busy?: boolean;
  workingDir?: string;
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

export function StudioComposer({ templates, onScaffold, onPrompt, busy = false, workingDir = '' }: StudioComposerProps) {
  const [prompt, setPrompt] = useState('');
  const [template, setTemplate] = useState<StudioTemplateId>('react-ts');
  const [projectName, setProjectName] = useState('app-studio-project');
  const [binName, setBinName] = useState('app-studio-project');
  const [description, setDescription] = useState('');
  const [targetDir, setTargetDir] = useState('app-studio-project');
  const [targetEdited, setTargetEdited] = useState(false);
  const [designSystem, setDesignSystem] = useState('');
  const selectedTemplate = useMemo(
    () => templates.find((item) => item.id === template) ?? templates[0],
    [template, templates],
  );
  const designGroups = useMemo(() => designSystemsByCategory(), []);
  const selectedDesign = designSystem ? findDesignSystem(designSystem) : undefined;
  const requiredVars = VARS_BY_TEMPLATE[template];

  useEffect(() => {
    if (templates.length === 0) return;
    if (!templates.some((item) => item.id === template)) {
      setTemplate(templates[0]?.id ?? 'react-ts');
    }
  }, [template, templates]);

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
        <div className="grid gap-2 md:grid-cols-[180px_minmax(0,1fr)_180px]">
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
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            Générer
          </button>
        </div>
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
          </div>
          <p className="flex items-center text-xs text-muted-foreground">
            {selectedDesign
              ? `${selectedDesign.name} — ${selectedDesign.tagline}`
              : "Choisis un style de marque : l'app générée en reprend couleurs, typo et géométrie."}
          </p>
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
    </section>
  );
}
