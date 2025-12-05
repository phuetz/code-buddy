/**
 * Tests for markdown-renderer table functionality
 */

// Mock external dependencies that use ESM
jest.mock('ink', () => ({
  Text: 'Text',
  Box: 'Box',
}));

jest.mock('marked', () => ({
  marked: {
    setOptions: jest.fn(),
    parse: jest.fn((content: string) => content),
  },
}));

jest.mock('marked-terminal', () => jest.fn());

jest.mock('cli-highlight', () => ({
  highlight: jest.fn((code: string) => code),
}));

import {
  findTables,
  parseMarkdownTable,
  renderTableCustom,
  splitContent,
} from '../src/ui/utils/markdown-renderer.js';

describe('Markdown Renderer - Table Detection', () => {
  describe('findTables', () => {
    it('should find a complete simple table', () => {
      const content = `| Header1 | Header2 |
|---------|---------|
| Cell1   | Cell2   |`;

      const tables = findTables(content);
      expect(tables).toHaveLength(1);
      expect(tables[0].isComplete).toBe(true);
      expect(tables[0].startLine).toBe(0);
      expect(tables[0].endLine).toBe(3);
    });

    it('should find multiple tables', () => {
      const content = `Some text

| A | B |
|---|---|
| 1 | 2 |

More text

| C | D |
|---|---|
| 3 | 4 |`;

      const tables = findTables(content);
      expect(tables).toHaveLength(2);
      expect(tables[0].isComplete).toBe(true);
      expect(tables[1].isComplete).toBe(true);
    });

    it('should detect incomplete table (no data rows)', () => {
      const content = `| Header1 | Header2 |
|---------|---------|`;

      const tables = findTables(content);
      expect(tables).toHaveLength(1);
      expect(tables[0].isComplete).toBe(false);
    });

    it('should detect incomplete table (missing closing pipe)', () => {
      const content = `| Header1 | Header2 |
|---------|---------|
| Cell1   | Cell2`;

      const tables = findTables(content);
      expect(tables).toHaveLength(1);
      expect(tables[0].isComplete).toBe(false);
    });

    it('should handle table with alignment markers', () => {
      const content = `| Left | Center | Right |
|:-----|:------:|------:|
| L    | C      | R     |`;

      const tables = findTables(content);
      expect(tables).toHaveLength(1);
      expect(tables[0].isComplete).toBe(true);
      expect(tables[0].data?.alignments).toEqual(['left', 'center', 'right']);
    });

    it('should not detect non-table content', () => {
      const content = `This is not a table
Just some text with | pipes | in it
But no proper structure`;

      const tables = findTables(content);
      expect(tables).toHaveLength(0);
    });

    it('should handle table at end of content without trailing newline', () => {
      const content = `| A | B |
|---|---|
| 1 | 2 |`;

      const tables = findTables(content);
      expect(tables).toHaveLength(1);
      expect(tables[0].isComplete).toBe(true);
    });

    it('should handle empty content', () => {
      const tables = findTables('');
      expect(tables).toHaveLength(0);
    });
  });

  describe('parseMarkdownTable', () => {
    it('should parse headers correctly', () => {
      const lines = [
        '| Name | Age | City |',
        '|------|-----|------|',
        '| John | 30  | NYC  |',
      ];

      const data = parseMarkdownTable(lines);
      expect(data).not.toBeNull();
      expect(data?.headers).toEqual(['Name', 'Age', 'City']);
    });

    it('should parse rows as objects with header keys', () => {
      const lines = [
        '| Name | Age |',
        '|------|-----|',
        '| John | 30  |',
        '| Jane | 25  |',
      ];

      const data = parseMarkdownTable(lines);
      expect(data).not.toBeNull();
      expect(data?.rows).toHaveLength(2);
      expect(data?.rows[0]).toEqual({ Name: 'John', Age: '30' });
      expect(data?.rows[1]).toEqual({ Name: 'Jane', Age: '25' });
    });

    it('should parse alignment correctly', () => {
      const lines = [
        '| Left | Center | Right |',
        '|:-----|:------:|------:|',
        '| L    | C      | R     |',
      ];

      const data = parseMarkdownTable(lines);
      expect(data?.alignments).toEqual(['left', 'center', 'right']);
    });

    it('should handle missing cells', () => {
      const lines = [
        '| A | B | C |',
        '|---|---|---|',
        '| 1 |   |   |',
      ];

      const data = parseMarkdownTable(lines);
      expect(data?.rows[0]).toEqual({ A: '1', B: '', C: '' });
    });

    it('should return null for invalid table (less than 3 lines)', () => {
      const lines = ['| A | B |', '|---|---|'];
      const data = parseMarkdownTable(lines);
      expect(data).toBeNull();
    });

    it('should return null for table without separator', () => {
      const lines = [
        '| A | B |',
        '| 1 | 2 |',
        '| 3 | 4 |',
      ];
      const data = parseMarkdownTable(lines);
      expect(data).toBeNull();
    });
  });

  describe('renderTableCustom', () => {
    it('should render a simple table with borders', () => {
      const data = {
        headers: ['A', 'B'],
        rows: [{ A: '1', B: '2' }],
        alignments: ['left' as const, 'left' as const],
      };

      const rendered = renderTableCustom(data);

      // Check for box-drawing characters
      expect(rendered).toContain('┌');
      expect(rendered).toContain('┐');
      expect(rendered).toContain('└');
      expect(rendered).toContain('┘');
      expect(rendered).toContain('│');
      expect(rendered).toContain('─');
    });

    it('should include header content', () => {
      const data = {
        headers: ['Name', 'Value'],
        rows: [{ Name: 'Test', Value: '123' }],
        alignments: ['left' as const, 'left' as const],
      };

      const rendered = renderTableCustom(data);
      expect(rendered).toContain('Name');
      expect(rendered).toContain('Value');
    });

    it('should include row data', () => {
      const data = {
        headers: ['Col'],
        rows: [{ Col: 'DataValue' }],
        alignments: ['left' as const],
      };

      const rendered = renderTableCustom(data);
      expect(rendered).toContain('DataValue');
    });

    it('should handle multiple rows', () => {
      const data = {
        headers: ['X'],
        rows: [{ X: 'Row1' }, { X: 'Row2' }, { X: 'Row3' }],
        alignments: ['left' as const],
      };

      const rendered = renderTableCustom(data);
      expect(rendered).toContain('Row1');
      expect(rendered).toContain('Row2');
      expect(rendered).toContain('Row3');
    });

    it('should truncate long cell content', () => {
      const data = {
        headers: ['Short'],
        rows: [{ Short: 'A'.repeat(100) }],
        alignments: ['left' as const],
      };

      const rendered = renderTableCustom(data);
      // Should contain truncation ellipsis
      expect(rendered).toContain('…');
    });
  });

  describe('splitContent', () => {
    it('should return single text segment for content without tables', () => {
      const content = 'Just some plain text without any tables.';
      const segments = splitContent(content, false);

      expect(segments).toHaveLength(1);
      expect(segments[0].type).toBe('text');
      expect(segments[0].content).toBe(content);
    });

    it('should split content with table into segments', () => {
      const content = `Before table

| A | B |
|---|---|
| 1 | 2 |

After table`;

      const segments = splitContent(content, false);

      expect(segments).toHaveLength(3);
      expect(segments[0].type).toBe('text');
      expect(segments[1].type).toBe('table');
      expect(segments[2].type).toBe('text');
    });

    it('should mark incomplete table as pending during streaming', () => {
      // Table with only header and separator (no data rows yet)
      const content = `| A | B |
|---|---|`;

      const segments = splitContent(content, true);  // isStreaming = true

      expect(segments).toHaveLength(1);
      expect(segments[0].type).toBe('pending-table');
    });

    it('should render incomplete table as complete when not streaming', () => {
      // Table with only header and separator (no data rows)
      const content = `| A | B |
|---|---|`;

      const segments = splitContent(content, false);  // isStreaming = false

      expect(segments).toHaveLength(1);
      expect(segments[0].type).toBe('table');
    });

    it('should include tableData for complete tables', () => {
      const content = `| Name |
|------|
| Test |`;

      const segments = splitContent(content, false);

      expect(segments[0].type).toBe('table');
      expect(segments[0].tableData).toBeDefined();
      expect(segments[0].tableData?.headers).toEqual(['Name']);
    });

    it('should handle multiple tables with text between them', () => {
      const content = `Text 1

| T1 |
|----|
| A  |

Text 2

| T2 |
|----|
| B  |

Text 3`;

      const segments = splitContent(content, false);

      // Should have: text, table, text, table, text
      expect(segments).toHaveLength(5);
      expect(segments[0].type).toBe('text');
      expect(segments[1].type).toBe('table');
      expect(segments[2].type).toBe('text');
      expect(segments[3].type).toBe('table');
      expect(segments[4].type).toBe('text');
    });
  });
});

describe('Markdown Renderer - Edge Cases', () => {
  it('should handle table with special characters in cells', () => {
    const content = `| Symbol | Description |
|--------|-------------|
| <      | Less than   |
| >      | Greater     |
| &      | Ampersand   |`;

    const tables = findTables(content);
    expect(tables).toHaveLength(1);
    expect(tables[0].isComplete).toBe(true);
    expect(tables[0].data?.rows).toHaveLength(3);
  });

  it('should handle table with code in cells', () => {
    const content = `| Code | Description |
|------|-------------|
| \`fn()\` | Function call |`;

    const tables = findTables(content);
    expect(tables).toHaveLength(1);
    expect(tables[0].data?.rows[0]['Code']).toBe('`fn()`');
  });

  it('should handle very wide tables', () => {
    const longHeader = 'A'.repeat(100);
    const content = `| ${longHeader} |
|${'-'.repeat(102)}|
| Cell |`;

    const tables = findTables(content);
    expect(tables).toHaveLength(1);
  });

  it('should handle table with many columns', () => {
    const headers = Array.from({ length: 20 }, (_, i) => `C${i}`).join(' | ');
    const separator = Array.from({ length: 20 }, () => '---').join(' | ');
    const row = Array.from({ length: 20 }, (_, i) => `V${i}`).join(' | ');

    const content = `| ${headers} |
| ${separator} |
| ${row} |`;

    const tables = findTables(content);
    expect(tables).toHaveLength(1);
    expect(tables[0].data?.headers).toHaveLength(20);
  });

  it('should handle table with empty rows', () => {
    const content = `| A | B |
|---|---|
|   |   |`;

    const tables = findTables(content);
    expect(tables).toHaveLength(1);
    expect(tables[0].data?.rows[0]).toEqual({ A: '', B: '' });
  });

  it('should handle table immediately after heading', () => {
    const content = `# Title

| A |
|---|
| 1 |`;

    const tables = findTables(content);
    expect(tables).toHaveLength(1);
  });

  it('should not confuse pipe characters in code blocks', () => {
    const content = `\`\`\`bash
echo "test | grep something"
\`\`\`

| Real | Table |
|------|-------|
| Yes  | Here  |`;

    const tables = findTables(content);
    // Should only find the real table, not the pipe in the code block
    expect(tables).toHaveLength(1);
    expect(tables[0].data?.headers).toEqual(['Real', 'Table']);
  });
});
