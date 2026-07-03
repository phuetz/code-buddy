/**
 * HomeView — the calm empty-state of the NewShell (behind COWORK_NEW_SHELL).
 * See cowork/REDESIGN.md § "Home = one input box + recent sessions + quick
 * chips".
 *
 * Slice 2: the center of gravity. When Chat has no active session, greet with
 * one heading, three quick-action chips (open the right surface via existing
 * store actions), and the recent sessions to resume — instead of dropping the
 * user straight into the dense workspace. The free-text "one input box" that
 * sends a first message is the next micro-slice (it needs composer wiring);
 * until then the primary call to action resumes/opens chat.
 */
import { useAppStore } from '../store';
import type { Session } from '../types';

interface QuickAction {
  label: string;
  hint: string;
  run: () => void;
}

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

  const openChat = () => setPrimaryView('chat');
  const resume = (id: string) => {
    setActiveSession(id);
    setPrimaryView('chat');
  };

  const recents = sessions
    .filter((s) => !s.archived)
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5);

  const quick: QuickAction[] = [
    { label: 'Coder / corriger', hint: 'Discuter avec l’agent sur ton dossier', run: openChat },
    { label: 'Rechercher', hint: 'Recherche large + flow de planification', run: () => setShowLiveLauncher(true) },
    { label: 'Créer un document', hint: 'Excel, Word, PDF, charts', run: () => setShowSkillsManager(true) },
  ];

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

      <RecentSessions sessions={recents} onOpen={resume} />
    </div>
  );
}
