import CodeMirror from '@uiw/react-codemirror';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
import type { Extension } from '@codemirror/state';
import { Save } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { languageForPath, type EditorLanguage } from './utils/editor-language.js';

export interface CodeEditorPaneProps {
  path: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  readOnly?: boolean;
}

function extensionFor(language: EditorLanguage): Extension[] {
  switch (language) {
    case 'javascript':
      return [javascript({ jsx: true, typescript: true })];
    case 'html':
      return [html()];
    case 'css':
      return [css()];
    case 'json':
      return [json()];
    case 'text':
      return [];
  }
}

export function CodeEditorPane({ path, value, onChange, onSave, readOnly = false }: CodeEditorPaneProps) {
  const [dirty, setDirty] = useState(false);
  const extensions = useMemo(() => extensionFor(languageForPath(path)), [path]);

  const handleChange = useCallback((nextValue: string) => {
    setDirty(true);
    onChange(nextValue);
  }, [onChange]);

  const handleSave = useCallback(() => {
    if (readOnly) return;
    onSave();
    setDirty(false);
  }, [onSave, readOnly]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      handleSave();
    }
  }, [handleSave]);

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden border border-border bg-surface">
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-muted px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-xs text-foreground">{path || 'Sans fichier'}</span>
          {dirty && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Modifié" />}
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={readOnly}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          title="Enregistrer"
          aria-label="Enregistrer"
        >
          <Save className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden" onKeyDownCapture={handleKeyDown}>
        <CodeMirror
          value={value}
          height="100%"
          theme={oneDark}
          extensions={extensions}
          editable={!readOnly}
          readOnly={readOnly}
          basicSetup={{
            foldGutter: true,
            lineNumbers: true,
            highlightActiveLine: true,
            autocompletion: true,
          }}
          onChange={handleChange}
        />
      </div>
    </section>
  );
}
