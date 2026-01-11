/**
 * Enhanced Confirmation Dialog
 *
 * Improved confirmation dialog with:
 * - Side-by-side diff preview
 * - Syntax highlighted file preview
 * - File size change indication
 * - Timeout with auto-cancel
 * - Better visual feedback
 */

import React, { useState, useCallback, useEffect, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { DiffRenderer } from "./DiffRenderer.js";

/**
 * Operation types for different visual treatments
 */
export type OperationType =
  | "create"
  | "edit"
  | "delete"
  | "execute"
  | "move"
  | "rename"
  | "install"
  | "other";

/**
 * Props for EnhancedConfirmationDialog
 */
interface EnhancedConfirmationDialogProps {
  operation: string;
  operationType?: OperationType;
  filename: string;
  onConfirm: (dontAskAgain?: boolean) => void;
  onReject: (feedback?: string) => void;
  showVSCodeOpen?: boolean;
  content?: string; // Diff or file content
  originalContent?: string; // For side-by-side view
  newContent?: string; // For side-by-side view
  timeout?: number; // Auto-cancel timeout in seconds
  showFileInfo?: boolean;
  fileSize?: number;
  newFileSize?: number;
}

/**
 * Confirmation options
 */
const CONFIRMATION_OPTIONS = [
  { key: "y", label: "Yes", description: "Proceed with this operation" },
  { key: "a", label: "Yes to all", description: "Don't ask again this session" },
  { key: "n", label: "No", description: "Cancel this operation" },
  { key: "f", label: "No + feedback", description: "Cancel and provide reason" },
] as const;

/**
 * Operation type icons and colors
 */
const OPERATION_CONFIG: Record<OperationType, { icon: string; color: string; label: string }> = {
  create: { icon: "+", color: "green", label: "CREATE" },
  edit: { icon: "~", color: "yellow", label: "EDIT" },
  delete: { icon: "-", color: "red", label: "DELETE" },
  execute: { icon: "▶", color: "cyan", label: "EXECUTE" },
  move: { icon: "→", color: "blue", label: "MOVE" },
  rename: { icon: "↔", color: "magenta", label: "RENAME" },
  install: { icon: "⬇", color: "green", label: "INSTALL" },
  other: { icon: "•", color: "white", label: "OPERATION" },
};

/**
 * Format file size
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Calculate size change indicator
 */
function SizeChange({ oldSize, newSize }: { oldSize?: number; newSize?: number }) {
  if (oldSize === undefined || newSize === undefined) return null;

  const diff = newSize - oldSize;
  const percentage = oldSize > 0 ? ((diff / oldSize) * 100).toFixed(1) : "new";

  if (diff === 0) {
    return <Text dimColor> (no size change)</Text>;
  }

  const color = diff > 0 ? "yellow" : "green";
  const sign = diff > 0 ? "+" : "";

  return (
    <Text color={color}>
      {" "}
      ({sign}{formatSize(Math.abs(diff))}, {sign}{percentage}%)
    </Text>
  );
}

/**
 * Enhanced Confirmation Dialog Component
 */
export function EnhancedConfirmationDialog({
  operation,
  operationType = "other",
  filename,
  onConfirm,
  onReject,
  showVSCodeOpen = false,
  content,
  originalContent: _originalContent,
  newContent: _newContent,
  timeout,
  showFileInfo = true,
  fileSize,
  newFileSize,
}: EnhancedConfirmationDialogProps) {
  const [selectedOption, setSelectedOption] = useState(0);
  const [feedbackMode, setFeedbackMode] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [remainingTime, setRemainingTime] = useState(timeout);
  const [showFullDiff, setShowFullDiff] = useState(false);

  const config = OPERATION_CONFIG[operationType];

  // Countdown timer
  useEffect(() => {
    if (!timeout || remainingTime === undefined || remainingTime <= 0) return;

    const timer = setInterval(() => {
      setRemainingTime((prev) => {
        if (prev === undefined || prev <= 1) {
          onReject("Operation cancelled: timeout");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [timeout, remainingTime, onReject]);

  // Handle keyboard input
  const handleInput = useCallback(
    (input: string, key: {
      return?: boolean;
      backspace?: boolean;
      delete?: boolean;
      ctrl?: boolean;
      meta?: boolean;
      upArrow?: boolean;
      downArrow?: boolean;
      tab?: boolean;
      shift?: boolean;
      escape?: boolean;
    }) => {
      if (feedbackMode) {
        if (key.return) {
          onReject(feedback.trim() || "User provided no feedback");
          return;
        }
        if (key.escape) {
          setFeedbackMode(false);
          setFeedback("");
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

      // Quick key shortcuts
      if (input === "y" || input === "Y") {
        onConfirm(false);
        return;
      }
      if (input === "a" || input === "A") {
        onConfirm(true);
        return;
      }
      if (input === "n" || input === "N") {
        onReject("Operation cancelled by user");
        return;
      }
      if (input === "f" || input === "F") {
        setFeedbackMode(true);
        return;
      }

      // Toggle full diff view
      if (input === "d" || input === "D") {
        setShowFullDiff((prev) => !prev);
        return;
      }

      // Arrow navigation
      if (key.upArrow || (key.shift && key.tab)) {
        setSelectedOption((prev) =>
          prev > 0 ? prev - 1 : CONFIRMATION_OPTIONS.length - 1
        );
        return;
      }

      if (key.downArrow || key.tab) {
        setSelectedOption((prev) => (prev + 1) % CONFIRMATION_OPTIONS.length);
        return;
      }

      if (key.return) {
        switch (selectedOption) {
          case 0:
            onConfirm(false);
            break;
          case 1:
            onConfirm(true);
            break;
          case 2:
            onReject("Operation cancelled by user");
            break;
          case 3:
            setFeedbackMode(true);
            break;
        }
        return;
      }

      if (key.escape) {
        onReject("Operation cancelled by user (Escape)");
      }
    },
    [feedbackMode, feedback, selectedOption, onConfirm, onReject]
  );

  useInput(handleInput);

  // Calculate diff stats if content provided
  const diffStats = useMemo(() => {
    if (!content) return null;

    const lines = content.split("\n");
    const additions = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
    const deletions = lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;

    return { additions, deletions, total: lines.length };
  }, [content]);

  // Feedback mode UI
  if (feedbackMode) {
    return (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Text color="yellow">Provide feedback for cancellation:</Text>
        </Box>
        <Box borderStyle="round" borderColor="yellow" paddingX={1}>
          <Text color="gray">❯ </Text>
          <Text>
            {feedback}
            <Text backgroundColor="white" color="black">
              {" "}
            </Text>
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Enter to submit • Esc to go back</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {/* Header with operation type */}
      <Box marginTop={1}>
        <Text color={config.color} bold>
          [{config.label}]
        </Text>
        <Text> </Text>
        <Text color={config.color}>{config.icon}</Text>
        <Text color="white"> {operation}</Text>
      </Box>

      {/* Filename and info */}
      <Box marginLeft={2} flexDirection="column">
        <Box>
          <Text color="cyan">File: </Text>
          <Text bold>{filename}</Text>
          {showFileInfo && fileSize !== undefined && (
            <>
              <Text dimColor> ({formatSize(fileSize)})</Text>
              <SizeChange oldSize={fileSize} newSize={newFileSize} />
            </>
          )}
        </Box>

        {showVSCodeOpen && (
          <Box marginTop={1}>
            <Text color="gray">⎿ Opened in Visual Studio Code ⧉</Text>
          </Box>
        )}

        {/* Diff stats */}
        {diffStats && (
          <Box marginTop={1}>
            <Text dimColor>Changes: </Text>
            <Text color="green">+{diffStats.additions}</Text>
            <Text dimColor> / </Text>
            <Text color="red">-{diffStats.deletions}</Text>
            <Text dimColor> lines</Text>
            {content && content.split("\n").length > 15 && (
              <Text dimColor> (press 'd' to {showFullDiff ? "collapse" : "expand"})</Text>
            )}
          </Box>
        )}

        {/* Content preview */}
        {content && (
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>Preview:</Text>
            <Box
              marginLeft={2}
              flexDirection="column"
              borderStyle="single"
              borderColor="gray"
              paddingX={1}
            >
              <DiffRenderer
                diffContent={
                  showFullDiff ? content : content.split("\n").slice(0, 10).join("\n")
                }
                filename={filename}
                terminalWidth={76}
              />
              {!showFullDiff && content.split("\n").length > 10 && (
                <Text dimColor>... {content.split("\n").length - 10} more lines</Text>
              )}
            </Box>
          </Box>
        )}
      </Box>

      {/* Timeout indicator */}
      {timeout && remainingTime !== undefined && remainingTime > 0 && (
        <Box marginTop={1} marginLeft={2}>
          <Text color={remainingTime <= 10 ? "red" : "yellow"}>
            ⏱ Auto-cancel in {remainingTime}s
          </Text>
        </Box>
      )}

      {/* Confirmation question */}
      <Box marginTop={1}>
        <Text bold>Proceed with this operation?</Text>
      </Box>

      {/* Options */}
      <Box flexDirection="column" marginTop={1}>
        {CONFIRMATION_OPTIONS.map((option, index) => (
          <Box key={option.key} paddingLeft={1}>
            <Text
              color={selectedOption === index ? "black" : "white"}
              backgroundColor={selectedOption === index ? "cyan" : undefined}
            >
              [{option.key}] {option.label}
            </Text>
            {selectedOption === index && (
              <Text dimColor> - {option.description}</Text>
            )}
          </Box>
        ))}
      </Box>

      {/* Help */}
      <Box marginTop={1}>
        <Text dimColor>
          ↑↓ navigate • Enter select • y/n quick keys • d toggle diff • Esc cancel
        </Text>
      </Box>
    </Box>
  );
}

export default EnhancedConfirmationDialog;
