import { memo, useMemo, useState } from 'react';
import { Activity, ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ContentBlock, Message, ToolResultContent } from '../../types';
import { ContentBlockView } from './ContentBlockView';
import { WidgetBlock } from '../widgets/WidgetBlock';

interface ActivityGroupBlockProps {
  blocks: ContentBlock[];
  allBlocks: ContentBlock[];
  message: Message;
  isStreaming?: boolean;
}

export const ActivityGroupBlock = memo(function ActivityGroupBlock({
  blocks,
  allBlocks,
  message,
  isStreaming,
}: ActivityGroupBlockProps) {
  const { t } = useTranslation();
  const widgetCandidates = useMemo(() => {
    const candidates: Array<{ id: string; data: unknown }> = [];
    const seen = new Set<string>();
    const pushResult = (result: ToolResultContent) => {
      if (result.isError || result.data === undefined || seen.has(result.toolUseId)) return;
      seen.add(result.toolUseId);
      candidates.push({ id: result.toolUseId, data: result.data });
    };

    for (const block of blocks) {
      if (block.type === 'tool_result') {
        pushResult(block as ToolResultContent);
      }
      if (block.type === 'tool_use') {
        const toolUseId = (block as { id?: unknown }).id;
        if (typeof toolUseId !== 'string') continue;
        const result = allBlocks.find(
          (candidate) =>
            candidate.type === 'tool_result' &&
            (candidate as ToolResultContent).toolUseId === toolUseId
        ) as ToolResultContent | undefined;
        if (result) pushResult(result);
      }
    }
    return candidates;
  }, [allBlocks, blocks]);
  const [expanded, setExpanded] = useState(isStreaming === true);
  const { toolCount, thinkingCount, errorCount } = useMemo(() => {
    let tools = 0;
    let thinking = 0;
    let errors = 0;
    for (const block of blocks) {
      if (block.type === 'tool_use') tools += 1;
      if (block.type === 'thinking') thinking += 1;
      if (block.type === 'tool_result' && (block as ToolResultContent).isError) errors += 1;
    }
    return { toolCount: tools, thinkingCount: thinking, errorCount: errors };
  }, [blocks]);

  if (blocks.length === 0) return null;

  const summary = [
    toolCount > 0 ? t('messageCard.activityTools', { count: toolCount, defaultValue: '{{count}} tools' }) : null,
    thinkingCount > 0 ? t('messageCard.activityThinking', 'thinking') : null,
    errorCount > 0 ? t('messageCard.activityErrors', { count: errorCount, defaultValue: '{{count}} errors' }) : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="rounded-lg border border-border-subtle bg-background/35 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-surface-hover/40 transition-colors"
      >
        <Activity className="w-3.5 h-3.5 text-text-muted shrink-0" />
        <span className="text-xs font-medium text-text-muted shrink-0">
          {t('messageCard.activity', 'Activity')}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-text-muted/70">
          {summary || t('messageCard.activitySummary', 'internal steps')}
        </span>
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-text-muted shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-text-muted shrink-0" />
        )}
      </button>
      {!expanded
        ? widgetCandidates.map((candidate) => (
            <WidgetBlock
              key={candidate.id}
              data={candidate.data}
              className="mb-2 mt-2"
            />
          ))
        : null}
      {expanded ? (
        <div className="space-y-1.5 border-t border-border/50 px-2.5 py-2">
          {blocks.map((block, index) => (
            <ContentBlockView
              key={'id' in block ? (block as { id: string }).id : `activity-${block.type}-${index}`}
              block={block}
              isUser={false}
              isStreaming={isStreaming}
              allBlocks={allBlocks}
              message={message}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
});
