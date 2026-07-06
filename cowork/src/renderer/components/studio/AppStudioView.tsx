import { Code2, Eye, PanelBottom, Play, Plus } from 'lucide-react';
import { useState } from 'react';
import { BuildStatusStrip, type BuildPhase } from './BuildStatusStrip.js';
import { CodeEditorPane } from './CodeEditorPane.js';
import { PreviewPane, type PreviewPaneProps } from './PreviewPane.js';
import { StudioComposer, type StudioScaffoldRequest, type TemplateCard } from './StudioComposer.js';
import { StudioFileTree } from './StudioFileTree.js';
import { TerminalPane } from './TerminalPane.js';
import type { TreeNode } from './utils/file-tree-model.js';
import { TemplateGallery } from '../template-gallery/TemplateGallery.js';
import { DEFAULT_TEMPLATES } from '../template-gallery/template-kinds.js';
import { StudioChatPanel } from '../studio-iterate/StudioChatPanel.js';
import { ChangedFilesStrip } from '../studio-iterate/ChangedFilesStrip.js';
import type { StudioMessage, StudioFileChange } from '../studio-iterate/iterate-model.js';
import { DevPlanCard } from './DevPlanCard.js';
import type { DevPlan } from './dev-plan.js';

/** bolt.new-style iterate chat, driven by the active project session. */
export interface StudioChatProps {
  messages: StudioMessage[];
  busy?: boolean;
  suggestions?: string[];
  /** Development plan derived from the app prompt (bolt.new's plan step). */
  plan?: DevPlan;
  /** Files the agent created/edited this session (bolt.new's changed-files strip). */
  changes?: StudioFileChange[];
  onSend: (text: string) => void;
  onStop?: () => void;
}

export interface AppStudioViewProps {
  tree: TreeNode[];
  activeFile: string | null;
  fileContent: string;
  previewUrl: string | null;
  previewStatus: PreviewPaneProps['status'];
  terminalOutput: string[];
  buildPhase: BuildPhase;
  buildElapsedMs: number;
  buildError?: string | null;
  templates: TemplateCard[];
  busy?: boolean;
  workingDir?: string;
  /** When set, App Studio renders the bolt.new split (chat left, workbench right). */
  chat?: StudioChatProps;
  onScaffold: (request: StudioScaffoldRequest) => void;
  onGenerateWithAI?: (request: StudioScaffoldRequest) => void;
  onPrompt: (text: string) => void;
  onOpenFile: (path: string) => void;
  onChangeFileContent: (value: string) => void;
  onSaveFile: () => void;
  onCreateEntry?: (parentPath: string) => void;
  onRenameEntry?: (path: string) => void;
  onDeleteEntry?: (path: string) => void;
  onStartPreview: () => void;
  onReloadPreview: () => void;
  onOpenPreviewExternal?: () => void;
  /** Ask the agent session to verify the running app with web_test. */
  onVerifyPreview?: () => void;
  /** Start a fresh app (bolt.new "new") — returns to the composer entry. */
  onNewApp?: () => void;
  onTerminalInput?: (line: string) => void;
  onClearTerminal?: () => void;
  onStopBuild: () => void;
}

type MainTab = 'editor' | 'preview';

export function AppStudioView({
  tree,
  activeFile,
  fileContent,
  previewUrl,
  previewStatus,
  terminalOutput,
  buildPhase,
  buildElapsedMs,
  buildError,
  templates,
  busy = false,
  workingDir,
  chat,
  onScaffold,
  onGenerateWithAI,
  onPrompt,
  onOpenFile,
  onChangeFileContent,
  onSaveFile,
  onCreateEntry,
  onRenameEntry,
  onDeleteEntry,
  onStartPreview,
  onReloadPreview,
  onOpenPreviewExternal,
  onVerifyPreview,
  onNewApp,
  onTerminalInput,
  onClearTerminal,
  onStopBuild,
}: AppStudioViewProps) {
  const [tab, setTab] = useState<MainTab>('editor');
  const [seedPrompt, setSeedPrompt] = useState<string | undefined>(undefined);
  const hasProject = tree.length > 0 || Boolean(activeFile) || Boolean(previewUrl);

  // The workbench (file tree + Code/Preview tabs + terminal) — shared by the
  // classic layout and the bolt.new split.
  const workbench = (
    <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)] gap-2 p-2">
      <StudioFileTree
        tree={tree}
        activePath={activeFile ?? undefined}
        onOpen={onOpenFile}
        onCreate={onCreateEntry}
        onRename={onRenameEntry}
        onDelete={onDeleteEntry}
      />
      <section className="grid min-h-0 grid-rows-[minmax(0,1fr)_220px] gap-2">
        <div className="flex min-h-0 flex-col border border-border bg-surface">
          <div className="flex h-10 shrink-0 items-center border-b border-border bg-muted px-2">
            <button
              type="button"
              onClick={() => setTab('editor')}
              className={`inline-flex h-8 items-center gap-2 rounded-md px-3 text-xs ${tab === 'editor' ? 'bg-background text-foreground' : 'text-muted-foreground hover:bg-background hover:text-foreground'}`}
            >
              <Code2 className="h-4 w-4" aria-hidden="true" />
              Éditeur
            </button>
            <button
              type="button"
              onClick={() => setTab('preview')}
              className={`inline-flex h-8 items-center gap-2 rounded-md px-3 text-xs ${tab === 'preview' ? 'bg-background text-foreground' : 'text-muted-foreground hover:bg-background hover:text-foreground'}`}
            >
              <Eye className="h-4 w-4" aria-hidden="true" />
              Preview
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('preview');
                onStartPreview();
              }}
              disabled={buildPhase === 'starting' || buildPhase === 'running'}
              className="ml-auto inline-flex h-8 items-center gap-2 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              Lancer
            </button>
          </div>
          <div className="min-h-0 flex-1">
            {tab === 'editor' ? (
              activeFile ? (
                <CodeEditorPane path={activeFile} value={fileContent} onChange={onChangeFileContent} onSave={onSaveFile} />
              ) : (
                <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
                  Aucun fichier sélectionné.
                </div>
              )
            ) : (
              <PreviewPane
                url={previewUrl}
                status={previewStatus}
                onReload={onReloadPreview}
                onOpenExternal={onOpenPreviewExternal}
                {...(onVerifyPreview ? { onVerify: onVerifyPreview } : {})}
              />
            )}
          </div>
        </div>
        <TerminalPane output={terminalOutput} onInput={onTerminalInput} onClear={onClearTerminal} />
      </section>
    </div>
  );

  // bolt.new split: chat left, workbench right. Active whenever a project session
  // is driving App Studio (the chat replaces the top composer).
  if (chat) {
    return (
      <main className="flex h-full min-h-0 flex-col bg-background text-foreground" data-testid="studio-bolt">
        {onNewApp ? (
          <div className="flex shrink-0 items-center border-b border-border bg-surface px-2 py-1.5">
            <button
              type="button"
              onClick={onNewApp}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Démarrer une nouvelle app"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Nouvelle app
            </button>
          </div>
        ) : null}
        <BuildStatusStrip phase={buildPhase} elapsedMs={buildElapsedMs} error={buildError} onStop={onStopBuild} />
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col border-r border-border bg-surface">
            {chat.plan ? <DevPlanCard plan={chat.plan} /> : null}
            <div className="min-h-0 flex-1">
              <StudioChatPanel
                messages={chat.messages}
                busy={chat.busy}
                suggestions={chat.suggestions}
                onSend={chat.onSend}
                onStop={chat.onStop}
              />
            </div>
            {chat.changes && chat.changes.length > 0 ? (
              <div className="shrink-0 border-t border-border">
                <ChangedFilesStrip changes={chat.changes} onOpen={onOpenFile} />
              </div>
            ) : null}
          </div>
          {hasProject ? (
            workbench
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center text-xs text-muted-foreground">
              Les fichiers, le code et la preview de ton app apparaîtront ici pendant la génération.
            </div>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <StudioComposer templates={templates} onScaffold={onScaffold} onGenerateWithAI={onGenerateWithAI} onPrompt={onPrompt} busy={busy} workingDir={workingDir} seedPrompt={seedPrompt} />
      <BuildStatusStrip phase={buildPhase} elapsedMs={buildElapsedMs} error={buildError} onStop={onStopBuild} />
      {!hasProject ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
          <div className="mx-auto max-w-3xl text-center">
            <PanelBottom className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <h2 className="mt-3 text-sm font-medium text-foreground">Que veux-tu créer&nbsp;?</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Choisis un type ci-dessous (aperçu de ce qui sera créé) ou décris ton app en haut — les fichiers, le code et la preview apparaîtront ici.
            </p>
          </div>
          <div className="mx-auto mt-5 w-full max-w-4xl">
            <TemplateGallery
              items={DEFAULT_TEMPLATES}
              onSelect={(id) => {
                const item = DEFAULT_TEMPLATES.find((t) => t.id === id);
                if (item) setSeedPrompt(`${item.name} — ${item.tagline}`);
              }}
            />
          </div>
        </div>
      ) : (
        workbench
      )}
    </main>
  );
}
