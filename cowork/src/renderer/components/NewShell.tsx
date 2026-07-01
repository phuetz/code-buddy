/**
 * NewShell — the opt-in redesigned Cowork shell (behind COWORK_NEW_SHELL). See cowork/REDESIGN.md.
 *
 * Slice 1: prove the calm information architecture without breaking anything. One thin rail drives a
 * single `primaryView` (replacing the ~44 `show*` overlay flags): Chat is the home (DockWorkspace
 * already shows the WelcomeView when no session is active), Activity/Workspace reuse the existing
 * overlays, and Advanced is a progressive-disclosure launcher into the current panels. Everything
 * dense stays one click away but out of sight until asked for.
 *
 * The old shell (ShellNavigation + DockWorkspace) is unchanged and still the default; App.tsx only
 * renders NewShell when `newShellEnabled` is set.
 */
import { useAppStore } from '../store';
import type { PrimaryView } from '../store';
import { DockWorkspace } from './DockWorkspace';
import { ActivityPane } from './ActivityPane';
import { PlanPanel } from './PlanPanel';
import { FileActivityPanel } from './FileActivityPanel';

interface RailItem {
  view: PrimaryView;
  label: string;
  glyph: string;
}

const RAIL: RailItem[] = [
  { view: 'chat', label: 'Chat', glyph: '💬' },
  { view: 'plan', label: 'Plan', glyph: '📋' },
  { view: 'activity', label: 'Activité', glyph: '📊' },
  { view: 'workspace', label: 'Fichiers', glyph: '📁' },
  { view: 'advanced', label: 'Avancé', glyph: '⚙️' },
];

/** Progressive-disclosure launcher: the dense/power-user surfaces, out of the default flow. */
function AdvancedLauncher() {
  const s = useAppStore();
  const cards: Array<{ label: string; hint: string; open: () => void }> = [
    { label: 'Réglages', hint: 'Modèles, clés, MCP, workspace', open: () => s.setShowSettings(true) },
    { label: 'Fleet', hint: 'Multi-agents, pairs, routage', open: () => s.setShowFleetCommandCenter(true) },
    { label: 'Autonomie', hint: 'Boucle autonome, YOLO', open: () => s.setShowAutonomyPanel(true) },
    { label: 'Mémoire', hint: 'Ce que Code Buddy retient', open: () => s.setShowMemoryEditor(true) },
    { label: 'Skills', hint: 'Docs Office, charts, recherche', open: () => s.setShowSkillsManager(true) },
    { label: 'Companion', hint: 'Voix, présence, canaux', open: () => s.setShowCompanionPanel(true) },
    { label: 'Missions', hint: 'Tableau des tâches', open: () => s.setShowMissionBoard(true) },
    { label: 'Tests', hint: 'Lancer la suite de tests', open: () => s.setShowTestRunner(true) },
    { label: 'Insights', hint: 'Analyse de session', open: () => s.setShowSessionInsights(true) },
  ];
  return (
    <div className="h-full overflow-auto p-6">
      <h2 className="text-lg font-semibold mb-1">Avancé</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Les surfaces puissantes de Code Buddy — hors du chemin par défaut, à un clic.
      </p>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {cards.map((c) => (
          <button
            key={c.label}
            type="button"
            onClick={c.open}
            className="text-left rounded-lg border border-border bg-background hover:bg-accent transition-colors p-3"
          >
            <div className="font-medium">{c.label}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{c.hint}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

export function NewShell() {
  const primaryView = useAppStore((st) => st.primaryView);
  const setPrimaryView = useAppStore((st) => st.setPrimaryView);
  const backToChat = () => setPrimaryView('chat');

  return (
    <div className="h-full min-h-0 flex overflow-hidden bg-background" data-testid="new-shell">
      {/* Thin rail — one calm nav, not three. */}
      <nav className="w-16 shrink-0 border-r border-border flex flex-col items-stretch py-2 gap-1">
        {RAIL.map((item) => {
          const active = primaryView === item.view;
          return (
            <button
              key={item.view}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => setPrimaryView(item.view)}
              title={item.label}
              className={`flex flex-col items-center gap-0.5 py-2 mx-1 rounded-md text-[10px] transition-colors ${
                active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60'
              }`}
            >
              <span className="text-lg leading-none">{item.glyph}</span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Primary area */}
      <div className="flex-1 min-w-0 min-h-0 relative">
        {/* Chat stays mounted so a session isn't torn down when peeking at other views. */}
        <div className={`absolute inset-0 ${primaryView === 'chat' ? '' : 'hidden'}`}>
          <DockWorkspace />
        </div>
        {primaryView === 'plan' && <PlanPanel />}
        {primaryView === 'activity' && <ActivityPane />}
        {primaryView === 'workspace' && <FileActivityPanel open onClose={backToChat} />}
        {primaryView === 'advanced' && <AdvancedLauncher />}
      </div>
    </div>
  );
}
