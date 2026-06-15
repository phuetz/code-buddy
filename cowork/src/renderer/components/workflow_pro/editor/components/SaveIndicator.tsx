/**
 * SaveIndicator — live save status badge for the workflow editor toolbar.
 *
 * Reads `isSaved` and `lastSaved` from the workflow store. Shows:
 *   - "● Unsaved" while there are dirty changes
 *   - "Saving…" briefly when `isSaved` flips from false → true
 *   - "✓ Saved at HH:MM" once persisted (relative for the first 60s)
 */

import React, { useEffect, useRef, useState } from 'react';
import { useWorkflowStore } from '../../store';

interface SaveIndicatorProps {
  darkMode?: boolean;
}

function formatRelative(date: Date, now: number): string {
  const diffSec = Math.max(0, Math.floor((now - date.getTime()) / 1000));
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  return `at ${h}:${m}`;
}

export const SaveIndicator: React.FC<SaveIndicatorProps> = ({ darkMode = false }) => {
  const isSaved = useWorkflowStore((s) => s.isSaved);
  const lastSaved = useWorkflowStore((s) => s.lastSaved);
  const currentWorkflowId = useWorkflowStore((s) => s.currentWorkflowId);

  const [isSaving, setIsSaving] = useState(false);
  const [tick, setTick] = useState(0);
  const prevIsSaved = useRef(isSaved);

  // Detect the dirty→clean transition and show "Saving…" briefly.
  useEffect(() => {
    if (prevIsSaved.current === false && isSaved === true) {
      setIsSaving(true);
      const t = setTimeout(() => setIsSaving(false), 600);
      return () => clearTimeout(t);
    }
    prevIsSaved.current = isSaved;
  }, [isSaved]);

  // Re-render once per 15s so the "Saved 30s ago" label refreshes.
  useEffect(() => {
    if (!lastSaved) return;
    const i = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(i);
  }, [lastSaved]);

  if (!currentWorkflowId && isSaved) {
    return null;
  }

  let label: string;
  let dotClass: string;
  let textClass: string;

  if (isSaving) {
    label = 'Saving…';
    dotClass = 'bg-blue-500 animate-pulse';
    textClass = darkMode ? 'text-blue-300' : 'text-blue-600';
  } else if (!isSaved) {
    label = 'Unsaved';
    dotClass = 'bg-amber-500';
    textClass = darkMode ? 'text-amber-300' : 'text-amber-700';
  } else if (lastSaved) {
    // Force re-read of `tick` so eslint understands the dep.
    void tick;
    const rel = formatRelative(new Date(lastSaved), Date.now());
    label = `Saved ${rel}`;
    dotClass = 'bg-emerald-500';
    textClass = darkMode ? 'text-emerald-300' : 'text-emerald-700';
  } else {
    return null;
  }

  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs select-none ${textClass}`}
      title={lastSaved ? `Last saved: ${new Date(lastSaved).toLocaleString()}` : label}
      aria-live="polite"
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
};
