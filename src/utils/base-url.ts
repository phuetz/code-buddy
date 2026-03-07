export const DEFAULT_BASE_URL = 'https://api.x.ai/v1';

export function normalizeBaseURL(input: string): string {
  if (typeof input !== 'string') {
    throw new Error('Base URL must be a string');
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error('Base URL cannot be empty or whitespace only');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Base URL must be a valid URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Base URL must start with http:// or https://');
  }

  if (parsed.username || parsed.password) {
    throw new Error('Base URL must not contain credentials');
  }

  if (parsed.search || parsed.hash) {
    throw new Error('Base URL must not include query parameters or fragments');
  }

  return parsed.toString().replace(/\/$/, '');
}
