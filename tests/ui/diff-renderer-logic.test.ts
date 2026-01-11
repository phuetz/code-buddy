import { parseDiffWithLineNumbers } from '../../src/ui/components/DiffRenderer';

describe('DiffRenderer Logic', () => {
  describe('parseDiffWithLineNumbers', () => {
    it('should parse a simple addition', () => {
      const diff = `@@ -1,0 +1,1 @@
+Added line`;
      const result = parseDiffWithLineNumbers(diff);
      expect(result).toHaveLength(2); // Hunk header + 1 line
      expect(result[0].type).toBe('hunk');
      expect(result[1]).toEqual({
        type: 'add',
        newLine: 1,
        content: 'Added line'
      });
    });

    it('should parse a deletion', () => {
      const diff = `@@ -1,1 +0,0 @@
-Deleted line`;
      const result = parseDiffWithLineNumbers(diff);
      expect(result).toHaveLength(2);
      expect(result[1]).toEqual({
        type: 'del',
        oldLine: 1,
        content: 'Deleted line'
      });
    });

    it('should parse context and mixed changes', () => {
      const diff = `@@ -1,3 +1,3 @@
 context 1
-deleted
+added
 context 2`;
      const result = parseDiffWithLineNumbers(diff);
      // hunk, context, del, add, context
      expect(result).toHaveLength(5);
      expect(result[1].type).toBe('context');
      expect(result[1].oldLine).toBe(1);
      expect(result[1].newLine).toBe(1);

      expect(result[2].type).toBe('del');
      expect(result[2].oldLine).toBe(2);

      expect(result[3].type).toBe('add');
      expect(result[3].newLine).toBe(2);

      expect(result[4].type).toBe('context');
      expect(result[4].oldLine).toBe(3);
      expect(result[4].newLine).toBe(3);
    });

    it('should skip standard git headers', () => {
      const diff = `diff --git a/file.ts b/file.ts
index 123..456 100644
--- a/file.ts
+++ b/file.ts
@@ -1,1 +1,1 @@
 context`;
      const result = parseDiffWithLineNumbers(diff);
      expect(result).toHaveLength(2); // Hunk + context
      expect(result[0].type).toBe('hunk');
      expect(result[1].content).toBe('context');
    });

    it('should handle "No newline at end of file"', () => {
        const diff = [
          '@@ -1,1 +1,1 @@',
          '-old',
          ' \\ No newline at end of file',
          '+new'
        ].join('\n');
        const result = parseDiffWithLineNumbers(diff);
        expect(result).toHaveLength(4); // hunk, del, other, add
        expect(result[2].type).toBe('other');
    });
  });
});