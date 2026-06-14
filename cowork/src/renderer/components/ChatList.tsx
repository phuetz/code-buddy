import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Loader2, Clock } from 'lucide-react';
import type { Message } from '../types';
import { MessageCard } from './MessageCard';
import { SubAgentPanel } from './SubAgentPanel';
import { APP_NAME } from '../brand';

interface ChatListProps {
  displayedMessages: Message[];
  searchMatches: string[];
  activeSearchMatchId: string | null;
  hasActiveTurn: boolean;
  partialMessage: string | null;
  partialThinking: string | null;
  liveElapsed: number;
  timerActive: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  onEditMessage: (message: Message, newText: string) => void;
  onRegenerateMessage: (message: Message) => void;
}

function formatExecutionTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

export function ChatList({
  displayedMessages,
  searchMatches,
  activeSearchMatchId,
  hasActiveTurn,
  partialMessage,
  partialThinking,
  liveElapsed,
  timerActive,
  messagesEndRef,
  onEditMessage,
  onRegenerateMessage,
}: ChatListProps) {
  const { t } = useTranslation();

  return (
    <div className="w-full max-w-[920px] mx-auto py-8 px-5 lg:px-8 space-y-5">
      {/* Sub-agent panel (Claude Cowork parity) */}
      <SubAgentPanel compact />

      {displayedMessages.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-28 text-text-muted space-y-3 text-center">
          <p className="text-[11px] uppercase tracking-[0.16em] text-text-muted/80">{APP_NAME}</p>
          <p className="text-base text-text-secondary">{t('chat.startConversation')}</p>
        </div>
      ) : (
        displayedMessages.map((message) => {
          const isStreaming = typeof message.id === 'string' && message.id.startsWith('partial-');
          return (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', damping: 20, stiffness: 100 }}
            >
              <MessageCard
                message={message}
                isStreaming={isStreaming}
                searchMatchState={
                  searchMatches.includes(message.id)
                    ? activeSearchMatchId === message.id
                      ? 'active'
                      : 'match'
                    : 'none'
                }
                onEdit={onEditMessage}
                onRegenerate={onRegenerateMessage}
              />
            </motion.div>
          );
        })
      )}

      {hasActiveTurn && (!partialMessage || partialMessage.trim() === '') && !partialThinking && (
        <div className="flex flex-col gap-1 px-4 py-3 rounded-2xl bg-background/80 border border-border-subtle max-w-fit">
          <div className="flex items-center gap-3">
            <Loader2 className="w-4 h-4 text-accent animate-spin" />
            <span className="text-sm text-text-secondary">
              {t('chat.processing')}
              {liveElapsed > 1000 && (
                <span className="text-text-muted/80 ml-2 tabular-nums">
                  · {Math.floor(liveElapsed / 1000)}s
                </span>
              )}
            </span>
          </div>
          {liveElapsed > 5000 && liveElapsed < 30000 && (
            <span className="text-[11px] text-text-muted/70 ml-7 italic">
              {t(
                'chat.modelLoading',
                'Loading model or generating thinking — first token usually arrives within 30 s.'
              )}
            </span>
          )}
          {liveElapsed >= 30000 && (
            <span className="text-[11px] text-warning/80 ml-7 italic">
              {t(
                'chat.modelColdStart',
                'Cold start in progress (large local models can take 30–120 s on first run).'
              )}
            </span>
          )}
        </div>
      )}

      {/* Real-time execution timer */}
      {liveElapsed > 0 && (
        <div className="flex items-center gap-1.5 text-[11px] text-text-muted mt-1 ml-0.5">
          <Clock className="w-3 h-3" />
          <span>
            {timerActive
              ? formatExecutionTime(liveElapsed)
              : t('messageCard.executionTime', { time: formatExecutionTime(liveElapsed) })}
          </span>
        </div>
      )}

      <div ref={messagesEndRef} />
    </div>
  );
}
