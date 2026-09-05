import * as fs from 'fs';
import * as path from 'path';

/**
 * Static analysis test to ensure no empty catch blocks remain in audited source files.
 *
 * An "empty catch block" is defined as a catch block that:
 * - Has no error parameter binding (e.g., `catch { }`)
 * - Has only whitespace/comments but no actual code or named parameter
 *
 * Valid catch blocks must either:
 * - Bind the error to a named parameter (e.g., `_err`, `_error`, `error`)
 * - Contain actual handling code (logging, re-throw, fallback logic)
 */

const SRC_ROOT = path.resolve(__dirname, '../../src');

// Files that were audited and fixed for empty catch blocks
const AUDITED_FILES = [
  'ui/components/ChatHistory.tsx',
  'ui/path-autocomplete.ts',
  'ui/clipboard-manager.ts',
  'desktop-automation/smart-snapshot.ts',
  'index.ts',
  'search/usearch-index.ts',
  'skills/index.ts',
];

/**
 * Matches catch blocks with no parameter binding: `} catch {`
 * This pattern captures `catch` followed by `{` without parenthesized parameter.
 */
const CATCH_NO_PARAM_REGEX = /\}\s*catch\s*\{/g;

/**
 * Matches catch blocks that bind a parameter but contain only
 * whitespace and/or comments (no actual handling code).
 * This is a multi-line regex that looks for:
 *   catch (anything) {
 *     // optional comment(s)
 *   }
 */
const CATCH_COMMENT_ONLY_REGEX = /\}\s*catch\s*\([^)]*\)\s*\{\s*(?:\/\/[^\n]*)?\s*\}/g;

describe('Error handling audit', () => {
  describe('no empty catch blocks without error parameter', () => {
    for (const relPath of AUDITED_FILES) {
      const fullPath = path.join(SRC_ROOT, relPath);

      it(`${relPath} should not contain catch blocks without error parameter`, () => {
        if (!fs.existsSync(fullPath)) {
          // File may have been removed; skip rather than fail
          return;
        }

        const content = fs.readFileSync(fullPath, 'utf-8');
        const matches = content.match(CATCH_NO_PARAM_REGEX);

        // Special case: smart-snapshot.ts contains an embedded PowerShell script
        // with `catch {}` which is PowerShell syntax, not TypeScript.
        if (relPath === 'desktop-automation/smart-snapshot.ts' && matches) {
          // Filter out matches that are inside string literals (template literals or quotes)
          const lines = content.split('\n');
          const tsMatches: string[] = [];
          let inTemplateLiteral = false;

          for (const line of lines) {
            // Track template literal boundaries (backtick strings)
            const backtickCount = (line.match(/`/g) || []).length;
            if (backtickCount % 2 !== 0) {
              inTemplateLiteral = !inTemplateLiteral;
            }

            if (!inTemplateLiteral && CATCH_NO_PARAM_REGEX.test(line)) {
              tsMatches.push(line.trim());
            }
            // Reset regex lastIndex since we use /g flag
            CATCH_NO_PARAM_REGEX.lastIndex = 0;
          }

          expect(tsMatches).toEqual([]);
          return;
        }

        expect(matches || []).toEqual([]);
      });
    }
  });

  describe('no catch blocks with only comments and no error parameter binding', () => {
    for (const relPath of AUDITED_FILES) {
      const fullPath = path.join(SRC_ROOT, relPath);

      it(`${relPath} should not have comment-only catch blocks without parameter`, () => {
        if (!fs.existsSync(fullPath)) {
          return;
        }

        const content = fs.readFileSync(fullPath, 'utf-8');

        // Find all catch blocks and verify each one either:
        // 1. Binds a parameter (e.g., `catch (_err)`)
        // 2. Contains actual handling code beyond just comments

        // Look for `catch {` (no parameter) followed by only comments until `}`
        const catchNoParamCommentOnly = /\}\s*catch\s*\{\s*\n(?:\s*\/\/[^\n]*\n)*\s*\}/g;
        const matches = content.match(catchNoParamCommentOnly);

        // For smart-snapshot.ts, exclude PowerShell embedded scripts
        if (relPath === 'desktop-automation/smart-snapshot.ts' && matches) {
          const filteredMatches = matches.filter(m => {
            // PowerShell catch {} is a single-line pattern, not multi-line with comments
            return !m.includes('catch {}');
          });
          expect(filteredMatches).toEqual([]);
          return;
        }

        expect(matches || []).toEqual([]);
      });
    }
  });

  describe('all catch blocks have named error parameters', () => {
    for (const relPath of AUDITED_FILES) {
      const fullPath = path.join(SRC_ROOT, relPath);

      it(`${relPath} catch blocks should bind error to a named parameter`, () => {
        if (!fs.existsSync(fullPath)) {
          return;
        }

        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');

        let inTemplateLiteral = false;
        const violations: { line: number; text: string }[] = [];

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          // Track template literal boundaries
          const backtickCount = (line.match(/`/g) || []).length;
          if (backtickCount % 2 !== 0) {
            inTemplateLiteral = !inTemplateLiteral;
          }

          // Skip lines inside template literals (e.g., embedded PowerShell)
          if (inTemplateLiteral) continue;

          // Check for `catch {` without parameter
          if (/\}\s*catch\s*\{/.test(line) || /^\s*catch\s*\{/.test(line)) {
            violations.push({ line: i + 1, text: line.trim() });
          }
        }

        if (violations.length > 0) {
          const details = violations
            .map(v => `  Line ${v.line}: ${v.text}`)
            .join('\n');
          expect(violations, `Found ${violations.length} catch block(s) without error parameter in ${relPath}:\n${details}`).toEqual([]);
        }
      });
    }
  });
});
