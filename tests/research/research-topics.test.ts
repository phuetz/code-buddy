import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadStoredTopics,
  addStoredTopics,
  removeStoredTopics,
  clearStoredTopics,
  resolveResearchTopics,
} from '../../src/research/research-topics.js';

let dir: string;
let store: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rtopics-'));
  store = join(dir, 'research-topics.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

describe('research topics store', () => {
  it('adds, dedups case-insensitively, and persists (keeping first spelling)', () => {
    addStoredTopics(['LLM agents', 'robotics'], store);
    const next = addStoredTopics(['  llm agents  ', 'RAG'], store); // dup of "LLM agents"
    expect(next).toEqual(['LLM agents', 'robotics', 'RAG']);
    expect(loadStoredTopics(store)).toEqual(['LLM agents', 'robotics', 'RAG']);
  });

  it('removes case-insensitively', () => {
    addStoredTopics(['LLM agents', 'robotics'], store);
    expect(removeStoredTopics(['ROBOTICS'], store)).toEqual(['LLM agents']);
  });

  it('clears the store', () => {
    addStoredTopics(['a', 'b'], store);
    clearStoredTopics(store);
    expect(loadStoredTopics(store)).toEqual([]);
  });

  it('missing/garbage store → empty, never throws', () => {
    expect(loadStoredTopics(join(dir, 'nope.json'))).toEqual([]);
  });

  it('resolveResearchTopics unions env + store, deduped', () => {
    addStoredTopics(['robotics', 'RAG'], store);
    const env = { CODEBUDDY_RESEARCH_TOPICS: 'LLM agents, robotics' } as NodeJS.ProcessEnv;
    expect(resolveResearchTopics(env, store)).toEqual(['LLM agents', 'robotics', 'RAG']);
  });

  it('resolveResearchTopics with no env and empty store → []', () => {
    expect(resolveResearchTopics({} as NodeJS.ProcessEnv, store)).toEqual([]);
  });
});
