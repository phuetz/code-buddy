/**
 * MemoryPanel — slide-out overlay around {@link MemoryBrowser} so Code Buddy's
 * cross-session persistent memory (the `memory.*` IPC over .codebuddy memory)
 * is reachable from the nav rail. Mirrors ReasoningTraceViewer's right-side
 * panel shell. MemoryBrowser itself stays unchanged (it is also embedded as the
 * ContextPanel "memory" tab).
 */
import { X, Brain } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MemoryBrowser } from './MemoryBrowser';

interface MemoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MemoryPanel({ isOpen, onClose }: MemoryPanelProps) {
  const { t } = useTranslation();
  if (!isOpen) return null;
  return (
    <div
      className="fixed right-0 top-0 h-full w-[560px] max-w-[95vw] bg-background border-l border-border shadow-2xl z-40 flex flex-col"
      data-testid="memory-panel"
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-muted flex-shrink-0">
        <Brain size={16} className="text-accent" />
        <h2 className="text-sm font-semibold text-text-primary">
          {t('memoryBrowser.title', 'Memory')}
        </h2>
        <button
          onClick={onClose}
          className="ml-auto p-1 text-text-muted hover:text-text-primary"
          aria-label={t('common.close', 'Close')}
          title={t('common.close', 'Close')}
          data-testid="memory-panel-close"
        >
          <X size={16} />
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        <MemoryBrowser />
      </div>
    </div>
  );
}
