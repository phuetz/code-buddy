import type { ToolResult } from '../types/index.js';
import {
  buildInternetScoutPlan,
  renderInternetScoutPlan,
  type InternetScoutPlan,
  type InternetScoutPlanOptions,
  type InternetScoutStepTool,
} from './internet-scout-plan.js';
import { assertSafeUrl } from '../security/ssrf-guard.js';

export type InternetScoutExecutableTool = InternetScoutStepTool;

export type InternetScoutTraceStatus =
  | 'success'
  | 'failed'
  | 'skipped'
  | 'stopped';

export type InternetScoutWaitUntil = 'load' | 'domcontentloaded' | 'networkidle';

export interface InternetScoutRunOptions extends InternetScoutPlanOptions {
  useBrowser?: boolean;
  headless?: boolean;
  browserPageLimit?: number;
  waitUntil?: InternetScoutWaitUntil;
  scrollCount?: number;
  executePersistence?: boolean;
}

export interface InternetScoutToolExecutor {
  execute(tool: InternetScoutExecutableTool, input: Record<string, unknown>): Promise<ToolResult>;
  isSafeUrl?(url: string): Promise<{ safe: true } | { safe: false; reason: string }>;
}

export interface InternetScoutTrace {
  stepId: string;
  tool: InternetScoutExecutableTool;
  action?: string;
  status: InternetScoutTraceStatus;
  url?: string;
  input?: Record<string, unknown>;
  output?: string;
  error?: string;
  blocker?: string;
}

export interface InternetScoutEvidence {
  url?: string;
  title?: string;
  headings: string[];
  matches: string[];
  snippet?: string;
  assertionPassed?: boolean;
  expectedText?: string;
}

export interface InternetScoutRunResult {
  success: boolean;
  stopped: boolean;
  blocker?: string;
  plan: InternetScoutPlan;
  selectedUrls: string[];
  evidence: InternetScoutEvidence[];
  traces: InternetScoutTrace[];
}

interface PersistenceSuggestion {
  tool: 'remember' | 'lessons_add';
  input: Record<string, string>;
}

const DEFAULT_BROWSER_PAGE_LIMIT = 1;
const MAX_SCROLL_COUNT = 5;
const STOP_PATTERNS = [
  { label: 'captcha or bot challenge', pattern: /captcha|verify you are human|unusual traffic|security checkpoint|bot[- ]?verification|cloudflare/i },
  { label: 'rate limit or forbidden response', pattern: /\b429\b|too many requests|rate[- ]?limit|\b403\b|forbidden/i },
  { label: 'login or private access wall', pattern: /sign in to continue|log in to continue|please log in|members only|private area|authentication required/i },
  { label: 'paywall or subscription wall', pattern: /paywall|subscribe to continue|subscription required/i },
  { label: 'access-control bypass request', pattern: /bypass|evade|stealth|solve captcha|credential harvest|inject cookie/i },
] as const;

export async function runInternetScout(
  options: InternetScoutRunOptions,
  executor: InternetScoutToolExecutor,
): Promise<InternetScoutRunResult> {
  const plan = buildInternetScoutPlan(options);
  const traces: InternetScoutTrace[] = [];
  const evidence: InternetScoutEvidence[] = [];
  const selectedUrls: string[] = [];
  const maxPages = plan.maxPages;
  const browserPageLimit = normalizeBrowserPageLimit(options.browserPageLimit);
  const scrollCount = normalizeScrollCount(options.scrollCount);
  const useBrowser = options.useBrowser !== false;
  let browserLaunchAttempted = false;
  let browserPagesUsed = 0;
  let assertionPassed = false;

  let candidateUrls = plan.sourceUrl ? [plan.sourceUrl] : [];

  if (candidateUrls.length === 0) {
    const searchResult = await executeAndTrace(traces, executor, {
      stepId: 'discover',
      tool: 'web_search',
      input: { query: plan.query, max_results: maxPages },
    });

    const blocker = detectBlocker(searchResult, plan.allowLoginPages);
    if (blocker) {
      return stopResult(plan, selectedUrls, evidence, traces, blocker);
    }
    if (!searchResult.success) {
      return stopResult(plan, selectedUrls, evidence, traces, searchResult.error || 'web_search failed');
    }

    candidateUrls = extractUrlsFromSearch(searchResult, maxPages);
    if (candidateUrls.length === 0) {
      return stopResult(plan, selectedUrls, evidence, traces, 'No public URL candidates found');
    }
  }

  for (const url of uniqueUrls(candidateUrls).slice(0, maxPages)) {
    const safeUrl = await assertPublicUrl(url, executor);
    if (!safeUrl.safe) {
      traces.push({
        stepId: 'url-safety',
        tool: 'web_fetch',
        status: 'stopped',
        url,
        blocker: safeUrl.reason,
      });
      return stopResult(plan, selectedUrls, evidence, traces, safeUrl.reason);
    }

    selectedUrls.push(url);

    const fetchResult = await executeAndTrace(traces, executor, {
      stepId: 'static-read',
      tool: 'web_fetch',
      url,
      input: { url, prompt: plan.goal },
    });

    const fetchBlocker = detectBlocker(fetchResult, plan.allowLoginPages);
    if (fetchBlocker) {
      return stopResult(plan, selectedUrls, evidence, traces, fetchBlocker);
    }

    if (!fetchResult.success) {
      continue;
    }

    if (!useBrowser) {
      evidence.push(evidenceFromFetch(url, fetchResult, plan.expectedText));
      continue;
    }

    if (browserPagesUsed >= browserPageLimit) {
      traces.push({
        stepId: 'browser-budget',
        tool: 'browser',
        status: 'skipped',
        url,
        output: `Browser page budget reached (${browserPageLimit}).`,
      });
      continue;
    }

    if (!browserLaunchAttempted) {
      browserLaunchAttempted = true;
      const launchResult = await executeAndTrace(traces, executor, {
        stepId: 'browser-launch',
        tool: 'browser',
        action: 'launch',
        input: { action: 'launch', headless: options.headless ?? true },
      });
      if (!launchResult.success) {
        return stopResult(plan, selectedUrls, evidence, traces, launchResult.error || 'browser launch failed');
      }
    }

    browserPagesUsed++;

    const navigateResult = await executeAndTrace(traces, executor, {
      stepId: 'browser-navigate',
      tool: 'browser',
      action: 'navigate',
      url,
      input: {
        action: 'navigate',
        url,
        waitUntil: options.waitUntil ?? 'domcontentloaded',
      },
    });
    const navigateBlocker = detectBlocker(navigateResult, plan.allowLoginPages);
    if (navigateBlocker) {
      return stopResult(plan, selectedUrls, evidence, traces, navigateBlocker);
    }
    if (!navigateResult.success) {
      continue;
    }

    if (plan.steps.some((step) => step.id === 'observe')) {
      const observeResult = await executeAndTrace(traces, executor, {
        stepId: 'observe',
        tool: 'browser',
        action: 'observe',
        url,
        input: { action: 'observe', query: plan.query, maxElements: 80 },
      });
      const observeBlocker = detectBlocker(observeResult, plan.allowLoginPages);
      if (observeBlocker) {
        return stopResult(plan, selectedUrls, evidence, traces, observeBlocker);
      }
    }

    for (let index = 0; index < scrollCount; index++) {
      await executeAndTrace(traces, executor, {
        stepId: `scroll-${index + 1}`,
        tool: 'browser',
        action: 'scroll',
        url,
        input: { action: 'scroll', direction: 'down', amount: 700 },
      });
    }

    const extractResult = await executeAndTrace(traces, executor, {
      stepId: 'extract',
      tool: 'browser',
      action: 'extract',
      url,
      input: {
        action: 'extract',
        query: plan.query,
        proofGoal: plan.goal,
        persistWhenProven: options.persistWhenProven === true,
      },
    });
    const extractBlocker = detectBlocker(extractResult, plan.allowLoginPages);
    if (extractBlocker) {
      return stopResult(plan, selectedUrls, evidence, traces, extractBlocker);
    }
    if (extractResult.success) {
      const pageEvidence = evidenceFromBrowserData(url, extractResult, plan.expectedText);
      evidence.push(pageEvidence);

      if (plan.steps.some((step) => step.id === 'relationship-context')) {
        await executeRelationshipContext(executor, traces, pageEvidence, plan.goal, plan.intent);
      }

      await maybeExecutePersistence(executor, traces, extractResult, options.executePersistence === true);
    }

    if (plan.expectedText) {
      const assertResult = await executeAndTrace(traces, executor, {
        stepId: 'assert',
        tool: 'browser',
        action: 'assert_text',
        url,
        input: {
          action: 'assert_text',
          expectedText: plan.expectedText,
          query: plan.query,
          proofGoal: plan.goal,
          persistWhenProven: options.persistWhenProven === true,
        },
      });
      assertionPassed = assertResult.success;
      mergeAssertionEvidence(evidence, url, assertResult, plan.expectedText);
      await maybeExecutePersistence(executor, traces, assertResult, options.executePersistence === true);
      if (assertionPassed) {
        break;
      }
    }
  }

  const hasEvidence = evidence.some((item) =>
    item.title || item.headings.length > 0 || item.matches.length > 0 || item.snippet,
  );
  const success = plan.expectedText ? assertionPassed : hasEvidence;

  return {
    success,
    stopped: false,
    ...(success ? {} : { blocker: plan.expectedText ? 'Expected text was not proven' : 'No durable evidence collected' }),
    plan,
    selectedUrls,
    evidence,
    traces,
  };
}

export function renderInternetScoutRunResult(result: InternetScoutRunResult): string {
  const lines = [
    renderInternetScoutPlan(result.plan),
    '',
    '## Run Result',
    `Status: ${result.success ? 'success' : result.stopped ? 'stopped' : 'incomplete'}`,
    result.blocker ? `Blocker: ${result.blocker}` : '',
    result.selectedUrls.length ? `Selected URLs: ${result.selectedUrls.join(', ')}` : '',
    '',
    '## Trace',
    ...result.traces.map((trace) => {
      const action = trace.action ? `.${trace.action}` : '';
      const suffix = trace.blocker || trace.error || trace.output || '';
      return `- ${trace.stepId}: ${trace.tool}${action} ${trace.status}${suffix ? ` - ${truncate(suffix, 180)}` : ''}`;
    }),
    '',
    '## Evidence',
    ...formatEvidence(result.evidence),
  ];

  return lines.filter((line) => line !== '').join('\n');
}

async function executeAndTrace(
  traces: InternetScoutTrace[],
  executor: InternetScoutToolExecutor,
  step: {
    stepId: string;
    tool: InternetScoutExecutableTool;
    action?: string;
    url?: string;
    input: Record<string, unknown>;
  },
): Promise<ToolResult> {
  const result = await executor.execute(step.tool, step.input);
  traces.push({
    stepId: step.stepId,
    tool: step.tool,
    ...(step.action ? { action: step.action } : {}),
    status: result.success ? 'success' : 'failed',
    ...(step.url ? { url: step.url } : {}),
    input: step.input,
    ...(result.output ? { output: truncate(result.output, 500) } : {}),
    ...(result.error ? { error: result.error } : {}),
  });
  return result;
}

async function assertPublicUrl(
  url: string,
  executor: InternetScoutToolExecutor,
): Promise<{ safe: true } | { safe: false; reason: string }> {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { safe: false, reason: `Unsupported URL protocol: ${parsed.protocol}` };
    }
    if (executor.isSafeUrl) {
      return executor.isSafeUrl(url);
    }
    const check = await assertSafeUrl(url);
    if (!check.safe) {
      return { safe: false, reason: `URL blocked by safety guard: ${check.reason || 'not allowed'}` };
    }
    return { safe: true };
  } catch (error) {
    return { safe: false, reason: `Invalid URL: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function stopResult(
  plan: InternetScoutPlan,
  selectedUrls: string[],
  evidence: InternetScoutEvidence[],
  traces: InternetScoutTrace[],
  blocker: string,
): InternetScoutRunResult {
  return {
    success: false,
    stopped: true,
    blocker,
    plan,
    selectedUrls,
    evidence,
    traces,
  };
}

function detectBlocker(result: ToolResult, allowLoginPages: boolean): string | undefined {
  const text = `${result.error || ''}\n${result.output || ''}`;
  for (const { label, pattern } of STOP_PATTERNS) {
    if (label === 'login or private access wall' && allowLoginPages) {
      continue;
    }
    if (pattern.test(text)) {
      return label;
    }
  }
  return undefined;
}

function extractUrlsFromSearch(result: ToolResult, maxUrls: number): string[] {
  const text = result.output || '';
  const urls = Array.from(text.matchAll(/https?:\/\/[^\s)\]}>"']+/g))
    .map((match) => match[0].replace(/[.,;:]+$/g, ''))
    .filter(Boolean);
  return uniqueUrls(urls).slice(0, maxUrls);
}

function uniqueUrls(urls: string[]): string[] {
  return [...new Set(urls)];
}

function evidenceFromFetch(
  url: string,
  result: ToolResult,
  expectedText: string | undefined,
): InternetScoutEvidence {
  const output = result.output || '';
  const matches = expectedText && output.toLowerCase().includes(expectedText.toLowerCase())
    ? [expectedText]
    : [];
  return {
    url,
    title: extractTitleFromText(output),
    headings: [],
    matches,
    snippet: truncate(output.replace(/\s+/g, ' ').trim(), 500),
    ...(expectedText ? { expectedText, assertionPassed: matches.length > 0 } : {}),
  };
}

function evidenceFromBrowserData(
  fallbackUrl: string,
  result: ToolResult,
  expectedText: string | undefined,
): InternetScoutEvidence {
  const data = toRecord(result.data);
  return {
    url: asString(data.url) || fallbackUrl,
    title: asString(data.title),
    headings: asStringArray(data.headings),
    matches: asStringArray(data.matches),
    snippet: asString(result.output) || asString(data.text),
    ...(expectedText ? { expectedText } : {}),
  };
}

function mergeAssertionEvidence(
  evidence: InternetScoutEvidence[],
  url: string,
  result: ToolResult,
  expectedText: string,
): void {
  const data = toRecord(result.data);
  const targetUrl = asString(data.url) || url;
  const entry = evidence.find((item) => item.url === targetUrl) ?? {
    url: targetUrl,
    title: asString(data.title),
    headings: [],
    matches: [],
  };

  entry.expectedText = expectedText;
  entry.assertionPassed = result.success;
  if (result.success && !entry.matches.includes(expectedText)) {
    entry.matches.push(expectedText);
  }
  if (!entry.snippet && result.output) {
    entry.snippet = truncate(result.output, 500);
  }
  if (!evidence.includes(entry)) {
    evidence.push(entry);
  }
}

async function executeRelationshipContext(
  executor: InternetScoutToolExecutor,
  traces: InternetScoutTrace[],
  pageEvidence: InternetScoutEvidence,
  goal: string,
  intent: InternetScoutPlan['intent'],
): Promise<void> {
  const publicFacts = [
    ...pageEvidence.headings.slice(0, 5),
    ...pageEvidence.matches.slice(0, 5),
    pageEvidence.snippet || '',
  ].filter(Boolean);

  await executeAndTrace(traces, executor, {
    stepId: 'relationship-context',
    tool: 'relationship_context',
    input: {
      subject: pageEvidence.title || goal,
      subjectType: intent === 'profile_enrichment' ? 'unknown_person' : 'organization',
      mode: 'prospecting',
      confidence: 0.65,
      publicFacts,
      evidence: [
        {
          sourceType: 'public_web',
          label: pageEvidence.title || 'Public web source',
          url: pageEvidence.url,
          excerpt: pageEvidence.snippet,
          confidence: 0.65,
        },
      ],
    },
  });
}

async function maybeExecutePersistence(
  executor: InternetScoutToolExecutor,
  traces: InternetScoutTrace[],
  result: ToolResult,
  executePersistence: boolean,
): Promise<void> {
  const suggestions = extractPersistenceSuggestions(result);
  if (suggestions.length === 0) {
    return;
  }

  if (!executePersistence) {
    for (const suggestion of suggestions) {
      traces.push({
        stepId: `persistence-${suggestion.tool}`,
        tool: suggestion.tool,
        status: 'skipped',
        output: 'Persistence suggestion available but executePersistence is false.',
      });
    }
    return;
  }

  for (const suggestion of suggestions) {
    await executeAndTrace(traces, executor, {
      stepId: `persistence-${suggestion.tool}`,
      tool: suggestion.tool,
      input: suggestion.input,
    });
  }
}

function extractPersistenceSuggestions(result: ToolResult): PersistenceSuggestion[] {
  const data = toRecord(result.data);
  const suggestions = Array.isArray(data.persistenceSuggestions) ? data.persistenceSuggestions : [];
  return suggestions
    .map((value) => toRecord(value))
    .filter((value): value is Record<string, unknown> => Boolean(value.tool && value.input))
    .map((value) => ({
      tool: value.tool === 'remember' ? 'remember' : 'lessons_add',
      input: stringRecord(value.input),
    }));
}

function normalizeBrowserPageLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_BROWSER_PAGE_LIMIT;
  }
  return Math.min(5, Math.max(0, Math.floor(value)));
}

function normalizeScrollCount(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 0;
  }
  return Math.min(MAX_SCROLL_COUNT, Math.max(0, Math.floor(value)));
}

function formatEvidence(evidence: InternetScoutEvidence[]): string[] {
  if (evidence.length === 0) {
    return ['- No durable evidence collected.'];
  }

  return evidence.map((item) => {
    const facts = [
      item.title ? `title="${item.title}"` : '',
      item.headings.length ? `headings=${item.headings.slice(0, 3).join(' | ')}` : '',
      item.matches.length ? `matches=${item.matches.join(' | ')}` : '',
      item.assertionPassed !== undefined ? `assertion=${item.assertionPassed ? 'passed' : 'failed'}` : '',
    ].filter(Boolean).join('; ');
    return `- ${item.url || '(unknown URL)'}${facts ? ` (${facts})` : ''}`;
  });
}

function extractTitleFromText(text: string): string | undefined {
  const firstLine = text.split(/\n+/).map((line) => line.trim()).find(Boolean);
  if (!firstLine) {
    return undefined;
  }
  return truncate(firstLine.replace(/^Content from\s+\S+:\s*/i, ''), 120);
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => asString(item)).filter((item): item is string => Boolean(item))
    : [];
}

function stringRecord(value: unknown): Record<string, string> {
  const record = toRecord(value);
  const output: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === 'string') {
      output[key] = entry;
    }
  }
  return output;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}
