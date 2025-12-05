# Flickering Issues in React Ink Apps

## Root Causes of Flickering

1. **Full Screen Redraws**: By default, terminal UIs redraw the entire output on every state change, causing visible flicker
2. **High Frequency Updates**: Rapid state changes (e.g., streaming text) trigger excessive re-renders
3. **Cursor Repositioning**: Moving the cursor and clearing regions causes visual artifacts
4. **stdout Buffering**: Inconsistent buffering between write operations

## Solutions and Best Practices

### 1. Enable Incremental Rendering Mode

Ink supports an incremental rendering mode that only updates changed lines instead of redrawing the entire output:

```typescript
import { render } from 'ink';

const { waitUntilExit } = render(<App />, {
  // Only update changed lines
  patchConsole: false,
});
```

### 2. Control Frame Rate (FPS)

Limit the maximum frames per second to reduce CPU usage and flickering for frequently updating components:

```typescript
// Lower FPS for components that update very frequently
// This reduces CPU usage and prevents visual artifacts
```

### 3. Immutable State Update Pattern

When streaming content, only update the portion that changes:

```typescript
// BAD: Creates new array, causes full re-render
setMessages([...messages, newMessage]);

// GOOD: Update only the final message
setMessages((prev) => [
  ...prev.slice(0, -1),
  {
    role: "assistant",
    content: prev.slice(-1)[0]?.content + newContent
  }
]);
```

### 4. Use Static Component for Permanent Content

The `<Static>` component renders content permanently above the dynamic UI:

```tsx
import { Static, Box, Text } from 'ink';

function App({ messages }) {
  const staticMessages = messages.filter(m => m.complete);
  const activeMessage = messages.find(m => !m.complete);

  return (
    <>
      <Static items={staticMessages}>
        {(msg, index) => (
          <Box key={index}>
            <Text>{msg.content}</Text>
          </Box>
        )}
      </Static>

      {/* Dynamic content below */}
      {activeMessage && <StreamingMessage message={activeMessage} />}
    </>
  );
}
```

### 5. Double Buffering Concept

Minimize time between clearing and redrawing:

```typescript
// Get all output ready before updating
const output = computeExpensiveOutput(data);

// Then update in one operation
setState({ output, ready: true });
```

### 6. Avoid Clearing Regions You Will Fill

```typescript
// BAD: Clear then fill
console.clear();
renderContent();

// GOOD: Only clear regions not being filled
// Use Static for completed content
// Use direct updates for active content
```

## Ink Render Configuration

```typescript
import { render } from 'ink';

render(<App />, {
  patchConsole: false,    // Preserve existing console output
  exitOnCtrlC: false,     // Custom exit handling
  // debug: true,         // Enable debug mode for development
});
```

## Sources

- [Ink GitHub Repository](https://github.com/vadimdemedes/ink)
- [Building a Coding CLI with React Ink](https://ivanleo.com/blog/migrating-to-react-ink)
- [Reactive UI with Ink and Yoga](https://gerred.github.io/building-an-agentic-system/ink-yoga-reactive-ui.html)
