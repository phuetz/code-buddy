/**
 * Professional diff renderer component with syntax highlighting
 */

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../utils/colors.js';
import crypto from 'crypto';
import { MaxSizedBox } from '../shared/max-sized-box.js';
import { highlight } from 'cli-highlight';

interface DiffLine {
  type: 'add' | 'del' | 'context' | 'hunk' | 'other';
  oldLine?: number;
  newLine?: number;
  content: string;
}

export function parseDiffWithLineNumbers(diffContent: string): DiffLine[] {
  const lines = diffContent.split('\n');
  const result: DiffLine[] = [];
  const state = { oldLine: 0, newLine: 0, inHunk: false };

  for (const line of lines) {
    const hunkInfo = parseHunkHeader(line);
    if (hunkInfo) {
      state.oldLine = hunkInfo.oldLine - 1;
      state.newLine = hunkInfo.newLine - 1;
      state.inHunk = true;
      result.push({ type: 'hunk', content: line });
      continue;
    }

    if (!state.inHunk) {
      if (shouldSkipHeader(line)) continue;
      continue;
    }

    const diffLine = processDiffLine(line, state);
    if (diffLine) {
      result.push(diffLine);
    }
  }
  return result;
}

function parseHunkHeader(line: string): { oldLine: number; newLine: number } | null {
  const hunkHeaderRegex = /^@@ -(\d+),?\d* \+(\d+),?\d* @@/;
  const match = line.match(hunkHeaderRegex);
  if (match) {
    return {
      oldLine: parseInt(match[1], 10),
      newLine: parseInt(match[2], 10),
    };
  }
  return null;
}

function shouldSkipHeader(line: string): boolean {
  return (
    line.startsWith('--- ') ||
    line.startsWith('+++ ') ||
    line.startsWith('diff --git') ||
    line.startsWith('index ') ||
    line.startsWith('similarity index') ||
    line.startsWith('rename from') ||
    line.startsWith('rename to') ||
    line.startsWith('new file mode') ||
    line.startsWith('deleted file mode')
  );
}

function processDiffLine(line: string, state: { oldLine: number; newLine: number }): DiffLine | null {
  if (line.startsWith('+')) {
    state.newLine++;
    return {
      type: 'add',
      newLine: state.newLine,
      content: line.substring(1),
    };
  }
  if (line.startsWith('-')) {
    state.oldLine++;
    return {
      type: 'del',
      oldLine: state.oldLine,
      content: line.substring(1),
    };
  }
  if (line.startsWith(' ')) {
    state.oldLine++;
    state.newLine++;
    return {
      type: 'context',
      oldLine: state.oldLine,
      newLine: state.newLine,
      content: line.substring(1),
    };
  }
  if (line.startsWith('\\')) {
    return { type: 'other', content: line };
  }
  return null;
}

interface DiffRendererProps {
  diffContent: string;
  filename?: string;
  tabWidth?: number;
  availableTerminalHeight?: number;
  terminalWidth?: number;
}

const DEFAULT_TAB_WIDTH = 4; // Spaces per tab for normalization

export const DiffRenderer = React.memo(function DiffRenderer({
  diffContent,
  filename,
  tabWidth = DEFAULT_TAB_WIDTH,
  availableTerminalHeight,
  terminalWidth = 80,
}: DiffRendererProps): React.ReactElement {
  // Memoize parsed content to avoid recomputation
  const parsedLines = useMemo(() => {
    if (!diffContent || typeof diffContent !== 'string') {
      return [];
    }

    // Strip the first summary line (e.g. "Updated file.txt with 1 addition and 2 removals")
    const lines = diffContent.split('\n');
    const firstLine = lines[0];
    let actualDiff = diffContent;

    if (firstLine && (firstLine.startsWith('Updated ') || firstLine.startsWith('Created '))) {
      actualDiff = lines.slice(1).join('\n');
    }

    return parseDiffWithLineNumbers(actualDiff);
  }, [diffContent]);

  if (!diffContent || typeof diffContent !== 'string') {
    return <Text color={Colors.AccentYellow}>No diff content.</Text>;
  }

  if (parsedLines.length === 0) {
    return <Text dimColor>No changes detected.</Text>;
  }

  // Always render as diff format to show line numbers and + signs
  const renderedOutput = renderDiffContent(
    parsedLines,
    filename,
    tabWidth,
    availableTerminalHeight,
    terminalWidth
  );

  return <>{renderedOutput}</>;
});

const renderDiffContent = (
  parsedLines: DiffLine[],
  filename: string | undefined,
  tabWidth = DEFAULT_TAB_WIDTH,
  availableTerminalHeight: number | undefined,
  terminalWidth: number
) => {
  // Detect language for syntax highlighting
  const language = getLanguageFromFilename(filename);

  // 1. Normalize whitespace (replace tabs with spaces) *before* further processing
  const normalizedLines = parsedLines.map((line) => ({
    ...line,
    content: line.content.replace(/\t/g, ' '.repeat(tabWidth)),
  }));

  // Filter out non-displayable lines (hunks, potentially 'other') using the normalized list
  const displayableLines = normalizedLines.filter((l) => l.type !== 'hunk' && l.type !== 'other');

  if (displayableLines.length === 0) {
    return <Text dimColor>No changes detected.</Text>;
  }

  // Calculate the minimum indentation across all displayable lines
  let baseIndentation = Infinity; // Start high to find the minimum
  for (const line of displayableLines) {
    // Only consider lines with actual content for indentation calculation
    if (line.content.trim() === '') continue;

    const firstCharIndex = line.content.search(/\S/); // Find index of first non-whitespace char
    const currentIndent = firstCharIndex === -1 ? 0 : firstCharIndex; // Indent is 0 if no non-whitespace found
    baseIndentation = Math.min(baseIndentation, currentIndent);
  }
  // If baseIndentation remained Infinity (e.g., no displayable lines with content), default to 0
  if (!isFinite(baseIndentation)) {
    baseIndentation = 0;
  }

  const key = filename
    ? `diff-box-${filename}`
    : `diff-box-${crypto.createHash('sha1').update(JSON.stringify(parsedLines)).digest('hex')}`;

  const MAX_CONTEXT_LINES_WITHOUT_GAP = 5;
  let lastLineNumber: number | null = null;

  return (
    <MaxSizedBox maxHeight={availableTerminalHeight} maxWidth={terminalWidth} key={key}>
      {displayableLines.map((line, index) => {
        const { element, newLastLineNumber } = renderDiffLine(
          line,
          index,
          lastLineNumber,
          MAX_CONTEXT_LINES_WITHOUT_GAP,
          terminalWidth,
          baseIndentation,
          language
        );
        lastLineNumber = newLastLineNumber;
        return element;
      })}
    </MaxSizedBox>
  );
};

function renderDiffLine(
  line: DiffLine,
  index: number,
  lastLineNumber: number | null,
  maxContextLines: number,
  terminalWidth: number,
  baseIndentation: number,
  language: string | null
): { element: React.ReactNode; newLastLineNumber: number | null } {
  // Determine the relevant line number for gap calculation based on type
  let relevantLineNumberForGapCalc: number | null = null;
  if (line.type === 'add' || line.type === 'context') {
    relevantLineNumberForGapCalc = line.newLine ?? null;
  } else if (line.type === 'del') {
    // For deletions, the gap is typically in relation to the original file's line numbering
    relevantLineNumberForGapCalc = line.oldLine ?? null;
  }

  const elements: React.ReactNode[] = [];

  if (
    lastLineNumber !== null &&
    relevantLineNumberForGapCalc !== null &&
    relevantLineNumberForGapCalc > lastLineNumber + maxContextLines + 1
  ) {
    elements.push(
      <Box key={`gap-${index}`}>
        <Text wrap="truncate">{'═'.repeat(terminalWidth)}</Text>
      </Box>
    );
  }

  const lineKey = `diff-line-${index}`;
  let gutterNumStr = '';
  let backgroundColor: string | undefined = undefined;
  let prefixSymbol = ' ';
  let dim = false;
  let newLastLineNumber = lastLineNumber;

  switch (line.type) {
    case 'add':
      gutterNumStr = (line.newLine ?? '').toString();
      backgroundColor = '#86efac'; // Light green for additions
      prefixSymbol = '+';
      newLastLineNumber = line.newLine ?? null;
      break;
    case 'del':
      gutterNumStr = (line.oldLine ?? '').toString();
      backgroundColor = 'redBright'; // Light red for deletions
      prefixSymbol = '-';
      // For deletions, update lastLineNumber based on oldLine if it's advancing.
      if (line.oldLine !== undefined) {
        newLastLineNumber = line.oldLine;
      }
      break;
    case 'context':
      gutterNumStr = (line.newLine ?? '').toString();
      dim = true;
      prefixSymbol = ' ';
      newLastLineNumber = line.newLine ?? null;
      break;
    default:
      return { element: null, newLastLineNumber };
  }

  const displayContent = line.content.substring(baseIndentation);

  // Apply syntax highlighting for context lines
  const highlightedContent =
    line.type === 'context' && language
      ? highlightCode(displayContent, language)
      : displayContent;

  elements.push(
    <Box key={lineKey} flexDirection="row">
      <Text color={Colors.Gray} dimColor={dim}>
        {gutterNumStr.padEnd(4)}
      </Text>
      <Text
        color={backgroundColor ? '#000000' : undefined}
        backgroundColor={backgroundColor}
        dimColor={!backgroundColor && dim}
      >
        {prefixSymbol}{' '}
      </Text>
      <Text
        color={backgroundColor ? '#000000' : undefined}
        backgroundColor={backgroundColor}
        dimColor={!backgroundColor && dim}
        wrap="wrap"
      >
        {highlightedContent}
      </Text>
    </Box>
  );

  return { element: <React.Fragment key={`frag-${index}`}>{elements}</React.Fragment>, newLastLineNumber };
}


// Language detection utility for syntax highlighting
const getLanguageFromFilename = (filename: string | undefined): string | null => {
  if (!filename) return null;

  const extension = filename.split('.').pop()?.toLowerCase() || '';
  const languageMap: { [key: string]: string } = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    json: 'json',
    css: 'css',
    scss: 'scss',
    less: 'less',
    html: 'html',
    htm: 'html',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    md: 'markdown',
    yaml: 'yaml',
    yml: 'yaml',
    txt: 'plaintext',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    php: 'php',
    sql: 'sql',
    swift: 'swift',
    kt: 'kotlin',
    scala: 'scala',
    r: 'r',
    lua: 'lua',
    dockerfile: 'dockerfile',
    makefile: 'makefile',
    xml: 'xml',
    toml: 'toml',
    ini: 'ini',
    env: 'bash',
  };

  // Handle special filenames
  const lowerFilename = filename.toLowerCase();
  if (lowerFilename === 'dockerfile') return 'dockerfile';
  if (lowerFilename === 'makefile') return 'makefile';
  if (lowerFilename.endsWith('.env')) return 'bash';

  return languageMap[extension] || null;
};

/**
 * Apply syntax highlighting to code content
 */
const highlightCode = (content: string, language: string | null): string => {
  if (!language || !content.trim()) return content;

  try {
    return highlight(content, { language, ignoreIllegals: true });
  } catch {
    return content;
  }
};
