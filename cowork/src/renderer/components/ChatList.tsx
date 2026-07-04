import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import type { Message } from '../types';
import type { SessionExecutionClock } from '../store';
import { MessageCard } from './MessageCard';
import { SubAgentPanel } from './SubAgentPanel';
import { LiveTimer } from './LiveTimer';
import { APP_NAME } from '../brand';

interface ChatListProps {
  displayedMessages: Message[];
  searchMatches: string[];
  activeSearchMatchId: string | null;
  hasActiveTurn: boolean;
  partialMessage: string | null;
  partialThinking: string | null;
  executionClock: SessionExecutionClock | undefined;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  onEditMessage: (message: Message, newText: string) => void;
  onRegenerateMessage: (message: Message) => void;
}

export function ChatList({
  displayedMessages,
  searchMatches,
  activeSearchMatchId,
  hasActiveTurn,
  partialMessage,
  partialThinking,
  executionClock,
  messagesEndRef,
  onEditMessage,
  onRegenerateMessage,
}: ChatListProps) {
  const { t } = useTranslation();

  return (
    <div className="w-full pb-8 pt-4 space-y-0">
      {/* Sub-agent panel (Claude Cowork parity) */}
      <div className="max-w-3xl mx-auto px-4 mb-6">
        <SubAgentPanel compact />
      </div>

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

      {/* Live execution timer — self-contained so its 100 ms tick never
          re-renders this message list. */}
      <LiveTimer
        executionClock={executionClock}
        hasActiveTurn={hasActiveTurn}
        partialMessage={partialMessage}
        partialThinking={partialThinking}
      />

      <div ref={messagesEndRef} />
    </div>
  );
}
