# React Performance Optimization in Ink

## How Ink Renders

Ink rebuilds the entire layout and output on every update, which can be taxing with high-frequency re-renders. Understanding this is key to optimization.

### Ink 3 Performance Improvements

Ink 3 introduced significant performance improvements:
- 2x faster rendering in high-frequency update scenarios
- Fixes to FlexBox layout rendering bugs
- Simplified internal architecture for easier debugging
- Removed hacky workarounds from previous versions

## React.memo for Ink Components

### Basic Usage

```tsx
import React, { memo } from 'react';
import { Box, Text } from 'ink';

interface MessageProps {
  role: string;
  content: string;
}

// Memoize components that receive stable props
const Message = memo(function Message({ role, content }: MessageProps) {
  return (
    <Box flexDirection="column">
      <Text bold>{role}:</Text>
      <Text>{content}</Text>
    </Box>
  );
});
```

### When to Use React.memo

Use `React.memo` when:
1. The component re-renders often with the same props
2. The component's render logic is computationally expensive
3. The parent component updates frequently but child props stay stable

Do NOT use when:
1. Props change on every render (negates the benefit)
2. The component is cheap to render
3. You're passing inline objects/functions without memoization

### Custom Comparison Function

```tsx
const ExpensiveComponent = memo(
  function ExpensiveComponent({ data, config }: Props) {
    // Expensive render logic
    return <Box>...</Box>;
  },
  (prevProps, nextProps) => {
    // Return true if props are equal (skip re-render)
    return (
      prevProps.data.id === nextProps.data.id &&
      prevProps.config.version === nextProps.config.version
    );
  }
);
```

## useMemo for Expensive Calculations

```tsx
import { useMemo } from 'react';

function MessageList({ messages }: { messages: Message[] }) {
  // Memoize expensive transformations
  const processedMessages = useMemo(() => {
    return messages.map(msg => ({
      ...msg,
      formattedContent: formatMarkdown(msg.content),
      timestamp: formatDate(msg.createdAt),
    }));
  }, [messages]);

  // Memoize filtering for static/dynamic separation
  const { staticMessages, dynamicMessages } = useMemo(() => ({
    staticMessages: processedMessages.filter(m => m.type === 'static'),
    dynamicMessages: processedMessages.filter(m => m.type === 'dynamic'),
  }), [processedMessages]);

  return (
    <>
      <Static items={staticMessages}>
        {msg => <Message key={msg.id} {...msg} />}
      </Static>
      {dynamicMessages.map(msg => (
        <Message key={msg.id} {...msg} />
      ))}
    </>
  );
}
```

## useCallback for Event Handlers

```tsx
import { useCallback } from 'react';

function InputComponent({ onSubmit }: { onSubmit: (text: string) => void }) {
  // Memoize callback to prevent child re-renders
  const handleSubmit = useCallback((value: string) => {
    onSubmit(value.trim());
  }, [onSubmit]);

  return <TextInput onSubmit={handleSubmit} />;
}
```

## Avoiding Common Performance Pitfalls

### 1. Inline Object Creation

```tsx
// BAD: Creates new object every render, breaks memoization
<Message style={{ color: 'blue' }} />

// GOOD: Define outside or memoize
const blueStyle = { color: 'blue' };
<Message style={blueStyle} />

// Or with useMemo for dynamic styles
const style = useMemo(() => ({
  color: isActive ? 'blue' : 'gray'
}), [isActive]);
```

### 2. Inline Function Props

```tsx
// BAD: New function every render
<Button onClick={() => handleClick(id)} />

// GOOD: Memoized callback
const handleButtonClick = useCallback(() => {
  handleClick(id);
}, [id]);
<Button onClick={handleButtonClick} />
```

### 3. Array/Object in Dependencies

```tsx
// BAD: Array identity changes every render
const items = messages.filter(m => m.visible);
useEffect(() => {
  // This runs every render!
}, [items]);

// GOOD: Memoize the derived array
const items = useMemo(
  () => messages.filter(m => m.visible),
  [messages]
);
```

## Component Structure Optimization

### Lift State Down

```tsx
// BAD: State at top causes everything to re-render
function App() {
  const [cursor, setCursor] = useState({ x: 0, y: 0 });

  return (
    <Box>
      <ExpensiveHeader />           {/* Re-renders unnecessarily */}
      <Cursor position={cursor} />
      <ExpensiveFooter />           {/* Re-renders unnecessarily */}
    </Box>
  );
}

// GOOD: Isolate frequently updating state
function App() {
  return (
    <Box>
      <ExpensiveHeader />           {/* Stable */}
      <CursorContainer />           {/* Contains its own state */}
      <ExpensiveFooter />           {/* Stable */}
    </Box>
  );
}

function CursorContainer() {
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  return <Cursor position={cursor} />;
}
```

### Children as Props Pattern

```tsx
// Layout component that doesn't need to re-render children
function Layout({ children }: { children: React.ReactNode }) {
  const [shouldNeverUpdate] = useState(true);

  return (
    <Box flexDirection="column">
      {children}
    </Box>
  );
}

// Children are passed by reference, not re-created
<Layout>
  <ExpensiveChild />
</Layout>
```

## Ink-Specific Optimizations

### 1. Use Static for Finalized Content

```tsx
import { Static } from 'ink';

// Content in Static is rendered once and never updated
<Static items={completedTasks}>
  {task => <TaskResult key={task.id} task={task} />}
</Static>
```

### 2. Minimize Dynamic Content Size

```tsx
// Keep the dynamic (frequently updating) portion small
function StreamingUI() {
  return (
    <Box flexDirection="column">
      {/* Large static content */}
      <Static items={history}>
        {item => <HistoryItem key={item.id} {...item} />}
      </Static>

      {/* Small dynamic portion */}
      <Box height={3}>
        <StreamingIndicator />
      </Box>
    </Box>
  );
}
```

### 3. Batch Updates with requestAnimationFrame

```tsx
const pendingUpdate = useRef<string>('');
const rafId = useRef<number | null>(null);

const batchedSetContent = (newContent: string) => {
  pendingUpdate.current = newContent;

  if (rafId.current === null) {
    rafId.current = requestAnimationFrame(() => {
      setContent(pendingUpdate.current);
      rafId.current = null;
    });
  }
};
```

## Sources

- [React.memo Documentation](https://react.dev/reference/react/memo)
- [Reactive UI with Ink and Yoga](https://gerred.github.io/building-an-agentic-system/ink-yoga-reactive-ui.html)
- [Kent C. Dodds - When to useMemo and useCallback](https://kentcdodds.com/blog/usememo-and-usecallback)
- [Ink 3 Release Notes](https://vadimdemedes.com/posts/ink-3)
