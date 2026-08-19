import { FileCode, X } from 'lucide-react';
import type { EditorTab } from './editor-tabs-model.js';
import { basename } from './editor-tabs-model.js';

/**
 * bolt.new-style open-file tabs above the editor. Props-driven: the parent owns
 * the tab list + active file and reacts to select/close.
 */
export function EditorTabs({
  tabs,
  activePath,
  onSelect,
  onClose,
}: {
  tabs: EditorTab[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}) {
  if (tabs.length === 0) return null;
  return (
    <div className="flex shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-border bg-muted px-1" role="tablist" aria-label="Open files">
      {tabs.map((tab) => {
        const selected = tab.path === activePath;
        return (
          <div
            key={tab.path}
            role="tab"
            aria-selected={selected}
            className={`group flex shrink-0 items-center gap-1.5 rounded-t-md px-2.5 py-1.5 text-xs ${
              selected ? 'bg-background text-foreground' : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
            }`}
          >
            <button type="button" onClick={() => onSelect(tab.path)} className="inline-flex items-center gap-1.5" title={tab.path}>
              <FileCode className="h-3.5 w-3.5" aria-hidden="true" />
              {basename(tab.path)}
              {tab.dirty ? <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-label="Modified" /> : null}
            </button>
            <button
              type="button"
              onClick={() => onClose(tab.path)}
              className="rounded p-0.5 text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100"
              title="Close"
              aria-label={`Close ${basename(tab.path)}`}
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
