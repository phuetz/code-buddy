/**
 * Fuzzy string matching utilities
 *
 * Inspired by mistral-vibe's search_replace tool that uses difflib.SequenceMatcher
 * to find similar strings when exact matches fail.
 */

export interface FuzzyMatchResult {
  /** The matched string from the content */
  match: string;
  /** Similarity score between 0 and 1 */
  similarity: number;
  /** Line number where match starts (1-indexed) */
  startLine: number;
  /** Character offset in the content where `match` starts */
  startIndex: number;
  /** Line number where match ends (1-indexed) */
  endLine: number;
  /** Human-readable similarity percentage */
  similarityPercent: string;
}

export interface FuzzyMatchOptions {
  /** Minimum similarity threshold (0-1), default 0.9 (90%) */
  threshold?: number;
  /** Maximum number of results to return */
  maxResults?: number;
  /** Whether to normalize whitespace before comparison */
  normalizeWhitespace?: boolean;
}

/**
 * Calculate the Longest Common Subsequence (LCS) length between two strings
 * Used for sequence matching similar to Python's difflib.SequenceMatcher
 */
function lcsLength(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  // Use only two rows for space optimization
  let prev = new Array(n + 1).fill(0);
  let curr = new Array(n + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1]);
      }
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

/**
 * Calculate similarity ratio between two strings
 * Returns a value between 0 and 1, similar to difflib.SequenceMatcher.ratio()
 */
export function calculateSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  if (a.length === 0 || b.length === 0) return 0.0;

  const lcs = lcsLength(a, b);
  return (2 * lcs) / (a.length + b.length);
}

/**
 * Normalize a string for fuzzy comparison
 */
function normalizeString(str: string, normalizeWhitespace: boolean): string {
  let result = str;

  if (normalizeWhitespace) {
    // Normalize line endings
    result = result.replace(/\r\n/g, '\n');
    // Normalize multiple spaces to single space
    result = result.replace(/[ \t]+/g, ' ');
    // Normalize multiple newlines
    result = result.replace(/\n{3,}/g, '\n\n');
    // Trim each line
    result = result.split('\n').map(line => line.trim()).join('\n');
  }

  return result;
}

/**
 * Find fuzzy matches for a search string in content
 *
 * @param content - The content to search in
 * @param searchStr - The string to search for
 * @param options - Fuzzy match options
 * @returns Array of fuzzy match results sorted by similarity (highest first)
 */
export function findFuzzyMatches(
  content: string,
  searchStr: string,
  options: FuzzyMatchOptions = {}
): FuzzyMatchResult[] {
  const {
    threshold = 0.9,
    maxResults = 5,
    normalizeWhitespace = true,
  } = options;

  const results: FuzzyMatchResult[] = [];
  const lines = content.split('\n');
  const searchLines = searchStr.split('\n');
  const searchLineCount = searchLines.length;

  // Normalize search string for comparison
  const normalizedSearch = normalizeString(searchStr, normalizeWhitespace);

  // Slide a window of the same size as searchStr through content
  for (let startLine = 0; startLine <= lines.length - searchLineCount; startLine++) {
    // Extract candidate chunk
    const candidateLines = lines.slice(startLine, startLine + searchLineCount);
    const candidate = candidateLines.join('\n');
    const normalizedCandidate = normalizeString(candidate, normalizeWhitespace);

    // Calculate similarity
    const similarity = calculateSimilarity(normalizedSearch, normalizedCandidate);

    if (similarity >= threshold) {
      results.push({
        match: candidate,
        similarity,
        startLine: startLine + 1, // Convert to 1-indexed
        startIndex: lines.slice(0, startLine).reduce((n, l) => n + l.length + 1, 0),
        endLine: startLine + searchLineCount,
        similarityPercent: `${Math.round(similarity * 100)}%`,
      });
    }
  }

  // Sort by similarity (highest first) and limit results
  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, maxResults);
}

/**
 * Find the best fuzzy match above threshold
 *
 * @param content - The content to search in
 * @param searchStr - The string to search for
 * @param threshold - Minimum similarity threshold (default 0.9)
 * @returns The best match or null if none found above threshold
 */
export function findBestFuzzyMatch(
  content: string,
  searchStr: string,
  threshold: number = 0.9
): FuzzyMatchResult | null {
  const matches = findFuzzyMatches(content, searchStr, { threshold, maxResults: 1 });
  return matches[0] ?? null;
}

/**
 * Generate a unified diff-style output showing the difference between search and match
 */
export function generateFuzzyDiff(
  searchStr: string,
  matchStr: string,
  filePath: string,
  matchResult: FuzzyMatchResult
): string {
  const searchLines = searchStr.split('\n');
  const matchLines = matchStr.split('\n');

  const lines: string[] = [
    `🔍 Fuzzy match found (${matchResult.similarityPercent} similarity)`,
    `   Lines ${matchResult.startLine}-${matchResult.endLine} in ${filePath}`,
    '',
    '--- Expected (search string)',
    '+++ Found (actual content)',
    `@@ -1,${searchLines.length} +1,${matchLines.length} @@`,
  ];

  // Simple line-by-line diff
  const maxLen = Math.max(searchLines.length, matchLines.length);
  for (let i = 0; i < maxLen; i++) {
    const searchLine = searchLines[i];
    const matchLine = matchLines[i];

    if (searchLine === matchLine) {
      lines.push(` ${matchLine ?? ''}`);
    } else if (searchLine !== undefined && matchLine !== undefined) {
      lines.push(`-${searchLine}`);
      lines.push(`+${matchLine}`);
    } else if (searchLine !== undefined) {
      lines.push(`-${searchLine}`);
    } else if (matchLine !== undefined) {
      lines.push(`+${matchLine}`);
    }
  }

  return lines.join('\n');
}

/**
 * Suggest fixes for common whitespace issues
 */
export function suggestWhitespaceFixes(
  searchStr: string,
  content: string
): string[] {
  const suggestions: string[] = [];

  // Check for line ending differences
  if (searchStr.includes('\r\n') && !content.includes('\r\n')) {
    suggestions.push('Your search string uses Windows line endings (CRLF), but the file uses Unix line endings (LF)');
  } else if (!searchStr.includes('\r\n') && content.includes('\r\n')) {
    suggestions.push('The file uses Windows line endings (CRLF), but your search string uses Unix line endings (LF)');
  }

  // Check for trailing whitespace
  const searchHasTrailing = searchStr.split('\n').some(line => line !== line.trimEnd());
  const contentHasTrailing = content.split('\n').some(line => line !== line.trimEnd());
  if (searchHasTrailing !== contentHasTrailing) {
    suggestions.push('There may be differences in trailing whitespace');
  }

  // Check for indentation style
  const searchUsesTabs = searchStr.includes('\t');
  const contentUsesTabs = content.includes('\t');
  if (searchUsesTabs && !contentUsesTabs) {
    suggestions.push('Your search string uses tabs, but the file uses spaces for indentation');
  } else if (!searchUsesTabs && contentUsesTabs) {
    suggestions.push('The file uses tabs, but your search string uses spaces for indentation');
  }

  return suggestions;
}
