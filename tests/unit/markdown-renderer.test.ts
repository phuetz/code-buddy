/**
 * Unit tests for MarkdownRenderer utility functions
 * Tests table parsing, content splitting, and rendering logic
 */

// Note: We test the utility functions exported from markdown-renderer.tsx
// The React components require a different testing approach with React Testing Library

import {
  findTables,
  parseMarkdownTable,
  renderTableCustom,
  splitContent,
} from '../../src/ui/utils/markdown-renderer';

describe('Markdown Renderer Utilities', () => {
  describe('parseMarkdownTable', () => {
    it('should parse simple table', () => {
      const tableLines = [
        '| Name | Age |',
        '| --- | --- |',
        '| Alice | 25 |',
        '| Bob | 30 |',
      ];

      const result = parseMarkdownTable(tableLines);

      expect(result).not.toBeNull();
      expect(result?.headers).toEqual(['Name', 'Age']);
      expect(result?.rows.length).toBe(2);
      expect(result?.rows[0]).toEqual({ Name: 'Alice', Age: '25' });
      expect(result?.rows[1]).toEqual({ Name: 'Bob', Age: '30' });
    });

    it('should return null for table with less than 3 lines', () => {
      const tableLines = [
        '| Name | Age |',
        '| --- | --- |',
      ];

      const result = parseMarkdownTable(tableLines);

      expect(result).toBeNull();
    });

    it('should return null for empty headers', () => {
      const tableLines = [
        '| | |',
        '| --- | --- |',
        '| Alice | 25 |',
      ];

      const result = parseMarkdownTable(tableLines);

      expect(result).toBeNull();
    });

    it('should return null when separator has no dashes', () => {
      const tableLines = [
        '| Name | Age |',
        '| | |',
        '| Alice | 25 |',
      ];

      const result = parseMarkdownTable(tableLines);

      expect(result).toBeNull();
    });

    it('should parse left alignment', () => {
      const tableLines = [
        '| Name | Age |',
        '| :--- | :--- |',
        '| Alice | 25 |',
      ];

      const result = parseMarkdownTable(tableLines);

      expect(result?.alignments).toEqual(['left', 'left']);
    });

    it('should parse right alignment', () => {
      const tableLines = [
        '| Name | Age |',
        '| ---: | ---: |',
        '| Alice | 25 |',
      ];

      const result = parseMarkdownTable(tableLines);

      expect(result?.alignments).toEqual(['right', 'right']);
    });

    it('should parse center alignment', () => {
      const tableLines = [
        '| Name | Age |',
        '| :---: | :---: |',
        '| Alice | 25 |',
      ];

      const result = parseMarkdownTable(tableLines);

      expect(result?.alignments).toEqual(['center', 'center']);
    });

    it('should parse mixed alignments', () => {
      const tableLines = [
        '| Left | Center | Right |',
        '| :--- | :---: | ---: |',
        '| A | B | C |',
      ];

      const result = parseMarkdownTable(tableLines);

      expect(result?.alignments).toEqual(['left', 'center', 'right']);
    });

    it('should handle missing cells in data rows', () => {
      const tableLines = [
        '| A | B | C |',
        '| --- | --- | --- |',
        '| 1 | | |',
      ];

      const result = parseMarkdownTable(tableLines);

      expect(result?.rows[0]).toEqual({ A: '1', B: '', C: '' });
    });

    it('should skip invalid data rows', () => {
      const tableLines = [
        '| Name | Age |',
        '| --- | --- |',
        '| Alice | 25 |',
        'Not a valid row',
        '| Bob | 30 |',
      ];

      const result = parseMarkdownTable(tableLines);

      expect(result?.rows.length).toBe(2);
    });
  });

  describe('findTables', () => {
    it('should find single table in content', () => {
      const content = `
Some text before

| Name | Age |
| --- | --- |
| Alice | 25 |

Some text after
`;

      const tables = findTables(content);

      expect(tables.length).toBe(1);
      expect(tables[0].isComplete).toBe(true);
    });

    it('should find multiple tables', () => {
      const content = `
| Table 1 |
| --- |
| Row 1 |

Some text between

| Table 2 |
| --- |
| Row 2 |
`;

      const tables = findTables(content);

      expect(tables.length).toBe(2);
    });

    it('should return empty for no tables', () => {
      const content = 'Just some regular text without tables';

      const tables = findTables(content);

      expect(tables.length).toBe(0);
    });

    it('should detect incomplete table', () => {
      const content = `
| Name | Age |
| --- | --- |
`;

      const tables = findTables(content);

      expect(tables.length).toBe(1);
      expect(tables[0].isComplete).toBe(false);
    });

    it('should handle table at start of content', () => {
      const content = `| Name |
| --- |
| Alice |`;

      const tables = findTables(content);

      expect(tables.length).toBe(1);
    });

    it('should handle table at end of content', () => {
      const content = `Some text

| Name |
| --- |
| Alice |`;

      const tables = findTables(content);

      expect(tables.length).toBe(1);
    });

    it('should track table line positions', () => {
      const content = `Line 0
Line 1
| Name |
| --- |
| Alice |
Line 5`;

      const tables = findTables(content);

      expect(tables[0].startLine).toBe(2);
      expect(tables[0].endLine).toBe(5);
    });

    it('should store raw table content', () => {
      const tableContent = `| Name |
| --- |
| Alice |`;
      const content = `Before\n${tableContent}\nAfter`;

      const tables = findTables(content);

      expect(tables[0].raw).toBe(tableContent);
    });

    it('should not detect table without separator', () => {
      const content = `
| This is not |
| a valid table |
| without separator |
`;

      const tables = findTables(content);

      expect(tables.length).toBe(0);
    });

    it('should handle mismatched column counts', () => {
      const content = `
| A | B | C |
| --- | --- |
| 1 | 2 | 3 |
`;

      const tables = findTables(content);

      // Should not detect as valid table due to column mismatch
      expect(tables.length).toBe(0);
    });
  });

  describe('splitContent', () => {
    it('should return single text segment when no tables', () => {
      const content = 'Just some text without tables';

      const segments = splitContent(content, false);

      expect(segments.length).toBe(1);
      expect(segments[0].type).toBe('text');
      expect(segments[0].content).toBe(content);
    });

    it('should split content with table in middle', () => {
      const content = `Before text

| Name |
| --- |
| Alice |

After text`;

      const segments = splitContent(content, false);

      expect(segments.length).toBe(3);
      expect(segments[0].type).toBe('text');
      expect(segments[1].type).toBe('table');
      expect(segments[2].type).toBe('text');
    });

    it('should include table data when available', () => {
      const content = `| Name |
| --- |
| Alice |`;

      const segments = splitContent(content, false);

      expect(segments[0].type).toBe('table');
      expect(segments[0].tableData).toBeDefined();
      expect(segments[0].tableData?.headers).toEqual(['Name']);
    });

    it('should mark incomplete tables as pending during streaming', () => {
      const content = `| Name |
| --- |`;

      const segments = splitContent(content, true);

      expect(segments[0].type).toBe('pending-table');
    });

    it('should mark incomplete tables as table when not streaming', () => {
      const content = `| Name |
| --- |`;

      const segments = splitContent(content, false);

      expect(segments[0].type).toBe('table');
    });

    it('should handle multiple tables', () => {
      const content = `| A |
| --- |
| 1 |

Text

| B |
| --- |
| 2 |`;

      const segments = splitContent(content, false);

      expect(segments.length).toBe(3);
      expect(segments[0].type).toBe('table');
      expect(segments[1].type).toBe('text');
      expect(segments[2].type).toBe('table');
    });

    it('should skip empty text segments', () => {
      const content = `| A |
| --- |
| 1 |
| B |
| --- |
| 2 |`;

      const segments = splitContent(content, false);

      // Should not include empty text between tables
      const textSegments = segments.filter((s) => s.type === 'text');
      expect(textSegments.every((s) => s.content.trim().length > 0)).toBe(true);
    });
  });

  describe('renderTableCustom', () => {
    it('should render table with Unicode borders', () => {
      const data = {
        headers: ['Name', 'Age'],
        rows: [{ Name: 'Alice', Age: '25' }],
        alignments: ['left' as const, 'left' as const],
      };

      const rendered = renderTableCustom(data);

      // Check for box-drawing characters
      expect(rendered).toContain('\u250c'); // top-left
      expect(rendered).toContain('\u2510'); // top-right
      expect(rendered).toContain('\u2514'); // bottom-left
      expect(rendered).toContain('\u2518'); // bottom-right
      expect(rendered).toContain('\u2502'); // vertical
      expect(rendered).toContain('\u2500'); // horizontal
    });

    it('should include header row', () => {
      const data = {
        headers: ['Name', 'Value'],
        rows: [{ Name: 'Test', Value: '123' }],
        alignments: ['left' as const, 'left' as const],
      };

      const rendered = renderTableCustom(data);

      expect(rendered).toContain('Name');
      expect(rendered).toContain('Value');
    });

    it('should include data rows', () => {
      const data = {
        headers: ['Col'],
        rows: [{ Col: 'Row1' }, { Col: 'Row2' }],
        alignments: ['left' as const],
      };

      const rendered = renderTableCustom(data);

      expect(rendered).toContain('Row1');
      expect(rendered).toContain('Row2');
    });

    it('should render empty table', () => {
      const data = {
        headers: ['Empty'],
        rows: [],
        alignments: ['left' as const],
      };

      const rendered = renderTableCustom(data);

      expect(rendered).toContain('Empty');
      // Should have top and bottom borders at minimum
      expect(rendered).toContain('\u250c');
      expect(rendered).toContain('\u2514');
    });

    it('should handle long content', () => {
      const longContent = 'A'.repeat(100);
      const data = {
        headers: ['Long'],
        rows: [{ Long: longContent }],
        alignments: ['left' as const],
      };

      const rendered = renderTableCustom(data);

      // Content should be truncated with ellipsis
      expect(rendered).toContain('\u2026'); // ellipsis
    });

    it('should handle multiple columns', () => {
      const data = {
        headers: ['A', 'B', 'C', 'D'],
        rows: [{ A: '1', B: '2', C: '3', D: '4' }],
        alignments: ['left' as const, 'left' as const, 'left' as const, 'left' as const],
      };

      const rendered = renderTableCustom(data);

      expect(rendered).toContain('A');
      expect(rendered).toContain('B');
      expect(rendered).toContain('C');
      expect(rendered).toContain('D');
      expect(rendered).toContain('1');
      expect(rendered).toContain('2');
      expect(rendered).toContain('3');
      expect(rendered).toContain('4');
    });

    it('should handle empty cells', () => {
      const data = {
        headers: ['Name', 'Value'],
        rows: [{ Name: 'Test', Value: '' }],
        alignments: ['left' as const, 'left' as const],
      };

      const rendered = renderTableCustom(data);

      expect(rendered).toContain('Test');
      // Should still have proper structure
      expect(rendered.split('\n').length).toBeGreaterThan(3);
    });

    it('should include separator between header and data', () => {
      const data = {
        headers: ['Col'],
        rows: [{ Col: 'Data' }],
        alignments: ['left' as const],
      };

      const rendered = renderTableCustom(data);

      // Check for separator characters
      expect(rendered).toContain('\u251c'); // left-mid
      expect(rendered).toContain('\u2524'); // right-mid
    });
  });
});

describe('Table Detection Edge Cases', () => {
  describe('isTableRow detection', () => {
    it('should detect valid table row', () => {
      const content = '| cell1 | cell2 |';
      const tables = findTables(`${content}\n| --- | --- |\n| data | data |`);

      expect(tables.length).toBe(1);
    });

    it('should not detect row without ending pipe', () => {
      const content = '| cell1 | cell2';
      const tables = findTables(`${content}\n| --- | --- |\n| data | data |`);

      expect(tables.length).toBe(0);
    });

    it('should not detect row without starting pipe', () => {
      const content = 'cell1 | cell2 |';
      const tables = findTables(`${content}\n| --- | --- |\n| data | data |`);

      expect(tables.length).toBe(0);
    });

    it('should not detect minimal pipe row', () => {
      const content = '||';
      const tables = findTables(`${content}\n| --- |\n| data |`);

      expect(tables.length).toBe(0);
    });
  });

  describe('isTableSeparator detection', () => {
    it('should detect standard separator', () => {
      const content = `| H |
| --- |
| D |`;
      const tables = findTables(content);

      expect(tables.length).toBe(1);
    });

    it('should detect separator with colons', () => {
      const content = `| H |
| :---: |
| D |`;
      const tables = findTables(content);

      expect(tables.length).toBe(1);
    });

    it('should detect separator with spaces', () => {
      const content = `| H |
|  ---  |
| D |`;
      const tables = findTables(content);

      expect(tables.length).toBe(1);
    });

    it('should detect separator with multiple dashes', () => {
      const content = `| H |
| ---------- |
| D |`;
      const tables = findTables(content);

      expect(tables.length).toBe(1);
    });
  });

  describe('Column count matching', () => {
    it('should accept rows with same column count', () => {
      const content = `| A | B |
| --- | --- |
| 1 | 2 |
| 3 | 4 |`;
      const tables = findTables(content);

      expect(tables.length).toBe(1);
      expect(tables[0].data?.rows.length).toBe(2);
    });

    it('should accept rows with different column counts', () => {
      const content = `| A | B | C |
| --- | --- | --- |
| 1 | 2 |
| 3 | 4 | 5 |`;
      const tables = findTables(content);

      // Table should still be detected
      expect(tables.length).toBe(1);
    });
  });

  describe('Content with special characters', () => {
    it('should handle content with markdown formatting', () => {
      const content = `| **Bold** | *Italic* |
| --- | --- |
| \`code\` | [link](url) |`;
      const tables = findTables(content);

      expect(tables.length).toBe(1);
    });

    it('should handle content with numbers', () => {
      const content = `| Value |
| --- |
| 12345 |
| 67.89 |
| -100 |`;
      const tables = findTables(content);

      expect(tables.length).toBe(1);
      expect(tables[0].data?.rows.length).toBe(3);
    });

    it('should handle content with special symbols', () => {
      const content = `| Symbol |
| --- |
| !@#$%^&*() |
| <>/?\\ |`;
      const tables = findTables(content);

      expect(tables.length).toBe(1);
    });
  });

  describe('Streaming scenarios', () => {
    it('should mark partial table as pending', () => {
      // Table without complete last row
      const content = `| Name |
| --- |`;

      const segments = splitContent(content, true);

      expect(segments.some((s) => s.type === 'pending-table')).toBe(true);
    });

    it('should mark complete table as table during streaming', () => {
      const content = `| Name |
| --- |
| Complete |`;

      const segments = splitContent(content, true);

      expect(segments.some((s) => s.type === 'table')).toBe(true);
    });

    it('should handle mixed complete and incomplete tables', () => {
      const content = `| Complete |
| --- |
| Done |

| Incomplete |
| --- |`;

      const segments = splitContent(content, true);

      expect(segments.filter((s) => s.type === 'table').length).toBe(1);
      expect(segments.filter((s) => s.type === 'pending-table').length).toBe(1);
    });
  });
});

describe('Performance considerations', () => {
  it('should handle large content efficiently', () => {
    // Create content with many paragraphs
    const paragraphs = Array(100)
      .fill(null)
      .map((_, i) => `Paragraph ${i}: ${' Lorem ipsum dolor sit amet.'.repeat(10)}`)
      .join('\n\n');

    const start = Date.now();
    const tables = findTables(paragraphs);
    const duration = Date.now() - start;

    expect(tables.length).toBe(0);
    expect(duration).toBeLessThan(100); // Should complete quickly
  });

  it('should handle many tables', () => {
    const tableTemplate = `| H |
| --- |
| D |

`;
    const content = tableTemplate.repeat(50);

    const start = Date.now();
    const tables = findTables(content);
    const duration = Date.now() - start;

    expect(tables.length).toBe(50);
    expect(duration).toBeLessThan(200);
  });

  it('should handle very wide tables', () => {
    const headers = Array(20)
      .fill(null)
      .map((_, i) => `Col${i}`)
      .join(' | ');
    const separator = Array(20)
      .fill('---')
      .join(' | ');
    const data = Array(20)
      .fill(null)
      .map((_, i) => `Val${i}`)
      .join(' | ');

    const content = `| ${headers} |
| ${separator} |
| ${data} |`;

    const tables = findTables(content);

    expect(tables.length).toBe(1);
    expect(tables[0].data?.headers.length).toBe(20);
  });

  it('should handle very tall tables', () => {
    const header = '| Col |';
    const separator = '| --- |';
    const rows = Array(100)
      .fill(null)
      .map((_, i) => `| Row${i} |`)
      .join('\n');

    const content = `${header}
${separator}
${rows}`;

    const tables = findTables(content);

    expect(tables.length).toBe(1);
    expect(tables[0].data?.rows.length).toBe(100);
  });
});
