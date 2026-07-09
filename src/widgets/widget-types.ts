/**
 * Widgets — rich, self-contained UI components rendered INLINE in a conversation
 * (ChatGPT-Apps-SDK style), driven by a tool's structured `data` payload.
 *
 * A widget is a body fragment (HTML + scoped CSS + JS) that reads its data from
 * `window.__WIDGET_DATA__` and renders into the page. `renderWidgetDocument`
 * wraps it in a sandboxed HTML document with the data injected. Curated widgets
 * ship in-repo; authored ones are generated on the fly and reused (see the
 * self-learning engine, Phase 2) — mirroring the authored-skills pattern.
 *
 * @module widgets/widget-types
 */

/** The structured payload a tool emits for a weather widget (aligns with WeatherTool.data). */
export interface WeatherWidgetData {
  type: 'weather';
  location: string;
  current: {
    temperature: number;
    feelsLike?: number;
    condition: string;
    humidity?: number;
    windSpeed?: number;
  };
  forecast?: Array<{ day: string; min: number; max: number; condition: string }>;
  units?: 'metric' | 'imperial';
}

/** The structured payload for a news/headlines widget. */
export interface NewsWidgetData {
  type: 'news';
  title?: string;
  items: Array<{ title: string; url?: string; source?: string }>;
}

export type WidgetData =
  | WeatherWidgetData
  | NewsWidgetData
  | { type: string; [k: string]: unknown };

/** The `type` discriminator of a widget payload (also the widget "kind"). */
export function widgetKind(data: unknown): string | null {
  const t = (data as { type?: unknown })?.type;
  return typeof t === 'string' && t.trim() ? t.trim() : null;
}

/** A candidate authored widget (LLM-proposed), before it clears the gate. */
export interface WidgetProposal {
  /** The data `type` this widget renders. */
  kind: string;
  /** SAFE Mustache-style HTML+CSS template (no script), read by the template engine. */
  template: string;
  /** Sample data the gate renders the template against. */
  sample: unknown;
  /** Optional human-readable brief the proposer was given. */
  brief?: string;
}

/** Result of running a proposal through the widget gate (fail-closed). */
export interface WidgetGateOutcome {
  accepted: boolean;
  /** Short machine reason on reject (`static-scan` | `render-empty` | `render-unsafe` | `unrendered-tokens`). */
  reason?: string;
  reasons?: string[];
  /** The rendered sample fragment, present only on accept. */
  fragment?: string;
}
