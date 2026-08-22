import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildRunRecallPack,
  buildRunRecallPackAsync,
} from '../../src/observability/run-recall-pack.js';
import { RunStore } from '../../src/observability/run-store.js';

describe('buildRunRecallPack', () => {
  let tempDir: string;
  let store: RunStore;
  let activeRunIds: string[];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-recall-pack-'));
    store = new RunStore(tempDir);
    activeRunIds = [];
  });

  afterEach(async () => {
    for (const runId of activeRunIds) {
      try {
        store.endRun(runId, 'cancelled');
      } catch {
        // Ignore already-ended runs.
      }
    }
    store.dispose();
    await new Promise((resolve) => setTimeout(resolve, 60));
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  function startRun(objective: string, metadata?: Parameters<RunStore['startRun']>[1]): string {
    const runId = store.startRun(objective, metadata);
    activeRunIds.push(runId);
    return runId;
  }

  it('groups ranked run search results into a cited prompt context', async () => {
    const runId = startRun('Hermes architect lead discovery', {
      channel: 'cowork',
      tags: ['fleet', 'research'],
    });
    store.saveArtifact(runId, 'summary.md', 'architect lead discovery produced a review-only public-data script.');
    store.endRun(runId, 'completed');
    activeRunIds = activeRunIds.filter((id) => id !== runId);
    await new Promise((resolve) => setTimeout(resolve, 60));

    const pack = buildRunRecallPack('architect lead discovery', {
      limit: 10,
      maxMatchesPerRun: 2,
      sources: ['desktop'],
      store,
    });

    expect(pack).toMatchObject({
      schemaVersion: 1,
      query: 'architect lead discovery',
      filters: {
        limit: 10,
        maxMemories: 5,
        maxMatchesPerRun: 2,
        maxLessons: 5,
        maxSessions: 3,
        sources: ['desktop'],
      },
      lessonCount: 0,
      runCount: 1,
    });
    expect(new Date(pack.generatedAt).toString()).not.toBe('Invalid Date');
    expect(pack.runs).toEqual([
      expect.objectContaining({
        channel: 'cowork',
        objective: 'Hermes architect lead discovery',
        runId,
        source: 'cowork',
        tags: ['fleet', 'research'],
      }),
    ]);
    expect(pack.runs[0]?.matches.length).toBeGreaterThan(0);
    expect(pack.runs[0]?.matches.length).toBeLessThanOrEqual(2);
    expect(pack.promptContext).toContain('# Run recall pack');
    expect(pack.promptContext).toContain(`## ${runId}`);
    expect(pack.promptContext).toContain('architect lead discovery');
  });

  it('can include matching lessons in the cited prompt context', () => {
    const pack = buildRunRecallPack('architect discovery', {
      lessonsTracker: {
        search: () => [
          {
            id: 'lesson_architect_public_data',
            category: 'PATTERN',
            content: 'Architect discovery should keep public evidence beside extracted contacts.',
            context: 'Lead Scout',
            createdAt: 1_779_132_000_000,
            source: 'self_observed',
          },
        ],
      },
      maxLessons: 2,
      store,
    });

    expect(pack).toMatchObject({
      filters: {
        maxLessons: 2,
      },
      lessonCount: 1,
      lessons: [
        expect.objectContaining({
          category: 'PATTERN',
          context: 'Lead Scout',
          id: 'lesson_architect_public_data',
          source: 'self_observed',
        }),
      ],
    });
    expect(pack.promptContext).toContain('## Lessons');
    expect(pack.promptContext).toContain('Architect discovery should keep public evidence');
  });

  it('can include matching persistent memories in the cited prompt context', () => {
    const memoryFile = path.join(tempDir, '.codebuddy', 'CODEBUDDY_MEMORY.md');
    fs.mkdirSync(path.dirname(memoryFile), { recursive: true });
    fs.writeFileSync(
      memoryFile,
      [
        '# Code Buddy Memory',
        '',
        '## Project Context',
        '- **lead-discovery-policy**: Architect discovery keeps source URLs beside each public contact.',
        '',
        '## Decisions',
        '- **manual-review**: Export contacts for review before any outreach.',
        '',
      ].join('\n'),
      'utf-8',
    );

    const pack = buildRunRecallPack('architect source urls', {
      includeMemories: true,
      maxMemories: 2,
      memoryFiles: [memoryFile],
      store,
    });

    expect(pack).toMatchObject({
      filters: {
        maxMemories: 2,
      },
      memoryCount: 1,
      memories: [
        expect.objectContaining({
          category: 'project',
          key: 'lead-discovery-policy',
          scope: 'custom',
        }),
      ],
    });
    expect(pack.promptContext).toContain('## Memories');
    expect(pack.promptContext).toContain('lead-discovery-policy');
    expect(pack.promptContext).toContain('source URLs');
  });

  it('can include matching saved sessions in the cited prompt context', async () => {
    const pack = await buildRunRecallPackAsync('architect handoff', {
      maxSessions: 1,
      sessionStore: {
        searchSessions: async () => [
          {
            id: 'session_architect_handoff',
            name: 'Architect handoff notes',
            workingDirectory: tempDir,
            model: 'gpt-5.4',
            messages: [],
            createdAt: new Date('2026-05-18T19:00:00.000Z'),
            lastAccessedAt: new Date('2026-05-18T19:05:00.000Z'),
            metadata: {
              parentSessionId: 'session_parent',
              searchMessageId: 7,
              searchRole: 'assistant',
              searchScore: 42,
              searchSnippet: 'architect handoff session snippet',
            },
          },
        ],
      },
      store,
    });

    expect(pack).toMatchObject({
      filters: {
        maxSessions: 1,
      },
      sessionCount: 1,
      sessions: [
        expect.objectContaining({
          id: 'session_architect_handoff',
          messageId: 7,
          parentSessionId: 'session_parent',
          role: 'assistant',
          snippet: 'architect handoff session snippet',
        }),
      ],
    });
    expect(pack.promptContext).toContain('## Sessions');
    expect(pack.promptContext).toContain('session_architect_handoff');
    expect(pack.promptContext).toContain('architect handoff session snippet');
  });

  it('exports active tool-filter blocks as policy evidence without duplicate result rows', async () => {
    const runId = startRun('Safe profile blocked mutation attempt', {
      channel: 'cowork',
      tags: ['profile:safe'],
    });
    store.emit(runId, {
      type: 'decision',
      data: {
        kind: 'tool_filter_block',
        source: 'active_tool_filter',
        toolCallId: 'call-blocked-create',
        toolName: 'create_file',
        reason: 'Tool "create_file" is disabled by the active tool filter and was not executed.',
      },
    });
    store.emit(runId, {
      type: 'tool_result',
      data: {
        blockedBy: 'active_tool_filter',
        error: 'Tool "create_file" is disabled by the active tool filter and was not executed.',
        success: false,
        toolCallId: 'call-blocked-create',
        toolName: 'create_file',
      },
    });
    store.endRun(runId, 'completed');
    activeRunIds = activeRunIds.filter((id) => id !== runId);
    await new Promise((resolve) => setTimeout(resolve, 60));

    const pack = buildRunRecallPack('active tool filter', {
      limit: 10,
      store,
    });

    expect(pack.runCount).toBe(1);
    expect(pack.runs[0]?.toolFilterBlocks).toEqual([
      expect.objectContaining({
        eventType: 'decision',
        source: 'active_tool_filter',
        toolCallId: 'call-blocked-create',
        toolName: 'create_file',
      }),
    ]);
    expect(pack.promptContext).toContain('Policy blocks:');
    expect(pack.promptContext).toContain(
      '- create_file call=call-blocked-create source=active_tool_filter',
    );
  });

  it('returns an empty pack for blank queries', () => {
    const pack = buildRunRecallPack('   ', { store });

    expect(pack).toMatchObject({
      query: '',
      count: 0,
      lessonCount: 0,
      lessons: [],
      memories: [],
      memoryCount: 0,
      runCount: 0,
      runs: [],
    });
    expect(pack.promptContext).toContain('No matching runs were found.');
  });
});
