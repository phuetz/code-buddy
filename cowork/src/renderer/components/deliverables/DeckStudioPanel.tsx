/**
 * DeckStudioPanel — the Genspark-style deck GENERATOR, self-contained.
 *
 * Describe a subject → a real agent session (memory on) opens with the
 * ```deck contract → the deck renders LIVE in SlideDeckPreview as it streams →
 * « Exporter en .pptx » hands the parsed deck to the real pptx skill in a
 * follow-up turn. Same proven pattern as App Studio's ```plan block.
 */
import { FileDown, Loader2, Presentation, Send } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAppStore } from '../../store';
import { useIPC } from '../../hooks/useIPC';
import { SlideDeckPreview } from './SlideDeckPreview.js';
import {
  buildDeckExportPrompt,
  buildDeckGenerationPrompt,
  latestDeckBlock,
  stripDeckBlocks,
} from './deck-block-model.js';

export function DeckStudioPanel() {
  const [subject, setSubject] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [exportAsked, setExportAsked] = useState(false);

  const sessionStates = useAppStore((st) => st.sessionStates);
  const workingDir = useAppStore((st) => st.workingDir);
  const { startSession, continueSession } = useIPC();

  const st = sessionId ? sessionStates[sessionId] : undefined;
  const busy = Boolean(st?.activeTurn);
  const deck = useMemo(
    () => latestDeckBlock(st?.messages ?? [], st?.partialMessage),
    [st?.messages, st?.partialMessage],
  );
  const lastReply = useMemo(() => {
    const messages = st?.messages ?? [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (m.role !== 'assistant') continue;
      const text = stripDeckBlocks(
        (m.content ?? [])
          .filter((b) => b.type === 'text' && typeof (b as { text?: string }).text === 'string')
          .map((b) => (b as { text: string }).text)
          .join(''),
      );
      if (text) return text;
    }
    return '';
  }, [st?.messages]);

  const generate = async () => {
    const trimmed = subject.trim();
    if (!trimmed || busy) return;
    setExportAsked(false);
    setActiveIndex(0);
    const session = await startSession(
      `Deck — ${trimmed.slice(0, 48)}`,
      buildDeckGenerationPrompt(trimmed),
      workingDir || undefined,
      null,
      true,
    );
    if (session?.id) setSessionId(session.id);
  };

  const exportPptx = () => {
    if (!sessionId || !deck || busy) return;
    setExportAsked(true);
    void continueSession(sessionId, buildDeckExportPrompt(deck));
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3" data-testid="deck-studio">
      <div className="flex items-start gap-2 rounded-md border border-border bg-background px-3 py-2 focus-within:border-accent">
        <Presentation className="mt-1.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <textarea
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void generate();
            }
          }}
          disabled={busy}
          rows={2}
          placeholder="Sujet du deck — ex. « lancer Code Buddy auprès des équipes dev ». Ctrl/⌘+Entrée pour générer."
          className="min-w-0 flex-1 resize-y bg-transparent py-1 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />
        <button
          type="button"
          onClick={() => void generate()}
          disabled={!subject.trim() || busy}
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
          Générer le deck
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <SlideDeckPreview slides={deck?.slides ?? []} activeIndex={activeIndex} onSelect={setActiveIndex} />
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={exportPptx}
          disabled={!deck || busy}
          title="L'agent écrit le fichier .pptx avec le skill pptx (dossier de travail)"
          className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          <FileDown className="h-4 w-4" aria-hidden="true" />
          Exporter en .pptx
        </button>
        <span className="min-w-0 truncate text-xs text-muted-foreground" title={lastReply}>
          {busy ? 'Génération en cours…' : exportAsked ? lastReply || 'Export demandé…' : deck ? `${deck.title} — ${deck.slides.length} slides` : ''}
        </span>
      </div>
    </div>
  );
}
