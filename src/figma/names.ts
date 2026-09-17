const RESERVED = new Set([
  'Object',
  'Array',
  'Function',
  'String',
  'Number',
  'Boolean',
  'React',
  'Fragment',
]);

export function toPascalCase(name: string, fallback = 'Node'): string {
  const parts = name
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let out = parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
  if (!out) out = fallback;
  if (!/^[A-Za-z]/.test(out)) out = `N${out}`;
  if (RESERVED.has(out)) out = `${out}View`;
  return out;
}

export function toCamelCase(name: string, fallback = 'value'): string {
  const pascal = toPascalCase(name, fallback);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

export function uniqueName(base: string, used: Set<string>): string {
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${base}${n}`;
    n += 1;
  }
  used.add(candidate);
  return candidate;
}
