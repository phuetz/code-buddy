import { memo, useEffect, useState } from 'react';

interface WidgetBlockProps {
  data: unknown;
  className?: string;
}

function isWidgetCandidate(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as { type?: unknown }).type === 'string'
  );
}

export const WidgetBlock = memo(function WidgetBlock({ data, className = '' }: WidgetBlockProps) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);

    if (!isWidgetCandidate(data) || typeof window === 'undefined') return;
    const render = window.electronAPI?.widgets?.render;
    if (!render) return;

    void render(data)
      .then((nextHtml) => {
        if (!cancelled) setHtml(nextHtml);
      })
      .catch(() => {
        if (!cancelled) setHtml(null);
      });

    return () => {
      cancelled = true;
    };
  }, [data]);

  if (!html) return null;

  return (
    <div
      className={`w-full max-w-[560px] overflow-hidden rounded-lg border border-border-subtle bg-white ${className}`}
    >
      {/* Widgets are rendered SERVER-SIDE (static HTML+CSS, no client script), so
          the iframe needs no `allow-scripts` — full sandbox + popups for outbound
          links only. No `allow-same-origin`. */}
      <iframe
        title="tool-result-widget"
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        srcDoc={html}
        className="block w-full border-0 bg-white"
        style={{ minHeight: 120, height: 'clamp(120px, 38vw, 320px)' }}
      />
    </div>
  );
});
