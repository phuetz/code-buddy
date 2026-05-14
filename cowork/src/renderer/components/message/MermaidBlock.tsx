import { useEffect, useState, memo } from 'react';
import DOMPurify from 'dompurify';

/**
 * Lazy-import mermaid the first time a mermaid block renders. Saves
 * ~500 KB from the initial Cowork bundle for users who never see a
 * Mermaid diagram. The promise is module-scoped so concurrent first
 * renders share the same fetch + initialize cycle.
 */
let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;
function loadMermaid(): Promise<typeof import('mermaid').default> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => {
      const mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        // strict — Mermaid will sanitize HTML labels; we ALSO DOMPurify
        // the rendered SVG below as defense-in-depth.
        securityLevel: 'strict',
        theme: 'dark',
        fontFamily: 'inherit',
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

/** Cache rendered+sanitized SVG by source text — re-renders are free. */
const renderCache = new Map<string, string>();
let renderCounter = 0;

interface MermaidBlockProps {
  /** The Mermaid source text (without the surrounding code-fence markers). */
  text: string;
}

/**
 * Inline Mermaid diagram renderer for the chat message stream.
 * Mirrors the chat-ui gitnexus-rs `MermaidBlock` pattern: lazy
 * `import('mermaid')`, render to SVG, DOMPurify with strict SVG
 * profile, then `dangerouslySetInnerHTML` (the only safe path for
 * SVG insertion in React).
 *
 * On render error, falls back to the source text in a `<pre>` block
 * so the user still sees what was attempted.
 */
export const MermaidBlock = memo(function MermaidBlock({ text }: MermaidBlockProps) {
  const cached = renderCache.get(text) ?? null;
  const [svg, setSvg] = useState<string | null>(cached);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fromCache = renderCache.get(text);
    if (fromCache) {
      setSvg(fromCache);
      setError(null);
      return;
    }
    let cancelled = false;
    loadMermaid()
      .then(async (mermaid) => {
        try {
          renderCounter += 1;
          const renderId = `mermaid-block-${renderCounter}`;
          const { svg: rendered } = await mermaid.render(renderId, text);
          // Strict SVG profile — strips <script>, on-event handlers, etc.
          // <foreignObject> is allow-listed so HTML labels in flowcharts
          // still render (Mermaid uses them for wrapped text).
          const sanitized = DOMPurify.sanitize(rendered, {
            USE_PROFILES: { svg: true, svgFilters: true },
            ADD_TAGS: ['foreignObject'],
          });
          if (cancelled) return;
          renderCache.set(text, sanitized);
          setSvg(sanitized);
          setError(null);
        } catch (renderErr) {
          if (cancelled) return;
          setError(renderErr instanceof Error ? renderErr.message : String(renderErr));
        }
      })
      .catch((loadErr) => {
        if (cancelled) return;
        setError(loadErr instanceof Error ? loadErr.message : String(loadErr));
      });
    return () => {
      cancelled = true;
    };
  }, [text]);

  if (error) {
    return (
      <div className="my-2 rounded-lg border border-error/40 bg-error/5 p-2.5 text-sm">
        <div className="text-error font-medium mb-1">
          Mermaid render failed: {error}
        </div>
        <pre className="text-xs font-mono text-text-muted whitespace-pre-wrap break-all">
          {text}
        </pre>
      </div>
    );
  }

  if (!svg) {
    // Loading state — preserve the source as a placeholder so the
    // user never sees a blank gap mid-stream.
    return (
      <pre className="my-2 rounded-lg bg-surface-muted p-2.5 text-xs font-mono text-text-muted whitespace-pre-wrap break-all">
        {text}
      </pre>
    );
  }

  return (
    <div
      className="my-2 rounded-lg overflow-x-auto bg-surface-muted p-2.5 flex justify-center"
      data-testid="mermaid-svg-container"
      // SVG sanitized above via DOMPurify (strict SVG profile).
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
});
