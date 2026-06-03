// MessageCard — top-level chat message renderer.
// Delegates block rendering to ContentBlockView and its sub-components.
import { useState, useCallback, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check, Clock, XCircle, Code2, Star, Pencil, RefreshCw } from 'lucide-react';
import type { Message, ContentBlock, ToolUseContent, ToolResultContent } from '../types';
import { ContentBlockView } from './message/ContentBlockView';
import { detectArtifacts } from '../utils/artifact-detector';
import { useAppStore } from '../store';

interface MessageCardProps {
  message: Message;
  isStreaming?: boolean;
  searchMatchState?: 'none' | 'match' | 'active';
  /** Called when user clicks the Edit button on their own message. */
  onEdit?: (message: Message, text: string) => void;
  /** Called when user clicks Regenerate on an assistant message. */
  onRegenerate?: (message: Message) => void;
}

export const MessageCard = memo(function MessageCard({
  message,
  isStreaming,
  searchMatchState = 'none',
  onEdit,
  onRegenerate,
}: MessageCardProps) {
  const { t } = useTranslation();
  const isUser = message.role === 'user';
  const isQueued = message.localStatus === 'queued';
  const isCancelled = message.localStatus === 'cancelled';
  const contentBlocks = useMemo<ContentBlock[]>(() => {
    const rawContent = message.content as unknown;
    return Array.isArray(rawContent)
      ? (rawContent as ContentBlock[])
      : [{ type: 'text', text: String(rawContent ?? '') } as ContentBlock];
  }, [message.content]);
  const [copied, setCopied] = useState(false);

  // Build a set of tool_result IDs that have a matching tool_use (for merging)
  const mergedResultIds = useMemo(() => {
    const ids = new Set<string>();
    for (const b of contentBlocks) {
      if (b.type === 'tool_use') {
        const tu = b as ToolUseContent;
        const result = contentBlocks.find(
          (r) => r.type === 'tool_result' && (r as ToolResultContent).toolUseId === tu.id
        );
        if (result) ids.add((result as ToolResultContent).toolUseId);
      }
    }
    return ids;
  }, [contentBlocks]);

  // Extract text content for copying
  const getTextContent = () =>
    contentBlocks
      .filter((block) => block.type === 'text')
      .map((block) => (block as { type: 'text'; text: string }).text)
      .join('\n');

  // Phase 2 step 10: detect renderable artifacts in the combined text content.
  const setActiveArtifact = useAppStore((s) => s.setActiveArtifact);
  const detectedArtifacts = useMemo(() => {
    if (isUser) return [];
    const text = contentBlocks
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('\n\n');
    return detectArtifacts(text);
  }, [contentBlocks, isUser]);

  const handleCopy = async () => {
    const text = getTextContent();
    if (text) {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // Clipboard unavailable
      }
    }
  };

  // Phase 3 step 4: bookmark toggle
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const bookmarkedMessageIds = useAppStore((s) => s.bookmarkedMessageIds);
  const toggleBookmarkedMessage = useAppStore((s) => s.toggleBookmarkedMessage);
  const isBookmarked = bookmarkedMessageIds.has(message.id);
  const handleToggleBookmark = useCallback(async () => {
    if (!activeSessionId || !window.electronAPI?.bookmarks?.toggle) return;
    const preview = getTextContent().slice(0, 500) || `${message.role} message`;
    const result = await window.electronAPI.bookmarks.toggle({
      sessionId: activeSessionId,
      projectId: activeProjectId,
      messageId: message.id,
      preview,
      role: message.role,
    });
    toggleBookmarkedMessage(message.id, result.bookmarked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, activeProjectId, message.id, message.role]);

  return (
    <div
      className={`animate-fade-in rounded-xl transition-all ${
        searchMatchState === 'active'
          ? 'ring-2 ring-accent/60 bg-accent/5'
          : searchMatchState === 'match'
            ? 'ring-1 ring-accent/30'
            : ''
      }`}
      id={`message-${message.id}`}
    >
      {isUser ? (
        // User message - compact styling with smaller padding and radius
        <div className="flex items-start gap-2 justify-end group">
          <div
            className={`message-user px-4 py-3 rounded-[1.65rem] max-w-[80%] min-w-0 break-words ${
              isQueued ? 'opacity-70 border-dashed' : ''
            } ${isCancelled ? 'opacity-60' : ''}`}
          >
            {isQueued && (
              <div className="mb-1 flex items-center gap-1 text-[11px] text-text-muted">
                <Clock className="w-3 h-3" />
                <span>{t('messageCard.queued')}</span>
              </div>
            )}
            {isCancelled && (
              <div className="mb-1 flex items-center gap-1 text-[11px] text-text-muted">
                <XCircle className="w-3 h-3" />
                <span>{t('messageCard.cancelled')}</span>
              </div>
            )}
            {contentBlocks.length === 0 ? (
              <span className="text-text-muted italic">{t('messageCard.emptyMessage')}</span>
            ) : (
              contentBlocks.map((block, index) => (
                <ContentBlockView
                  key={
                    'id' in block ? (block as { id: string }).id : `block-${block.type}-${index}`
                  }
                  block={block}
                  isUser={isUser}
                  isStreaming={isStreaming}
                />
              ))
            )}
          </div>
          <div className="mt-1 flex flex-col gap-1 flex-shrink-0">
            {onEdit && (
              <button
                onClick={() => onEdit(message, getTextContent())}
                className="w-6 h-6 flex items-center justify-center rounded-md bg-surface-muted hover:bg-surface-active transition-all opacity-0 group-hover:opacity-100"
                title={t('messageCard.editMessage', 'Edit & resend')}
                data-testid={`message-edit-${message.id}`}
              >
                <Pencil className="w-3 h-3 text-text-muted" />
              </button>
            )}
            <button
              onClick={handleCopy}
              className="w-6 h-6 flex items-center justify-center rounded-md bg-surface-muted hover:bg-surface-active transition-all opacity-0 group-hover:opacity-100"
              title={t('messageCard.copyMessage')}
              data-testid={`message-copy-${message.id}`}
            >
              {copied ? (
                <Check className="w-3 h-3 text-success" />
              ) : (
                <Copy className="w-3 h-3 text-text-muted" />
              )}
            </button>
            <button
              onClick={handleToggleBookmark}
              className={`w-6 h-6 flex items-center justify-center rounded-md transition-all ${
                isBookmarked
                  ? 'bg-warning/20 opacity-100'
                  : 'bg-surface-muted hover:bg-surface-active opacity-0 group-hover:opacity-100'
              }`}
              title={isBookmarked ? t('bookmarks.remove') : t('bookmarks.add')}
            >
              <Star
                className={`w-3 h-3 ${
                  isBookmarked ? 'text-warning fill-warning' : 'text-text-muted'
                }`}
              />
            </button>
          </div>
        </div>
      ) : (
        // Assistant message — no bubble, direct content (Claude style)
        <div className="space-y-1.5 group/assistant relative">
          <div className="absolute -left-8 top-0 flex flex-col gap-1">
            <button
              onClick={handleToggleBookmark}
              className={`w-6 h-6 flex items-center justify-center rounded-md transition-all ${
                isBookmarked
                  ? 'bg-warning/20 opacity-100'
                  : 'bg-surface-muted hover:bg-surface-active opacity-0 group-hover/assistant:opacity-100'
              }`}
              title={isBookmarked ? t('bookmarks.remove') : t('bookmarks.add')}
            >
              <Star
                className={`w-3 h-3 ${
                  isBookmarked ? 'text-warning fill-warning' : 'text-text-muted'
                }`}
              />
            </button>
            {!isStreaming && (
              <button
                onClick={handleCopy}
                className="w-6 h-6 flex items-center justify-center rounded-md bg-surface-muted hover:bg-surface-active transition-all opacity-0 group-hover/assistant:opacity-100"
                title={t('messageCard.copyMessage')}
                data-testid={`message-copy-${message.id}`}
              >
                {copied ? (
                  <Check className="w-3 h-3 text-success" />
                ) : (
                  <Copy className="w-3 h-3 text-text-muted" />
                )}
              </button>
            )}
            {onRegenerate && !isStreaming && (
              <button
                onClick={() => onRegenerate(message)}
                className="w-6 h-6 flex items-center justify-center rounded-md bg-surface-muted hover:bg-surface-active transition-all opacity-0 group-hover/assistant:opacity-100"
                title={t('messageCard.regenerate', 'Regenerate response')}
                data-testid={`message-regenerate-${message.id}`}
              >
                <RefreshCw className="w-3 h-3 text-text-muted" />
              </button>
            )}
          </div>
          {contentBlocks.map((block, index) => {
            // Skip tool_result blocks that are merged into their tool_use card
            if (
              block.type === 'tool_result' &&
              mergedResultIds.has((block as ToolResultContent).toolUseId)
            ) {
              return null;
            }
            return (
              <ContentBlockView
                key={'id' in block ? (block as { id: string }).id : `block-${block.type}-${index}`}
                block={block}
                isUser={isUser}
                isStreaming={isStreaming}
                allBlocks={contentBlocks}
                message={message}
              />
            );
          })}
          {detectedArtifacts.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {detectedArtifacts.map((artifact) => (
                <button
                  key={artifact.id}
                  onClick={() =>
                    setActiveArtifact({
                      id: artifact.id,
                      kind: artifact.kind,
                      language: artifact.language,
                      source: artifact.source,
                      title: artifact.title,
                    })
                  }
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] bg-surface hover:bg-surface-hover border border-border rounded-lg transition-colors group"
                  title={t('artifact.openPanel')}
                >
                  <Code2 size={12} className="text-accent" />
                  <span className="text-text-primary font-medium">
                    {artifact.title ?? t(`artifact.kind.${artifact.kind}`)}
                  </span>
                  <span className="text-text-muted uppercase text-[9px]">{artifact.kind}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
