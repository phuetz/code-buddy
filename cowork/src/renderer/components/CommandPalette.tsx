/**
 * CommandPalette — Cmd+K command palette with fuzzy search
 */
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';
import { CAPABILITY_COMMANDS } from './command-palette-capabilities';
import {
  Search,
  MessageSquare,
  Settings,
  Download,
  Keyboard,
  Sun,
  Moon,
  Clock3,
  ShieldAlert,
  Bot,
  Zap,
  Brain,
  Scissors,
  PackageOpen,
  Trello,
} from 'lucide-react';

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  action: () => void;
  shortcut?: string;
}

interface CommandPaletteProps {
  onClose: () => void;
  onNewSession: () => void;
  onResumeSession: () => void;
  onOpenSettings: () => void;
  onToggleTheme: () => void;
  onShowShortcuts: () => void;
  isDark: boolean;
  // P4.5 — extended actions for unified palette
  onShowDiagnostics?: () => void;
  onShowSubAgents?: () => void;
  onShowBtw?: () => void;
  onToggleYolo?: () => void;
  onShowPlugins?: () => void;
  onShowSkillsManager?: () => void;
  onShowClawMigration?: () => void;
  onShowKanban?: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  onClose,
  onNewSession,
  onResumeSession,
  onOpenSettings,
  onToggleTheme,
  onShowShortcuts,
  isDark,
  onShowDiagnostics,
  onShowSubAgents,
  onShowBtw,
  onToggleYolo,
  onShowPlugins,
  onShowSkillsManager,
  onShowClawMigration,
  onShowKanban,
}) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands: CommandItem[] = useMemo(
    () => [
      {
        id: 'new-session',
        label: t('commandPalette.newSession', 'New session'),
        description: t('commandPalette.newSessionDesc', 'Start a new conversation'),
        icon: <MessageSquare size={14} />,
        action: onNewSession,
        shortcut: 'Ctrl+N',
      },
      {
        id: 'resume-session',
        label: t('commandPalette.resumeSession', 'Resume session'),
        description: t('commandPalette.resumeSessionDesc', 'Open the session resume chooser'),
        icon: <Clock3 size={14} />,
        action: onResumeSession,
      },
      {
        id: 'settings',
        label: t('settings.title', 'Settings'),
        description: t('commandPalette.settingsDesc', 'Open settings panel'),
        icon: <Settings size={14} />,
        action: onOpenSettings,
        shortcut: 'Ctrl+,',
      },
      {
        id: 'theme',
        label: isDark
          ? t('commandPalette.switchToLightTheme', 'Switch to light theme')
          : t('commandPalette.switchToDarkTheme', 'Switch to dark theme'),
        icon: isDark ? <Sun size={14} /> : <Moon size={14} />,
        action: onToggleTheme,
      },
      {
        id: 'shortcuts',
        label: t('shortcutsDialog.title', 'Keyboard shortcuts'),
        description: t('commandPalette.shortcutsDesc', 'View all shortcuts'),
        icon: <Keyboard size={14} />,
        action: onShowShortcuts,
        shortcut: 'Ctrl+/',
      },
      {
        id: 'export',
        label: t('exportDialog.title', 'Export session'),
        description: t('commandPalette.exportDesc', 'Export as Markdown or JSON'),
        icon: <Download size={14} />,
        action: () => {
          /* handled by sidebar */
        },
      },
      ...(onShowDiagnostics
        ? [
            {
              id: 'diagnostics',
              label: t('commandPalette.diagnostics', 'Security diagnostics'),
              description: t('commandPalette.diagnosticsDesc', 'Vulns, secrets, licenses scans'),
              icon: <ShieldAlert size={14} />,
              action: onShowDiagnostics,
              shortcut: 'Ctrl+Shift+D',
            },
          ]
        : []),
      ...(onShowSubAgents
        ? [
            {
              id: 'subagents',
              label: t('commandPalette.subAgents', 'Sub-agents dashboard'),
              description: t('commandPalette.subAgentsDesc', 'View spawned sub-agents'),
              icon: <Bot size={14} />,
              action: onShowSubAgents,
              shortcut: 'Ctrl+Shift+A',
            },
          ]
        : []),
      ...(onShowBtw
        ? [
            {
              id: 'btw',
              label: t('commandPalette.btw', 'Quick ask (BTW)'),
              description: t('commandPalette.btwDesc', 'One-shot question without touching session'),
              icon: <Brain size={14} />,
              action: onShowBtw,
              shortcut: 'Ctrl+Shift+/',
            },
          ]
        : []),
      ...(onToggleYolo
        ? [
            {
              id: 'yolo',
              label: t('commandPalette.yolo', 'Toggle YOLO mode'),
              description: t('commandPalette.yoloDesc', 'Auto-approve everything (with budget cap)'),
              icon: <Zap size={14} />,
              action: onToggleYolo,
            },
          ]
        : []),
      ...(onShowPlugins
        ? [
            {
              id: 'plugins',
              label: t('commandPalette.plugins', 'Open Plugins manager'),
              description: t('commandPalette.pluginsDesc', 'Browse, install, toggle plugins'),
              icon: <Scissors size={14} />,
              action: onShowPlugins,
            },
          ]
        : []),
      ...(onShowSkillsManager
        ? [
            {
              id: 'skills-manager',
              label: t('commandPalette.skillsManager', 'Open Skills Manager'),
              description: t(
                'commandPalette.skillsManagerDesc',
                'Review installed skills and the candidate queue',
              ),
              icon: <PackageOpen size={14} />,
              action: onShowSkillsManager,
              shortcut: 'Ctrl+Shift+L',
            },
          ]
        : []),
      ...(onShowClawMigration
        ? [
            {
              id: 'claw-migration',
              label: t('commandPalette.clawMigration', 'Migrate from OpenClaw'),
              description: t(
                'commandPalette.clawMigrationDesc',
                'Preview and import an OpenClaw installation (dry-run first)',
              ),
              icon: <PackageOpen size={14} />,
              action: onShowClawMigration,
            },
          ]
        : []),
      ...(onShowKanban
        ? [
            {
              id: 'kanban',
              label: t('commandPalette.kanban', 'Open Kanban board'),
              description: t(
                'commandPalette.kanbanDesc',
                'Manage the workspace Hermes Kanban board',
              ),
              icon: <Trello size={14} />,
              action: onShowKanban,
            },
          ]
        : []),
      // Universal backstop: every Code Buddy capability reachable from ⌘K (the new shell dropped the
      // TopMenuBar, so this is the discoverability net). Each opens its globally-mounted panel.
      ...CAPABILITY_COMMANDS.map((c) => ({
        id: c.id,
        label: c.label,
        description: c.description,
        icon: <Brain size={14} />,
        action: () => c.run(useAppStore.getState()),
      })),
    ],
    [
      onNewSession,
      onResumeSession,
      onOpenSettings,
      onToggleTheme,
      onShowShortcuts,
      isDark,
      t,
      onShowDiagnostics,
      onShowSubAgents,
      onShowBtw,
      onToggleYolo,
      onShowPlugins,
      onShowSkillsManager,
      onShowClawMigration,
      onShowKanban,
    ]
  );

  const filtered = useMemo(() => {
    if (!query) return commands;
    const q = query.toLowerCase();
    return commands.filter(
      (c) => c.label.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q)
    );
  }, [query, commands]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      filtered[selectedIndex].action();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24" onClick={onClose}>
      <div
        className="w-[480px] bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
          <Search size={16} className="text-zinc-500" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('commandPalette.searchPlaceholder', 'Type a command…')}
            className="flex-1 bg-transparent text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
          />
        </div>

        {/* Results */}
        <div className="max-h-64 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-3 text-sm text-zinc-500">
              {t('commandPalette.empty', 'No matching commands')}
            </div>
          ) : (
            filtered.map((cmd, i) => (
              <button
                key={cmd.id}
                onClick={() => {
                  cmd.action();
                  onClose();
                }}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  i === selectedIndex ? 'bg-zinc-800' : 'hover:bg-zinc-800/50'
                }`}
              >
                <span className="text-zinc-400">{cmd.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-zinc-200">{cmd.label}</div>
                  {cmd.description && (
                    <div className="text-xs text-zinc-500">{cmd.description}</div>
                  )}
                </div>
                {cmd.shortcut && (
                  <span className="text-xs text-zinc-600 font-mono">{cmd.shortcut}</span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
