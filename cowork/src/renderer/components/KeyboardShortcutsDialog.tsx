import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, RotateCcw, Search, Upload, X } from 'lucide-react';
import {
  SHORTCUT_DEFINITIONS,
  eventToBinding,
  getShortcutBinding,
  importShortcuts,
  readShortcutOverrides,
  resetShortcuts,
  saveShortcutBinding,
  type ShortcutAction,
} from '../utils/shortcut-registry';

type ShortcutSection = (typeof SHORTCUT_DEFINITIONS)[number]['section'];

export function KeyboardShortcutsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [revision, setRevision] = useState(0);
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lowered = query.trim().toLowerCase();
  const shortcutLabels: Record<ShortcutAction, string> = {
    commandPalette: t('shortcutsDialog.openCommandPalette', 'Open command palette'),
    globalSearch: t('shortcutsDialog.globalSearch', 'Global search'),
    shortcuts: t('shortcutsDialog.configureShortcuts', 'Configure shortcuts'),
    settings: t('shortcutsDialog.openSettings', 'Open settings'),
    sessionSearch: t('shortcutsDialog.searchMessages', 'Search in messages'),
    toggleSidebar: t('shortcutsDialog.toggleSidebar', 'Toggle sidebar'),
    toggleSplitPane: t('shortcutsDialog.toggleSplitPane', 'Toggle split view'),
    snippets: t('shortcutsDialog.snippets', 'Snippet library'),
    persona: t('shortcutsDialog.persona', 'Change persona'),
    tests: t('shortcutsDialog.tests', 'Tests and runs'),
    reasoning: t('shortcutsDialog.reasoning', 'Reasoning trace'),
    orchestrator: t('shortcutsDialog.orchestrator', 'Multi-agent orchestrator'),
    subagents: t('shortcutsDialog.subagents', 'Sub-agent board'),
    diagnostics: t('shortcutsDialog.diagnostics', 'Security diagnostics'),
    quickAsk: t('shortcutsDialog.quickAsk', 'Quick BTW question'),
    insights: t('shortcutsDialog.insights', 'Session insights'),
    resume: t('shortcutsDialog.resume', 'Resume session'),
    focus: t('shortcutsDialog.focus', 'Focus mode'),
    skills: t('shortcutsDialog.skills', 'Skill manager'),
    fileActivity: t('shortcutsDialog.fileActivity', 'File activity'),
  };
  const sectionLabels: Record<ShortcutSection, string> = {
    Général: t('shortcutsDialog.general', 'General'),
    Navigation: t('shortcutsDialog.navigation', 'Navigation'),
    Panneaux: t('shortcutsDialog.panels', 'Panels'),
    'Multi-agent': t('shortcutsDialog.multiAgent', 'Multi-agent'),
  };
  const sections = SHORTCUT_DEFINITIONS.filter((item) => {
    const searchValue = `${shortcutLabels[item.action]} ${item.defaultBinding}`.toLowerCase();
    return !lowered || searchValue.includes(lowered);
  }).reduce<Record<ShortcutSection, typeof SHORTCUT_DEFINITIONS>>(
    (acc, item) => {
      (acc[item.section] ??= []).push(item);
      return acc;
    },
    {} as Record<ShortcutSection, typeof SHORTCUT_DEFINITIONS>
  );

  const exportBindings = () => {
    const blob = new Blob([JSON.stringify(readShortcutOverrides(), null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'code-buddy-shortcuts.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importBindings = async (file?: File) => {
    if (!file) return;
    importShortcuts(JSON.parse(await file.text()));
    setRevision((value) => value + 1);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('shortcutsDialog.title', 'Keyboard shortcuts')}
    >
      <div
        className="flex max-h-[86vh] w-[680px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        data-testid="shortcut-editor"
        data-revision={revision}
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-secondary">
              {t('shortcutsDialog.configurableTitle', 'Configurable shortcuts')}
            </h2>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {t(
                'shortcutsDialog.instructions',
                'Select a shortcut, then press the new key combination.'
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-surface-hover"
            aria-label={t('common.close', 'Close')}
          >
            <X size={16} />
          </button>
        </header>
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <div className="relative min-w-0 flex-1">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('shortcutsDialog.searchPlaceholder', 'Search shortcuts…')}
              className="w-full rounded-md border border-border bg-surface py-1.5 pl-8 pr-3 text-xs outline-none focus:border-accent"
            />
          </div>
          <button
            onClick={exportBindings}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1.5 text-[10px] text-secondary"
          >
            <Download size={11} /> {t('shortcutsDialog.export', 'Export')}
          </button>
          <label className="inline-flex cursor-pointer items-center gap-1 rounded border border-border px-2 py-1.5 text-[10px] text-secondary">
            <Upload size={11} /> {t('shortcutsDialog.import', 'Import')}
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(event) => void importBindings(event.target.files?.[0])}
            />
          </label>
          <button
            onClick={() => {
              resetShortcuts();
              setRevision((value) => value + 1);
            }}
            className="rounded border border-border p-1.5 text-muted-foreground"
            title={t('shortcutsDialog.reset', 'Reset')}
          >
            <RotateCcw size={12} />
          </button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {Object.entries(sections).map(([section, definitions]) => (
            <section key={section}>
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {sectionLabels[section as ShortcutSection]}
              </h3>
              <div className="space-y-1">
                {definitions.map((definition) => (
                  <div
                    key={definition.action}
                    className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-surface/70"
                  >
                    <span className="text-xs text-secondary">
                      {shortcutLabels[definition.action]}
                    </span>
                    <button
                      type="button"
                      onClick={() => setRecording(definition.action)}
                      onKeyDown={(event) => {
                        if (recording !== definition.action) return;
                        event.preventDefault();
                        const binding = eventToBinding(event);
                        if (!binding) return;
                        saveShortcutBinding(definition.action, binding);
                        setRecording(null);
                        setRevision((value) => value + 1);
                      }}
                      className={`min-w-28 rounded border px-2 py-1 font-mono text-[10px] ${recording === definition.action ? 'border-accent bg-accent/10 text-accent' : 'border-border bg-surface text-secondary'}`}
                    >
                      {recording === definition.action
                        ? t('shortcutsDialog.pressKeys', 'Press the keys…')
                        : getShortcutBinding(definition.action)}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
