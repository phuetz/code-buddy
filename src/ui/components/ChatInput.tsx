import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../context/theme-context.js';

interface ChatInputProps {
  input: string;
  cursorPosition: number;
  isProcessing: boolean;
  isStreaming: boolean;
  mode?: string;
}

/** A bounded draft viewport. Editing remains available while the agent works. */
export const ChatInput = React.memo(function ChatInput({
  input, cursorPosition, isProcessing, isStreaming, mode = 'code',
}: ChatInputProps) {
  const { colors } = useTheme();
  const busy = isProcessing || isStreaming;
  const viewport = useMemo(() => {
    const position = Math.max(0, Math.min(input.length, cursorPosition));
    const lines = input.split('\n');
    const before = input.slice(0, position).split('\n');
    const row = before.length - 1;
    const column = before[row]?.length ?? 0;
    const start = Math.max(0, Math.min(row - 3, lines.length - 6));
    return { lines, row, column, start, visible: lines.slice(start, start + 6) };
  }, [input, cursorPosition]);
  const placeholder = mode === 'plan' ? 'Describe what you want to plan…'
    : mode === 'ask' ? 'Ask a question…'
    : busy ? 'Write a follow-up while I work…' : 'Describe a task, or type / for commands…';

  return (
    <Box flexDirection="column" borderStyle="round"
      borderColor={busy ? colors.borderBusy : colors.borderActive}
      paddingX={1} marginTop={1}>
      <Box justifyContent="space-between">
        <Text bold color={colors.primary}>{mode === 'plan' ? 'Plan' : mode === 'ask' ? 'Question' : 'Message'}</Text>
        <Text color={colors.textMuted}>{busy ? 'Draft · working' : 'Ready'}{viewport.lines.length > 1 ? ` · ${viewport.lines.length} lines` : ''}</Text>
      </Box>
      {viewport.start > 0 && <Text dimColor>… {viewport.start} lines above</Text>}
      {viewport.visible.map((line, index) => {
        const active = viewport.start + index === viewport.row;
        const char = Array.from(line.slice(viewport.column))[0] || ' ';
        return (
          <Box key={viewport.start + index}>
            <Text color={colors.primary}>{active ? '❯ ' : '  '}</Text>
            {!input ? (
              <Text><Text inverse> </Text><Text dimColor>{placeholder}</Text></Text>
            ) : active ? (
              <Text>{line.slice(0, viewport.column)}<Text inverse>{char}</Text>{line.slice(viewport.column + char.length)}</Text>
            ) : <Text>{line || ' '}</Text>}
          </Box>
        );
      })}
      {viewport.start + 6 < viewport.lines.length && <Text dimColor>… {viewport.lines.length - viewport.start - 6} lines below</Text>}
    </Box>
  );
});
