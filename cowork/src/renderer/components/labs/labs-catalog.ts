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
