import { describe, expect, it } from 'vitest';
import {
  CHANGELOG_SECTION_ORDER,
  groupChangelogCommits,
  parseConventionalCommit,
  renderChangelogMarkdown,
  type ChangelogCommit,
  type ChangelogSectionId,
} from '../../src/git/changelog.js';

function commit(hash: string, subject: string, body = ''): ChangelogCommit {
  return { hash, subject, body };
}

function entriesFor(
  changelog: ReturnType<typeof groupChangelogCommits>,
  sectionId: ChangelogSectionId
) {
  return changelog.sections.find((section) => section.id === sectionId)?.entries ?? [];
}

describe('parseConventionalCommit', () => {
  it('parses the type, scope and subject from a conventional header', () => {
    const parsed = parseConventionalCommit(
      commit('1234567890abcdef', 'feat(api): ajoute la pagination')
    );

    expect(parsed).toMatchObject({
      type: 'feat',
      scope: 'api',
      subject: 'ajoute la pagination',
      breaking: false,
      conventional: true,
      shortHash: '1234567',
    });
  });

  it('recognizes a breaking marker with or without a scope', () => {
    expect(
      parseConventionalCommit(commit('aaaaaaa', 'fix!: retire l’ancien protocole'))
    ).toMatchObject({ type: 'fix', scope: null, breaking: true });
    expect(
      parseConventionalCommit(commit('bbbbbbb', 'feat(auth)!: change le format des jetons'))
    ).toMatchObject({ type: 'feat', scope: 'auth', breaking: true });
  });

  it('recognizes a BREAKING CHANGE footer', () => {
    const parsed = parseConventionalCommit(
      commit(
        'abcdef0123456789',
        'refactor(storage): simplifie le schéma',
        'Migration requise.\n\nBREAKING CHANGE: la colonne legacy disparaît.'
      )
    );

    expect(parsed.breaking).toBe(true);
    expect(parsed.subject).toBe('simplifie le schéma');
  });

  it('keeps a non-conventional subject visible instead of inventing fields', () => {
    const parsed = parseConventionalCommit(
      commit('fedcba9876543210', 'Update dependencies before release')
    );

    expect(parsed).toMatchObject({
      conventional: false,
      type: null,
      scope: null,
      subject: 'Update dependencies before release',
      breaking: false,
    });

    expect(parseConventionalCommit(commit('aaaaaaa', 'merge: integration release'))).toMatchObject({
      conventional: false,
      type: null,
      subject: 'merge: integration release',
    });
  });
});

describe('groupChangelogCommits', () => {
  const commits = [
    commit('1111111111111111', 'feat(api): ajoute une route'),
    commit('2222222222222222', 'fix(cli): corrige la sortie'),
    commit('3333333333333333', 'perf(cache): accélère le rappel'),
    commit('4444444444444444', 'docs: documente la commande'),
    commit('5555555555555555', 'feat(core)!: retire une API'),
    commit('6666666666666666', 'chore(deps): met à jour Vitest'),
    commit('7777777777777777', 'Merge branch release'),
  ];

  it('keeps the required stable section order', () => {
    const changelog = groupChangelogCommits(commits);

    expect(changelog.sections.map(({ id, title }) => ({ id, title }))).toEqual(
      CHANGELOG_SECTION_ORDER
    );
    expect(changelog.sections.map((section) => section.title)).toEqual([
      '⚠ Breaking Changes',
      'Features',
      'Bug Fixes',
      'Performance',
      'Docs',
      'Autres',
    ]);
  });

  it('groups supported types and gives breaking changes priority without duplicates', () => {
    const changelog = groupChangelogCommits(commits);

    expect(entriesFor(changelog, 'breaking').map((entry) => entry.subject)).toEqual([
      'retire une API',
    ]);
    expect(entriesFor(changelog, 'features').map((entry) => entry.subject)).toEqual([
      'ajoute une route',
    ]);
    expect(entriesFor(changelog, 'fixes')).toHaveLength(1);
    expect(entriesFor(changelog, 'performance')).toHaveLength(1);
    expect(entriesFor(changelog, 'docs')).toHaveLength(1);
    expect(changelog.sections.flatMap((section) => section.entries)).toHaveLength(commits.length);
  });

  it('places conventional maintenance and non-conventional commits in Autres', () => {
    const changelog = groupChangelogCommits(commits);

    expect(entriesFor(changelog, 'other').map((entry) => entry.rawSubject)).toEqual([
      'chore(deps): met à jour Vitest',
      'Merge branch release',
    ]);
  });

  it('renders readable Markdown entries with scopes and short hashes in section order', () => {
    const markdown = renderChangelogMarkdown(groupChangelogCommits(commits));

    expect(markdown).toContain('- **api:** ajoute une route (1111111)');
    expect(markdown).toContain('- documente la commande (4444444)');
    expect(markdown.indexOf('## ⚠ Breaking Changes')).toBeLessThan(markdown.indexOf('## Features'));
    expect(markdown.indexOf('## Features')).toBeLessThan(markdown.indexOf('## Bug Fixes'));
    expect(markdown.indexOf('## Bug Fixes')).toBeLessThan(markdown.indexOf('## Performance'));
    expect(markdown.indexOf('## Performance')).toBeLessThan(markdown.indexOf('## Docs'));
    expect(markdown.indexOf('## Docs')).toBeLessThan(markdown.indexOf('## Autres'));
  });
});
