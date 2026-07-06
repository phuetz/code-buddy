/**
 * command-palette-capabilities — the universal ⌘K backstop.
 *
 * The new shell (`COWORK_NEW_SHELL`) dropped the TopMenuBar/ShellNavigation, so the command palette
 * is now the one place from which *every* Code Buddy capability must be reachable. Each entry opens a
 * panel that is already mounted globally at the App root via its store `setShow*` action — nothing new
 * is instantiated here, this is pure wiring.
 *
 * Kept as a plain data module (no React/JSX) so it can be unit-tested in the node vitest env without
 * pulling the renderer tree. The `run` callbacks are typed against the real `AppState` (type-only
 * import → no runtime store dependency), so a renamed/removed setter fails `tsc`.
 */
import type { AppState } from '../store';

export interface CapabilityCommand {
  id: string;
  label: string;
  description: string;
  run: (s: AppState) => void;
}

export const CAPABILITY_COMMANDS: CapabilityCommand[] = [
  { id: 'cap-fleet', label: 'Fleet — Command Center', description: 'Multi-agent mesh, peers, routing', run: (s) => s.setShowFleetCommandCenter(true) },
  { id: 'cap-fleet-events', label: 'Fleet — peer events', description: 'Live fleet peer event stream', run: (s) => s.setShowFleetPanel(true) },
  { id: 'cap-team', label: 'Agent Team', description: 'Coordinate an agent team', run: (s) => s.setShowTeamPanel(true) },
  { id: 'cap-orchestrator', label: 'Orchestrator', description: 'Spawn a multi-agent workflow', run: (s) => s.setShowOrchestratorLauncher(true) },
  { id: 'cap-missions', label: 'Mission board', description: 'Multi-agent task board', run: (s) => s.setShowMissionBoard(true) },
  // Autonomy + reasoning-trace dock into the chat workspace (rc-dock tabs in DockWorkspace), not as
  // global overlays — from a non-chat view the tab would mount inside a display:none subtree and
  // never show. Switch to the chat view first so the panel is actually visible.
  { id: 'cap-autonomy', label: 'Autonomy', description: 'Autonomous loop, YOLO, goal', run: (s) => { s.setPrimaryView('chat'); s.setShowAutonomyPanel(true); } },
  { id: 'cap-creations', label: 'Créations', description: 'Studios livrables : deck, feuille, doc, pod, image, vidéo, drive', run: (s) => s.setPrimaryView('creations') },
  { id: 'cap-workflows', label: 'Workflows', description: 'Visual workflow editor', run: (s) => s.setShowWorkflowProPanel(true) },
  { id: 'cap-evolution', label: 'Evolution', description: 'Versions from self-improvement', run: (s) => s.setShowEvolutionPanel(true) },
  { id: 'cap-knowledge', label: 'Knowledge (CKG)', description: 'Collective memory + research topics', run: (s) => s.setShowKnowledgePanel(true) },
  { id: 'cap-memory', label: 'Memory', description: 'What Code Buddy remembers', run: (s) => s.setShowMemoryEditor(true) },
  { id: 'cap-lessons-candidates', label: 'Lesson candidates', description: 'Review learned-lesson candidates', run: (s) => s.setShowLessonCandidatePanel(true) },
  { id: 'cap-user-model', label: 'User model', description: 'What Code Buddy learned about you', run: (s) => s.setShowUserModelPanel(true) },
  { id: 'cap-research', label: 'Research / Flow launcher', description: 'Wide research + planning flow', run: (s) => s.setShowLiveLauncher(true) },
  { id: 'cap-deep-research', label: 'Deep Research', description: 'Multi-source, cited report (deterministic pipeline)', run: (s) => { s.setLiveLauncherDeepIntent(true); s.setShowLiveLauncher(true); } },
  { id: 'cap-reasoning-trace', label: 'Reasoning trace', description: 'Inspect the reasoning tree', run: (s) => { s.setPrimaryView('chat'); s.setShowReasoningViewer(true); } },
  { id: 'cap-insights', label: 'Session insights', description: 'Analysis of this session', run: (s) => s.setShowSessionInsights(true) },
  { id: 'cap-activity', label: 'Activity feed', description: 'Cross-project activity', run: (s) => s.setShowActivityFeed(true) },
  { id: 'cap-tests', label: 'Test runner', description: 'Run the test suite', run: (s) => s.setShowTestRunner(true) },
  { id: 'cap-companion', label: 'Companion', description: 'Voice, presence, persona', run: (s) => s.setShowCompanionPanel(true) },
  { id: 'cap-channels', label: 'Delivery channels', description: 'Telegram, Discord, Slack…', run: (s) => s.setShowChannelsPanel(true) },
  { id: 'cap-mobile', label: 'Mobile supervision', description: 'Supervise from your phone', run: (s) => s.setShowMobileSupervisionPanel(true) },
  { id: 'cap-devices', label: 'Paired devices', description: 'Manage device nodes', run: (s) => s.setShowDevicePanel(true) },
  { id: 'cap-personas', label: 'Personas', description: 'Switch the active persona', run: (s) => s.setShowPersonaSwitcher(true) },
  { id: 'cap-identity', label: 'Agent identity', description: 'SOUL.md / USER.md', run: (s) => s.setShowIdentityPanel(true) },
  { id: 'cap-spec', label: 'Spec backlog', description: 'Spec-driven review pipeline', run: (s) => s.setShowSpecPanel(true) },
  { id: 'cap-snippets', label: 'Snippets library', description: 'Saved prompt snippets', run: (s) => s.setShowSnippetsLibrary(true) },
  { id: 'cap-bookmarks', label: 'Bookmarks', description: 'Bookmarked messages', run: (s) => s.setShowBookmarksPanel(true) },
  { id: 'cap-focus', label: 'Focus view', description: 'Distraction-free focus', run: (s) => s.setShowFocusView(true) },
  { id: 'cap-desktop-snapshot', label: 'Desktop snapshot', description: 'Capture the screen', run: (s) => s.setShowDesktopSnapshot(true) },
  { id: 'cap-global-search', label: 'Search everything', description: 'Sessions, messages, memory, files', run: (s) => s.setShowGlobalSearch(true) },
];
