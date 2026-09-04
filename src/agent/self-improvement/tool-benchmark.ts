/**
 * Seed behavioural benchmark for self-authored TOOLS. Each scenario describes a
 * small, deterministic capability with VISIBLE cases (shown to the proposer) and
 * HELD-OUT cases (fresh inputs, never shown) — so a tool that hardcodes the
 * visible answers is caught. Curated separately from any proposer.
 *
 * @module agent/self-improvement/tool-benchmark
 */

import type { ToolBenchmarkScenario } from './tool-types.js';

export const SEED_TOOL_SCENARIOS: ToolBenchmarkScenario[] = [
  {
    id: 'slugify',
    capability: 'Slugify the string field `text`: lowercase it, replace runs of spaces with single hyphens, and print the slug.',
    description: 'authored__slugify converts text to a url slug',
    visibleCases: [
      { input: { text: 'Hello World' }, expectedOutput: 'hello-world' },
      { input: { text: 'Foo Bar Baz' }, expectedOutput: 'foo-bar-baz' },
    ],
    heldOutCases: [
      { input: { text: 'The Quick Brown' }, expectedOutput: 'the-quick-brown' },
      { input: { text: 'A B C' }, expectedOutput: 'a-b-c' },
      // Capability says "runs of spaces" — a tool that only replace(' ','-')
      // would otherwise pass G4 on the single-space held-out pairs above.
      { input: { text: 'Hello  World' }, expectedOutput: 'hello-world' },
    ],
  },
  {
    id: 'word-count',
    capability: 'Count the whitespace-separated words in the string field `text` and print the integer count.',
    description: 'authored__word_count counts words',
    visibleCases: [
      { input: { text: 'one two three' }, expectedOutput: '3' },
      { input: { text: 'hello' }, expectedOutput: '1' },
    ],
    heldOutCases: [
      { input: { text: 'a b c d e' }, expectedOutput: '5' },
      { input: { text: 'foo bar' }, expectedOutput: '2' },
    ],
  },
];
