export interface ChangelogCommit {
  hash: string;
  subject: string;
  body: string;
}

export type ChangelogSectionId =
  | 'breaking'
  | 'features'
  | 'fixes'
  | 'performance'
  | 'docs'
  | 'other';

export interface ParsedConventionalCommit {
  hash: string;
  shortHash: string;
  rawSubject: string;
  subject: string;
  type: string | null;
  scope: string | null;
  breaking: boolean;
  conventional: boolean;
}

export type ChangelogEntry = ParsedConventionalCommit;

export interface ChangelogSection {
  id: ChangelogSectionId;
  title: string;
  entries: ChangelogEntry[];
}

export interface GroupedChangelog {
  totalCommits: number;
  sections: ChangelogSection[];
}

export const CHANGELOG_SECTION_ORDER: ReadonlyArray<
  Readonly<{ id: ChangelogSectionId; title: string }>
> = [
  { id: 'breaking', title: '⚠ Breaking Changes' },
  { id: 'features', title: 'Features' },
  { id: 'fixes', title: 'Bug Fixes' },
  { id: 'performance', title: 'Performance' },
  { id: 'docs', title: 'Docs' },
  { id: 'other', title: 'Autres' },
];

const CONVENTIONAL_HEADER = /^([a-z][a-z0-9-]*)(?:\(([^)\r\n]+)\))?(!)?:\s+(.+)$/;
const BREAKING_FOOTER = /^BREAKING(?: CHANGE|-CHANGE):[ \t]*/m;
const CONVENTIONAL_TYPES = new Set([
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'chore',
  'ci',
  'build',
  'revert',
]);

/** Parse one commit without reading Git or touching the filesystem. */
export function parseConventionalCommit(commit: ChangelogCommit): ParsedConventionalCommit {
  const rawSubject = commit.subject.trim();
  const match = CONVENTIONAL_HEADER.exec(rawSubject);
  const type = match?.[1]?.toLowerCase();

  if (!match || !type || !CONVENTIONAL_TYPES.has(type)) {
    return {
      hash: commit.hash,
      shortHash: commit.hash.slice(0, 7),
      rawSubject,
      subject: rawSubject || '(sans sujet)',
      type: null,
      scope: null,
      breaking: false,
      conventional: false,
    };
  }

  const scope = match[2]?.trim() || null;
  const subject = match[4]?.trim() || '(sans sujet)';

  return {
    hash: commit.hash,
    shortHash: commit.hash.slice(0, 7),
    rawSubject,
    subject,
    type,
    scope,
    breaking: match[3] === '!' || BREAKING_FOOTER.test(commit.body),
    conventional: true,
  };
}

function sectionFor(entry: ParsedConventionalCommit): ChangelogSectionId {
  if (!entry.conventional) return 'other';
  if (entry.breaking) return 'breaking';

  switch (entry.type) {
    case 'feat':
      return 'features';
    case 'fix':
      return 'fixes';
    case 'perf':
      return 'performance';
    case 'docs':
      return 'docs';
    default:
      return 'other';
  }
}

/** Group commits in the stable release-note section order. Each commit appears once. */
export function groupChangelogCommits(commits: readonly ChangelogCommit[]): GroupedChangelog {
  const sections: ChangelogSection[] = CHANGELOG_SECTION_ORDER.map((section) => ({
    ...section,
    entries: [],
  }));
  const sectionsById = new Map(sections.map((section) => [section.id, section]));

  for (const commit of commits) {
    const entry = parseConventionalCommit(commit);
    sectionsById.get(sectionFor(entry))?.entries.push(entry);
  }

  return {
    totalCommits: commits.length,
    sections,
  };
}

function escapeMarkdownInline(value: string): string {
  return value.replace(/([\\`*_[\]<>])/g, '\\$1');
}

function renderEntry(entry: ChangelogEntry): string {
  const subject = escapeMarkdownInline(entry.subject);
  const prefix = entry.scope ? `**${escapeMarkdownInline(entry.scope)}:** ` : '';
  return `- ${prefix}${subject} (${entry.shortHash})`;
}

/** Render only populated groups, preserving the canonical section order. */
export function renderChangelogMarkdown(changelog: GroupedChangelog): string {
  if (changelog.totalCommits === 0) {
    return '# Release notes\n\n_Aucun commit trouvé sur la plage demandée._\n';
  }

  const lines = ['# Release notes', ''];
  for (const section of changelog.sections) {
    if (section.entries.length === 0) continue;
    lines.push(`## ${section.title}`, '', ...section.entries.map(renderEntry), '');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}
