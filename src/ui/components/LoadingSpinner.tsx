import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { formatTokenCount } from "../../utils/token-counter.js";
import { useTheme } from "../context/theme-context.js";

// Braille dot spinner — smoother animation than simple rotation
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

const IDLE_TEXTS = [
  "Thinking...",
  "Analyzing...",
  "Processing...",
  "Computing...",
  "Synthesizing...",
] as const;

interface LoadingSpinnerProps {
  isActive: boolean;
  processingTime: number;
  tokenCount: number;
  /** Current activity description (e.g. "Executing: read_file") */
  activity?: string;
}

// Memoized loading spinner to reduce re-renders
export const LoadingSpinner = React.memo(function LoadingSpinnerInner({
  isActive,
  processingTime,
  tokenCount,
  activity,
}: LoadingSpinnerProps) {
  const { colors } = useTheme();
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const [idleTextIndex, setIdleTextIndex] = useState(0);

  useEffect(() => {
    if (!isActive) return;

    const interval = setInterval(() => {
      setSpinnerFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, 80);

    return () => clearInterval(interval);
  }, [isActive]);

  useEffect(() => {
    if (!isActive) return;

    setIdleTextIndex(Math.floor(Math.random() * IDLE_TEXTS.length));

    const interval = setInterval(() => {
      setIdleTextIndex(Math.floor(Math.random() * IDLE_TEXTS.length));
    }, 4000);

    return () => clearInterval(interval);
  }, [isActive]);

  if (!isActive) return null;

  const displayText = activity || IDLE_TEXTS[idleTextIndex];

  return (
    <Box marginTop={1}>
      <Text color={colors.spinner} bold>
        {SPINNER_FRAMES[spinnerFrame]}{" "}
      </Text>
      <Text color={colors.primary}>
        {displayText}{" "}
      </Text>
      <Text color={colors.textMuted}>
        ({processingTime}s · ↑ {formatTokenCount(tokenCount)} tokens · esc to
        interrupt)
      </Text>
    </Box>
  );
});
