import { memo, type MouseEvent, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import { CodeBlock } from './message/CodeBlock';
import { MermaidBlock } from './message/MermaidBlock';

// Hoisted to module scope to avoid re-creating arrays on every render
const REMARK_PLUGINS = [remarkMath, [remarkGfm, { singleTilde: false }]] as const;

// No rehype-sanitize: this pipeline has no rehype-raw, so react-markdown escapes
// any inline HTML from the model (never rendered as HTML). The only generated HTML
// comes from rehypeKatex, which is safe. Sanitizing here only stripped KaTeX's
// MathML/classes/styles and rendered every formula as three stacked plain-text
// copies (proven fix, matches the Lisa renderer).
const REHYPE_PLUGINS = [[rehypeKatex, { throwOnError: false, strict: false }]] as const;

// Default code rendering for EVERY MessageMarkdown context (ThinkingBlock,
// FilePreviewPane, LiveLauncherPanel, …): fenced blocks → CodeBlock (highlight +
// copy + "open as artifact"); inline code → a styled <code>. Callers can still
// override via the `components` prop (e.g. ContentBlockView's file-mention code).
const SAFE_HREF_RE = /^(?:https?:|mailto:|#)/i;

function isSafeHref(href: string | undefined): href is string {
  return typeof href === 'string' && SAFE_HREF_RE.test(href) && !/[<>"'\s]/.test(href);
}

const DEFAULT_COMPONENTS = {
  a({ href, children, ...props }: { href?: string; children?: ReactNode }) {
    const safeHref = isSafeHref(href) ? href : undefined;
    return (
      <a
        {...props}
        href={safeHref}
        target={safeHref?.startsWith('http') ? '_blank' : undefined}
        rel={safeHref?.startsWith('http') ? 'noopener noreferrer' : undefined}
        onClick={(e: MouseEvent<HTMLAnchorElement>) => {
          if (safeHref && typeof window !== 'undefined' && window.electronAPI?.openExternal) {
            e.preventDefault();
            void window.electronAPI.openExternal(safeHref);
          }
        }}
      >
        {children}
      </a>
    );
  },
  code({ className, children, ...props }: { className?: string; children?: ReactNode }) {
    const match = /language-([\w+#.-]+)/.exec(className || '');
    if (!match) {
      return (
        <code className="px-1.5 py-0.5 rounded bg-surface-muted text-accent font-mono text-sm" {...props}>
          {children}
        </code>
      );
    }
    const lang = match[1];
    const source = String(children).replace(/\n$/, '');
    // Render mermaid fences as inline SVG diagrams instead of highlighted text.
    if (lang.toLowerCase() === 'mermaid') {
      return <MermaidBlock text={source} />;
    }
    return <CodeBlock language={lang}>{source}</CodeBlock>;
  },
};

export interface MessageMarkdownProps {
  normalizedText: string;
  isStreaming?: boolean;
  components?: Record<string, unknown>;
}

export const MessageMarkdown = memo(function MessageMarkdown({
  normalizedText,
  isStreaming,
  components,
}: MessageMarkdownProps) {
  return (
    <div className="prose-chat max-w-none text-text-primary">
      <ReactMarkdown
        remarkPlugins={
          REMARK_PLUGINS as unknown as Parameters<typeof ReactMarkdown>[0]['remarkPlugins']
        }
        rehypePlugins={
          REHYPE_PLUGINS as unknown as Parameters<typeof ReactMarkdown>[0]['rehypePlugins']
        }
        components={
          { ...DEFAULT_COMPONENTS, ...components } as Parameters<typeof ReactMarkdown>[0]['components']
        }
      >
        {normalizedText}
      </ReactMarkdown>
      {isStreaming && <span className="inline-block w-2 h-4 bg-accent ml-1 animate-pulse" />}
    </div>
  );
});
