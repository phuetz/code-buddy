# Layout Stability in React Ink

## The Static Component

The `<Static>` component is Ink's primary solution for layout stability. It permanently renders content above the dynamic UI, ensuring completed content never causes layout shifts.

### How Static Works

```tsx
import { Static, Box, Text } from 'ink';

function App({ logs }: { logs: string[] }) {
  return (
    <>
      {/* Static content - rendered once, never re-rendered */}
      <Static items={logs}>
        {(log, index) => (
          <Text key={index}>{log}</Text>
        )}
      </Static>

      {/* Dynamic content below - updates freely */}
      <Box>
        <Text>Current status: processing...</Text>
      </Box>
    </>
  );
}
```

### Key Characteristics

1. **Permanent Rendering**: Once rendered, Static content cannot be updated
2. **Above Dynamic Content**: Static content appears above all other UI elements
3. **Performance**: Acts like a virtual list - only renders new items
4. **Use Cases**: Completed tasks, logs, test results, generated pages

### Real-World Examples

- **Tap** (test runner): Displays completed tests in Static
- **Gatsby**: Shows generated pages in Static while displaying live progress bar
- **Jest**: Logs completed test results permanently

## Preventing Layout Shifts

### 1. Reserve Space for Dynamic Content

```tsx
function StatusBar() {
  const [status, setStatus] = useState('');

  return (
    <Box height={1} width="100%">
      {/* Fixed height prevents shifts when content changes */}
      <Text>{status || ' '}</Text>
    </Box>
  );
}
```

### 2. Fixed Dimensions for Containers

```tsx
function ProgressContainer({ children }: { children: React.ReactNode }) {
  return (
    <Box
      flexDirection="column"
      height={5}           // Fixed height
      width="100%"
      overflow="hidden"    // Prevent content from pushing layout
    >
      {children}
    </Box>
  );
}
```

### 3. Consistent Element Counts

```tsx
// BAD: Conditional rendering causes layout shifts
function BadStatus({ isLoading }: { isLoading: boolean }) {
  return (
    <Box>
      {isLoading && <Spinner />}  {/* Appears/disappears */}
      <Text>Status</Text>
    </Box>
  );
}

// GOOD: Always render, just change visibility/content
function GoodStatus({ isLoading }: { isLoading: boolean }) {
  return (
    <Box>
      <Box width={3}>
        {isLoading ? <Spinner /> : <Text> </Text>}
      </Box>
      <Text>Status</Text>
    </Box>
  );
}
```

## Responsive Layouts with useStdout

Handle terminal resize gracefully:

```tsx
import { useStdout, Box } from 'ink';
import { useState, useEffect } from 'react';

function ResponsiveLayout({ children }: { children: React.ReactNode }) {
  const { stdout } = useStdout();
  const [dimensions, setDimensions] = useState({
    width: stdout?.columns ?? 80,
    height: stdout?.rows ?? 24,
  });

  useEffect(() => {
    const handleResize = () => {
      setDimensions({
        width: stdout?.columns ?? 80,
        height: stdout?.rows ?? 24,
      });
    };

    stdout?.on('resize', handleResize);
    return () => {
      stdout?.off('resize', handleResize);
    };
  }, [stdout]);

  return (
    <Box
      flexDirection="column"
      width={dimensions.width}
      height={dimensions.height}
    >
      {children}
    </Box>
  );
}
```

## Flexbox Patterns for Stability

### Fixed Header/Footer with Flexible Content

```tsx
function AppLayout() {
  return (
    <Box flexDirection="column" height="100%">
      {/* Fixed header */}
      <Box height={3} borderStyle="single">
        <Text bold>Header</Text>
      </Box>

      {/* Flexible content area */}
      <Box flexGrow={1} flexDirection="column">
        <Content />
      </Box>

      {/* Fixed footer */}
      <Box height={2}>
        <StatusBar />
      </Box>
    </Box>
  );
}
```

### Sidebar Layout

```tsx
function SidebarLayout({ sidebar, main }: {
  sidebar: React.ReactNode;
  main: React.ReactNode;
}) {
  return (
    <Box flexDirection="row" height="100%">
      {/* Fixed width sidebar */}
      <Box width={30} borderStyle="single">
        {sidebar}
      </Box>

      {/* Flexible main content */}
      <Box flexGrow={1}>
        {main}
      </Box>
    </Box>
  );
}
```

## Handling Variable Content Length

### Truncation

```tsx
import { Text } from 'ink';

function TruncatedText({ text, maxWidth }: {
  text: string;
  maxWidth: number;
}) {
  const truncated = text.length > maxWidth
    ? text.slice(0, maxWidth - 3) + '...'
    : text;

  return <Text>{truncated}</Text>;
}
```

### Scrollable Container (Virtual)

```tsx
import { Box, Text, useInput } from 'ink';
import { useState } from 'react';

function ScrollableList({
  items,
  visibleCount = 10,
}: {
  items: string[];
  visibleCount?: number;
}) {
  const [scrollOffset, setScrollOffset] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setScrollOffset(Math.max(0, scrollOffset - 1));
    }
    if (key.downArrow) {
      setScrollOffset(
        Math.min(items.length - visibleCount, scrollOffset + 1)
      );
    }
  });

  const visibleItems = items.slice(
    scrollOffset,
    scrollOffset + visibleCount
  );

  return (
    <Box flexDirection="column" height={visibleCount}>
      {visibleItems.map((item, i) => (
        <Text key={scrollOffset + i}>{item}</Text>
      ))}
    </Box>
  );
}
```

## Static vs Dynamic Content Separation Pattern

```tsx
interface Message {
  id: string;
  content: string;
  isComplete: boolean;
}

function ChatUI({ messages }: { messages: Message[] }) {
  const { complete, inProgress } = useMemo(() => ({
    complete: messages.filter(m => m.isComplete),
    inProgress: messages.find(m => !m.isComplete),
  }), [messages]);

  return (
    <Box flexDirection="column">
      {/* Completed messages - stable, no layout shifts */}
      <Static items={complete}>
        {msg => <CompletedMessage key={msg.id} message={msg} />}
      </Static>

      {/* In-progress message - contained in fixed area */}
      <Box height={10} overflow="hidden">
        {inProgress && <StreamingMessage message={inProgress} />}
      </Box>

      {/* Input area - always at bottom */}
      <Box height={3} borderStyle="single">
        <TextInput placeholder="Type a message..." />
      </Box>
    </Box>
  );
}
```

## Sources

- [Ink GitHub Repository](https://github.com/vadimdemedes/ink)
- [Ink 3 Release](https://vadimdemedes.com/posts/ink-3)
- [Reactive UI with Ink and Yoga](https://gerred.github.io/building-an-agentic-system/ink-yoga-reactive-ui.html)
