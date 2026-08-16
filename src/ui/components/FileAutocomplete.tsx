/**
 * FileAutocomplete - Autocomplete component for @ file references
 *
 * Provides project-wide fuzzy file suggestions when the user types @ followed
 * by a partial path.
 * Inspired by Mistral Vibe CLI's file reference feature.
 */

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import ignore from 'ignore';
import { useTheme } from '../context/theme-context.js';
import { fuzzyMatch } from './FuzzyPicker.js';

export interface FileAutocompleteProps {
  /** Current input text */
  input: string;
  /** Whether autocomplete is visible */
  visible: boolean;
  /** Currently selected index */
  selectedIndex: number;
  /** Callback when a file is selected */
  onSelect?: (filePath: string) => void;
  /** Precomputed suggestions from the input hook (avoids duplicate scans) */
  suggestions?: readonly FileSuggestion[];
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

interface CachedProjectIndex {
  expiresAt: number;
  suggestions: FileSuggestion[];
}

const PROJECT_INDEX_CACHE_TTL_MS = 5_000;
const MAX_PROJECT_SUGGESTIONS = 50;
const PROJECT_INDEX_IGNORES = [
  '.git',
  '.git/**',
  '**/.git/**',
  'node_modules',
  'node_modules/**',
  '**/node_modules/**',
];
const projectIndexCache = new Map<string, CachedProjectIndex>();

/** Clear the short-lived project index cache (primarily useful in tests). */
export function clearFileSuggestionCache(cwd?: string): void {
  if (cwd) {
    projectIndexCache.delete(path.resolve(cwd));
  } else {
    projectIndexCache.clear();
  }
}

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function isHiddenPath(filePath: string): boolean {
  return filePath.split('/').some((segment) => segment.startsWith('.'));
}

function queryRequestsHiddenPath(query: string): boolean {
  return query.split('/').some((segment) => segment.startsWith('.'));
}

function readProjectIndex(cwd: string): FileSuggestion[] {
  const projectRoot = path.resolve(cwd);
  const cached = projectIndexCache.get(projectRoot);
  if (cached && cached.expiresAt > Date.now()) return cached.suggestions;

  const gitignore = ignore();
  try {
    gitignore.add(fs.readFileSync(path.join(projectRoot, '.gitignore'), 'utf8'));
  } catch {
    // A project without a readable .gitignore is still safe to index.
  }

  const suggestions: FileSuggestion[] = [];
  try {
    const entries = fg.sync('**/*', {
      cwd: projectRoot,
      dot: true,
      followSymbolicLinks: false,
      ignore: PROJECT_INDEX_IGNORES,
      objectMode: true,
      onlyFiles: false,
      suppressErrors: true,
    });

    for (const entry of entries) {
      if (entry.dirent.isSymbolicLink()) continue;
      const isDirectory = entry.dirent.isDirectory();
      if (!isDirectory && !entry.dirent.isFile()) continue;

      const relativePath = toPosixPath(entry.path);
      try {
        if (gitignore.ignores(isDirectory ? `${relativePath}/` : relativePath)) continue;
      } catch {
        // Malformed ignore rules must not break the input UI.
      }

      const name = path.posix.basename(relativePath);
      const extension = isDirectory ? '' : path.posix.extname(name).toLowerCase();
      suggestions.push({
        name,
        path: relativePath,
        isDirectory,
        extension: extension || undefined,
      });
    }
  } catch {
    // An unreadable project produces no suggestions rather than breaking Ink.
  }

  projectIndexCache.set(projectRoot, {
    expiresAt: Date.now() + PROJECT_INDEX_CACHE_TTL_MS,
    suggestions,
  });
  return suggestions;
}

function scoreSuggestion(query: string, suggestion: FileSuggestion): number {
  if (!query) {
    const depth = suggestion.path.split('/').length;
    return (suggestion.isDirectory ? 500 : 1_000) - depth;
  }

  const pathScore = fuzzyMatch(query, suggestion.path);
  const basenameQuery = query.split('/').pop() ?? query;
  const nameScore = fuzzyMatch(basenameQuery, suggestion.name);
  const boostedNameScore = nameScore < 0 ? -1 : nameScore + 75;

  // Once a directory separator is typed, matching the whole relative path is
  // required so an unrelated basename cannot jump into another directory.
  return query.includes('/') ? pathScore : Math.max(pathScore, boostedNameScore);
}

/**
 * Extract the @ reference from input
 * Returns the partial path after @ if found
 */
export function extractFileReference(input: string): {
  found: boolean;
  partial: string;
  startPos: number;
} {
  // Find the last @ that's not escaped
  const atIndex = input.lastIndexOf('@');

  if (atIndex === -1) {
    return { found: false, partial: '', startPos: -1 };
  }

  // Check if @ is at start or preceded by whitespace
  // safe: atIndex > 0 guarantees 0 <= atIndex - 1 < input.length, so the char is always defined
  const charBeforeAt = atIndex > 0 ? input.charAt(atIndex - 1) : '';
  if (atIndex > 0 && !/\s/.test(charBeforeAt)) {
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
  const normalizedPartial = partial.replace(/\\/g, '/').replace(/^\.\//, '');
  const pathSegments = normalizedPartial.split('/');

  if (path.isAbsolute(partial) || /^[a-zA-Z]:[\\/]/.test(partial) || pathSegments.includes('..')) {
    return [];
  }

  const showHidden = queryRequestsHiddenPath(normalizedPartial);
  return readProjectIndex(cwd)
    .filter((suggestion) => showHidden || !isHiddenPath(suggestion.path))
    .map((suggestion) => ({
      suggestion,
      score: scoreSuggestion(normalizedPartial, suggestion),
    }))
    .filter((candidate) => candidate.score >= 0)
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      if (a.suggestion.isDirectory !== b.suggestion.isDirectory) {
        return a.suggestion.isDirectory ? -1 : 1;
      }
      if (a.suggestion.path.length !== b.suggestion.path.length) {
        return a.suggestion.path.length - b.suggestion.path.length;
      }
      return a.suggestion.path.localeCompare(b.suggestion.path);
    })
    .slice(0, MAX_PROJECT_SUGGESTIONS)
    .map((candidate) => candidate.suggestion);
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
    '.ts': '\uD83D\uDCC4', // TypeScript
    '.tsx': '\u269B\uFE0F', // React TSX
    '.js': '\uD83D\uDFE8', // JavaScript
    '.jsx': '\u269B\uFE0F', // React JSX
    '.json': '{}',
    '.md': '\uD83D\uDCDD', // Markdown
    '.py': '\uD83D\uDC0D', // Python
    '.rs': '\uD83E\uDD80', // Rust
    '.go': '\uD83D\uDC39', // Go
    '.sh': '\uD83D\uDCDC', // Shell
    '.yml': '\u2699\uFE0F', // YAML
    '.yaml': '\u2699\uFE0F',
    '.css': '\uD83C\uDFA8', // CSS
    '.scss': '\uD83C\uDFA8',
    '.html': '\uD83C\uDF10', // HTML
    '.sql': '\uD83D\uDDC3\uFE0F', // SQL
    '.txt': '\uD83D\uDCC4', // Text
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
  suggestions: providedSuggestions,
  maxSuggestions = 8,
}: FileAutocompleteProps) {
  const { colors } = useTheme();

  // Extract file reference from input
  const { found, partial } = useMemo(() => extractFileReference(input), [input]);

  const suggestions = useMemo(() => {
    if (!found || !visible) return [];
    return (providedSuggestions ?? getFileSuggestions(partial)).slice(0, maxSuggestions);
  }, [found, maxSuggestions, partial, providedSuggestions, visible]);

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
              {icon} {suggestion.name}
              {suffix}
            </Text>
            <Text color={colors.textMuted} dimColor>
              {' '}
              {suggestion.path}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
});

export default FileAutocomplete;
