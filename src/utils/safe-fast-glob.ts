import fg from 'fast-glob';

// braces 3.0.3 has recursive AST walkers without a depth guard (GHSA-vfj7-8cjw-p6xm).
// Bound patterns BEFORE fast-glob expands braces, including its ignore patterns.
function validatePatterns(value: unknown): void {
  const patterns: unknown[] = Array.isArray(value) ? value : [value];
  if (patterns.length > 1024) throw new Error('Too many glob patterns (maximum 1024).');
  for (const pattern of patterns) {
    if (typeof pattern !== 'string') throw new TypeError('Glob patterns must be strings.');
    if (pattern.length > 4096) throw new Error('Glob pattern too long (maximum 4096 characters).');
    let groups = 0;
    for (const char of pattern) {
      // Count even escaped delimiters: a conservative bound avoids a second parser.
      if ((char === '{' || char === '(') && ++groups > 64) {
        throw new Error('Glob pattern too complex (maximum 64 groups).');
      }
    }
  }
}

function validateArguments(args: unknown[]): void {
  validatePatterns(args[0]);
  const options = args[1];
  if (options && typeof options === 'object' && 'ignore' in options && options.ignore !== undefined) {
    validatePatterns(options.ignore);
  }
}

// Preserve overloads, objectMode/stats, and the synchronous/stream/task APIs.
const guardedMethods = new Set(['glob', 'async', 'sync', 'globSync', 'stream', 'globStream', 'generateTasks', 'isDynamicPattern']);
const safeFastGlob: typeof fg = new Proxy(fg, {
  apply(target, thisArg, args: unknown[]) {
    validateArguments(args);
    return Reflect.apply(target, thisArg, args);
  },
  get(target, property, receiver) {
    const value: unknown = Reflect.get(target, property, receiver);
    if (typeof property !== 'string' || !guardedMethods.has(property) || typeof value !== 'function') return value;
    return new Proxy(value, {
      apply(method, thisArg, args: unknown[]) {
        validateArguments(args);
        return Reflect.apply(method, thisArg, args);
      },
    });
  },
});

export default safeFastGlob;
