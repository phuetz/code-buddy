/**
 * HomeView — the calm empty-state of the NewShell (behind COWORK_NEW_SHELL).
 * See cowork/REDESIGN.md § "Home = one input box + recent sessions + quick
 * chips".
 *
 * Slice 2 gave the calm layout; slice 3 wires the "one input box": typing a
 * goal and pressing Enter starts a real session with that first message
 * (the same startSession path WelcomeView uses), then NewShell swaps Home
 * for the live chat. Quick chips prefill the input or open the matching
 * surface; recent sessions resume.
 */
import { useMemo, useRef, useState } from 'react';
import { Clapperboard, FileText, FolderOpen, Hammer, Image as ImageIcon, Presentation, Radio, Search, Table2 } from 'lucide-react';
import { useAppStore } from '../store';
import { useIPC } from '../hooks/useIPC';
import { getInitialSessionTitle } from '../../shared/session-title';
import { AGENT_RECIPES } from './agent-recipes';
import type { Session } from '../types';

interface QuickAction {
  label: string;
  hint: string;
  run: () => void;
}

/** Genspark-style agent tiles: each studio is ONE click from Home. */
interface StudioTile {
  label: string;
  icon: typeof Presentation;
  /** `seed` = the Home composer's current text, carried into the studio. */
  run: (s: ReturnType<typeof useAppStore.getState>, seed: string | null) => void;
}

const STUDIO_TILES: StudioTile[] = [
  { label: 'App', icon: Hammer, run: (s) => s.setPrimaryView('studio') },
  { label: 'Deck', icon: Presentation, run: (s, seed) => { s.setCreationsSeed(seed); s.setCreationsTab('deck'); s.setPrimaryView('creations'); } },
  { label: 'Feuille', icon: Table2, run: (s, seed) => { s.setCreationsSeed(seed); s.setCreationsTab('sheet'); s.setPrimaryView('creations'); } },
  { label: 'Document', icon: FileText, run: (s, seed) => { s.setCreationsSeed(seed); s.setCreationsTab('doc'); s.setPrimaryView('creations'); } },
  { label: 'Pod', icon: Radio, run: (s, seed) => { s.setCreationsSeed(seed); s.setCreationsTab('pod'); s.setPrimaryView('creations'); } },
  { label: 'Image', icon: ImageIcon, run: (s, seed) => { s.setCreationsSeed(seed); s.setCreationsTab('image'); s.setPrimaryView('creations'); } },
  { label: 'Vidéo', icon: Clapperboard, run: (s, seed) => { s.setCreationsSeed(seed); s.setCreationsTab('video'); s.setPrimaryView('creations'); } },
  { label: 'Drive', icon: FolderOpen, run: (s) => { s.setCreationsTab('drive'); s.setPrimaryView('creations'); } },
  { label: 'Recherche', icon: Search, run: (s) => s.setShowLiveLauncher(true) },
];

function RecentSessions({
  sessions,
  onOpen,
}: {
  sessions: Session[];
  onOpen: (id: string) => void;
}) {
  if (sessions.length === 0) return null;
  return (
    <div className="w-full max-w-xl" data-testid="home-recents">
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
        Sessions récentes
      </div>
      <div className="flex flex-col gap-1">
        {sessions.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onOpen(s.id)}
            className="text-left rounded-md border border-border bg-background hover:bg-accent transition-colors px-3 py-2"
          >
            <div className="text-sm font-medium truncate">{s.title || 'Sans titre'}</div>
            {s.cwd && (
              <div className="text-xs text-muted-foreground truncate">{s.cwd}</div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export function HomeView() {
  const sessions = useAppStore((s) => s.sessions);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setPrimaryView = useAppStore((s) => s.setPrimaryView);
  const setShowLiveLauncher = useAppStore((s) => s.setShowLiveLauncher);
  const setShowSkillsManager = useAppStore((s) => s.setShowSkillsManager);
  const workingDir = useAppStore((s) => s.workingDir);
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const { startSession } = useIPC();

  const [prompt, setPrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const resume = (id: string) => {
    setActiveSession(id);
    setPrimaryView('chat');
  };

  // The one input box: start a real session with this first message. Once the
  // session is active, NewShell swaps Home for DockWorkspace automatically.
  const send = async () => {
    const text = prompt.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    try {
      const session = await startSession(
        getInitialSessionTitle(text),
        text,
        workingDir || undefined,
        activeProjectId ?? undefined,
        false
      );
      if (session) setPrompt('');
    } finally {
      setSubmitting(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const prefill = (text: string) => {
    setPrompt(text);
    inputRef.current?.focus();
  };

  const recents = sessions
    .filter((s) => !s.archived)
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5);

  const quick: QuickAction[] = [
    { label: 'Coder / corriger', hint: 'Décris le bug ou la fonctionnalité', run: () => prefill('') },
    { label: 'Rechercher', hint: 'Recherche large + flow de planification', run: () => setShowLiveLauncher(true) },
    { label: 'Créer un document', hint: 'Excel, Word, PDF, charts', run: () => setShowSkillsManager(true) },
  ];

  // A rotating handful of ready-to-run missions (Genspark recipes) — clicking
  // one drops its prompt into the input so the user only fills the <…> bits.
  const missions = useMemo(() => AGENT_RECIPES.slice(0, 6), []);

  return (
    <div
      className="h-full min-h-0 overflow-auto flex flex-col items-center justify-center gap-8 p-8"
      data-testid="home-view"
    >
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Que veux-tu faire ?</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Dis-le à Code Buddy — il code, cherche et crée sur ton dossier.
        </p>
      </div>

      {/* One input box — the center of gravity (REDESIGN.md § Home). */}
      <form
        className="w-full max-w-xl"
        data-testid="home-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <div className="flex items-end gap-2 rounded-2xl border border-border bg-background p-2 shadow-soft focus-within:border-accent transition-colors">
          <textarea
            ref={inputRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder="Ex : corrige le bug de connexion, ou crée un tableau de bord…"
            className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm focus:outline-none"
            data-testid="home-input"
          />
          <button
            type="submit"
            disabled={!prompt.trim() || submitting}
            className="shrink-0 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-background hover:bg-accent-hover disabled:opacity-40"
            data-testid="home-send"
          >
            {submitting ? '…' : 'Envoyer'}
          </button>
        </div>
      </form>

      {/* Genspark-style agent row: every studio is one click away; the typed
          subject travels with the click (creationsSeed). */}
      <div className="w-full max-w-xl flex flex-wrap justify-center gap-2" data-testid="home-studios">
        {STUDIO_TILES.map(({ label, icon: Icon, run }) => (
          <button
            key={label}
            type="button"
            onClick={() => run(useAppStore.getState(), prompt.trim() || null)}
            className="flex flex-col items-center gap-1.5 rounded-xl border border-border bg-background hover:border-accent hover:bg-accent/10 transition-colors px-4 py-3 min-w-[72px]"
          >
            <Icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <span className="text-xs">{label}</span>
          </button>
        ))}
        {prompt.trim() ? (
          <div className="w-full text-center text-xs text-muted-foreground">
            Ton sujet accompagnera le studio choisi.
          </div>
        ) : null}
      </div>

      <div className="w-full max-w-xl grid grid-cols-1 sm:grid-cols-3 gap-3" data-testid="home-quick">
        {quick.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={a.run}
            className="text-left rounded-lg border border-border bg-background hover:bg-accent transition-colors p-3"
          >
            <div className="font-medium text-sm">{a.label}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{a.hint}</div>
          </button>
        ))}
      </div>

      {/* Ready-to-run missions (agent-recipes catalogue, previously dormant). */}
      <div className="w-full max-w-xl" data-testid="home-missions">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Missions prêtes</div>
        <div className="flex flex-wrap gap-2">
          {missions.map((r) => (
            <button
              key={r.id}
              type="button"
              title={r.description}
              onClick={() => prefill(r.prompt)}
              className="rounded-full border border-border bg-background hover:border-accent hover:bg-accent/10 transition-colors px-3 py-1.5 text-xs"
            >
              <span className="mr-1" aria-hidden="true">{r.emoji}</span>
              {r.title}
            </button>
          ))}
        </div>
      </div>

      <RecentSessions sessions={recents} onOpen={resume} />
    </div>
  );
}
