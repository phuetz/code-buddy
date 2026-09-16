/**
 * Push an auto-rendered widget onto the in-process canvas store.
 * Opt-in via CODEBUDDY_WIDGETS + CODEBUDDY_WIDGETS_AUTO (autoWidget gate).
 * Never throws; a missing/unsafe widget leaves the canvas untouched.
 *
 * @module widgets/canvas-publish
 */
import { canvasStore } from '../server/routes/canvas.js';
import { autoWidget, type AutoWidgetDeps, type AutoWidgetResult } from './auto-widget.js';

export interface PublishedWidget extends AutoWidgetResult {
  canvasId: string | null;
  canvasPath: string | null;
}

function unpublished(widget: AutoWidgetResult): PublishedWidget {
  return { ...widget, canvasId: null, canvasPath: null };
}

/**
 * Detect + render at most one widget and, if HTML exists, publish it to canvas.
 * Callers must not claim a render when canvasId is null.
 */
export async function publishAnswerWidget(
  answer: string,
  payloads: readonly unknown[] = [],
  deps: AutoWidgetDeps = {},
): Promise<PublishedWidget> {
  try {
    const widget = await autoWidget(answer, payloads, deps);
    if (!widget.widgetHtml) return unpublished(widget);
    const snapshot = canvasStore.push(widget.widgetHtml, undefined, undefined, {
      dataType: widget.candidate?.dataType,
    });
    return {
      ...widget,
      canvasId: snapshot.id,
      canvasPath: `/__codebuddy__/canvas/${snapshot.id}`,
    };
  } catch {
    return unpublished({ answer, widgetHtml: null, candidate: null });
  }
}

/** Convenience for a single tool result (`data:{type}` payload). */
export async function publishToolResultWidget(
  result: { output?: string; data?: unknown },
  deps: AutoWidgetDeps = {},
): Promise<PublishedWidget> {
  return publishAnswerWidget(result.output ?? '', [result], deps);
}
