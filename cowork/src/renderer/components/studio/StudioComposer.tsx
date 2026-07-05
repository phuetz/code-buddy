import { Send, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { suggestTemplate, type StudioTemplateId } from './utils/studio-intent.js';

export interface TemplateCard {
  id: StudioTemplateId;
  label: string;
  description: string;
}

export interface StudioScaffoldRequest {
  template: StudioTemplateId;
  prompt: string;
  vars: Record<string, string>;
}

export interface StudioComposerProps {
  templates: TemplateCard[];
  onScaffold: (request: StudioScaffoldRequest) => void;
  onPrompt: (text: string) => void;
  busy?: boolean;
}

const SUGGESTIONS = [
  'une todo app React',
  'une API Express CRUD',
  'une landing page',
];

export function StudioComposer({ templates, onScaffold, onPrompt, busy = false }: StudioComposerProps) {
  const [prompt, setPrompt] = useState('');
  const [template, setTemplate] = useState<StudioTemplateId>('react-ts');
  const selectedTemplate = useMemo(
    () => templates.find((item) => item.id === template) ?? templates[0],
    [template, templates],
  );

  useEffect(() => {
    if (templates.length === 0) return;
    if (!templates.some((item) => item.id === template)) {
      setTemplate(templates[0]?.id ?? 'react-ts');
    }
  }, [template, templates]);

  const updatePrompt = (nextPrompt: string) => {
    setPrompt(nextPrompt);
    onPrompt(nextPrompt);
    const suggestion = suggestTemplate(nextPrompt);
    if (templates.some((item) => item.id === suggestion)) {
      setTemplate(suggestion);
    }
  };

  const handleGenerate = () => {
    const text = prompt.trim();
    if (!text || busy) return;
    onScaffold({
      template,
      prompt: text,
      vars: {
        description: text,
      },
    });
  };

  return (
    <section className="border-b border-border bg-surface p-3">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 lg:flex-row">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-background px-3">
            <Wand2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              value={prompt}
              onChange={(event) => updatePrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  handleGenerate();
                }
              }}
              disabled={busy}
              placeholder="Décris l'app à construire"
              className="h-10 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
            />
          </div>
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
          <button
            type="button"
            onClick={handleGenerate}
            disabled={busy || !prompt.trim()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            Générer
          </button>
        </div>
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
        </div>
      </div>
    </section>
  );
}
