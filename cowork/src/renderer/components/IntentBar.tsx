/**
 * IntentBar — first-pass command surface for the Cowork super-agent flow.
 *
 * Labels intentionally stay as French defaults in this additive demo component;
 * integration can move them into locale files when the surface is mounted.
 *
 * @module renderer/components/IntentBar
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Rocket, Sparkles } from 'lucide-react';
import { classifyIntent } from '../utils/intent-classify';

export interface IntentBarProps {
  suggestions: string[];
  onSubmit: (text: string) => void;
  busy?: boolean;
}

export function IntentBar({ suggestions, onSubmit, busy = false }: IntentBarProps) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const intent = classifyIntent(text);
  const canSubmit = text.trim().length > 0 && !busy;

  const submitText = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    onSubmit(trimmed);
  };

  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-testid="intent-bar">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          submitText(text);
        }}
      >
        <label className="block text-sm font-medium text-foreground" htmlFor="intent-bar-input">
          {t('genspark.intent.label', 'Dis ce que tu veux')}
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Sparkles
              aria-hidden="true"
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              id="intent-bar-input"
              className="h-11 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
              data-testid="intent-bar-input"
              disabled={busy}
              placeholder={t('genspark.intent.placeholder', 'Construis, cherche, analyse ou automatise...')}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </div>
          <button
            type="submit"
            aria-label={t('genspark.intent.launch', 'Lancer')}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="intent-bar-submit"
            disabled={!canSubmit}
          >
            {busy ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Rocket aria-hidden="true" className="h-4 w-4" />}
            {t('genspark.intent.launch', 'Lancer')}
          </button>
        </div>
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            aria-label={t('genspark.intent.useSuggestion', { suggestion, defaultValue: `Utiliser ${suggestion}` })}
            className="rounded-full border border-border bg-muted px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            data-testid={`intent-suggestion-${suggestion}`}
            disabled={busy}
            onClick={() => {
              setText(suggestion);
              submitText(suggestion);
            }}
          >
            {suggestion}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-testid="intent-bar-classification">
        <span className="rounded-full bg-muted px-2 py-1">{intent.kind}</span>
        <span className="rounded-full bg-muted px-2 py-1">{intent.suggestedTool}</span>
        <span className="rounded-full bg-muted px-2 py-1">{Math.round(intent.confidence * 100)}%</span>
      </div>
    </section>
  );
}
