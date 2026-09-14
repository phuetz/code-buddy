import React from 'react';
import { Box, Text } from 'ink';

interface ModelOption {
  model: string;
}

interface ModelSelectionProps {
  models: ModelOption[];
  selectedIndex: number;
  isVisible: boolean;
  currentModel: string;
}

// Memoized individual model item to prevent re-renders
const ModelItem = React.memo(function ModelItem({
  model,
  isSelected,
}: {
  model: string;
  isSelected: boolean;
}) {
  return (
    <Box paddingLeft={1}>
      <Text
        color={isSelected ? 'black' : 'white'}
        backgroundColor={isSelected ? 'cyan' : undefined}
      >
        {model}
      </Text>
    </Box>
  );
});

export const ModelSelection = React.memo(function ModelSelection({
  models,
  selectedIndex,
  isVisible,
  currentModel,
}: ModelSelectionProps) {
  // Early return for invisible state
  if (!isVisible) return null;

  const headerText = `Select model (current: ${currentModel}):`;
  const start = Math.max(0, Math.min(selectedIndex - 4, models.length - 8));
  const visibleModels = models.slice(start, start + 8);

  return (
    <Box marginTop={1} flexDirection="column">
      <Box marginBottom={1}>
        <Text color="cyan">{headerText}</Text>
      </Box>
      {visibleModels.map((modelOption, index) => (
        <ModelItem
          key={modelOption.model}
          model={modelOption.model}
          isSelected={start + index === selectedIndex}
        />
      ))}
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          ↑↓ navigate • →/Enter select • ←/Esc cancel
        </Text>
      </Box>
    </Box>
  );
});
