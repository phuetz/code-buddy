/**
 * Real-model runner + seed graded tasks for the paired live gate.
 *
 * The runner makes ONE model call per condition (lesson injected vs not) and
 * returns the response text the task grader checks. This is a behavioral signal
 * — does the lesson change what the model DOES on a task — a real step above
 * retrievability, while staying cheap (no full agentic loop). It grades the
 * model's RESPONSE; grading full tool-using execution is the further horizon.
 *
 * Lazy + graceful: with no provider configured the runner returns empty text, so
 * the gate finds the lesson inert rather than crashing.
 *
 * @module agent/self-improvement/paired-runner
 */

import type { AgentRunner, GradedTask } from './paired-gate.js';

interface MinimalClient {
  chat(
    messages: Array<{ role: string; content: string }>,
    tools?: unknown[],
  ): Promise<{ choices?: Array<{ message?: { content?: string | null } }> }>;
}

export function createHeadlessRunner(): AgentRunner {
  let clientPromise: Promise<MinimalClient | null> | null = null;
  const getClient = (): Promise<MinimalClient | null> => {
    if (!clientPromise) {
      clientPromise = (async () => {
        try {
          const { createAuxiliaryClient } = await import('../../providers/auxiliary-llm.js');
          return createAuxiliaryClient('paired') as unknown as MinimalClient;
        } catch {
          return null;
        }
      })();
    }
    return clientPromise;
  };

  return {
    async run(prompt, lessonText) {
      const client = await getClient();
      if (!client) return { text: '' };
      try {
        const messages: Array<{ role: string; content: string }> = [];
        if (lessonText) messages.push({ role: 'system', content: `Relevant lessons to apply:\n${lessonText}` });
        messages.push({ role: 'user', content: prompt });
        const response = await client.chat(messages, []);
        return { text: (response?.choices?.[0]?.message?.content ?? '').trim() };
      } catch {
        return { text: '' };
      }
    },
  };
}

/**
 * Seed graded tasks — five paraphrased instances of ONE capability (running a
 * large test suite efficiently), so a genuinely good lesson can win on enough
 * paired tasks to reach statistical confidence. A topic-diverse set can never
 * reach 95% for a single lesson (a lesson only helps its own domain), so the
 * paired gate must be run against tasks IN the lesson's domain. This seed set
 * is a demo for test-efficiency lessons; operators curate their own per-capability
 * task sets the same way they curate the rule corpus (eval curation stays human-gated).
 */
const TEST_EFFICIENCY_GRADER = (r: { text: string }): boolean =>
  /path filter|path\/to|test\s+--|-- [\w./*]+test|specific test|single (file|test)/i.test(r.text);

export const SEED_GRADED_TASKS: GradedTask[] = [
  { id: 'test-speed-1', prompt: 'The test suite takes 5 minutes and I only changed one file. In ONE short sentence, the fastest way to run just the relevant tests?', grade: TEST_EFFICIENCY_GRADER },
  { id: 'test-speed-2', prompt: 'A teammate runs the whole suite every iteration and it is too slow. In ONE short sentence, what should they do instead?', grade: TEST_EFFICIENCY_GRADER },
  { id: 'test-speed-3', prompt: 'How do I run only the tests in tests/agent/foo.test.ts without running everything? Answer in ONE short sentence.', grade: TEST_EFFICIENCY_GRADER },
  { id: 'test-speed-4', prompt: 'CI is fine but locally the full test run wastes my time during TDD. In ONE short sentence, the fix?', grade: TEST_EFFICIENCY_GRADER },
  { id: 'test-speed-5', prompt: 'I keep waiting for ~27000 tests to finish just to check one change. In ONE short sentence, what is the practical fix?', grade: TEST_EFFICIENCY_GRADER },
];
