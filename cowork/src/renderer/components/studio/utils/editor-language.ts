export type EditorLanguage = 'javascript' | 'html' | 'css' | 'json' | 'text';

export function languageForPath(path: string): EditorLanguage {
  const lower = path.toLowerCase();
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(lower)) return 'javascript';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.json')) return 'json';
  return 'text';
}
