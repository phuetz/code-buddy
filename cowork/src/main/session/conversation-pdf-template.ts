/**
 * conversation-pdf-template — the « beau PDF » export for conversations,
 * adapted from Code Explorer's corporate print template (cover page,
 * @page geometry, print-exact colors) onto Code Buddy Studio's identity.
 * Pure string building — no Electron imports, unit-testable.
 */

export interface PdfMessage {
  role: string;
  text: string;
  timestamp?: number;
}

export interface ConversationPdfInput {
  title: string;
  model?: string;
  exportedAt: Date;
  messages: PdfMessage[];
}

export function htmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Minimal, dependency-free markdown rendering for conversation text:
 * fenced code blocks, inline code, bold/italic, paragraphs. Everything is
 * HTML-escaped first — model output can never inject markup.
 */
export function renderMarkdownLite(text: string): string {
  const parts = text.split(/```/);
  let html = '';
  for (let i = 0; i < parts.length; i++) {
    const segment = parts[i] ?? '';
    if (i % 2 === 1) {
      // Code fence: first line may be a language tag.
      const body = segment.replace(/^[\w-]*\n?/, '');
      html += `<pre class="code">${htmlEscape(body)}</pre>`;
    } else {
      const paragraphs = segment
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => {
          let content = htmlEscape(p);
          content = content.replace(/`([^`]+)`/g, '<code>$1</code>');
          content = content.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
          content = content.replace(/\*([^*]+)\*/g, '<em>$1</em>');
          content = content.replace(/\n/g, '<br/>');
          return `<p>${content}</p>`;
        })
        .join('\n');
      html += paragraphs;
    }
  }
  return html;
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export function buildConversationPdfHtml(input: ConversationPdfInput): string {
  const date = input.exportedAt.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const bubbles = input.messages
    .map((message) => {
      const isUser = message.role === 'user';
      const label = isUser ? 'Vous' : 'Code Buddy';
      const time = formatTime(message.timestamp);
      return `<div class="msg ${isUser ? 'user' : 'assistant'}">
  <div class="msg-head">${label}${time ? `<span class="msg-time">${time}</span>` : ''}</div>
  <div class="msg-body">${renderMarkdownLite(message.text)}</div>
</div>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8"/>
<title>${htmlEscape(input.title)}</title>
<style>
@page { size: A4; margin: 2.2cm 1.8cm; }
@page :first { margin: 0; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: 'Segoe UI', Calibri, 'Helvetica Neue', Arial, sans-serif; font-size: 10.5pt; line-height: 1.55; color: #1a1a1a; margin: 0; }
.cover-page { height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; background: linear-gradient(180deg, #1c1917 0%, #292524 55%, #7c2d12 100%); color: #fafaf9; padding: 4cm 3cm; page-break-after: always; }
.cover-brand { font-size: 11pt; letter-spacing: 0.35em; text-transform: uppercase; color: #fdba74; margin-bottom: 1.2cm; }
.cover-title { font-size: 26pt; font-weight: 700; line-height: 1.25; max-width: 15cm; }
.cover-subtitle { font-size: 12pt; color: #d6d3d1; margin-top: 0.8cm; }
.cover-footer { position: absolute; bottom: 2cm; font-size: 9pt; color: #a8a29e; letter-spacing: 0.08em; }
.document-body { padding-top: 0.2cm; }
.msg { margin: 0 0 14pt 0; page-break-inside: avoid; }
.msg-head { font-size: 8.5pt; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 3pt; }
.msg.user .msg-head { color: #57534e; }
.msg.assistant .msg-head { color: #c2410c; }
.msg-time { font-weight: 400; margin-left: 6pt; color: #a8a29e; letter-spacing: 0; text-transform: none; }
.msg-body { border-left: 2.5pt solid #e7e5e4; padding: 2pt 0 2pt 10pt; }
.msg.assistant .msg-body { border-left-color: #fdba74; }
.msg-body p { margin: 0 0 6pt 0; }
.msg-body p:last-child { margin-bottom: 0; }
pre.code { background: #f5f5f4; border: 0.5pt solid #e7e5e4; border-radius: 4pt; padding: 8pt 10pt; font-family: 'Cascadia Code', Consolas, 'Courier New', monospace; font-size: 8.5pt; line-height: 1.45; white-space: pre-wrap; word-break: break-word; page-break-inside: avoid; }
code { background: #f5f5f4; border-radius: 2pt; padding: 0.5pt 3pt; font-family: Consolas, monospace; font-size: 9pt; }
</style>
</head>
<body>
<div class="cover-page">
  <div class="cover-brand">Conversation</div>
  <div class="cover-title">${htmlEscape(input.title)}</div>
  <div class="cover-subtitle">${date}${input.model ? ` · ${htmlEscape(input.model)}` : ''} · ${input.messages.length} message${input.messages.length > 1 ? 's' : ''}</div>
  <div class="cover-footer">Généré par Code Buddy Studio</div>
</div>
<div class="document-body">
${bubbles}
</div>
</body>
</html>`;
}
