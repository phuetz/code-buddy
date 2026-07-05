import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import { Bot, Send, Square, Sparkles, User } from 'lucide-react';
import type { StudioMessage } from './iterate-model.js';
import { lastAssistantMessage } from './iterate-model.js';

export interface StudioChatPanelProps {
  messages: StudioMessage[];
  busy?: boolean;
  suggestions?: string[];
  onSend?: (text: string) => void;
  onStop?: () => void;
}

function Bubble({ message }: { message: StudioMessage }) {
  const isUser = message.role === 'user';

  return (
    <article className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`} aria-label={isUser ? 'Message utilisateur' : 'Message assistant'}>
      {!isUser && (
        <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground">
          <Bot className="h-4 w-4" aria-hidden="true" />
        </span>
      )}
      <div
        className={`max-w-[82%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
          isUser ? 'bg-primary text-primary-foreground' : 'border border-border bg-surface text-foreground'
        }`}
      >
        <p className="whitespace-pre-wrap leading-relaxed">{message.text || (message.streaming ? 'Itération en cours' : '')}</p>
        {message.streaming && (
          <span className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground" aria-label="Réponse en cours">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:120ms]" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:240ms]" />
          </span>
        )}
      </div>
      {isUser && (
        <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground">
          <User className="h-4 w-4" aria-hidden="true" />
        </span>
      )}
    </article>
  );
}

export function StudioChatPanel({ messages, busy = false, suggestions = [], onSend, onStop }: StudioChatPanelProps) {
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const latestAssistant = lastAssistantMessage(messages);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, latestAssistant?.text]);

  const send = (text: string) => {
    const value = text.trim();
    if (!value || busy) {
      return;
    }

    onSend?.(value);
    setDraft('');
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    send(draft);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      send(draft);
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border border-border bg-background" aria-label="Chat d'itération App Studio">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Itérer sur l’app
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Demande une modification, puis vérifie la preview.</p>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" role="log" aria-live="polite" aria-relevant="additions text">
        {messages.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-surface p-4 text-sm text-muted-foreground">
            Décris la prochaine itération : style, composant, données ou tests à ajouter.
          </div>
        ) : (
          messages.map((message) => <Bubble key={message.id} message={message} />)
        )}
        <div ref={bottomRef} />
      </div>

      {suggestions.length > 0 && (
        <div className="flex gap-2 overflow-x-auto border-t border-border px-4 py-2" aria-label="Suggestions d'itération">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="shrink-0 rounded-full border border-border bg-surface px-3 py-1 text-xs text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              disabled={busy}
              onClick={() => send(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      <form className="border-t border-border p-3" onSubmit={submit}>
        <label className="sr-only" htmlFor="studio-iterate-composer">Message d'itération</label>
        <textarea
          id="studio-iterate-composer"
          className="min-h-20 w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
          placeholder="Ex. Rends le bouton principal plus visible et ajoute un état vide"
          value={draft}
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Ctrl/⌘ + Entrée pour envoyer</span>
          {busy ? (
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm text-red-500 hover:bg-red-500/15"
              onClick={onStop}
            >
              <Square className="h-3.5 w-3.5" aria-hidden="true" />
              Stop
            </button>
          ) : (
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!draft.trim()}
            >
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
              Envoyer
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
