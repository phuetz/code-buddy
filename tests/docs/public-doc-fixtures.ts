export const publicMarkdownDocs = [
  'CHANGELOG.md',
  'CLAUDE.md',
  'README.md',
  'cowork/ARCHITECTURE.md',
  'cowork/README.md',
  'cowork/README_zh.md',
  'cowork/RUNNER_AUDIT.md',
  'docs/agents.md',
  'docs/channels.md',
  'docs/commands.md',
  'docs/configuration.md',
  'docs/context-engine.md',
  'docs/cowork-guide-fr.md',
  'docs/cowork-user-guide.md',
  'docs/development.md',
  'docs/fleet-guide.md',
  'docs/getting-started.md',
  'docs/infrastructure.md',
  'docs/providers.md',
  'docs/reasoning.md',
  'docs/reprise/cli-smoke.md',
  'docs/reprise/fleet-minimal.md',
  'docs/screenshots/README.md',
  'docs/security.md',
  'docs/tools-reference.md',
  'docs/qa/code-buddy-studio/README.md',
  'docs/qa/code-buddy-studio/feature-qa.md',
  'docs/qa/code-buddy-studio/overnight-qa-campaign.md',
] as const;

export const publicPrivacyDocs = [
  ...publicMarkdownDocs,
  'docs/qa/code-buddy-studio/feature-qa-report.json',
  'docs/qa/code-buddy-studio/overnight-test-datasets.json',
] as const;

export const publicScreenshotDirs = [
  'docs/screenshots',
  'docs/qa/code-buddy-studio/screenshots',
] as const;
