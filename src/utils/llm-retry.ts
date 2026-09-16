import { logger } from './logger.js';

/**
 * Parse a JSON string that may contain markdown code fences, surrounding text,
 * trailing commas, or a truncated closing brace/bracket.
 */
export function parseJsonResponse(text: string): any {
  const candidate = extractJsonCandidate(text);
  const repaired = repairCommonJson(candidate);
  return JSON.parse(repaired);
}

function extractJsonCandidate(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = findFirstJsonStart(trimmed);
  if (start === -1) {
    return trimmed;
  }

  const balancedEnd = findBalancedJsonEnd(trimmed, start);
  return trimmed.slice(start, balancedEnd ?? trimmed.length).trim();
}

function findFirstJsonStart(text: string): number {
  const objectStart = text.indexOf('{');
  const arrayStart = text.indexOf('[');
  if (objectStart === -1) return arrayStart;
  if (arrayStart === -1) return objectStart;
  return Math.min(objectStart, arrayStart);
}

function findBalancedJsonEnd(text: string, start: number): number | null {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i]!;

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      stack.push('}');
    } else if (char === '[') {
      stack.push(']');
    } else if (char === '}' || char === ']') {
      if (stack.pop() !== char) {
        return null;
      }
      if (stack.length === 0) {
        return i + 1;
      }
    }
  }

  return null;
}

function repairCommonJson(value: string): string {
  let repaired = value.trim();
  // GK33 live: qwen3 emitted a stray `",` line after `"id": "3",` which
  // made JSON.parse fail and collapsed buddy flow to a single Execute task.
  repaired = repaired.replace(/\n\s*",\s*\n/g, '\n');
  repaired = repaired.replace(/,\s*([}\]])/g, '$1');

  if ([...repaired].some(char => !'{}[] \t\r\n'.includes(char))) {
    const missingClosers = getMissingClosers(repaired);
    if (missingClosers.length > 0) {
      repaired += missingClosers.join('');
    }
  }

  return repaired;
}

function getMissingClosers(text: string): string[] {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (const char of text) {
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      stack.push('}');
    } else if (char === '[') {
      stack.push(']');
    } else if (char === '}' || char === ']') {
      if (stack.at(-1) !== char) {
        return [];
      }
      stack.pop();
    }
  }

  return stack.reverse();
}

/**
 * Generates JSON using an LLM and automatically retries if the output is not valid JSON.
 * On failure, it passes the exact parsing error back to the LLM to help it self-correct.
 */
export async function generateJsonWithRetry<T>(
  generateFn: (prompt: string) => Promise<string>,
  initialPrompt: string,
  maxRetries: number = 2
): Promise<T> {
  let currentPrompt = initialPrompt;
  let lastError: Error | null = null;
  let lastRawText: string = '';

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const resultText = await generateFn(currentPrompt);
      lastRawText = resultText;

      // Attempt to parse
      const parsed = parseJsonResponse(resultText);

      if (attempt > 1) {
        logger.info(`[Self-Healing JSON] Successfully recovered JSON on attempt ${attempt}`);
      }

      return parsed as T;
    } catch (error: any) {
      lastError = error;
      logger.warn(`[Self-Healing JSON] Invalid JSON received from LLM on attempt ${attempt}, retrying: ${error.message}`);

      // Update prompt to ask the model to fix its mistake
      currentPrompt = `You previously returned an invalid JSON object. Here is the raw text you returned:\n\n${lastRawText}\n\nWhen trying to parse it, I received this error:\n${error.message}\n\nPlease fix the JSON syntax error and return ONLY the valid JSON object without any additional conversational text.`;
    }
  }

  logger.error(`[Self-Healing JSON] Exhausted all retries for JSON parsing: ${lastError?.message}`);
  throw new Error(`Failed to generate valid JSON after ${maxRetries} retries: ${lastError?.message}`);
}
