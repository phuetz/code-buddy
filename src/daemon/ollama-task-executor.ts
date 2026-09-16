/**
 * Local/network model task executor for the autonomous fleet loop.
 *
 * Calls the chosen tier's OpenAI-compatible endpoint (a local Ollama, a Tailscale
 * peer's Ollama, or — at the top rung — a paid endpoint) to produce the task's
 * artifact, and writes it to a scoped output directory.
 *
 * Safety: this v0 executor only *produces an artifact into its own output dir*.
 * It deliberately does NOT run arbitrary tools or modify repo files, so the
 * continuous loop can run unattended without a blast radius. Wiring the full
 * agentic executor (tools, repo edits) is a separate, checkpointed step.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { AutonomousModelChoice } from '../agent/model-tier.js';
import type { ColabTask } from '../fleet/colab-store.js';
import { sanitizeModelOutput } from '../utils/output-sanitizer.js';
import type { TaskExecutor, TaskExecutionResult } from './autonomous-loop.js';

export interface LocalModelTaskExecutorOptions {
  /** Where artifacts are written (default: <cwd>/.codebuddy/fleet-output). */
  outputDir?: string;
  /** Injectable fetch (tests). */
  fetchImpl?: typeof fetch;
  /** Injectable clock (tests). */
  now?: () => number;
  /** Per-call timeout (default 120s). */
  timeoutMs?: number;
  /** Optional API key for the paid tier (sent as Bearer). */
  apiKey?: string;
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0, 80) || 'task';
}

function buildPrompt(task: ColabTask): string {
  const parts = [`Task: ${task.title}`];
  if (task.description) parts.push(`\nDetails:\n${task.description}`);
  if (task.acceptanceCriteria?.length) {
    parts.push(`\nAcceptance criteria:\n${task.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}`);
  }
  parts.push('\nProduce exactly the requested artifact. Output only the artifact content.');
  return parts.join('\n');
}

/**
 * Build a {@link TaskExecutor} that runs the task on the tier's model and writes
 * the result to `<outputDir>/<taskId>.md`.
 */
export function createLocalModelTaskExecutor(opts: LocalModelTaskExecutorOptions = {}): TaskExecutor {
  const outputDir = opts.outputDir ?? path.join(process.cwd(), '.codebuddy', 'fleet-output');
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => Date.now());
  const timeoutMs = opts.timeoutMs ?? 120_000;

  return async (task: ColabTask, model: AutonomousModelChoice): Promise<TaskExecutionResult> => {
    const start = now();
    if (task.filesToModify?.length || task.verifyCommand?.trim()) {
      return {
        ok: false,
        summary: 'artifact executor cannot edit a repo',
        error: 'task has filesToModify/verifyCommand — use the agent executor (buddy autonomy run --executor agent --workspace <dir>)',
      };
    }
    if (!model.baseUrl) {
      return { ok: false, summary: 'no endpoint for the chosen model tier', error: `tier ${model.tier} has no baseUrl` };
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (opts.apiKey) headers['Authorization'] = `Bearer ${opts.apiKey}`;

    try {
      const res = await doFetch(`${model.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: model.model,
          messages: [
            { role: 'system', content: 'You are an autonomous fleet worker. Produce exactly the requested artifact, nothing else.' },
            { role: 'user', content: buildPrompt(task) },
          ],
          stream: false,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        return { ok: false, summary: `model returned HTTP ${res.status}`, error: `${res.status} ${res.statusText}` };
      }
      const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = sanitizeModelOutput(data.choices?.[0]?.message?.content ?? '').trim();
      if (!content) {
        return { ok: false, summary: 'model returned empty output', error: 'no content' };
      }
      fs.mkdirSync(outputDir, { recursive: true });
      const outFile = path.join(outputDir, `${safeName(task.id)}.md`);
      fs.writeFileSync(outFile, `${content}\n`, 'utf-8');
      return {
        ok: true,
        summary: `produced ${path.basename(outFile)} via ${model.tier} model ${model.model}`,
        filesModified: [{ file: outFile, changes: `wrote ${content.length} chars` }],
        elapsedSeconds: (now() - start) / 1000,
      };
    } catch (err) {
      return { ok: false, summary: 'executor error', error: err instanceof Error ? err.message : String(err) };
    }
  };
}
