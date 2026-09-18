/**
 * Turn a Cowork artefact into Markdown suitable for local office export.
 *
 * @module renderer/utils/artifact-office-source
 */

export interface OfficeSourceArtifact {
  kind: string;
  source: string;
  title?: string;
  report?: {
    title: string;
    body: string;
    sources: Array<{ n: number; label: string; url?: string; page?: string; section?: string }>;
  };
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

export function htmlFragmentToMarkdown(html: string): string {
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level, inner) => {
    const hashes = '#'.repeat(Number(level) || 1);
    return `\n${hashes} ${stripTags(inner)}\n`;
  });
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner) => `- ${stripTags(inner)}\n`);
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_m, inner) => `${stripTags(inner)}\n\n`);
  text = text.replace(/<[^>]+>/g, '');
  return decodeEntities(text).replace(/\n{3,}/g, '\n\n').trim();
}

function reportToMarkdown(report: NonNullable<OfficeSourceArtifact['report']>): string {
  const refs = report.sources
    .map((source) => {
      let line = `[${source.n}] ${source.label}`;
      if (source.url) line += ` — ${source.url}`;
      const meta = [source.page ? `p.${source.page}` : '', source.section ?? ''].filter(Boolean).join(', ');
      if (meta) line += ` (${meta})`;
      return line;
    })
    .join('\n');
  return `${report.body}\n\n## Références\n\n${refs}\n`;
}

export function artifactToMarkdown(artifact: OfficeSourceArtifact): string {
  if (artifact.kind === 'report' && artifact.report) {
    return reportToMarkdown(artifact.report);
  }
  if (artifact.kind === 'table') {
    return artifact.source;
  }
  if (artifact.kind === 'html') {
    return htmlFragmentToMarkdown(artifact.source);
  }
  if (artifact.kind === 'svg') {
    const title = artifact.title ? `# ${artifact.title}\n\n` : '';
    return `${title}\`\`\`xml\n${artifact.source}\n\`\`\`\n`;
  }
  const fence =
    artifact.kind === 'json'
      ? 'json'
      : artifact.kind === 'mermaid'
        ? 'mermaid'
        : artifact.kind === 'react'
          ? 'jsx'
          : '';
  const title = artifact.title ? `# ${artifact.title}\n\n` : '';
  return `${title}\`\`\`${fence}\n${artifact.source}\n\`\`\`\n`;
}
