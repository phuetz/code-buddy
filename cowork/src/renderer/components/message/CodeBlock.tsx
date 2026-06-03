// Fenced code block with syntax highlighting (highlight.js) and copy button
import { useState, useMemo, memo } from 'react';
import { Copy, Check } from 'lucide-react';
import type { LanguageFn } from 'highlight.js';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import ini from 'highlight.js/lib/languages/ini';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import plaintext from 'highlight.js/lib/languages/plaintext';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

const languageDefinitions: Array<[name: string, definition: LanguageFn, aliases?: string[]]> = [
  ['bash', bash, ['sh', 'shell', 'zsh']],
  ['css', css],
  ['diff', diff, ['patch']],
  ['dockerfile', dockerfile, ['docker']],
  ['ini', ini, ['toml', 'properties', 'env']],
  ['javascript', javascript, ['js', 'jsx', 'mjs', 'cjs']],
  ['json', json, ['jsonc']],
  ['markdown', markdown, ['md']],
  ['plaintext', plaintext, ['text', 'txt']],
  ['powershell', powershell, ['ps1', 'pwsh']],
  ['python', python, ['py']],
  ['sql', sql],
  ['typescript', typescript, ['ts', 'tsx']],
  ['xml', xml, ['html', 'svg']],
  ['yaml', yaml, ['yml']],
];

for (const [name, definition, aliases] of languageDefinitions) {
  hljs.registerLanguage(name, definition);
  if (aliases) {
    hljs.registerAliases(aliases, { languageName: name });
  }
}

// Sanitize highlight.js output - only allow highlight span tags
const sanitizeHighlight = (html: string): string =>
  html.replace(/<(?!\/?span(?:\s+class="hljs-[^"]*")?\s*\/?>)[^>]*>/g, (match) =>
    match.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  );

interface CodeBlockProps {
  language: string;
  children: string;
}

export const CodeBlock = memo(function CodeBlock({ language, children }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const highlightedHtml = useMemo(() => {
    try {
      const lang = language.trim().toLowerCase();
      let result: string;
      if (hljs.getLanguage(lang)) {
        result = hljs.highlight(children, { language: lang }).value;
      } else {
        result = hljs.highlightAuto(children, hljs.listLanguages()).value;
      }
      return sanitizeHighlight(result);
    } catch {
      return null;
    }
  }, [children, language]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard write can fail if focus is lost or permission denied
    }
  };

  return (
    <div className="relative group my-3">
      <div className="absolute top-2 right-2 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="text-xs text-text-muted px-2 py-1 rounded bg-surface">{language}</span>
        <button
          onClick={handleCopy}
          className="w-7 h-7 flex items-center justify-center rounded bg-surface hover:bg-surface-hover transition-colors"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-success" />
          ) : (
            <Copy className="w-3.5 h-3.5 text-text-muted" />
          )}
        </button>
      </div>
      <pre className="code-block">
        {highlightedHtml ? (
          // highlight.js sanitizes and escapes input before injecting span tokens
          <code dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
        ) : (
          <code>{children}</code>
        )}
      </pre>
    </div>
  );
});
