/**
 * Labs catalog — wires the dormant "Genspark" panel components into the Labs gallery.
 *
 * The gallery is a browsable shelf of props-driven components that were built but never
 * mounted. Each entry pairs a {@link GensparkSlice} (title / category / descriptor, derived
 * from the single source of truth in `genspark-slices.ts`) with:
 *   - a lazy `load()` (a STATIC `import()` so Vite can code-split each component out of the
 *     main bundle — the gallery itself stays light), and
 *   - a minimal, HONEST empty-state `props` object (empty arrays, zeroed summaries, no-op
 *     callbacks). Every component renders a clean empty state from these.
 *
 * Only `panel`- and `labs`-mount slices belong here. `composer` / `chat-inline` / `settings`
 * / `primitive` slices are surfaced at their own mount points (later), not in this gallery.
 *
 * Components are typed loosely as `LabsComponent` on purpose: the gallery passes a plain
 * `Record<string, unknown>` of empty defaults and never constructs the components' real prop
 * types, so union-literal fields (`mode: 'plan'`, `kind: 'doc'`, …) need no `as const` dance.
 * A render throw is caught by the gallery's per-card error boundary (`fallback={null}`), so an
 * imperfect default can never crash the shelf.
 *
 * @module renderer/components/labs/labs-catalog
 */
import type { ComponentType } from 'react';
import { GENSPARK_SLICES, type GensparkSlice } from '../genspark-slices';

/** A Genspark component rendered with an opaque empty-state props bag. */
export type LabsComponent = ComponentType<Record<string, unknown>>;

type LabsLoader = () => Promise<{ default: LabsComponent }>;

interface LabsWiring {
  load: LabsLoader;
  props: Record<string, unknown>;
}

export interface LabsEntry {
  slice: GensparkSlice;
  load: LabsLoader;
  props: Record<string, unknown>;
}

/** Cast a named export to the loose Labs component type (through `unknown` — props are contravariant). */
function named(mod: Record<string, unknown>, name: string): { default: LabsComponent } {
  return { default: mod[name] as unknown as LabsComponent };
}

/**
 * Static loader + empty-state props per slice id. Keyed by id so a slice with no wiring here is
 * simply not shown (honest: the gallery only surfaces what it can actually render).
 */
const WIRING: Record<string, LabsWiring> = {
  // B0 is the first PROMOTED entry: a functional, self-contained generator
  // (real agent session inside), not an empty-state preview.
  B0: {
    load: () => import('../deliverables/DeckStudioPanel').then((m) => named(m, 'DeckStudioPanel')),
    props: {},
  },
  B8: {
    load: () => import('../deliverables/SheetStudioPanel').then((m) => named(m, 'SheetStudioPanel')),
    props: {},
  },
  B9: {
    load: () => import('../deliverables/DocStudioPanel').then((m) => named(m, 'DocStudioPanel')),
    props: {},
  },
  B10: {
    load: () => import('../deliverables/PodStudioPanel').then((m) => named(m, 'PodStudioPanel')),
    props: {},
  },
  B11: {
    load: () => import('../deliverables/ImageStudioPanel').then((m) => named(m, 'ImageStudioPanel')),
    props: {},
  },
  B12: {
    load: () => import('../deliverables/VideoStudioPanel').then((m) => named(m, 'VideoStudioPanel')),
    props: {},
  },
  A2: {
    load: () => import('../MissionBoard').then((m) => named(m, 'MissionBoard')),
    props: { missions: [], onOpen: () => {}, onPause: () => {}, onResume: () => {} },
  },
  A3: {
    load: () => import('../MissionResumeMenu').then((m) => named(m, 'MissionResumeMenu')),
    props: { checkpoints: [], onResume: () => {}, onBranch: () => {} },
  },
  A5: {
    load: () => import('../GuardrailsBadge').then((m) => named(m, 'GuardrailsBadge')),
    props: { mode: 'plan', guardrails: [] },
  },
  B1: {
    load: () => import('../SlideDeckBuilder').then((m) => named(m, 'SlideDeckBuilder')),
    props: { outline: [], onGenerate: () => {}, onEditOutline: () => {} },
  },
  B2: {
    load: () => import('../SheetAnalystView').then((m) => named(m, 'SheetAnalystView')),
    props: { schema: { title: '', source: '', columns: [] }, rows: [], onRun: () => {} },
  },
  B3: {
    load: () => import('../DocComposer').then((m) => named(m, 'DocComposer')),
    props: { sections: [], onGenerate: () => {} },
  },
  B4: {
    load: () => import('../ImagePromptStudio').then((m) => named(m, 'ImagePromptStudio')),
    props: { presets: [], results: [], onGenerate: () => {} },
  },
  B5: {
    load: () => import('../ShortVideoStoryboard').then((m) => named(m, 'ShortVideoStoryboard')),
    props: { scenes: [], onRender: () => {} },
  },
  B6: {
    load: () => import('../PodcastComposer').then((m) => named(m, 'PodcastComposer')),
    props: { segments: [], onSynthesize: () => {} },
  },
  B7: {
    load: () => import('../ExportShareSheet').then((m) => named(m, 'ExportShareSheet')),
    props: {
      deliverable: { id: '', title: '', kind: 'doc' },
      formats: [],
      onExport: () => {},
      onShare: () => {},
    },
  },
  C1: {
    load: () => import('../BrowserAutopilotPanel').then((m) => named(m, 'BrowserAutopilotPanel')),
    props: { steps: [], onStart: () => {}, onStop: () => {} },
  },
  C2: {
    load: () => import('../ComputerUseViewer').then((m) => named(m, 'ComputerUseViewer')),
    props: { files: [], onPick: () => {} },
  },
  C3: {
    load: () => import('../CallLogView').then((m) => named(m, 'CallLogView')),
    props: { transcript: [], summary: '' },
  },
  D1: {
    load: () => import('../ChannelMissionAssign').then((m) => named(m, 'ChannelMissionAssign')),
    props: { channels: [], onAssign: () => {} },
  },
  D2: {
    load: () => import('../WorkerDashboard').then((m) => named(m, 'WorkerDashboard')),
    props: {
      status: {
        online: false,
        uptimeSec: 0,
        activeMissions: 0,
        queuedMissions: 0,
        processedToday: 0,
        capacity: 0,
      },
    },
  },
  D4: {
    load: () => import('../MobileSupervisionView').then((m) => named(m, 'MobileSupervisionView')),
    props: { missions: [], onAct: () => {} },
  },
  E1: {
    load: () => import('../DriveGrid').then((m) => named(m, 'DriveGrid')),
    props: { items: [], onOpen: () => {}, onTag: () => {} },
  },
  E2: {
    load: () =>
      import('../DeliverableVersionTimeline').then((m) => named(m, 'DeliverableVersionTimeline')),
    props: { versions: [], onRestore: () => {}, onDiff: () => {} },
  },
  E3: {
    load: () => import('../ShareLinkDialog').then((m) => named(m, 'ShareLinkDialog')),
    props: {
      item: { id: '', title: '', type: 'doc', tags: [], updatedAt: 0 },
      onCreateLink: () => {},
    },
  },
  F1: {
    load: () => import('../ModelComparatorView').then((m) => named(m, 'ModelComparatorView')),
    props: { answers: [], onPick: () => {} },
  },
  F2: {
    load: () => import('../DeliberationPanel').then((m) => named(m, 'DeliberationPanel')),
    props: { verdicts: [], dhi: 0 },
  },
  G4: {
    load: () => import('../MissionReplayView').then((m) => named(m, 'MissionReplayView')),
    props: { events: [], onSeek: () => {} },
  },
  G6: {
    load: () => import('../FocusRunnerView').then((m) => named(m, 'FocusRunnerView')),
    props: {
      mission: { id: '', title: '', status: 'queued', progress: 0, model: '', durationMs: 0 },
      log: [],
      onExit: () => {},
    },
  },
  NV1: {
    load: () => import('../viz/Sparkline').then((m) => named(m, 'Sparkline')),
    props: { values: [12, 18, 16, 24, 31, 38, 43, 57], width: 220, height: 72, tone: 'success' },
  },
  NV2: {
    load: () => import('../viz/BarChart').then((m) => named(m, 'BarChart')),
    props: {
      data: [
        { label: 'Recherche', value: 42 },
        { label: 'Code', value: 68 },
        { label: 'Tests', value: 54 },
        { label: 'Revue', value: 31 },
      ],
      horizontal: true,
    },
  },
  NV3: {
    load: () => import('../viz/Donut').then((m) => named(m, 'Donut')),
    props: {
      segments: [
        { label: 'Terminé', value: 62, tone: 'success' },
        { label: 'En cours', value: 24, tone: 'warning' },
        { label: 'Bloqué', value: 8, tone: 'danger' },
        { label: 'Planifié', value: 18, tone: 'muted' },
      ],
    },
  },
  NV4: {
    load: () => import('../viz/Heatmap').then((m) => named(m, 'Heatmap')),
    props: {
      rows: ['Agent', 'Tools', 'Cowork', 'Fleet'],
      cols: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'],
      cells: [
        [12, 18, 21, 28, 35],
        [8, 14, 19, 25, 29],
        [4, 11, 16, 22, 30],
        [6, 9, 15, 20, 27],
      ],
    },
  },
  NV5: {
    load: () => import('../viz/TimelineChart').then((m) => named(m, 'TimelineChart')),
    props: {
      events: [
        { t: '2026-07-01T09:00:00Z', label: 'Brief', tone: 'primary' },
        { t: '2026-07-01T11:30:00Z', label: 'Implémentation', tone: 'warning' },
        { t: '2026-07-01T14:00:00Z', label: 'Tests', tone: 'success' },
        { t: '2026-07-01T16:45:00Z', label: 'Gate', tone: 'success' },
      ],
    },
  },
  NV6: {
    load: () => import('../viz/StackedBar').then((m) => named(m, 'StackedBar')),
    props: {
      parts: [
        { label: 'Pass', value: 74, tone: 'success' },
        { label: 'Warn', value: 18, tone: 'warning' },
        { label: 'Fail', value: 5, tone: 'danger' },
        { label: 'Skip', value: 3, tone: 'muted' },
      ],
    },
  },
  NV7: {
    load: () => import('../viz/GaugeMeter').then((m) => named(m, 'GaugeMeter')),
    props: { value: 78, max: 100, tone: 'warning' },
  },
  ND1: {
    load: () => import('../deliverables/SlideDeckPreview').then((m) => named(m, 'SlideDeckPreview')),
    props: {
      slides: [
        { title: 'Code Buddy Labs', bullets: ['Galerie vivante', 'Surfaces Genspark', 'Données réalistes'] },
        { title: 'Impact produit', bullets: ['Découverte plus rapide', 'Prévisualisation claire', 'Câblage Fable simplifié'] },
        { title: 'Prochain gate', bullets: ['Screenshot GUI', 'Validation UX', 'Merge contrôlé'] },
      ],
      activeIndex: 1,
    },
  },
  ND2: {
    load: () => import('../deliverables/SheetPreview').then((m) => named(m, 'SheetPreview')),
    props: {
      columns: ['Tranche', 'Catégorie', 'Statut', 'Score'],
      rows: [
        ['NV1', 'UI', 'câblé', 92],
        ['ND1', 'Livrable', 'câblé', 88],
        ['NA2', 'Média', 'en test', 81],
        ['NM1', 'Agent', 'stable', 95],
        ['NG2', 'Shell', 'review', 76],
      ],
    },
  },
  ND3: {
    load: () => import('../deliverables/DocPreview').then((m) => named(m, 'DocPreview')),
    props: {
      blocks: [
        { type: 'h1', text: 'Rapport Labs Genspark' },
        { type: 'p', text: 'La galerie expose les nouvelles surfaces avec des jeux de données proches d’un run réel.' },
        { type: 'list', items: ['Viz scalables', 'Livrables prévisualisables', 'Panneaux OS prêts à brancher'] },
      ],
    },
  },
  NA3: {
    load: () => import('../media-gen/MediaGenComposer').then((m) => named(m, 'MediaGenComposer')),
    props: { mode: 'image', prompt: 'Un copilote terminal lumineux qui orchestre une flotte IA', onPromptChange: () => {}, onSubmit: () => {} },
  },
  NA4: {
    load: () => import('../template-gallery/TemplateGallery').then((m) => named(m, 'TemplateGallery')),
    props: {},
  },
  NA5: {
    load: () => import('../media-gen/MediaGenPanel').then((m) => named(m, 'MediaGenPanel')),
    props: {},
  },
  NM1: {
    load: () => import('../os-panels/AutonomyDashboard').then((m) => named(m, 'AutonomyDashboard')),
    props: { posture: 'dontAsk', running: 3, queued: 7, costUsd: 12.48, capUsd: 50, turns: 128, maxTurns: 400 },
  },
  NM2: {
    load: () => import('../os-panels/KnowledgeGraphView').then((m) => named(m, 'KnowledgeGraphView')),
    props: {
      nodes: [
        { id: 'lesson-verify', type: 'lesson', label: 'Vérifier avant clôture', confidence: 0.96 },
        { id: 'decision-yolo', type: 'decision', label: 'YOLO borné par guardrails', confidence: 0.88 },
        { id: 'fact-fleet', type: 'fact', label: 'Fleet expose peer.chat-session', confidence: 0.92 },
        { id: 'discovery-labs', type: 'discovery', label: 'Labs consomme WIRING + slices', confidence: 0.84 },
        { id: 'lesson-store', type: 'lesson', label: 'Renderer props-driven uniquement', confidence: 0.94 },
      ],
      edges: [
        { from: 'lesson-verify', to: 'discovery-labs', kind: 'supports' },
        { from: 'decision-yolo', to: 'fact-fleet', kind: 'constrains' },
        { from: 'lesson-store', to: 'discovery-labs', kind: 'applies' },
        { from: 'fact-fleet', to: 'discovery-labs', kind: 'context' },
      ],
    },
  },
  NG1: {
    load: () => import('../os-panels/OsStatusBar').then((m) => named(m, 'OsStatusBar')),
    props: {
      items: [
        { label: 'API', value: 'ok', tone: 'ok' },
        { label: 'Budget', value: '$12.48/$50', tone: 'ok' },
        { label: 'Tests', value: '1 warn', tone: 'warn' },
        { label: 'Fleet', value: '3 pairs', tone: 'muted' },
      ],
    },
  },
  NG2: {
    load: () => import('../os-panels/MissionControlShell').then((m) => named(m, 'MissionControlShell')),
    props: {
      header: null,
      left: null,
      main: 'Mission principale: câbler Labs avec données de démonstration.',
      right: 'Gate: typecheck + vite build.',
    },
  },
  NA1: {
    load: () => import('../drive/AiDrive').then((m) => named(m, 'AiDrive')),
    props: {
      items: [
        { id: 'd1', name: 'Analyse marché Q3.xlsx', kind: 'sheet', createdAt: Date.now() - 1_200_000, sizeBytes: 48_213 },
        { id: 'd2', name: 'Pitch investisseurs.pptx', kind: 'slide', createdAt: Date.now() - 5_400_000, sizeBytes: 1_843_200 },
        { id: 'd3', name: 'Rapport concurrence.md', kind: 'doc', createdAt: Date.now() - 86_400_000, sizeBytes: 12_400 },
        { id: 'd4', name: 'hero-banner.png', kind: 'image', createdAt: Date.now() - 3_600_000, sizeBytes: 542_000 },
        { id: 'd5', name: 'demo-produit.mp4', kind: 'video', createdAt: Date.now() - 172_800_000, sizeBytes: 8_400_000 },
        { id: 'd6', name: 'todo-app', kind: 'app', createdAt: Date.now() - 600_000 },
      ],
      onOpen: () => {},
      onDelete: () => {},
    },
  },
  NA2: {
    load: () => import('../media-gen/MediaGallery').then((m) => named(m, 'MediaGallery')),
    props: {
      items: [
        {
          id: 'm1',
          type: 'image',
          status: 'done',
          url: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22120%22 height=%22120%22%3E%3Crect width=%22120%22 height=%22120%22 fill=%22%236366f1%22/%3E%3C/svg%3E',
          prompt: 'Un renard roux dans une forêt brumeuse, aquarelle',
          model: 'flux',
          aspect: '1:1',
          createdAt: Date.now() - 300_000,
        },
        { id: 'm2', type: 'image', status: 'generating', prompt: 'Skyline néon cyberpunk de nuit', aspect: '16:9', createdAt: Date.now() - 60_000 },
        {
          id: 'm3',
          type: 'video',
          status: 'done',
          url: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22160%22 height=%2290%22%3E%3Crect width=%22160%22 height=%2290%22 fill=%22%2310a37f%22/%3E%3C/svg%3E',
          prompt: 'Vagues au coucher du soleil',
          aspect: '16:9',
          createdAt: Date.now() - 900_000,
        },
        { id: 'm4', type: 'image', status: 'queued', prompt: 'Logo minimaliste marque de café', aspect: '1:1', createdAt: Date.now() - 30_000 },
        { id: 'm5', type: 'image', status: 'error', prompt: 'Portrait photoréaliste', aspect: '9:16', createdAt: Date.now() - 1_200_000 },
      ],
      onSelect: () => {},
      onRetry: () => {},
    },
  },
  NI1: {
    load: () => import('../studio-iterate/StudioChatPanel').then((m) => named(m, 'StudioChatPanel')),
    props: {
      messages: [
        { id: '1', role: 'user', text: 'Rends le bouton principal bleu et arrondi.' },
        { id: '2', role: 'assistant', text: 'Fait — j’ai mis à jour la couleur et le rayon du bouton dans src/App.css, et la preview s’est rechargée.' },
        { id: '3', role: 'user', text: 'Ajoute un mode sombre.' },
      ],
      suggestions: ['Change le thème', 'Ajoute des tests', 'Rends-le responsive'],
      onSend: () => {},
      onStop: () => {},
    },
  },
  NI2: {
    load: () => import('../studio-iterate/ChangedFilesStrip').then((m) => named(m, 'ChangedFilesStrip')),
    props: {
      changes: [
        { path: 'src/App.tsx', kind: 'modified' },
        { path: 'src/theme.css', kind: 'added' },
        { path: 'src/legacy.css', kind: 'deleted' },
      ],
      onOpen: () => {},
    },
  },
  NI3: {
    load: () => import('../studio-iterate/PreviewToolbar').then((m) => named(m, 'PreviewToolbar')),
    props: {
      url: 'http://127.0.0.1:5173/',
      status: 'running',
      device: 'desktop',
      onReload: () => {},
      onDevice: () => {},
      onOpenExternal: () => {},
      onToggle: () => {},
    },
  },
};

/**
 * The gallery's shelf: every `panel`/`labs` slice that has an empty-state wiring, joined with
 * its display metadata. Order follows `GENSPARK_SLICES` (roadmap order within the manifest).
 */
export const LABS_ENTRIES: LabsEntry[] = GENSPARK_SLICES.filter(
  (s) => (s.mount === 'panel' || s.mount === 'labs') && WIRING[s.id],
).map((slice) => {
  const wiring = WIRING[slice.id]!;
  return { slice, load: wiring.load, props: wiring.props };
});

/** Human-readable French labels for each slice category (used as gallery section headings). */
export const LABS_CATEGORY_LABELS: Record<GensparkSlice['category'], string> = {
  agent: 'Agents & missions',
  deliverable: 'Livrables',
  action: 'Actions (navigateur, ordinateur, appels)',
  claw: 'Flotte 24/7 (OpenClaw)',
  drive: 'Drive & versions',
  moa: 'Mixture-of-Agents',
  ux: 'Expérience',
  ui: 'Primitives UI',
};
