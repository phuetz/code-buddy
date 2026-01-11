import React, { useMemo } from 'react';
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

  // Memoize header text to prevent re-computation
  const headerText = useMemo(
    () => `Select Grok Model (current: ${currentModel}):`,
    [currentModel]
  );

  return (
    <Box marginTop={1} flexDirection="column">
      <Box marginBottom={1}>
        <Text color="cyan">{headerText}</Text>
      </Box>
      {models.map((modelOption, index) => (
        <ModelItem
          key={modelOption.model}
          model={modelOption.model}
          isSelected={index === selectedIndex}
        />
      ))}
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          ↑↓ navigate • Enter/Tab select • Esc cancel
        </Text>
      </Box>
    </Box>
  );
});
