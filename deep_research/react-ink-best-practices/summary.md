# React Ink Best Practices - Summary

## Overview

This research covers best practices for building terminal UIs with React Ink, focusing on flickering prevention, table rendering, streaming LLM responses, performance optimization, and layout stability.

## Quick Reference: Key Patterns

### 1. Prevent Flickering

```tsx
// Use Static for completed content
<Static items={completedMessages}>
  {msg => <Message key={msg.id} {...msg} />}
</Static>

// Update only the changing portion
setMessages(prev => [
  ...prev.slice(0, -1),
  { ...prev[prev.length - 1], content: prev[prev.length - 1].content + newText }
]);

// Render configuration
render(<App />, {
  patchConsole: false,
  exitOnCtrlC: false,
});
```

### 2. Streaming LLM Responses

```tsx
function ChatUI({ messages }) {
  const { staticMsgs, dynamicMsg } = useMemo(() => ({
    staticMsgs: messages.filter(m => m.isComplete),
    dynamicMsg: messages.find(m => !m.isComplete),
  }), [messages]);

  return (
    <>
      <Static items={staticMsgs}>
        {msg => <Message key={msg.id} {...msg} />}
      </Static>
      {dynamicMsg && <StreamingMessage message={dynamicMsg} />}
    </>
  );
}
```

### 3. Performance Optimization

```tsx
// Memoize expensive components
const Message = memo(function Message({ content }) {
  return <Text>{content}</Text>;
});

// Memoize derived data
const formattedContent = useMemo(
  () => formatMarkdown(content),
  [content]
);

// Batch rapid updates
const batchedUpdate = useCallback((text) => {
  pendingRef.current += text;
  if (!rafRef.current) {
    rafRef.current = requestAnimationFrame(() => {
      setContent(pendingRef.current);
      rafRef.current = null;
    });
  }
}, []);
```

### 4. Layout Stability

```tsx
// Fixed dimensions prevent layout shifts
<Box height={3} width="100%">
  {loading ? <Spinner /> : <Text>{status}</Text>}
</Box>

// Reserve space even when empty
<Box width={3}>
  {icon || <Text> </Text>}
</Box>
```

### 5. Tables

```tsx
// Using ink-table
import Table from 'ink-table';
<Table data={rows} columns={['name', 'status']} />

// Responsive width calculation
const terminalWidth = process.stdout.columns || 80;
const colWidth = Math.floor(terminalWidth / numColumns);
```

## Research Files

| File | Description |
|------|-------------|
| [flickering-issues.md](./flickering-issues.md) | Causes and solutions for flickering in Ink apps |
| [table-rendering.md](./table-rendering.md) | ink-table, cli-table3, and custom table patterns |
| [streaming-text.md](./streaming-text.md) | Handling streaming LLM responses without flicker |
| [performance-optimization.md](./performance-optimization.md) | React.memo, useMemo, useCallback strategies |
| [layout-stability.md](./layout-stability.md) | Static component and layout shift prevention |

## Key Takeaways

### Flickering Prevention
1. **Use `<Static>` for completed content** - renders once, never updates
2. **Enable incremental rendering** - only updates changed lines
3. **Immutable state updates** - update only the final message, not the whole array
4. **Minimize time between clear and redraw** - prepare output before updating

### Streaming Best Practices
1. **Separate static from dynamic content** - completed messages go to Static
2. **Handle chunk types appropriately** - text_delta for streaming, input_json_delta for tool calls
3. **Batch very fast updates** - use requestAnimationFrame or debounce at ~60fps
4. **Don't parse incomplete JSON** - wait for tool call completion

### Performance
1. **Memoize strategically** - use React.memo for expensive components with stable props
2. **Lift state down** - isolate frequently updating state to minimize re-renders
3. **Use useMemo for derived data** - avoid recalculating on every render
4. **Avoid inline objects/functions** - breaks memoization

### Layout Stability
1. **Fixed dimensions** - use height/width to reserve space
2. **Consistent element counts** - always render elements, just change content
3. **Handle terminal resize** - use useStdout hook for responsive layouts
4. **Contain dynamic content** - use overflow: hidden to prevent pushing layout

## Ink Render Options

```typescript
render(<App />, {
  patchConsole: false,    // Preserve console.log output
  exitOnCtrlC: false,     // Handle exit manually
  // debug: true,         // Enable for development
});
```

## Related Tools and Libraries

- **ink-table** - Table component for Ink
- **ink-spinner** - Loading spinners
- **ink-text-input** - Text input component
- **ink-use-stdout-dimensions** - Hook for terminal dimensions
- **cli-table3** - Alternative table library (not Ink-specific)
- **llm-ui** - React library for smooth LLM output rendering

## Sources

- [Ink GitHub Repository](https://github.com/vadimdemedes/ink)
- [Building a Coding CLI with React Ink](https://ivanleo.com/blog/migrating-to-react-ink)
- [Reactive UI with Ink and Yoga](https://gerred.github.io/building-an-agentic-system/ink-yoga-reactive-ui.html)
- [Ink 3 Release Notes](https://vadimdemedes.com/posts/ink-3)
- [How Claude Code is Built](https://newsletter.pragmaticengineer.com/p/how-claude-code-is-built)
- [ink-table npm](https://www.npmjs.com/package/ink-table)
- [cli-table3 GitHub](https://github.com/cli-table/cli-table3)
