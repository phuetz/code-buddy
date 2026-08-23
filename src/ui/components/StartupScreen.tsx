import React from 'react';
import { Box, Text } from 'ink';
import { LOADING_SCREEN_TITLE } from '../loading-screen.js';

export function StartupScreen() {
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text color="cyan">{LOADING_SCREEN_TITLE}</Text>
      <Text color="gray" dimColor>Loading the coding assistant.</Text>
    </Box>
  );
}
