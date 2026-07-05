/**
 * EmptyState — honest empty-state primitive with optional action.
 *
 * @module renderer/components/ui/EmptyState
 */

import type { ReactNode } from 'react';

export interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  hint: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, hint, action }: EmptyStateProps) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center rounded-lg border border-border bg-background p-4 text-center" data-testid="empty-state">
      <div className="mb-3 text-muted-foreground">{icon}</div>
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <p className="mt-1 max-w-sm text-xs text-muted-foreground">{hint}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
