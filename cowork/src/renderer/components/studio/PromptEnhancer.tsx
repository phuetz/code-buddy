import { Sparkles, Wand2 } from 'lucide-react';

/**
 * bolt.new-style "enhance prompt": shows suggestions to enrich a terse app
 * description and applies the enriched prompt on demand. Props-driven.
 */
export function PromptEnhancer({
  suggestions,
  enriched,
  onApply,
  busy = false,
}: {
  suggestions: string[];
  enriched: string;
  onApply: (enriched: string) => void;
  busy?: boolean;
}) {
  if (suggestions.length === 0) return null;
  return (
    <section className="rounded-lg border border-border bg-surface p-2.5" aria-label="Enhance the prompt" data-testid="prompt-enhancer">
      <header className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground">
        <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
        Suggestions
      </header>
      <ul className="mb-2 space-y-1">
        {suggestions.map((s, i) => (
          <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" aria-hidden="true" />
            {s}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => onApply(enriched)}
        disabled={busy || !enriched}
        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />
        Enhance the prompt
      </button>
    </section>
  );
}
