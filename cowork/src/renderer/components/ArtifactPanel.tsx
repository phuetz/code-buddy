/**
 * ArtifactPanel — Claude Cowork parity Phase 2 step 10
 *
 * Slide-out panel that renders artifacts detected in assistant messages:
 * HTML (sandboxed iframe), SVG (inline), Mermaid (client-side render),
 * React/JSX (live preview via CDN React+Babel), JSON (pretty-printed).
 *
 * Driven by store.activeArtifact — setting it opens the panel.
 *
 * @module renderer/components/ArtifactPanel
 */

import React, { useEffect, useMemo, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useTranslation } from 'react-i18next';
import { X, Code2, Eye, Copy, Check, Download, FileCode } from 'lucide-react';
import { useAppStore } from '../store';
import { AgenticHarnessStrip, parseAgenticHarnessArtifact } from './agentic-harness-strip';
import { buildReactPreviewDoc } from '../utils/react-preview';
import { ReportArtifact } from './artifacts/ReportArtifact';
import { TableArtifact } from './artifacts/TableArtifact';
import { MessageMarkdown } from './MessageMarkdown';
import type { ReportArtifactData } from '../utils/artifact-detector';

type TabKey = 'preview' | 'source';

function escapeHtml(input: string): string {
  return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Rebuild a `.md` document from a parsed report (body + a references list). */
function buildReportMarkdown(report: ReportArtifactData): string {
  const refs = report.sources
    .map((s) => {
      let line = `[${s.n}] ${s.label}`;
      if (s.url) line += ` — ${s.url}`;
      const meta = [s.page ? `p.${s.page}` : '', s.section ?? ''].filter(Boolean).join(', ');
      if (meta) line += ` (${meta})`;
      return line;
    })
    .join('\n');
  return `${report.body}\n\n## Références\n\n${refs}\n`;
}

/** Wrap the rendered report in a minimal, self-contained HTML doc (Sparkpage export). */
function buildReportHtml(report: ReportArtifactData): string {
  let bodyHtml: string;
  try {
    bodyHtml = renderToStaticMarkup(
      React.createElement(MessageMarkdown, { normalizedText: report.body })
    );
  } catch {
    bodyHtml = `<pre>${escapeHtml(report.body)}</pre>`;
  }
  const sourcesHtml = report.sources
    .map((s) => {
      const meta = [s.page ? `p.${escapeHtml(s.page)}` : '', s.section ? escapeHtml(s.section) : '']
        .filter(Boolean)
        .join(' · ');
      const label = s.url
        ? `<a href="${escapeHtml(s.url)}" target="_blank" rel="noreferrer">${escapeHtml(s.label)}</a>`
        : escapeHtml(s.label);
      return `<li><span class="n">[${s.n}]</span> ${label}${meta ? ` <span class="meta">${meta}</span>` : ''}</li>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(report.title)}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; line-height: 1.6; color: #1a1a1a; background: #fff; }
  .layout { display: flex; gap: 2rem; max-width: 1080px; margin: 0 auto; padding: 2.5rem 1.5rem; align-items: flex-start; }
  .report { flex: 1 1 auto; min-width: 0; }
  .report h1 { font-size: 1.8rem; line-height: 1.25; margin: 0 0 1rem; }
  .report h2 { font-size: 1.3rem; margin: 2rem 0 0.75rem; }
  .report h3 { font-size: 1.1rem; margin: 1.5rem 0 0.5rem; }
  .report p { margin: 0 0 1rem; }
  .report ul, .report ol { padding-left: 1.4rem; margin: 0 0 1rem; }
  .report a { color: #2563eb; }
  .report code { background: rgba(127,127,127,0.15); padding: 0.1em 0.35em; border-radius: 4px; font-size: 0.9em; }
  .report pre { background: rgba(127,127,127,0.12); padding: 1rem; border-radius: 8px; overflow-x: auto; }
  .report table { border-collapse: collapse; width: 100%; margin: 0 0 1rem; }
  .report th, .report td { border: 1px solid rgba(127,127,127,0.3); padding: 0.4rem 0.6rem; text-align: left; }
  aside.sources { flex: 0 0 240px; border-left: 1px solid rgba(127,127,127,0.25); padding-left: 1.25rem; position: sticky; top: 1rem; }
  aside.sources h2 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: #666; margin: 0 0 0.75rem; }
  .src-list { list-style: none; margin: 0; padding: 0; font-size: 0.85rem; }
  .src-list li { margin-bottom: 0.6rem; }
  .src-list .n { font-family: ui-monospace, monospace; color: #2563eb; margin-right: 0.25rem; }
  .src-list .meta { display: inline-block; margin-left: 0.35rem; color: #888; font-size: 0.75rem; }
  @media (prefers-color-scheme: dark) {
    body { color: #e6e6e6; background: #16181d; }
    aside.sources h2 { color: #999; }
    .report a, .src-list .n { color: #6ea8fe; }
  }
  @media (max-width: 720px) { .layout { flex-direction: column; } aside.sources { border-left: 0; border-top: 1px solid rgba(127,127,127,0.25); padding-left: 0; padding-top: 1rem; position: static; } }
</style>
</head>
<body>
<div class="layout">
<main class="report">
${bodyHtml}
</main>
<aside class="sources">
<h2>Sources</h2>
<ol class="src-list">${sourcesHtml}</ol>
</aside>
</div>
</body>
</html>`;
}

function triggerDownload(content: string, filename: string, mime = 'text/plain'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Build a self-contained HTML document for the iframe sandbox.
 * Mermaid loads from a local copy bundled with the renderer (or CDN fallback
 * if not available — gated by CSP in the iframe).
 */
function buildIframeDoc(kind: 'html' | 'svg' | 'mermaid' | 'react', source: string): string {
  if (kind === 'html') {
    // If the source is a full HTML document, use it as-is.
    if (/<html[\s>]/i.test(source)) return source;
    // Otherwise wrap it with a minimal shell.
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Artifact</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 16px; color: #111; background: #fff; }
  </style>
</head>
<body>
${source}
</body>
</html>`;
  }

  if (kind === 'svg') {
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { margin: 0; padding: 16px; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #fff; }
    svg { max-width: 100%; max-height: 100%; }
  </style>
</head>
<body>
${source}
</body>
</html>`;
  }

  if (kind === 'mermaid') {
    const escaped = escapeHtml(source);
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
  <style>
    body { font-family: system-ui, sans-serif; margin: 16px; background: #fff; }
    .mermaid { background: #fff; }
  </style>
</head>
<body>
  <div class="mermaid">${escaped}</div>
  <script>
    if (window.mermaid) {
      window.mermaid.initialize({ startOnLoad: true, theme: 'default', securityLevel: 'strict' });
    }
  </script>
</body>
</html>`;
  }

  if (kind === 'react') {
    // React lives only in the sandboxed iframe (React/ReactDOM/Babel from CDN, like
    // mermaid). The harness (strip modules, find component, inject hooks) is a pure,
    // tested helper.
    return buildReactPreviewDoc(source);
  }

  return '';
}

export const ArtifactPanel: React.FC<{ inline?: boolean }> = ({ inline = false }) => {
  const { t } = useTranslation();
  const activeArtifact = useAppStore((s) => s.activeArtifact);
  const setActiveArtifact = useAppStore((s) => s.setActiveArtifact);
  const [tab, setTab] = useState<TabKey>('preview');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!activeArtifact) return;
    setTab('preview');
    setCopied(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveArtifact(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeArtifact, setActiveArtifact]);

  const iframeDoc = useMemo(() => {
    if (!activeArtifact) return '';
    if (
      activeArtifact.kind === 'html' ||
      activeArtifact.kind === 'svg' ||
      activeArtifact.kind === 'mermaid' ||
      activeArtifact.kind === 'react'
    ) {
      return buildIframeDoc(activeArtifact.kind, activeArtifact.source);
    }
    return '';
  }, [activeArtifact]);

  const agenticHarness = useMemo(() => {
    if (!activeArtifact || activeArtifact.kind !== 'json') {
      return null;
    }
    return parseAgenticHarnessArtifact(activeArtifact.source);
  }, [activeArtifact]);

  if (!activeArtifact) {
    return inline ? <div className="flex h-full items-center justify-center p-6 text-xs text-text-muted">Aucun artefact pour cette session.</div> : null;
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeArtifact.source);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('[ArtifactPanel] copy failed:', err);
    }
  };

  const baseName = activeArtifact.title ?? activeArtifact.id;

  const handleDownload = () => {
    // report / table save as `.md` (report rebuilds a references list).
    if (activeArtifact.kind === 'report' && activeArtifact.report) {
      triggerDownload(buildReportMarkdown(activeArtifact.report), `${baseName}.md`, 'text/markdown');
      return;
    }
    if (activeArtifact.kind === 'table') {
      triggerDownload(activeArtifact.source, `${baseName}.md`, 'text/markdown');
      return;
    }
    const ext =
      activeArtifact.kind === 'html'
        ? 'html'
        : activeArtifact.kind === 'svg'
          ? 'svg'
          : activeArtifact.kind === 'mermaid'
            ? 'mmd'
            : activeArtifact.kind === 'json'
              ? 'json'
              : 'txt';
    triggerDownload(activeArtifact.source, `${baseName}.${ext}`);
  };

  const handleExportHtml = () => {
    if (activeArtifact.kind !== 'report' || !activeArtifact.report) return;
    triggerDownload(buildReportHtml(activeArtifact.report), `${baseName}.html`, 'text/html');
  };

  const isReport = activeArtifact.kind === 'report';
  const isTable = activeArtifact.kind === 'table';

  const canPreview =
    activeArtifact.kind === 'html' ||
    activeArtifact.kind === 'svg' ||
    activeArtifact.kind === 'mermaid' ||
    activeArtifact.kind === 'react' ||
    isReport ||
    isTable ||
    Boolean(agenticHarness);

  return (
    <div className={inline
      ? 'h-full min-h-0 bg-background flex flex-col'
      : 'fixed right-0 top-0 bottom-0 w-[560px] max-w-[90vw] bg-background border-l border-border shadow-elevated z-40 flex flex-col'}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-muted shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Code2 size={14} className="text-accent shrink-0" />
          <div className="min-w-0">
            <div className="text-xs font-semibold text-text-primary truncate">
              {activeArtifact.title ?? t(`artifact.kind.${activeArtifact.kind}`)}
            </div>
            <div className="text-[10px] text-text-muted uppercase tracking-wide">
              {activeArtifact.kind} · {activeArtifact.source.length} {t('artifact.chars')}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isReport && (
            <button
              onClick={handleExportHtml}
              className="flex items-center gap-1 px-2 py-1 text-[10px] text-text-muted hover:text-text-primary hover:bg-surface-hover rounded transition-colors"
              title={t('artifact.exportHtml')}
            >
              <FileCode size={12} />
              HTML
            </button>
          )}
          <button
            onClick={handleCopy}
            className="p-1.5 text-text-muted hover:text-text-primary hover:bg-surface-hover rounded transition-colors"
            title={t('common.copy')}
          >
            {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
          </button>
          <button
            onClick={handleDownload}
            className="p-1.5 text-text-muted hover:text-text-primary hover:bg-surface-hover rounded transition-colors"
            title={t('common.download')}
          >
            <Download size={12} />
          </button>
          <button
            onClick={() => setActiveArtifact(null)}
            className="p-1.5 text-text-muted hover:text-text-primary hover:bg-surface-hover rounded transition-colors"
            title={t('common.close')}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      {canPreview && (
        <div className="flex border-b border-border-muted shrink-0">
          <button
            onClick={() => setTab('preview')}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs border-b-2 transition-colors ${
              tab === 'preview'
                ? 'border-accent text-text-primary'
                : 'border-transparent text-text-muted hover:text-text-primary'
            }`}
          >
            <Eye size={12} />
            {t('artifact.preview')}
          </button>
          <button
            onClick={() => setTab('source')}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs border-b-2 transition-colors ${
              tab === 'source'
                ? 'border-accent text-text-primary'
                : 'border-transparent text-text-muted hover:text-text-primary'
            }`}
          >
            <Code2 size={12} />
            {t('artifact.source')}
          </button>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-auto">
        {tab === 'preview' && isReport && activeArtifact.report && (
          <ReportArtifact report={activeArtifact.report} />
        )}
        {tab === 'preview' && isTable && activeArtifact.table && (
          <TableArtifact table={activeArtifact.table} />
        )}
        {canPreview &&
          tab === 'preview' &&
          activeArtifact.kind !== 'json' &&
          !isReport &&
          !isTable && (
            <iframe
              key={activeArtifact.id}
              title="artifact-preview"
              sandbox="allow-scripts"
              srcDoc={iframeDoc}
              className="w-full h-full border-0 bg-white"
            />
          )}
        {agenticHarness && tab === 'preview' && (
          <div className="p-4">
            <AgenticHarnessStrip
              harness={agenticHarness}
              sourceKind={activeArtifact.title ?? activeArtifact.language}
            />
          </div>
        )}
        {(tab === 'source' || !canPreview) && (
          <pre className="p-4 text-[11px] leading-relaxed font-mono text-text-primary whitespace-pre-wrap break-words">
            {activeArtifact.source}
          </pre>
        )}
      </div>
    </div>
  );
};
