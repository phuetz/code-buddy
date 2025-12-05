# Table Rendering Best Practices for Terminal

## ink-table Component

The official `ink-table` package provides a React component for rendering tables in Ink:

```bash
npm install ink-table
```

### Basic Usage

```tsx
import Table from 'ink-table';

const data = [
  { name: 'Item 1', status: 'active', count: 42 },
  { name: 'Item 2', status: 'pending', count: 17 },
];

function MyTable() {
  return <Table data={data} />;
}
```

### TableProps API

```typescript
interface TableProps<T> {
  data: T[];                              // Array of row objects
  columns?: (keyof T)[];                  // Columns to display
  padding?: number;                       // Cell padding
  header?: (props: HeaderProps) => JSX.Element;  // Custom header
  cell?: (props: CellProps) => JSX.Element;      // Custom cell
  skeleton?: (props: SkeletonProps) => JSX.Element;  // Table skeleton
}
```

## Alternative: cli-table3

For more control over column widths and formatting:

```bash
npm install cli-table3
```

### Usage with Fixed Widths

```typescript
import Table from 'cli-table3';

const table = new Table({
  head: ['Name', 'Status', 'Count'],
  colWidths: [20, 15, 10],  // Required for word wrapping
  wordWrap: true,
});

table.push(['Item 1', 'active', '42']);
console.log(table.toString());
```

### Responsive Width Calculation

cli-table3 does not have built-in responsive width support. Calculate manually:

```typescript
import Table from 'cli-table3';

function createResponsiveTable(data: any[]) {
  const terminalWidth = process.stdout.columns || 80;
  const numColumns = Object.keys(data[0]).length;
  const padding = 3; // For borders
  const colWidth = Math.floor((terminalWidth - (numColumns * padding)) / numColumns);

  return new Table({
    colWidths: Array(numColumns).fill(colWidth),
    wordWrap: true,
  });
}
```

## Custom Table Implementation with Ink

For full control and better integration with Ink's rendering:

```tsx
import { Box, Text } from 'ink';
import React, { useMemo } from 'react';

interface Column<T> {
  key: keyof T;
  header: string;
  width?: number;
}

interface TableProps<T> {
  data: T[];
  columns: Column<T>[];
}

function CustomTable<T>({ data, columns }: TableProps<T>) {
  const columnWidths = useMemo(() => {
    return columns.map(col => {
      if (col.width) return col.width;
      // Calculate based on content
      const maxContent = Math.max(
        col.header.length,
        ...data.map(row => String(row[col.key]).length)
      );
      return Math.min(maxContent + 2, 30);
    });
  }, [data, columns]);

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box>
        {columns.map((col, i) => (
          <Box key={String(col.key)} width={columnWidths[i]}>
            <Text bold>{col.header}</Text>
          </Box>
        ))}
      </Box>

      {/* Separator */}
      <Box>
        <Text>{'─'.repeat(columnWidths.reduce((a, b) => a + b, 0))}</Text>
      </Box>

      {/* Rows */}
      {data.map((row, rowIndex) => (
        <Box key={rowIndex}>
          {columns.map((col, colIndex) => (
            <Box key={String(col.key)} width={columnWidths[colIndex]}>
              <Text>{String(row[col.key])}</Text>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}
```

## Handling Terminal Resize

```tsx
import { useStdout } from 'ink';
import { useEffect, useState } from 'react';

function useTerminalSize() {
  const { stdout } = useStdout();
  const [size, setSize] = useState({
    columns: stdout?.columns ?? 80,
    rows: stdout?.rows ?? 24,
  });

  useEffect(() => {
    const handleResize = () => {
      setSize({
        columns: stdout?.columns ?? 80,
        rows: stdout?.rows ?? 24,
      });
    };

    stdout?.on('resize', handleResize);
    return () => {
      stdout?.off('resize', handleResize);
    };
  }, [stdout]);

  return size;
}
```

## Performance Tips for Tables

1. **Memoize column calculations**: Use `useMemo` for width calculations
2. **Virtualize long lists**: Only render visible rows for large datasets
3. **Use Static for completed tables**: If table content is final, wrap in `<Static>`
4. **Limit re-renders**: Use `React.memo` for row components

## Sources

- [ink-table npm](https://www.npmjs.com/package/ink-table)
- [ink-table GitHub](https://github.com/maticzav/ink-table)
- [cli-table3 GitHub](https://github.com/cli-table/cli-table3)
