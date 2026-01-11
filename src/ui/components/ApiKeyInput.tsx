import React, { useState, useCallback, useMemo } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { CodeBuddyAgent } from "../../agent/codebuddy-agent.js";
import { getSettingsManager } from "../../utils/settings-manager.js";
import { logger } from "../../utils/logger.js";

interface ApiKeyInputProps {
  onApiKeySet: (agent: CodeBuddyAgent) => void;
}

function ApiKeyInputInner({ onApiKeySet }: ApiKeyInputProps) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { exit } = useApp();

  // Memoized submit handler
  const handleSubmit = useCallback(async () => {
    if (!input.trim()) {
      setError("API key cannot be empty");
      return;
    }

    setIsSubmitting(true);
    try {
      const apiKey = input.trim();
      const agent = new CodeBuddyAgent(apiKey);

      // Set environment variable for current process
      process.env.GROK_API_KEY = apiKey;

      // Save to user settings
      try {
        const manager = getSettingsManager();
        manager.updateUserSetting('apiKey', apiKey);
        logger.info('API key saved to ~/.codebuddy/user-settings.json');
      } catch (_error) {
        logger.warn('Could not save API key to settings file. API key set for current session only.');
      }

      onApiKeySet(agent);
    } catch (_error: unknown) {
      setError("Invalid API key format");
      setIsSubmitting(false);
    }
  }, [input, onApiKeySet]);

  // Memoized input handler
  const handleInput = useCallback((inputChar: string, key: { ctrl?: boolean; meta?: boolean; return?: boolean; backspace?: boolean; delete?: boolean }) => {
    if (isSubmitting) return;

    if (key.ctrl && inputChar === "c") {
      exit();
      return;
    }

    if (key.return) {
      handleSubmit();
      return;
    }

    if (key.backspace || key.delete) {
      setInput((prev) => prev.slice(0, -1));
      setError("");
      return;
    }

    if (inputChar && !key.ctrl && !key.meta) {
      setInput((prev) => prev + inputChar);
      setError("");
    }
  }, [isSubmitting, exit, handleSubmit]);

  useInput(handleInput);

  // Memoized display text to prevent re-computation
  const displayText = useMemo(() => {
    if (input.length > 0) {
      return isSubmitting ? "*".repeat(input.length) : "*".repeat(input.length) + "█";
    }
    return isSubmitting ? " " : "█";
  }, [input.length, isSubmitting]);

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text color="yellow">🔑 CodeBuddy API Key Required</Text>
      <Box marginBottom={1}>
        <Text color="gray">Please enter your CodeBuddy API key to continue:</Text>
      </Box>
      
      <Box borderStyle="round" borderColor="blue" paddingX={1} marginBottom={1}>
        <Text color="gray">❯ </Text>
        <Text>{displayText}</Text>
      </Box>

      {error ? (
        <Box marginBottom={1}>
          <Text color="red">❌ {error}</Text>
        </Box>
      ) : null}

      <Box flexDirection="column" marginTop={1}>
        <Text color="gray" dimColor>• Press Enter to submit</Text>
        <Text color="gray" dimColor>• Press Ctrl+C to exit</Text>
        <Text color="gray" dimColor>Note: API key will be saved to ~/.codebuddy/user-settings.json</Text>
      </Box>

      {isSubmitting ? (
        <Box marginTop={1}>
          <Text color="yellow">🔄 Validating API key...</Text>
        </Box>
      ) : null}
    </Box>
  );
}

// Export memoized component to prevent unnecessary re-renders
const ApiKeyInput = React.memo(ApiKeyInputInner);
export default ApiKeyInput;