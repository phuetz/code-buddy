import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { formatTokenCount } from "../../utils/token-counter.js";
import { useTheme } from "../context/theme-context.js";

interface LoadingSpinnerProps {
  isActive: boolean;
  processingTime: number;
  tokenCount: number;
}

// Memoized loading spinner to reduce re-renders
export const LoadingSpinner = React.memo(function LoadingSpinnerInner({
  isActive,
  processingTime,
  tokenCount,
}: LoadingSpinnerProps) {
  const { colors } = useTheme();
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const [loadingTextIndex, setLoadingTextIndex] = useState(0);

  useEffect(() => {
    if (!isActive) return;

    const spinnerFrames = ["/", "-", "\\", "|"];
    const interval = setInterval(() => {
      setSpinnerFrame((prev) => (prev + 1) % spinnerFrames.length);
    }, 500);

    return () => clearInterval(interval);
  }, [isActive]);

  useEffect(() => {
    if (!isActive) return;

    setLoadingTextIndex(Math.floor(Math.random() * loadingTextsArray.length));

    const interval = setInterval(() => {
      setLoadingTextIndex(Math.floor(Math.random() * loadingTextsArray.length));
    }, 4000);

    return () => clearInterval(interval);
  }, [isActive]);

  if (!isActive) return null;

  const spinnerFrames = ["/", "-", "\\", "|"];

  return (
    <Box marginTop={1}>
      <Text color={colors.spinner}>
        {spinnerFrames[spinnerFrame]} {loadingTextsArray[loadingTextIndex]}{" "}
      </Text>
      <Text color={colors.textMuted}>
        ({processingTime}s · ↑ {formatTokenCount(tokenCount)} tokens · esc to
        interrupt)
      </Text>
    </Box>
  );
});

const loadingTextsArray = [
  "Thinking...",
  "Computing...",
  "Analyzing...",
  "Processing...",
  "Calculating...",
  "Interfacing...",
  "Optimizing...",
  "Synthesizing...",
  "Decrypting...",
  "Calibrating...",
  "Bootstrapping...",
  "Synchronizing...",
  "Compiling...",
  "Downloading...",
];
