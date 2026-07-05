/**
 * SectionCard — headed panel primitive with optional actions slot.
 *
 * @module renderer/components/ui/SectionCard
 */

import type { ReactNode } from 'react';

export interface SectionCardProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function SectionCard({ title, description, actions, children }: SectionCardProps) {
  return (
    <section className="rounded-lg border border-border bg-surface" data-testid="section-card">
      <div className="flex items-start gap-3 border-b border-border p-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}
