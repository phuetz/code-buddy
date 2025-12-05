# Streaming LLM Responses in React Ink

## The Challenge

When streaming LLM responses, the UI must handle:
- Character-by-character text updates
- Tool call JSON fragments that need concatenation
- Preventing flickering during rapid updates
- Distinguishing between complete and in-progress content

## Event-Driven Streaming Pattern

### Handling Streaming Chunks

```typescript
interface StreamingState {
  content: string;
  toolCalls: ToolCall[];
  isComplete: boolean;
}

async function handleStream(response: AsyncIterable<StreamChunk>) {
  for await (const chunk of response) {
    switch (chunk.type) {
      case 'content_block_start':
        // Initialize new content container
        initializeNewBlock(chunk);
        break;

      case 'content_block_delta':
        if (chunk.delta.type === 'text_delta') {
          // Append text character by character
          appendText(chunk.delta.text);
        } else if (chunk.delta.type === 'input_json_delta') {
          // Accumulate JSON fragments for tool calls
          accumulateToolJson(chunk.delta.partial_json);
        }
        break;

      case 'content_block_stop':
        // Block complete - execute any pending operations
        finalizeBlock();
        break;
    }
  }
}
```

### State Update Pattern to Prevent Flickering

```tsx
// GOOD: Update only the final message in-place
const appendToLastMessage = (newContent: string) => {
  setMessages((prev) => {
    if (prev.length === 0) return prev;

    const lastIndex = prev.length - 1;
    const lastMessage = prev[lastIndex];

    return [
      ...prev.slice(0, lastIndex),
      {
        ...lastMessage,
        content: lastMessage.content + newContent
      }
    ];
  });
};

// BAD: Creates new message each time
const badAppend = (newContent: string) => {
  setMessages([...messages, { content: newContent }]); // Flickers!
};
```

## Component Architecture for Streaming

### Separating Static and Dynamic Content

```tsx
import { Static, Box, Text } from 'ink';
import React, { useMemo } from 'react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isComplete: boolean;
}

function ChatInterface({ messages }: { messages: Message[] }) {
  // Separate completed messages (static) from in-progress (dynamic)
  const { staticMessages, dynamicMessage } = useMemo(() => {
    const complete = messages.filter(m => m.isComplete);
    const inProgress = messages.find(m => !m.isComplete);
    return { staticMessages: complete, dynamicMessage: inProgress };
  }, [messages]);

  return (
    <>
      {/* Completed messages - rendered once, never re-rendered */}
      <Static items={staticMessages}>
        {(message) => (
          <MessageComponent key={message.id} message={message} />
        )}
      </Static>

      {/* Currently streaming message - updates frequently */}
      {dynamicMessage && (
        <StreamingMessage message={dynamicMessage} />
      )}
    </>
  );
}
```

### Streaming Message Component

```tsx
import { Box, Text } from 'ink';
import React, { memo } from 'react';

interface StreamingMessageProps {
  message: Message;
}

const StreamingMessage = memo(function StreamingMessage({
  message
}: StreamingMessageProps) {
  return (
    <Box flexDirection="column">
      <Text color="cyan">{message.role}:</Text>
      <Box marginLeft={2}>
        <Text>{message.content}</Text>
        {!message.isComplete && <Text color="gray">...</Text>}
      </Box>
    </Box>
  );
});
```

## Handling Tool Calls During Streaming

```tsx
interface ToolCall {
  id: string;
  name: string;
  arguments: string; // Accumulated JSON string
  isComplete: boolean;
}

function ToolCallDisplay({ toolCall }: { toolCall: ToolCall }) {
  // Don't parse incomplete JSON
  const args = toolCall.isComplete
    ? JSON.parse(toolCall.arguments)
    : null;

  return (
    <Box flexDirection="column" marginY={1}>
      <Text color="yellow">Tool: {toolCall.name}</Text>
      {toolCall.isComplete ? (
        <Text>{JSON.stringify(args, null, 2)}</Text>
      ) : (
        <Text color="gray">Receiving arguments...</Text>
      )}
    </Box>
  );
}
```

## Render Configuration for Streaming

```typescript
import { render } from 'ink';

const { waitUntilExit, rerender } = render(<App />, {
  patchConsole: false,    // Don't intercept console.log
  exitOnCtrlC: false,     // Handle Ctrl+C manually
});

// For streaming updates, the component should manage its own state
// rather than calling rerender() externally
```

## Performance Optimizations

### 1. Debounce Very Fast Updates

```typescript
import { useMemo, useRef, useEffect, useState } from 'react';

function useDebounced<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  const timeoutRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    timeoutRef.current = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [value, delay]);

  return debouncedValue;
}

// Usage: debounce very fast streaming updates
const debouncedContent = useDebounced(streamingContent, 16); // ~60fps
```

### 2. Batch State Updates

```typescript
// React 18 automatically batches updates in event handlers
// For streaming, use a ref to accumulate then update

const contentRef = useRef('');
const updateScheduled = useRef(false);

const appendContent = (text: string) => {
  contentRef.current += text;

  if (!updateScheduled.current) {
    updateScheduled.current = true;
    requestAnimationFrame(() => {
      setContent(contentRef.current);
      updateScheduled.current = false;
    });
  }
};
```

## Sources

- [Building a Coding CLI with React Ink](https://ivanleo.com/blog/migrating-to-react-ink)
- [Reactive UI with Ink and Yoga](https://gerred.github.io/building-an-agentic-system/ink-yoga-reactive-ui.html)
- [llm-ui React Library](https://llm-ui.com/)
