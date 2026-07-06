/**
 * CreationsView — the promoted home of the Genspark deliverable studios.
 *
 * One full-screen view, one tab per FUNCTIONAL studio (each drives a real
 * agent session and produces a real file) plus the Drive of everything
 * produced. The panels are the exact same components Labs promoted first —
 * this view is their permanent address on the rail.
 */
import { lazy, Suspense, useState, type ComponentType, type LazyExoticComponent } from 'react';
import { FileDown, FileText, FolderOpen, Image as ImageIcon, Loader2, Presentation, Radio, Table2, Clapperboard } from 'lucide-react';

const DeckStudioPanel = lazy(() => import('./DeckStudioPanel.js').then((m) => ({ default: m.DeckStudioPanel })));
const SheetStudioPanel = lazy(() => import('./SheetStudioPanel.js').then((m) => ({ default: m.SheetStudioPanel })));
const DocStudioPanel = lazy(() => import('./DocStudioPanel.js').then((m) => ({ default: m.DocStudioPanel })));
const PodStudioPanel = lazy(() => import('./PodStudioPanel.js').then((m) => ({ default: m.PodStudioPanel })));
const ImageStudioPanel = lazy(() => import('./ImageStudioPanel.js').then((m) => ({ default: m.ImageStudioPanel })));
const VideoStudioPanel = lazy(() => import('./VideoStudioPanel.js').then((m) => ({ default: m.VideoStudioPanel })));
const DrivePanel = lazy(() => import('./DrivePanel.js').then((m) => ({ default: m.DrivePanel })));

interface StudioTab {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
  component: LazyExoticComponent<ComponentType>;
}

export const CREATIONS_TABS: StudioTab[] = [
  { id: 'deck', label: 'Deck', icon: Presentation, component: DeckStudioPanel },
  { id: 'sheet', label: 'Feuille', icon: Table2, component: SheetStudioPanel },
  { id: 'doc', label: 'Document', icon: FileText, component: DocStudioPanel },
  { id: 'pod', label: 'Pod', icon: Radio, component: PodStudioPanel },
  { id: 'image', label: 'Image', icon: ImageIcon, component: ImageStudioPanel },
  { id: 'video', label: 'Vidéo', icon: Clapperboard, component: VideoStudioPanel },
  { id: 'drive', label: 'Drive', icon: FolderOpen, component: DrivePanel },
];

export function CreationsView() {
  const [active, setActive] = useState('deck');
  const tab = CREATIONS_TABS.find((t) => t.id === active) ?? CREATIONS_TABS[0]!;
  const Panel = tab.component;

  return (
    <main className="flex h-full min-h-0 flex-col bg-background text-foreground" data-testid="creations-view">
      <header className="flex shrink-0 items-center gap-1 border-b border-border bg-surface px-3 py-2">
        <FileDown className="mr-1 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h1 className="mr-3 text-sm font-semibold">Créations</h1>
        {CREATIONS_TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActive(id)}
            className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs ${
              active === id
                ? 'bg-background text-foreground'
                : 'text-muted-foreground hover:bg-background hover:text-foreground'
            }`}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {label}
          </button>
        ))}
      </header>
      <div className="min-h-0 flex-1">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            </div>
          }
        >
          {/* key remounts the panel per tab — each studio keeps its own session state */}
          <Panel key={tab.id} />
        </Suspense>
      </div>
    </main>
  );
}
