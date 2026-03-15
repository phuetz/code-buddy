/**
 * Docs Generator Configuration — per-project settings
 *
 * Can be overridden via .codebuddy/docs-config.json
 */

export interface DocsConfig {
  /** Output directory (default: ".codebuddy/docs") */
  outputDir: string;
  /** Repository URL (auto-detected from git remote) */
  repoUrl: string;
  /** Current commit hash (auto-detected) */
  commit: string;
  /** Primary language (auto-detected) */
  language: string;

  /** LLM thinking level for plan generation */
  thinkingLevel: 'minimal' | 'low' | 'medium' | 'high';
  /** Max depth levels: 1=flat, 2=sections, 3=sub-sections */
  maxDepthLevels: number;
  /** Max nodes per Mermaid diagram */
  maxNodesPerDiagram: number;
  /** Max source modules referenced per page */
  maxModulesPerPage: number;

  /** Documentation output language */
  docLanguage: 'en' | 'fr' | 'auto';
  /** Include private/internal API */
  includePrivateApi: boolean;
  /** Generate troubleshooting section */
  includeTroubleshooting: boolean;
}

export function getDefaultConfig(): DocsConfig {
  return {
    outputDir: '.codebuddy/docs',
    repoUrl: '',
    commit: '',
    language: 'typescript',
    thinkingLevel: 'medium',
    maxDepthLevels: 2,
    maxNodesPerDiagram: 10,
    maxModulesPerPage: 5,
    docLanguage: 'en',
    includePrivateApi: false,
    includeTroubleshooting: true,
  };
}

/** Load config from .codebuddy/docs-config.json, merged with defaults */
export function loadDocsConfig(cwd: string): DocsConfig {
  const defaults = getDefaultConfig();

  // Auto-detect repo URL and commit
  try {
    const { execFileSync } = require('child_process');
    defaults.repoUrl = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf-8', timeout: 3000 }).trim()
      .replace(/\.git$/, '')
      .replace(/^git@github\.com:/, 'https://github.com/');
    defaults.commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd, encoding: 'utf-8', timeout: 3000 }).trim();
  } catch { /* git not available */ }

  // Load project override
  try {
    const fs = require('fs');
    const path = require('path');
    const configPath = path.join(cwd, '.codebuddy', 'docs-config.json');
    if (fs.existsSync(configPath)) {
      const override = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return { ...defaults, ...override };
    }
  } catch { /* no config file */ }

  return defaults;
}
