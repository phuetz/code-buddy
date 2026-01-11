/**
 * Multi-Step Progress Component
 *
 * Shows step-by-step progress with visual indicators, progress bar,
 * and time estimation. Designed for multi-step operations.
 */

import React, { useState, useEffect, useMemo } from "react";
import { Box, Text } from "ink";

/**
 * Step status types
 */
export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

/**
 * Single step definition
 */
export interface ProgressStep {
  id: string;
  name: string;
  description?: string;
  status: StepStatus;
  duration?: number; // in ms
  error?: string;
}

/**
 * Props for MultiStepProgress
 */
interface MultiStepProgressProps {
  steps: ProgressStep[];
  title?: string;
  showProgressBar?: boolean;
  showTimeEstimate?: boolean;
  showStepDetails?: boolean;
  compact?: boolean;
  width?: number;
}

/**
 * Spinner frames for running state
 */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Format duration in human-readable format
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

/**
 * Status icons and colors
 */
const STATUS_CONFIG: Record<StepStatus, { icon: string; color: string; textLabel: string }> = {
  pending: { icon: "○", color: "gray", textLabel: "[PENDING]" },
  running: { icon: "●", color: "cyan", textLabel: "[RUNNING]" },
  completed: { icon: "✓", color: "green", textLabel: "[DONE]" },
  failed: { icon: "✗", color: "red", textLabel: "[FAILED]" },
  skipped: { icon: "⊘", color: "yellow", textLabel: "[SKIPPED]" },
};

/**
 * Multi-Step Progress Component
 */
export function MultiStepProgress({
  steps,
  title,
  showProgressBar = true,
  showTimeEstimate = true,
  showStepDetails = false,
  compact = false,
  width = 50,
}: MultiStepProgressProps) {
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);

  // Calculate progress stats
  const stats = useMemo(() => {
    const total = steps.length;
    const completed = steps.filter((s) => s.status === "completed").length;
    const failed = steps.filter((s) => s.status === "failed").length;
    const skipped = steps.filter((s) => s.status === "skipped").length;
    const running = steps.find((s) => s.status === "running");
    const currentIndex = steps.findIndex((s) => s.status === "running");

    // Calculate total duration from completed steps
    const totalDuration = steps
      .filter((s) => s.duration !== undefined)
      .reduce((sum, s) => sum + (s.duration || 0), 0);

    // Estimate remaining time based on average
    const avgDuration = completed > 0 ? totalDuration / completed : 0;
    const remainingSteps = total - completed - failed - skipped;
    const estimatedRemaining = avgDuration * remainingSteps;

    const progress = total > 0 ? ((completed + failed + skipped) / total) * 100 : 0;

    return {
      total,
      completed,
      failed,
      skipped,
      running,
      currentIndex,
      progress,
      totalDuration,
      estimatedRemaining,
    };
  }, [steps]);

  // Animate spinner for running state
  useEffect(() => {
    if (!stats.running) return;

    const interval = setInterval(() => {
      setSpinnerFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, 80);

    return () => clearInterval(interval);
  }, [stats.running]);

  // Track elapsed time
  useEffect(() => {
    if (!stats.running) return;

    const interval = setInterval(() => {
      setElapsedTime((prev) => prev + 100);
    }, 100);

    return () => clearInterval(interval);
  }, [stats.running]);

  // Reset elapsed time when step changes
  useEffect(() => {
    setElapsedTime(0);
  }, [stats.currentIndex]);

  // Render progress bar
  const renderProgressBar = () => {
    const barWidth = width - 10; // Leave room for percentage
    const filledWidth = Math.round((stats.progress / 100) * barWidth);
    const emptyWidth = barWidth - filledWidth;

    const filled = "█".repeat(filledWidth);
    const empty = "░".repeat(emptyWidth);

    return (
      <Box marginY={1}>
        <Text color="green">{filled}</Text>
        <Text dimColor>{empty}</Text>
        <Text> {stats.progress.toFixed(0)}%</Text>
      </Box>
    );
  };

  // Render step icon with animation
  const getStepIcon = (status: StepStatus): string => {
    if (status === "running") {
      return SPINNER_FRAMES[spinnerFrame];
    }
    return STATUS_CONFIG[status].icon;
  };

  // Compact view - single line progress
  if (compact) {
    return (
      <Box flexDirection="column">
        <Box>
          <Text color="cyan">{getStepIcon(stats.running ? "running" : "pending")} </Text>
          <Text>
            Step {stats.currentIndex + 1}/{stats.total}:{" "}
          </Text>
          <Text bold>{stats.running?.name || "Waiting..."}</Text>
          {showTimeEstimate && elapsedTime > 0 && (
            <Text dimColor> ({formatDuration(elapsedTime)})</Text>
          )}
        </Box>
        {showProgressBar && (
          <Box marginLeft={2}>
            <Text color="green">{"█".repeat(Math.round((stats.progress / 100) * 20))}</Text>
            <Text dimColor>{"░".repeat(20 - Math.round((stats.progress / 100) * 20))}</Text>
            <Text> {stats.progress.toFixed(0)}%</Text>
          </Box>
        )}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {/* Title */}
      {title && (
        <Box marginBottom={1}>
          <Text bold color="white">
            {title}
          </Text>
          <Text dimColor>
            {" "}
            ({stats.completed + stats.failed + stats.skipped}/{stats.total})
          </Text>
        </Box>
      )}

      {/* Progress bar */}
      {showProgressBar && renderProgressBar()}

      {/* Step list */}
      <Box flexDirection="column">
        {steps.map((step, _index) => {
          const config = STATUS_CONFIG[step.status];
          const icon = getStepIcon(step.status);
          const isRunning = step.status === "running";

          return (
            <Box key={step.id} flexDirection="column">
              <Box>
                <Text color={config.color}>{icon} </Text>
                <Text color={config.color} dimColor={step.status === "pending"}>
                  {step.name}
                </Text>

                {/* Duration for completed steps */}
                {step.duration !== undefined && step.status === "completed" && (
                  <Text dimColor> ({formatDuration(step.duration)})</Text>
                )}

                {/* Elapsed time for running step */}
                {isRunning && elapsedTime > 0 && (
                  <Text dimColor> ({formatDuration(elapsedTime)})</Text>
                )}

                {/* Accessibility: text status label */}
                <Text dimColor> {config.textLabel}</Text>
              </Box>

              {/* Step description or error */}
              {showStepDetails && (
                <>
                  {step.description && isRunning && (
                    <Box marginLeft={2}>
                      <Text dimColor>⎿ {step.description}</Text>
                    </Box>
                  )}
                  {step.error && step.status === "failed" && (
                    <Box marginLeft={2}>
                      <Text color="red">⎿ Error: {step.error}</Text>
                    </Box>
                  )}
                </>
              )}
            </Box>
          );
        })}
      </Box>

      {/* Time estimate */}
      {showTimeEstimate && stats.estimatedRemaining > 0 && (
        <Box marginTop={1}>
          <Text dimColor>
            Estimated remaining: {formatDuration(stats.estimatedRemaining)}
          </Text>
        </Box>
      )}

      {/* Summary when complete */}
      {stats.progress === 100 && (
        <Box marginTop={1}>
          <Text color="green">✓ </Text>
          <Text>
            Completed {stats.completed} step{stats.completed !== 1 ? "s" : ""}
          </Text>
          {stats.failed > 0 && (
            <Text color="red"> • {stats.failed} failed</Text>
          )}
          {stats.skipped > 0 && (
            <Text color="yellow"> • {stats.skipped} skipped</Text>
          )}
          <Text dimColor> • Total: {formatDuration(stats.totalDuration)}</Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Hook to manage step progress state
 */
export function useStepProgress(initialSteps: Omit<ProgressStep, "status">[]) {
  const [steps, setSteps] = useState<ProgressStep[]>(
    initialSteps.map((s) => ({ ...s, status: "pending" as StepStatus }))
  );
  const [startTimes, setStartTimes] = useState<Map<string, number>>(new Map());

  const startStep = (stepId: string) => {
    setStartTimes((prev) => new Map(prev).set(stepId, Date.now()));
    setSteps((prev) =>
      prev.map((s) =>
        s.id === stepId ? { ...s, status: "running" as StepStatus } : s
      )
    );
  };

  const completeStep = (stepId: string) => {
    const startTime = startTimes.get(stepId);
    const duration = startTime ? Date.now() - startTime : undefined;

    setSteps((prev) =>
      prev.map((s) =>
        s.id === stepId
          ? { ...s, status: "completed" as StepStatus, duration }
          : s
      )
    );
  };

  const failStep = (stepId: string, error?: string) => {
    const startTime = startTimes.get(stepId);
    const duration = startTime ? Date.now() - startTime : undefined;

    setSteps((prev) =>
      prev.map((s) =>
        s.id === stepId
          ? { ...s, status: "failed" as StepStatus, duration, error }
          : s
      )
    );
  };

  const skipStep = (stepId: string) => {
    setSteps((prev) =>
      prev.map((s) =>
        s.id === stepId ? { ...s, status: "skipped" as StepStatus } : s
      )
    );
  };

  const resetSteps = () => {
    setSteps(initialSteps.map((s) => ({ ...s, status: "pending" as StepStatus })));
    setStartTimes(new Map());
  };

  return {
    steps,
    startStep,
    completeStep,
    failStep,
    skipStep,
    resetSteps,
  };
}

export default MultiStepProgress;
