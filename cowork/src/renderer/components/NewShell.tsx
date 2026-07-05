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
import { HomeView } from './HomeView';
import { useMemo } from 'react';
import { AppStudioView } from './studio/AppStudioView';
import { useAppStudio } from './studio/use-app-studio';
import { createStudioApis } from './studio/studio-api-bridge';
import { MissionControlView } from './os/MissionControlView';
import { LabsGallery } from './labs/LabsGallery';

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
  { view: 'studio', label: 'App Studio', glyph: '🛠️' },
  { view: 'os', label: 'Mission Control', glyph: '🛰️' },
  { view: 'labs', label: 'Labs', glyph: '🧪' },
  { view: 'advanced', label: 'Avancé', glyph: '⚙️' },
];

interface LauncherCard {
  label: string;
  hint: string;
  open: () => void;
}

function CardGrid({ cards }: { cards: LauncherCard[] }) {
  return (
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
  );
}

/**
 * Progressive-disclosure launcher: the power-user surfaces, out of the default flow. Split into
 * "Avancé" (stable power-user tools) and "Labs" (dense / experimental / competitor-parity surfaces),
 * so a first-time user isn't confronted with the fleet mesh and parity strips next to Settings.
 */
function AdvancedLauncher() {
  const s = useAppStore();
  const advanced: LauncherCard[] = [
    { label: 'Réglages', hint: 'Modèles, clés, MCP, workspace', open: () => s.setShowSettings(true) },
    { label: 'Mémoire', hint: 'Ce que Code Buddy retient', open: () => s.setShowMemoryEditor(true) },
    { label: 'Skills', hint: 'Docs Office, charts, recherche', open: () => s.setShowSkillsManager(true) },
    { label: 'Companion', hint: 'Voix, présence, canaux', open: () => s.setShowCompanionPanel(true) },
    { label: 'Autonomie', hint: 'Boucle autonome, YOLO', open: () => s.setShowAutonomyPanel(true) },
    { label: 'Recherche', hint: 'Recherche large + flow de planification', open: () => s.setShowLiveLauncher(true) },
    { label: 'Tests', hint: 'Lancer la suite de tests', open: () => s.setShowTestRunner(true) },
    { label: 'Insights', hint: 'Analyse de session', open: () => s.setShowSessionInsights(true) },
  ];
  const labs: LauncherCard[] = [
    {
      label: 'Deep Research',
      hint: 'Recherche multi-sources, cité — rapport avec références',
      open: () => {
        s.setLiveLauncherDeepIntent(true);
        s.setShowLiveLauncher(true);
      },
    },
    { label: 'Connaissances', hint: 'Mémoire collective (CKG) + sujets de recherche', open: () => s.setShowKnowledgePanel(true) },
    { label: 'Évolution', hint: 'Versions générées par l’auto-amélioration', open: () => s.setShowEvolutionPanel(true) },
    { label: 'AI-Scientist', hint: 'Expériences `buddy science` (lecture seule)', open: () => s.setShowSciencePanel(true) },
    { label: 'Fleet', hint: 'Multi-agents, pairs, routage', open: () => s.setShowFleetCommandCenter(true) },
    { label: 'Missions', hint: 'Tableau des tâches multi-agents', open: () => s.setShowMissionBoard(true) },
    { label: 'Workflows', hint: 'Éditeur de workflow visuel', open: () => s.setShowWorkflowProPanel(true) },
    { label: 'Migration Claw', hint: 'Import OpenClaw / parité', open: () => s.setShowClawMigration(true) },
  ];
  return (
    <div className="h-full overflow-auto p-6 space-y-6">
      <section>
        <h2 className="text-lg font-semibold mb-1">Avancé</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Les surfaces puissantes de Code Buddy — hors du chemin par défaut, à un clic.
        </p>
        <CardGrid cards={advanced} />
      </section>
      <section>
        <h2 className="text-lg font-semibold mb-1">
          Labs <span className="text-xs font-normal text-muted-foreground">· expérimental</span>
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Orchestration multi-agents et surfaces de parité — denses, pour quand tu en as besoin.
        </p>
        <CardGrid cards={labs} />
      </section>
    </div>
  );
}

/**
 * App Studio (bolt.diy-style: file tree + editor + terminal + live preview) as a
 * full-screen primaryView. The preload-backed APIs are built once from
 * window.electronAPI.studio; with no project selected the view renders its own
 * calm empty state ("Décris une app pour commencer").
 */
function StudioView() {
  const apis = useMemo(() => createStudioApis(), []);
  const { viewProps } = useAppStudio({ apis });
  return <AppStudioView {...viewProps} />;
}

export function NewShell() {
  const primaryView = useAppStore((st) => st.primaryView);
  const setPrimaryView = useAppStore((st) => st.setPrimaryView);
  const setShowCommandPalette = useAppStore((st) => st.setShowCommandPalette);
  const setShowShortcutsDialog = useAppStore((st) => st.setShowShortcutsDialog);
  const activeSessionId = useAppStore((st) => st.activeSessionId);
  const backToChat = () => setPrimaryView('chat');
  // Chat with no active session → the calm Home center-of-gravity, not the
  // dense workspace (REDESIGN.md § Home).
  const showHome = primaryView === 'chat' && !activeSessionId;

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

        {/* Footer: the discoverability net. ⌘K reaches every capability; "?" lists all shortcuts. */}
        <div className="mt-auto flex flex-col items-stretch gap-1">
          <button
            type="button"
            onClick={() => setShowCommandPalette(true)}
            title="Palette de commandes (⌘K) — atteindre n'importe quelle fonctionnalité"
            className="flex flex-col items-center gap-0.5 py-2 mx-1 rounded-md text-[10px] text-muted-foreground hover:bg-accent/60 transition-colors"
          >
            <span className="text-sm leading-none font-mono">⌘K</span>
            <span>Palette</span>
          </button>
          <button
            type="button"
            onClick={() => setShowShortcutsDialog(true)}
            title="Raccourcis clavier (⌘/)"
            aria-label="Raccourcis clavier"
            className="flex flex-col items-center gap-0.5 py-2 mx-1 rounded-md text-[10px] text-muted-foreground hover:bg-accent/60 transition-colors"
          >
            <span className="text-lg leading-none">?</span>
            <span>Aide</span>
          </button>
        </div>
      </nav>

      {/* Primary area */}
      <div className="flex-1 min-w-0 min-h-0 relative">
        {/* Home greets when Chat has no session; DockWorkspace stays mounted
            (but hidden) so an active session isn't torn down when peeking. */}
        {showHome && (
          <div className="absolute inset-0">
            <HomeView />
          </div>
        )}
        <div className={`absolute inset-0 ${primaryView === 'chat' && !showHome ? '' : 'hidden'}`}>
          <DockWorkspace />
        </div>
        {primaryView === 'plan' && <PlanPanel />}
        {primaryView === 'activity' && <ActivityPane />}
        {primaryView === 'workspace' && <FileActivityPanel open onClose={backToChat} />}
        {primaryView === 'studio' && <StudioView />}
        {primaryView === 'os' && <MissionControlView />}
        {primaryView === 'labs' && <LabsGallery />}
        {primaryView === 'advanced' && <AdvancedLauncher />}
      </div>
    </div>
  );
}
