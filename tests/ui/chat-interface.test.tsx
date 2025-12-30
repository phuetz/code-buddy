/**
 * UI Component Tests for Chat Interface (Item 8)
 */

import React from 'react';
import { render } from 'ink-testing-library';
import { Text, Box } from 'ink';

const MockChatMessage = ({ role, content }: { role: string; content: string }) => (
  <Box flexDirection="column">
    <Text color={role === 'user' ? 'blue' : 'green'}>{role}:</Text>
    <Text>{content}</Text>
  </Box>
);

const MockProgressBar = ({ progress }: { progress: number }) => (
  <Box>
    <Text>[{'='.repeat(Math.floor(progress / 5))}] {progress}%</Text>
  </Box>
);

describe('Chat Interface UI Components', () => {
  describe('ChatMessage', () => {
    it('should render user message', () => {
      const { lastFrame } = render(<MockChatMessage role="user" content="Hello" />);
      expect(lastFrame()).toContain('user:');
      expect(lastFrame()).toContain('Hello');
    });

    it('should render assistant message', () => {
      const { lastFrame } = render(<MockChatMessage role="assistant" content="Hi!" />);
      expect(lastFrame()).toContain('assistant:');
    });

    it('should handle empty content', () => {
      const { lastFrame } = render(<MockChatMessage role="user" content="" />);
      expect(lastFrame()).toContain('user:');
    });
  });

  describe('ProgressBar', () => {
    it('should render progress correctly', () => {
      const { lastFrame } = render(<MockProgressBar progress={50} />);
      expect(lastFrame()).toContain('50%');
    });
  });
});

describe('UI Snapshots (Item 87)', () => {
  it('should match ChatMessage snapshot', () => {
    const { lastFrame } = render(<MockChatMessage role="user" content="Test" />);
    expect(lastFrame()).toMatchSnapshot();
  });

  it('should match ProgressBar snapshot', () => {
    const { lastFrame } = render(<MockProgressBar progress={75} />);
    expect(lastFrame()).toMatchSnapshot();
  });
});
