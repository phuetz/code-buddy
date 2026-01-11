/**
 * Enhanced Spinners and Progress Components
 *
 * Provides various spinner styles and progress indicators for CLI.
 * Based on hurry-mode's UI component patterns.
 */

import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";

/**
 * Spinner style types
 */
export type SpinnerStyle =
  | "dots"
  | "line"
  | "circle"
  | "arrow"
  | "bounce"
  | "pulse"
  | "braille"
  | "clock"
  | "earth"
  | "moon";

/**
 * Spinner frame definitions
 */
const SPINNER_FRAMES: Record<SpinnerStyle, string[]> = {
  dots: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  line: ["-", "\\", "|", "/"],
  circle: ["◐", "◓", "◑", "◒"],
  arrow: ["←", "↖", "↑", "↗", "→", "↘", "↓", "↙"],
  bounce: ["⠁", "⠂", "⠄", "⠂"],
  pulse: ["█", "▓", "▒", "░", "▒", "▓"],
  braille: ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"],
  clock: ["🕐", "🕑", "🕒", "🕓", "🕔", "🕕", "🕖", "🕗", "🕘", "🕙", "🕚", "🕛"],
  earth: ["🌍", "🌎", "🌏"],
  moon: ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"],
};

/**
 * Props for EnhancedSpinner
 */
interface EnhancedSpinnerProps {
  style?: SpinnerStyle;
  text?: string;
  color?: string;
  speed?: number;
  isActive?: boolean;
}

/**
 * Enhanced Spinner Component
 */
export function EnhancedSpinner({
  style = "dots",
  text = "Loading...",
  color = "cyan",
  speed = 80,
  isActive = true,
}: EnhancedSpinnerProps) {
  const [frame, setFrame] = useState(0);
  const frames = SPINNER_FRAMES[style];

  useEffect(() => {
    if (!isActive) return;

    const interval = setInterval(() => {
      setFrame((prev) => (prev + 1) % frames.length);
    }, speed);

    return () => clearInterval(interval);
  }, [isActive, frames.length, speed]);

  if (!isActive) return null;

  return (
    <Box>
      <Text color={color}>{frames[frame]} </Text>
      <Text>{text}</Text>
    </Box>
  );
}

/**
 * Props for ProgressBar
 */
interface ProgressBarProps {
  progress: number; // 0-100
  width?: number;
  showPercentage?: boolean;
  filledChar?: string;
  emptyChar?: string;
  color?: string;
  label?: string;
}

/**
 * Progress Bar Component
 */
export function ProgressBar({
  progress,
  width = 30,
  showPercentage = true,
  filledChar = "█",
  emptyChar = "░",
  color = "green",
  label,
}: ProgressBarProps) {
  const clampedProgress = Math.max(0, Math.min(100, progress));
  const filledWidth = Math.round((clampedProgress / 100) * width);
  const emptyWidth = width - filledWidth;

  const filled = filledChar.repeat(filledWidth);
  const empty = emptyChar.repeat(emptyWidth);

  return (
    <Box flexDirection="column">
      {label && <Text dimColor>{label}</Text>}
      <Box>
        <Text color={color}>{filled}</Text>
        <Text dimColor>{empty}</Text>
        {showPercentage && (
          <Text> {clampedProgress.toFixed(0)}%</Text>
        )}
      </Box>
    </Box>
  );
}

/**
 * Props for StepProgress
 */
interface StepProgressProps {
  steps: string[];
  currentStep: number;
  completedColor?: string;
  currentColor?: string;
  pendingColor?: string;
}

/**
 * Step Progress Component
 */
export function StepProgress({
  steps,
  currentStep,
  completedColor = "green",
  currentColor = "cyan",
  pendingColor = "gray",
}: StepProgressProps) {
  return (
    <Box flexDirection="column">
      {steps.map((step, index) => {
        let icon: string;
        let textColor: string;

        if (index < currentStep) {
          icon = "✓";
          textColor = completedColor;
        } else if (index === currentStep) {
          icon = "●";
          textColor = currentColor;
        } else {
          icon = "○";
          textColor = pendingColor;
        }

        return (
          <Box key={index}>
            <Text color={textColor}>{icon} </Text>
            <Text color={textColor}>{step}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * Props for StatusIndicator
 */
interface StatusIndicatorProps {
  status: "success" | "error" | "warning" | "info" | "pending" | "running";
  text: string;
  showIcon?: boolean;
}

/**
 * Status Indicator Component
 */
export function StatusIndicator({
  status,
  text,
  showIcon = true,
}: StatusIndicatorProps) {
  const config = {
    success: { icon: "✓", color: "green" },
    error: { icon: "✗", color: "red" },
    warning: { icon: "⚠", color: "yellow" },
    info: { icon: "ℹ", color: "blue" },
    pending: { icon: "○", color: "gray" },
    running: { icon: "◐", color: "cyan" },
  };

  const { icon, color } = config[status];

  return (
    <Box>
      {showIcon && <Text color={color}>{icon} </Text>}
      <Text color={color}>{text}</Text>
    </Box>
  );
}

/**
 * Props for CountdownTimer
 */
interface CountdownTimerProps {
  seconds: number;
  onComplete?: () => void;
  format?: "seconds" | "minutes" | "full";
  prefix?: string;
}

/**
 * Countdown Timer Component
 */
export function CountdownTimer({
  seconds: initialSeconds,
  onComplete,
  format = "seconds",
  prefix = "Time remaining: ",
}: CountdownTimerProps) {
  const [seconds, setSeconds] = useState(initialSeconds);

  useEffect(() => {
    if (seconds <= 0) {
      onComplete?.();
      return;
    }

    const interval = setInterval(() => {
      setSeconds((prev) => prev - 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [seconds, onComplete]);

  const formatTime = (secs: number): string => {
    if (format === "seconds") {
      return `${secs}s`;
    } else if (format === "minutes") {
      const mins = Math.floor(secs / 60);
      const remainingSecs = secs % 60;
      return `${mins}:${remainingSecs.toString().padStart(2, "0")}`;
    } else {
      const hours = Math.floor(secs / 3600);
      const mins = Math.floor((secs % 3600) / 60);
      const remainingSecs = secs % 60;
      return `${hours}:${mins.toString().padStart(2, "0")}:${remainingSecs.toString().padStart(2, "0")}`;
    }
  };

  return (
    <Box>
      <Text dimColor>{prefix}</Text>
      <Text color={seconds <= 10 ? "red" : "cyan"}>{formatTime(seconds)}</Text>
    </Box>
  );
}

/**
 * Props for TaskList
 */
interface TaskListProps {
  tasks: Array<{
    name: string;
    status: "pending" | "running" | "completed" | "failed" | "skipped";
    duration?: number;
  }>;
}

/**
 * Task List Component
 */
export function TaskList({ tasks }: TaskListProps) {
  const [runningFrame, setRunningFrame] = useState(0);
  const spinnerFrames = SPINNER_FRAMES.dots;

  useEffect(() => {
    const hasRunning = tasks.some((t) => t.status === "running");
    if (!hasRunning) return;

    const interval = setInterval(() => {
      setRunningFrame((prev) => (prev + 1) % spinnerFrames.length);
    }, 80);

    return () => clearInterval(interval);
  }, [tasks, spinnerFrames.length]);

  const getIcon = (status: string): string => {
    switch (status) {
      case "completed":
        return "✓";
      case "failed":
        return "✗";
      case "running":
        return spinnerFrames[runningFrame];
      case "skipped":
        return "⊘";
      default:
        return "○";
    }
  };

  const getColor = (status: string): string => {
    switch (status) {
      case "completed":
        return "green";
      case "failed":
        return "red";
      case "running":
        return "cyan";
      case "skipped":
        return "yellow";
      default:
        return "gray";
    }
  };

  return (
    <Box flexDirection="column">
      {tasks.map((task, index) => (
        <Box key={index}>
          <Text color={getColor(task.status)}>{getIcon(task.status)} </Text>
          <Text color={getColor(task.status)}>{task.name}</Text>
          {task.duration !== undefined && task.status === "completed" && (
            <Text dimColor> ({task.duration}ms)</Text>
          )}
        </Box>
      ))}
    </Box>
  );
}

/**
 * Props for InfoPanel
 */
interface InfoPanelProps {
  title: string;
  content: string | string[];
  type?: "info" | "warning" | "error" | "success" | "tip";
  width?: number;
}

/**
 * Info Panel Component (Tooltip-like)
 */
export function InfoPanel({
  title,
  content,
  type = "info",
  width = 50,
}: InfoPanelProps) {
  const colors = {
    info: "blue",
    warning: "yellow",
    error: "red",
    success: "green",
    tip: "magenta",
  };

  const icons = {
    info: "ℹ",
    warning: "⚠",
    error: "✗",
    success: "✓",
    tip: "💡",
  };

  const borderColor = colors[type];
  const lines = Array.isArray(content) ? content : [content];
  const border = "─".repeat(width - 2);

  return (
    <Box flexDirection="column">
      <Text color={borderColor}>┌{border}┐</Text>
      <Box>
        <Text color={borderColor}>│ </Text>
        <Text color={borderColor} bold>
          {icons[type]} {title}
        </Text>
        <Text color={borderColor}>
          {" ".repeat(Math.max(0, width - title.length - 5))}│
        </Text>
      </Box>
      <Text color={borderColor}>├{border}┤</Text>
      {lines.map((line, index) => (
        <Box key={index}>
          <Text color={borderColor}>│ </Text>
          <Text>{line}</Text>
          <Text color={borderColor}>
            {" ".repeat(Math.max(0, width - line.length - 4))}│
          </Text>
        </Box>
      ))}
      <Text color={borderColor}>└{border}┘</Text>
    </Box>
  );
}

/**
 * Props for DataTable
 */
interface DataTableProps {
  headers: string[];
  rows: string[][];
  maxWidth?: number;
}

/**
 * Simple Data Table Component
 */
export function DataTable({ headers, rows, maxWidth = 80 }: DataTableProps) {
  // Calculate column widths
  const colWidths = headers.map((header, i) => {
    const maxInColumn = Math.max(
      header.length,
      ...rows.map((row) => (row[i] || "").length)
    );
    return Math.min(maxInColumn, Math.floor(maxWidth / headers.length));
  });

  const formatCell = (content: string, width: number): string => {
    if (content.length > width) {
      return content.slice(0, width - 1) + "…";
    }
    return content.padEnd(width);
  };

  const headerRow = headers
    .map((h, i) => formatCell(h, colWidths[i]))
    .join(" │ ");
  const separator = colWidths.map((w) => "─".repeat(w)).join("─┼─");

  return (
    <Box flexDirection="column">
      <Text bold>{headerRow}</Text>
      <Text dimColor>{separator}</Text>
      {rows.map((row, rowIndex) => (
        <Text key={rowIndex}>
          {row.map((cell, i) => formatCell(cell || "", colWidths[i])).join(" │ ")}
        </Text>
      ))}
    </Box>
  );
}

/**
 * Props for Badge
 */
interface BadgeProps {
  text: string;
  color?: string;
  backgroundColor?: string;
}

/**
 * Badge Component
 */
export function Badge({
  text,
  color = "white",
  backgroundColor = "blue",
}: BadgeProps) {
  return (
    <Text color={color} backgroundColor={backgroundColor}>
      {" "}
      {text}{" "}
    </Text>
  );
}

/**
 * Props for Divider
 */
interface DividerProps {
  width?: number;
  char?: string;
  title?: string;
  color?: string;
}

/**
 * Divider Component
 */
export function Divider({
  width = 60,
  char = "─",
  title,
  color = "gray",
}: DividerProps) {
  if (title) {
    const sideWidth = Math.floor((width - title.length - 2) / 2);
    const leftSide = char.repeat(sideWidth);
    const rightSide = char.repeat(width - sideWidth - title.length - 2);
    return (
      <Text color={color}>
        {leftSide} {title} {rightSide}
      </Text>
    );
  }

  return <Text color={color}>{char.repeat(width)}</Text>;
}
