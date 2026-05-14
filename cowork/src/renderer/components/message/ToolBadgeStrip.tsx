import { memo } from 'react';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { useAppStore } from '../../store';
import type { ContentBlock, ToolUseContent, Message } from '../../types';
import { resolveToolStatus, compactToolLabel, type ToolStatus } from '../../utils/tool-status';
import { getToolIcon } from './toolHelpers';

interface ToolBadgeStripProps {
  blocks: ContentBlock[];
  message: Message;
}

/**
 * Compact horizontal strip of tool-call badges shown at the head of an
 * assistant message. Mirrors the chat-ui gitnexus-rs `ToolCallBadge`
 * pattern: at-a-glance visibility into what the agent invoked, with
 * status color coding (running / success / error). Each badge is a
 * scroll-to anchor on the matching `ToolUseBlock` further down for
 * the full input/output detail.
 *
 * Renders nothing when there are no `tool_use` blocks.
 */
export const ToolBadgeStrip = memo(function ToolBadgeStrip({
  blocks,
  message,
}: ToolBadgeStripProps) {
  const allMessages = useAppStore((s) => s.sessionStates[message.sessionId]?.messages ?? []);
  const activeTurn = useAppStore((s) => s.sessionStates[message.sessionId]?.activeTurn ?? null);
  const hasActiveTurn = Boolean(activeTurn);

  const toolUses = blocks.filter((b) => b.type === 'tool_use') as ToolUseContent[];
  if (toolUses.length === 0) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-1 mb-1"
      data-testid="tool-badge-strip"
    >
      {toolUses.map((tool) => {
        const { status } = resolveToolStatus({
          toolUseId: tool.id,
          ownerBlocks: blocks,
          allMessages,
          hasActiveTurn,
        });
        return (
          <ToolBadge
            key={tool.id}
            tool={tool}
            status={status}
            anchorId={`tool-${tool.id}`}
          />
        );
      })}
    </div>
  );
});

function ToolBadge({
  tool,
  status,
  anchorId,
}: {
  tool: ToolUseContent;
  status: ToolStatus;
  anchorId: string;
}) {
  const label = compactToolLabel(tool.name);
  const style = badgeStyleFor(status);

  const onClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const target = document.getElementById(anchorId);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Brief flash to draw the eye to the now-scrolled-into-view card.
      target.classList.add('ring-2', 'ring-accent/60');
      setTimeout(() => target.classList.remove('ring-2', 'ring-accent/60'), 1200);
    }
  };

  return (
    <a
      href={`#${anchorId}`}
      onClick={onClick}
      className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-mono transition-colors ${style.pill}`}
      title={`${tool.name} — ${labelFor(status)}`}
      aria-label={`${tool.name} (${labelFor(status)})`}
    >
      <span className={style.icon}>{statusIcon(status)}</span>
      <span className="text-text-muted/90">{getToolIcon(tool.name)}</span>
      <span className="truncate max-w-[140px]">{label}</span>
    </a>
  );
}

function statusIcon(status: ToolStatus) {
  switch (status) {
    case 'running':
      return <Loader2 className="w-2.5 h-2.5 animate-spin" />;
    case 'error':
      return <XCircle className="w-2.5 h-2.5" />;
    case 'success':
    default:
      return <CheckCircle2 className="w-2.5 h-2.5" />;
  }
}

function badgeStyleFor(status: ToolStatus): { pill: string; icon: string } {
  switch (status) {
    case 'running':
      return {
        pill: 'border-warning/40 bg-warning/10 text-warning hover:bg-warning/15',
        icon: 'text-warning',
      };
    case 'error':
      return {
        pill: 'border-error/40 bg-error/10 text-error hover:bg-error/15',
        icon: 'text-error',
      };
    case 'success':
    default:
      return {
        pill: 'border-success/40 bg-success/10 text-success hover:bg-success/15',
        icon: 'text-success',
      };
  }
}

function labelFor(status: ToolStatus): string {
  switch (status) {
    case 'running':
      return 'en cours';
    case 'error':
      return 'erreur';
    case 'success':
    default:
      return 'OK';
  }
}
