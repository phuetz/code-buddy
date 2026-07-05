import { Code2, Eye, PanelBottom } from 'lucide-react';
import { useState } from 'react';
import { BuildStatusStrip, type BuildPhase } from './BuildStatusStrip.js';
import { CodeEditorPane } from './CodeEditorPane.js';
import { PreviewPane, type PreviewPaneProps } from './PreviewPane.js';
import { StudioComposer, type StudioScaffoldRequest, type TemplateCard } from './StudioComposer.js';
import { StudioFileTree } from './StudioFileTree.js';
import { TerminalPane } from './TerminalPane.js';
import type { TreeNode } from './utils/file-tree-model.js';

export interface AppStudioViewProps {
  tree: TreeNode[];
  activeFile: string | null;
  fileContent: string;
  previewUrl: string | null;
  previewStatus: PreviewPaneProps['status'];
  terminalOutput: string[];
  buildPhase: BuildPhase;
  buildElapsedMs: number;
  templates: TemplateCard[];
  busy?: boolean;
  onScaffold: (request: StudioScaffoldRequest) => void;
  onPrompt: (text: string) => void;
  onOpenFile: (path: string) => void;
  onChangeFileContent: (value: string) => void;
  onSaveFile: () => void;
  onCreateEntry?: (parentPath: string) => void;
  onRenameEntry?: (path: string) => void;
  onDeleteEntry?: (path: string) => void;
  onReloadPreview: () => void;
  onOpenPreviewExternal?: () => void;
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
  templates,
  busy = false,
  onScaffold,
  onPrompt,
  onOpenFile,
  onChangeFileContent,
  onSaveFile,
  onCreateEntry,
  onRenameEntry,
  onDeleteEntry,
  onReloadPreview,
  onOpenPreviewExternal,
  onTerminalInput,
  onClearTerminal,
  onStopBuild,
}: AppStudioViewProps) {
  const [tab, setTab] = useState<MainTab>('editor');
  const hasProject = tree.length > 0 || Boolean(activeFile) || Boolean(previewUrl);

  return (
    <main className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <StudioComposer templates={templates} onScaffold={onScaffold} onPrompt={onPrompt} busy={busy} />
      <BuildStatusStrip phase={buildPhase} elapsedMs={buildElapsedMs} onStop={onStopBuild} />
      {!hasProject ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center">
          <div>
            <PanelBottom className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <h2 className="mt-3 text-sm font-medium text-foreground">Décris une app pour commencer</h2>
            <p className="mt-1 text-xs text-muted-foreground">Les fichiers, le code, la preview et le terminal apparaîtront ici.</p>
          </div>
        </div>
      ) : (
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
                  />
                )}
              </div>
            </div>
            <TerminalPane output={terminalOutput} onInput={onTerminalInput} onClear={onClearTerminal} />
          </section>
        </div>
      )}
    </main>
  );
}
