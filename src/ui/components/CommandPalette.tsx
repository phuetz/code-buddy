import { getProviderModels } from '../../config/model-defaults.js';
/**
 * Command Palette Component (Ctrl+K)
 *
 * Interactive fuzzy search palette for commands, models, and recent prompts.
 * Supports category prefixes for filtered search:
 * - `>` for commands only
 * - `@` for models only
 * - `#` for sessions/recent prompts
 */

import React, { useState, useMemo, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { getNavigableHistory } from '../navigable-history.js';

/**
 * Palette item representing a command, model, or recent prompt
 */
export interface PaletteItem {
  id: string;
  label: string;
  description: string;
  category: 'command' | 'model' | 'recent';
  icon: string;
  keybinding?: string;
  value: string;
}

/**
 * Props for CommandPalette
 */
export interface CommandPaletteProps {
  commands: Array<{ command: string; description: string; category: string }>;
  onSelect: (item: PaletteItem) => void;
  onClose: () => void;
  currentModel?: string;
}

/**
 * Common models available for selection
 */
function commonModels(): Array<{ model: string; description: string }> {
  return (['xai', 'chatgpt', 'openai', 'anthropic', 'google', 'deepseek'] as const)
    .flatMap(provider => getProviderModels(provider).map(model => ({ model, description: provider })));
}

/**
 * Simple fuzzy matching score (reuses logic from FuzzyPicker)
 */
function fuzzyScore(query: string, text: string): number {
  if (!query) return 1;

  const lq = query.toLowerCase();
  const lt = text.toLowerCase();

  if (lt === lq) return 1000;
  if (lt.startsWith(lq)) return 500 + (query.length / text.length) * 100;
  if (lt.includes(lq)) return 200 + (query.length / text.length) * 100;

  // Fuzzy character matching
  let qi = 0;
  let score = 0;
  let consecutive = 0;

  for (let i = 0; i < lt.length && qi < lq.length; i++) {
    if (lt[i] === lq[qi]) {
      score += 10 + consecutive;
      consecutive += 5;
      qi++;
    } else {
      consecutive = 0;
    }
  }

  return qi < lq.length ? -1 : score;
}

/**
 * Category icons and badges
 */
const CATEGORY_BADGE: Record<string, { icon: string; color: string }> = {
  command: { icon: '>', color: 'cyan' },
  model: { icon: '@', color: 'green' },
  recent: { icon: '#', color: 'yellow' },
};

/**
 * Build the full palette items list
 */
export function buildPaletteItems(
  commands: Array<{ command: string; description: string; category: string }>,
  currentModel?: string,
): PaletteItem[] {
  const items: PaletteItem[] = [];

  // Add commands
  for (const cmd of commands) {
    items.push({
      id: `cmd:${cmd.command}`,
      label: `/${cmd.command}`,
      description: cmd.description,
      category: 'command',
      icon: '>',
      value: `/${cmd.command}`,
    });
  }

  // Add models
  const models = commonModels();
  if (currentModel && !models.some(item => item.model === currentModel)) {
    models.unshift({ model: currentModel, description: 'Session' });
  }
  for (const m of models) {
    const isCurrent = currentModel === m.model;
    items.push({
      id: `model:${m.model}`,
      label: m.model,
      description: `${m.description}${isCurrent ? ' (current)' : ''}`,
      category: 'model',
      icon: '@',
      value: m.model,
    });
  }

  // Add recent prompts from history
  const history = getNavigableHistory();
  const recent = history.getRecent(15);
  for (let i = 0; i < recent.length; i++) {
    const entry = recent[i];
    if (!entry) continue;
    // Skip slash commands in recent (they're already in commands)
    if (entry.command.startsWith('/')) continue;

    const truncated = entry.command.length > 60
      ? entry.command.slice(0, 57) + '...'
      : entry.command;

    items.push({
      id: `recent:${i}`,
      label: truncated,
      description: `${timeSince(entry.timestamp)} ago`,
      category: 'recent',
      icon: '#',
      value: entry.command,
    });
  }

  return items;
}

/**
 * Human-friendly time since a date
 */
function timeSince(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

/**
 * Command Palette Component
 */
export function CommandPalette({
  commands,
  onSelect,
  onClose,
  currentModel,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const allItems = useMemo(
    () => buildPaletteItems(commands, currentModel),
    [commands, currentModel],
  );

  // Filter items based on query with category prefix support
  const filteredItems = useMemo(() => {
    let searchQuery = query;
    let categoryFilter: 'command' | 'model' | 'recent' | null = null;

    // Check for category prefix
    if (searchQuery.startsWith('>')) {
      categoryFilter = 'command';
      searchQuery = searchQuery.slice(1).trim();
    } else if (searchQuery.startsWith('@')) {
      categoryFilter = 'model';
      searchQuery = searchQuery.slice(1).trim();
    } else if (searchQuery.startsWith('#')) {
      categoryFilter = 'recent';
      searchQuery = searchQuery.slice(1).trim();
    }

    let candidates = allItems;
    if (categoryFilter) {
      candidates = candidates.filter(item => item.category === categoryFilter);
    }

    if (!searchQuery) return candidates;

    return candidates
      .map(item => ({
        item,
        score: Math.max(
          fuzzyScore(searchQuery, item.label),
          fuzzyScore(searchQuery, item.description) * 0.5,
        ),
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ item }) => item);
  }, [query, allItems]);

  const maxVisible = 12;
  const clampedIndex = Math.min(selectedIndex, Math.max(0, filteredItems.length - 1));

  // Handle input
  useInput(
    useCallback(
      (input: string, key) => {
        if (key.escape) {
          onClose();
          return;
        }

        if (key.return) {
          if (filteredItems[clampedIndex]) {
            onSelect(filteredItems[clampedIndex]);
          }
          return;
        }

        if (key.upArrow) {
          setSelectedIndex(prev => Math.max(0, prev - 1));
          return;
        }

        if (key.downArrow) {
          setSelectedIndex(prev => Math.min(filteredItems.length - 1, prev + 1));
          return;
        }

        if (key.backspace || key.delete) {
          setQuery(prev => prev.slice(0, -1));
          setSelectedIndex(0);
          return;
        }

        if (key.tab) {
          setSelectedIndex(prev =>
            prev < filteredItems.length - 1 ? prev + 1 : 0,
          );
          return;
        }

        // Regular character input
        if (input && !key.ctrl && !key.meta) {
          setQuery(prev => prev + input);
          setSelectedIndex(0);
        }
      },
      [filteredItems, clampedIndex, onSelect, onClose],
    ),
  );

  // Calculate visible window
  const halfVisible = Math.floor(maxVisible / 2);
  let startIndex = Math.max(0, clampedIndex - halfVisible);
  const endIndex = Math.min(filteredItems.length, startIndex + maxVisible);
  if (endIndex - startIndex < maxVisible) {
    startIndex = Math.max(0, endIndex - maxVisible);
  }

  const visibleItems = filteredItems.slice(startIndex, endIndex);
  const hasAbove = startIndex > 0;
  const hasBelow = endIndex < filteredItems.length;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="magenta" padding={1}>
      {/* Title */}
      <Box marginBottom={1}>
        <Text bold color="white">
          Command Palette
        </Text>
        <Text dimColor> (Ctrl+K)</Text>
      </Box>

      {/* Search input */}
      <Box marginBottom={1}>
        <Text color="magenta">{'> '}</Text>
        <Text>{query || <Text dimColor>Type to search commands, models, prompts...</Text>}</Text>
        <Text color="white">{'\u2588'}</Text>
      </Box>

      {/* Results count and prefix hints */}
      <Box marginBottom={1}>
        <Text dimColor>
          {filteredItems.length} results
        </Text>
        <Text dimColor>  |  </Text>
        <Text dimColor>
          {'>'} commands  @ models  # recent
        </Text>
      </Box>

      {/* Scroll up indicator */}
      {hasAbove && (
        <Box>
          <Text dimColor>  {'\u2191'} {startIndex} more above</Text>
        </Box>
      )}

      {/* Item list */}
      <Box flexDirection="column">
        {visibleItems.length === 0 ? (
          <Box paddingY={1}>
            <Text dimColor>No matches found</Text>
          </Box>
        ) : (
          visibleItems.map((item, displayIndex) => {
            const actualIndex = startIndex + displayIndex;
            const isSelected = actualIndex === clampedIndex;
            const badge = CATEGORY_BADGE[item.category] ?? { icon: '?', color: 'gray' };

            return (
              <Box key={item.id} paddingLeft={1}>
                <Text color={isSelected ? 'magenta' : undefined}>
                  {isSelected ? '\u276F ' : '  '}
                </Text>
                <Text color={badge.color}>[{badge.icon}]</Text>
                <Text> </Text>
                <Text
                  color={isSelected ? 'magenta' : undefined}
                  bold={isSelected}
                >
                  {item.label}
                </Text>
                <Text dimColor> - {item.description}</Text>
                {item.keybinding && (
                  <Text color="gray"> ({item.keybinding})</Text>
                )}
              </Box>
            );
          })
        )}
      </Box>

      {/* Scroll down indicator */}
      {hasBelow && (
        <Box>
          <Text dimColor>  {'\u2193'} {filteredItems.length - endIndex} more below</Text>
        </Box>
      )}

      {/* Help text */}
      <Box marginTop={1}>
        <Text dimColor>{'\u2191\u2193'} navigate  Enter select  Tab cycle  Esc close</Text>
      </Box>
    </Box>
  );
}

export default CommandPalette;
