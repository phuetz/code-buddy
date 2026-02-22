/**
 * Tests for all bundled SKILL.md files
 *
 * Validates:
 * - All bundled skills exist
 * - YAML frontmatter is properly formatted
 * - Required frontmatter fields are present
 * - Markdown body contains expected sections
 */

import { readdirSync, existsSync, readFileSync, statSync } from 'fs';
import { join, basename } from 'path';

// Get the repo root (assuming tests are in /tests/skills/)
const REPO_ROOT = join(__dirname, '..', '..');
const BUNDLED_SKILLS_DIR = join(REPO_ROOT, '.codebuddy', 'skills', 'bundled');

// Expected number of bundled skills
const EXPECTED_SKILL_COUNT = 46;

// Required frontmatter fields
const REQUIRED_FRONTMATTER_FIELDS = ['name', 'version', 'description', 'author', 'tags'];

/**
 * Parse YAML frontmatter from a SKILL.md file
 * Returns object with frontmatter fields
 */
function parseFrontmatter(content: string): Record<string, any> {
  const lines = content.split('\n');

  // Check for opening ---
  if (lines[0] !== '---') {
    return {};
  }

  // Find closing ---
  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    return {};
  }

  // Parse YAML-like key-value pairs
  const frontmatter: Record<string, any> = {};
  const yamlLines = lines.slice(1, endIndex);

  let currentKey: string | null = null;
  let currentValue: any = null;

  for (const line of yamlLines) {
    // Skip empty lines
    if (line.trim() === '') {
      continue;
    }

    // Check if this is a key-value line
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0 && !line.startsWith(' ') && !line.startsWith('\t')) {
      // Save previous key-value if exists
      if (currentKey !== null) {
        frontmatter[currentKey] = currentValue;
      }

      // Parse new key-value
      currentKey = line.slice(0, colonIndex).trim();
      const valueStr = line.slice(colonIndex + 1).trim();

      // Handle different value types
      if (valueStr === '') {
        // Multi-line object or array
        currentValue = null;
      } else if (valueStr.startsWith('[') && valueStr.endsWith(']')) {
        // Inline array with brackets: tags: [git, github, gh]
        currentValue = valueStr
          .slice(1, -1)
          .split(',')
          .map(s => s.trim())
          .filter(s => s.length > 0);
      } else if (currentKey === 'tags' && valueStr.includes(',')) {
        // Comma-separated tags without brackets: tags: git, github, gh
        currentValue = valueStr
          .split(',')
          .map(s => s.trim())
          .filter(s => s.length > 0);
      } else {
        // Simple value
        currentValue = valueStr;
      }
    } else if (line.startsWith(' ') || line.startsWith('\t')) {
      // Continuation of previous key (nested object)
      const trimmed = line.trim();
      if (trimmed && currentKey) {
        if (currentValue === null) {
          currentValue = {};
        }

        // Parse nested key-value
        const nestedColonIndex = trimmed.indexOf(':');
        if (nestedColonIndex > 0) {
          const nestedKey = trimmed.slice(0, nestedColonIndex).trim();
          const nestedValue = trimmed.slice(nestedColonIndex + 1).trim();

          if (typeof currentValue === 'object' && !Array.isArray(currentValue)) {
            currentValue[nestedKey] = nestedValue.replace(/^["']|["']$/g, '');
          }
        }
      }
    }
  }

  // Save last key-value
  if (currentKey !== null) {
    frontmatter[currentKey] = currentValue;
  }

  return frontmatter;
}

/**
 * Get markdown body (everything after frontmatter)
 */
function getMarkdownBody(content: string): string {
  const lines = content.split('\n');

  if (lines[0] !== '---') {
    return content;
  }

  // Find closing ---
  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    return content;
  }

  return lines.slice(endIndex + 1).join('\n');
}

// Load skill directories at module level (required for it.each)
const skillDirs = existsSync(BUNDLED_SKILLS_DIR)
  ? readdirSync(BUNDLED_SKILLS_DIR)
      .map(name => join(BUNDLED_SKILLS_DIR, name))
      .filter(path => statSync(path).isDirectory())
      .map(p => basename(p))
      .sort()
  : [];

describe('Bundled SKILL.md Files', () => {
  beforeAll(() => {
    // Check that bundled skills directory exists
    expect(existsSync(BUNDLED_SKILLS_DIR)).toBe(true);
    expect(skillDirs.length).toBeGreaterThan(0);
  });

  describe('Directory Structure', () => {
    it(`should have exactly ${EXPECTED_SKILL_COUNT} bundled skill directories`, () => {
      expect(skillDirs.length).toBe(EXPECTED_SKILL_COUNT);
    });

    it('should have SKILL.md in each directory', () => {
      for (const skillDir of skillDirs) {
        const skillMdPath = join(BUNDLED_SKILLS_DIR, skillDir, 'SKILL.md');
        expect(existsSync(skillMdPath)).toBe(true);
      }
    });
  });

  describe('YAML Frontmatter Validation', () => {
    it.each(skillDirs)('%s: should have valid frontmatter with all required fields', (skillDir) => {
      const skillMdPath = join(BUNDLED_SKILLS_DIR, skillDir, 'SKILL.md');
      const content = readFileSync(skillMdPath, 'utf-8');

      // Parse frontmatter
      const frontmatter = parseFrontmatter(content);

      // Check all required fields exist
      for (const field of REQUIRED_FRONTMATTER_FIELDS) {
        expect(frontmatter[field]).toBeDefined();
        expect(frontmatter[field]).not.toBe('');
        expect(frontmatter[field]).not.toBe(null);
      }
    });

    it.each(skillDirs)('%s: name should match directory name', (skillDir) => {
      const skillMdPath = join(BUNDLED_SKILLS_DIR, skillDir, 'SKILL.md');
      const content = readFileSync(skillMdPath, 'utf-8');
      const frontmatter = parseFrontmatter(content);

      expect(frontmatter.name).toBe(skillDir);
    });

    it.each(skillDirs)('%s: version should be valid semver format', (skillDir) => {
      const skillMdPath = join(BUNDLED_SKILLS_DIR, skillDir, 'SKILL.md');
      const content = readFileSync(skillMdPath, 'utf-8');
      const frontmatter = parseFrontmatter(content);

      // Basic semver check: X.Y.Z
      const semverRegex = /^\d+\.\d+\.\d+$/;
      expect(frontmatter.version).toMatch(semverRegex);
    });

    it.each(skillDirs)('%s: description should be a non-empty string', (skillDir) => {
      const skillMdPath = join(BUNDLED_SKILLS_DIR, skillDir, 'SKILL.md');
      const content = readFileSync(skillMdPath, 'utf-8');
      const frontmatter = parseFrontmatter(content);

      expect(typeof frontmatter.description).toBe('string');
      expect(frontmatter.description.length).toBeGreaterThan(10);
    });

    it.each(skillDirs)('%s: author should be set', (skillDir) => {
      const skillMdPath = join(BUNDLED_SKILLS_DIR, skillDir, 'SKILL.md');
      const content = readFileSync(skillMdPath, 'utf-8');
      const frontmatter = parseFrontmatter(content);

      expect(typeof frontmatter.author).toBe('string');
      expect(frontmatter.author.length).toBeGreaterThan(0);
    });

    it.each(skillDirs)('%s: tags should be an array', (skillDir) => {
      const skillMdPath = join(BUNDLED_SKILLS_DIR, skillDir, 'SKILL.md');
      const content = readFileSync(skillMdPath, 'utf-8');
      const frontmatter = parseFrontmatter(content);

      expect(Array.isArray(frontmatter.tags)).toBe(true);
      expect(frontmatter.tags.length).toBeGreaterThan(0);
    });
  });

  describe('Markdown Body Validation', () => {
    it.each(skillDirs)('%s: should have meaningful markdown content', (skillDir) => {
      const skillMdPath = join(BUNDLED_SKILLS_DIR, skillDir, 'SKILL.md');
      const content = readFileSync(skillMdPath, 'utf-8');
      const body = getMarkdownBody(content);

      // Should have substantial content (at least 100 characters)
      expect(body.trim().length).toBeGreaterThan(100);
    });

    it.each(skillDirs)('%s: should have section headings (## ) or Direct Control', (skillDir) => {
      const skillMdPath = join(BUNDLED_SKILLS_DIR, skillDir, 'SKILL.md');
      const content = readFileSync(skillMdPath, 'utf-8');
      const body = getMarkdownBody(content);

      // Check for either ## headings or "Direct Control" section
      const hasHeadings = body.includes('##');
      const hasDirectControl = body.includes('Direct Control');

      expect(hasHeadings || hasDirectControl).toBe(true);
    });

    it.each(skillDirs)('%s: should have organized content structure', (skillDir) => {
      const skillMdPath = join(BUNDLED_SKILLS_DIR, skillDir, 'SKILL.md');
      const content = readFileSync(skillMdPath, 'utf-8');
      const body = getMarkdownBody(content);

      // Skills should be well-organized with multiple sections
      // Count ## headings (level 2)
      const headingMatches = body.match(/^## /gm);
      const headingCount = headingMatches ? headingMatches.length : 0;

      // Should have at least 2 sections (beyond just title)
      expect(headingCount).toBeGreaterThanOrEqual(2);
    });

    it.each(skillDirs)('%s: should not be empty after frontmatter', (skillDir) => {
      const skillMdPath = join(BUNDLED_SKILLS_DIR, skillDir, 'SKILL.md');
      const content = readFileSync(skillMdPath, 'utf-8');
      const body = getMarkdownBody(content).trim();

      expect(body.length).toBeGreaterThan(0);
    });
  });

  describe('Content Quality Checks', () => {
    it.each(skillDirs)('%s: should have code blocks or examples', (skillDir) => {
      const skillMdPath = join(BUNDLED_SKILLS_DIR, skillDir, 'SKILL.md');
      const content = readFileSync(skillMdPath, 'utf-8');
      const body = getMarkdownBody(content);

      // Check for code blocks (```) or inline code (`)
      const hasCodeBlocks = body.includes('```');
      const hasInlineCode = body.includes('`');

      expect(hasCodeBlocks || hasInlineCode).toBe(true);
    });

    it.each(skillDirs)('%s: frontmatter should be properly closed', (skillDir) => {
      const skillMdPath = join(BUNDLED_SKILLS_DIR, skillDir, 'SKILL.md');
      const content = readFileSync(skillMdPath, 'utf-8');
      const lines = content.split('\n');

      // First line should be ---
      expect(lines[0]).toBe('---');

      // Should have a closing ---
      let closingFound = false;
      for (let i = 1; i < lines.length; i++) {
        if (lines[i] === '---') {
          closingFound = true;
          break;
        }
      }
      expect(closingFound).toBe(true);
    });
  });

  describe('All Skills List', () => {
    it('should list all bundled skills', () => {
      // This test serves as documentation of all bundled skills
      const expectedSkills = [
        'ableton-live',
        'blender',
        'blog-watcher',
        'brave-search',
        'coding-agent',
        'csharp-avalonia',
        'databases',
        'davinci-resolve',
        'email-tools',
        'exa-search',
        'figma',
        'game-engines',
        'gif-search',
        'gimp',
        'github',
        'gitlab',
        'grafana-prometheus',
        'healthcheck',
        'image-gen',
        'inkscape',
        'jenkins-ci',
        'kubernetes',
        'merge-pr',
        'model-usage',
        'n8n',
        'notion',
        'pdf-tools',
        'perplexity',
        'playwright',
        'prepare-pr',
        'project-best-practices',
        'puppeteer',
        'review-pr',
        'screenshot',
        'session-logs',
        'skill-creator',
        'smart-home',
        'spotify',
        'summarize',
        'terraform-ansible',
        'tmux-sessions',
        'unreal-engine',
        'video-tools',
        'weather',
        'web-fetch',
        'whisper-transcribe',
      ];

      expect(skillDirs).toEqual(expectedSkills);
    });
  });
});
