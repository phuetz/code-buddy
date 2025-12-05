import React, { useState, useCallback, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { DiffRenderer } from "./diff-renderer.js";

interface ConfirmationDialogProps {
  operation: string;
  filename: string;
  onConfirm: (dontAskAgain?: boolean) => void;
  onReject: (feedback?: string) => void;
  showVSCodeOpen?: boolean;
  content?: string; // Optional content to show (file content or command)
}

// Memoized options array - stable reference
const CONFIRMATION_OPTIONS = [
  "Yes",
  "Yes, and don't ask again this session",
  "No",
  "No, with feedback",
] as const;

function ConfirmationDialogInner({
  operation,
  filename,
  onConfirm,
  onReject,
  showVSCodeOpen = false,
  content,
}: ConfirmationDialogProps) {
  const [selectedOption, setSelectedOption] = useState(0);
  const [feedbackMode, setFeedbackMode] = useState(false);
  const [feedback, setFeedback] = useState("");

  // Memoized handlers
  const handleConfirm = useCallback((dontAskAgain: boolean) => {
    onConfirm(dontAskAgain);
  }, [onConfirm]);

  const handleReject = useCallback((message: string) => {
    onReject(message);
  }, [onReject]);

  // Memoized input handler
  const handleInput = useCallback((input: string, key: { return?: boolean; backspace?: boolean; delete?: boolean; ctrl?: boolean; meta?: boolean; upArrow?: boolean; downArrow?: boolean; tab?: boolean; shift?: boolean; escape?: boolean }) => {
    if (feedbackMode) {
      if (key.return) {
        handleReject(feedback.trim());
        return;
      }
      if (key.backspace || key.delete) {
        setFeedback((prev) => prev.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setFeedback((prev) => prev + input);
      }
      return;
    }

    if (key.upArrow || (key.shift && key.tab)) {
      setSelectedOption((prev) => (prev > 0 ? prev - 1 : CONFIRMATION_OPTIONS.length - 1));
      return;
    }

    if (key.downArrow || key.tab) {
      setSelectedOption((prev) => (prev + 1) % CONFIRMATION_OPTIONS.length);
      return;
    }

    if (key.return) {
      if (selectedOption === 0) {
        handleConfirm(false);
      } else if (selectedOption === 1) {
        handleConfirm(true);
      } else if (selectedOption === 2) {
        handleReject("Operation cancelled by user");
      } else {
        setFeedbackMode(true);
      }
      return;
    }

    if (key.escape) {
      if (feedbackMode) {
        setFeedbackMode(false);
        setFeedback("");
      } else {
        // Cancel the confirmation when escape is pressed from main confirmation
        handleReject("Operation cancelled by user (pressed Escape)");
      }
      return;
    }
  }, [feedbackMode, feedback, selectedOption, handleConfirm, handleReject]);

  useInput(handleInput);

  if (feedbackMode) {
    return (
      <Box flexDirection="column" padding={1}>
        <Box flexDirection="column" marginBottom={1}>
          <Text color="gray">
            Type your feedback and press Enter, or press Escape to go back.
          </Text>
        </Box>

        <Box
          borderStyle="round"
          borderColor="yellow"
          paddingX={1}
          marginTop={1}
        >
          <Text color="gray">❯ </Text>
          <Text>
            {feedback}
            <Text color="white">█</Text>
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {/* Tool use header - styled like chat history */}
      <Box marginTop={1}>
        <Box>
          <Text color="magenta">⏺</Text>
          <Text color="white">
            {" "}
            {operation}({filename})
          </Text>
        </Box>
      </Box>

      <Box marginLeft={2} flexDirection="column">
        <Text color="gray">⎿ Requesting user confirmation</Text>

        {showVSCodeOpen && (
          <Box marginTop={1}>
            <Text color="gray">⎿ Opened changes in Visual Studio Code ⧉</Text>
          </Box>
        )}

        {/* Show content preview if provided */}
        {content && (
          <>
            <Text color="gray">⎿ {content.split('\n')[0]}</Text>
            <Box marginLeft={4} flexDirection="column">
              <DiffRenderer
                diffContent={content}
                filename={filename}
                terminalWidth={80}
              />
            </Box>
          </>
        )}
      </Box>

      {/* Confirmation options */}
      <Box flexDirection="column" marginTop={1}>
        <Box marginBottom={1}>
          <Text>Do you want to proceed with this operation?</Text>
        </Box>

        <Box flexDirection="column">
          {CONFIRMATION_OPTIONS.map((option, index) => (
            <Box key={index} paddingLeft={1}>
              <Text
                color={selectedOption === index ? "black" : "white"}
                backgroundColor={selectedOption === index ? "cyan" : undefined}
              >
                {index + 1}. {option}
              </Text>
            </Box>
          ))}
        </Box>

        <Box marginTop={1}>
          <Text color="gray" dimColor>
            ↑↓ navigate • Enter select • Esc cancel
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

// Export memoized component to prevent unnecessary re-renders
const ConfirmationDialog = React.memo(ConfirmationDialogInner);
export default ConfirmationDialog;
