import { evaluateRequest } from './risky.js';

export function createService(): { handle(value: number): string } {
  return {
    handle: (value) => evaluateRequest(value),
  };
}
