/**
 * Transform Handler
 *
 * /transform <type> [file|directory]
 *
 * Transformation types:
 *   modernize    — update to latest language features (ES2024, Python 3.12, etc.)
 *   typescript   — convert JS to TypeScript
 *   async        — convert callbacks to async/await
 *   functional   — convert imperative to functional style
 *   es-modules   — convert CommonJS to ESM
 */

import type { CommandHandlerResult } from './branch-handlers.js';
import { failureFlag } from '../slash-failure.js';

const TRANSFORM_TYPES = ['modernize', 'typescript', 'async', 'functional', 'es-modules'] as const;
type TransformType = typeof TRANSFORM_TYPES[number];

/**
 * Get a description of each transformation type.
 */
function getTransformDescription(type: TransformType): string {
  const descriptions: Record<TransformType, string> = {
    modernize: 'Update to latest language features (ES2024+, optional chaining, nullish coalescing, etc.)',
    typescript: 'Convert JavaScript files to TypeScript with type annotations',
    async: 'Convert callback-based code to async/await patterns',
    functional: 'Convert imperative loops and mutations to functional style (map, filter, reduce)',
    'es-modules': 'Convert CommonJS require/module.exports to ESM import/export',
  };
  return descriptions[type];
}

/**
 * Build the LLM prompt for a specific transformation type.
 */
export function buildTransformPrompt(type: TransformType, filePath: string): string {
  const prompts: Record<TransformType, string> = {
    modernize: `Read the file "${filePath}" and modernize it to use the latest language features:
- Replace var with const/let
- Use optional chaining (?.) and nullish coalescing (??)
- Use array/object destructuring where appropriate
- Use template literals instead of string concatenation
- Use arrow functions where appropriate
- Use modern APIs (Array.includes, Object.entries, etc.)
- Preserve all existing functionality
Show the diff before applying changes using str_replace_editor.`,

    typescript: `Read the file "${filePath}" and convert it from JavaScript to TypeScript:
- Add type annotations to function parameters and return types
- Add interface definitions for object shapes
- Replace require() with import statements
- Add proper typing for variables where inference is insufficient
- Handle any null/undefined with proper types
- Rename the file from .js to .ts
Show the diff before applying changes using str_replace_editor.`,

    async: `Read the file "${filePath}" and convert callback-based code to async/await:
- Convert callback patterns to async/await
- Convert .then()/.catch() chains to try/catch with await
- Convert event-based patterns to promises where appropriate
- Add proper error handling with try/catch
- Preserve all existing functionality
Show the diff before applying changes using str_replace_editor.`,

    functional: `Read the file "${filePath}" and convert imperative code to functional style:
- Replace for/while loops with map, filter, reduce, forEach
- Replace mutations with immutable patterns (spread, Object.assign)
- Extract pure functions where possible
- Use function composition and pipes
- Preserve all existing functionality and behavior
Show the diff before applying changes using str_replace_editor.`,

    'es-modules': `Read the file "${filePath}" and convert from CommonJS to ES Modules:
- Replace require() calls with import statements
- Replace module.exports with export/export default
- Replace __dirname/__filename with import.meta.url + fileURLToPath
- Add .js extensions to relative imports
- Update any dynamic require() to dynamic import()
- Preserve all existing functionality
Show the diff before applying changes using str_replace_editor.`,
  };

  return prompts[type];
}

/**
 * Handle the /transform command.
 */
export async function handleTransform(args: string[]): Promise<CommandHandlerResult> {
  if (args.length === 0) {
    const usage = [
      'Usage: /transform <type> [file|directory]',
      '',
      'Transformation types:',
      ...TRANSFORM_TYPES.map(t => `  ${t.padEnd(14)} ${getTransformDescription(t as TransformType)}`),
      '',
      'Examples:',
      '  /transform modernize src/utils/index.ts',
      '  /transform typescript src/legacy.js',
      '  /transform es-modules src/',
      '  /transform async src/api/client.js',
    ];

    return {
      handled: true,
...failureFlag(usage.join('\n')),
      entry: { type: 'assistant', content: usage.join('\n'), timestamp: new Date() },
    };
  }

  // safe: args.length === 0 returns early above, so args[0] is in-bounds here.
  const type = (args[0] ?? '').toLowerCase();

  if (!TRANSFORM_TYPES.includes(type as TransformType)) {
    return {
      handled: true,
...failureFlag(`Unknown transformation type: "${type}"\n\nAvailable types: ${TRANSFORM_TYPES.join(', ')}`),
      entry: {
        type: 'assistant',
        content: `Unknown transformation type: "${type}"\n\nAvailable types: ${TRANSFORM_TYPES.join(', ')}`,
        timestamp: new Date(),
      },
    };
  }

  const filePath = args.slice(1).join(' ').trim();
  if (!filePath) {
    return {
      handled: true,
...failureFlag(`Please specify a file or directory to transform.\n\nUsage: /transform ${type} <file|directory>`),
      entry: {
        type: 'assistant',
        content: `Please specify a file or directory to transform.\n\nUsage: /transform ${type} <file|directory>`,
        timestamp: new Date(),
      },
    };
  }

  // Build the prompt and pass it to the AI for execution
  const prompt = buildTransformPrompt(type as TransformType, filePath);

  return {
    handled: true,
    passToAI: true,
    prompt,
  };
}
