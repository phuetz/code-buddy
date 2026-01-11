/**
 * FileAutocomplete - Autocomplete component for @ file references
 *
 * Provides file path suggestions when user types @ followed by a partial path.
 * Inspired by Mistral Vibe CLI's file reference feature.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text } from 'ink';
import fs from 'fs';
import path from 'path';
import { useTheme } from '../context/theme-context.js';

export interface FileAutocompleteProps {
  /** Current input text */
  input: string;
  /** Whether autocomplete is visible */
  visible: boolean;
  /** Currently selected index */
  selectedIndex: number;
  /** Callback when a file is selected */
  onSelect?: (filePath: string) => void;
  /** Maximum number of suggestions to show */
  maxSuggestions?: number;
}

export interface FileSuggestion {
  /** Display name */
  name: string;
  /** Full path */
  path: string;
  /** Whether it's a directory */
  isDirectory: boolean;
  /** File extension */
  extension?: string;
}

/**
 * Extract the @ reference from input
 * Returns the partial path after @ if found
 */
export function extractFileReference(input: string): { found: boolean; partial: string; startPos: number } {
  // Find the last @ that's not escaped
  const atIndex = input.lastIndexOf('@');

  if (atIndex === -1) {
    return { found: false, partial: '', startPos: -1 };
  }

  // Check if @ is at start or preceded by whitespace
  if (atIndex > 0 && !/\s/.test(input[atIndex - 1])) {
    return { found: false, partial: '', startPos: -1 };
  }

  const partial = input.slice(atIndex + 1);

  // Don't show autocomplete if there's a space after the partial path
  // (user has moved on to something else)
  if (partial.includes(' ')) {
    return { found: false, partial: '', startPos: -1 };
  }

  return { found: true, partial, startPos: atIndex };
}

/**
 * Get file suggestions based on partial path
 */
export function getFileSuggestions(partial: string, cwd: string = process.cwd()): FileSuggestion[] {
  const suggestions: FileSuggestion[] = [];

  try {
    let searchDir: string;
    let prefix: string;

    if (partial === '' || partial === '.') {
      // List current directory
      searchDir = cwd;
      prefix = '';
    } else if (partial.startsWith('/')) {
      // Absolute path
      const lastSlash = partial.lastIndexOf('/');
      searchDir = partial.slice(0, lastSlash + 1) || '/';
      prefix = partial.slice(lastSlash + 1);
    } else if (partial.includes('/')) {
      // Relative path with directories
      const lastSlash = partial.lastIndexOf('/');
      searchDir = path.join(cwd, partial.slice(0, lastSlash + 1));
      prefix = partial.slice(lastSlash + 1);
    } else {
      // Just a filename prefix in current directory
      searchDir = cwd;
      prefix = partial;
    }

    if (!fs.existsSync(searchDir)) {
      return suggestions;
    }

    const entries = fs.readdirSync(searchDir, { withFileTypes: true });
    const lowerPrefix = prefix.toLowerCase();

    for (const entry of entries) {
      // Skip hidden files unless prefix starts with .
      if (entry.name.startsWith('.') && !prefix.startsWith('.')) {
        continue;
      }

      // Filter by prefix
      if (!entry.name.toLowerCase().startsWith(lowerPrefix)) {
        continue;
      }

      const fullPath = path.join(searchDir, entry.name);
      const relativePath = path.relative(cwd, fullPath);
      const ext = path.extname(entry.name).toLowerCase();

      suggestions.push({
        name: entry.name,
        path: relativePath.startsWith('..') ? fullPath : relativePath,
        isDirectory: entry.isDirectory(),
        extension: ext || undefined,
      });
    }

    // Sort: directories first, then by name
    suggestions.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

  } catch {
    // Ignore filesystem errors
  }

  return suggestions;
}

/**
 * Get icon for file type
 */
function getFileIcon(suggestion: FileSuggestion): string {
  if (suggestion.isDirectory) {
    return '\uD83D\uDCC1'; // folder
  }

  // File type icons based on extension
  const iconMap: Record<string, string> = {
    '.ts': '\uD83D\uDCC4',    // TypeScript
    '.tsx': '\u269B\uFE0F',   // React TSX
    '.js': '\uD83D\uDFE8',    // JavaScript
    '.jsx': '\u269B\uFE0F',   // React JSX
    '.json': '{}',
    '.md': '\uD83D\uDCDD',    // Markdown
    '.py': '\uD83D\uDC0D',    // Python
    '.rs': '\uD83E\uDD80',    // Rust
    '.go': '\uD83D\uDC39',    // Go
    '.sh': '\uD83D\uDCDC',    // Shell
    '.yml': '\u2699\uFE0F',   // YAML
    '.yaml': '\u2699\uFE0F',
    '.css': '\uD83C\uDFA8',   // CSS
    '.scss': '\uD83C\uDFA8',
    '.html': '\uD83C\uDF10',  // HTML
    '.sql': '\uD83D\uDDC3\uFE0F', // SQL
    '.txt': '\uD83D\uDCC4',   // Text
  };

  return iconMap[suggestion.extension || ''] || '\uD83D\uDCC4';
}

/**
 * FileAutocomplete component
 */
export const FileAutocomplete = React.memo(function FileAutocomplete({
  input,
  visible,
  selectedIndex,
  maxSuggestions = 8,
}: FileAutocompleteProps) {
  const { colors } = useTheme();
  const [suggestions, setSuggestions] = useState<FileSuggestion[]>([]);

  // Extract file reference from input
  const { found, partial } = useMemo(() => extractFileReference(input), [input]);

  // Update suggestions when partial changes
  useEffect(() => {
    if (found && visible) {
      const newSuggestions = getFileSuggestions(partial);
      setSuggestions(newSuggestions.slice(0, maxSuggestions));
    } else {
      setSuggestions([]);
    }
  }, [found, partial, visible, maxSuggestions]);

  if (!visible || !found || suggestions.length === 0) {
    return null;
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={colors.borderActive}
      marginTop={1}
      paddingX={1}
    >
      <Text color={colors.textMuted} dimColor>
        File suggestions (Tab to select):
      </Text>
      {suggestions.map((suggestion, index) => {
        const isSelected = index === selectedIndex;
        const icon = getFileIcon(suggestion);
        const suffix = suggestion.isDirectory ? '/' : '';

        return (
          <Box key={suggestion.path}>
            <Text
              color={isSelected ? colors.primary : colors.text}
              backgroundColor={isSelected ? colors.backgroundAlt : undefined}
              bold={isSelected}
            >
              {isSelected ? '> ' : '  '}
              {icon} {suggestion.name}{suffix}
            </Text>
            <Text color={colors.textMuted} dimColor>
              {' '}{suggestion.path}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
});

export default FileAutocomplete;
