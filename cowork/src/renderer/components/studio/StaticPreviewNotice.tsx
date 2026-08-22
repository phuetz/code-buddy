import { FileCode2, Terminal } from 'lucide-react';
import type { PreviewMode } from './static-project-model.js';

/**
 * A small banner explaining how the preview will be served: a static index.html
 * (open directly) vs a dev-server project (npm run dev). Props-driven.
 */
export function StaticPreviewNotice({ mode, entry }: { mode: PreviewMode; entry: string | null }) {
  if (mode === 'static') {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-2.5 py-1.5 text-[11px] text-muted-foreground" data-testid="static-notice">
        <FileCode2 className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
        Static site — the preview serves {entry ?? 'index.html'} directly (no build).
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-2.5 py-1.5 text-[11px] text-muted-foreground" data-testid="static-notice">
      <Terminal className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
      Build project — the preview starts the dev server (npm run dev).
    </div>
  );
}
