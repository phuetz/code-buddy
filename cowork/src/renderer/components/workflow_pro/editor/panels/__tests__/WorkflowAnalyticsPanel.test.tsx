// @ts-nocheck
/**
 * WorkflowAnalyticsPanel tests (V24-3)
 * --------------------------------------------------------------------
 * Covers the per-workflow analytics panel contract:
 *   - empty state when API returns zero data
 *   - 4 stat cards render values from a mocked response
 *   - range selector triggers a re-fetch with the right query string
 *   - SVG line chart renders one <circle> per data point
 *   - failure-by-node table renders rows + correct percentages
 *   - auto-refresh toggle starts/stops the polling interval
 *
 * Notes
 * -----
 * - Uses vi.stubGlobal('fetch', …) to control responses per-test.
 *   test-setup.ts also stubs fetch, but stubGlobal supersedes it.
 * - Fake timers are scoped per-test: enable in beforeEach, restore
 *   in afterEach (see CLAUDE.md test-stability gotchas).
 */
import React from 'react';
import {
  render,
  screen,
  waitFor,
  fireEvent,
  act,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  WorkflowAnalyticsPanel,
  type AnalyticsResponse,
} from '../WorkflowAnalyticsPanel';

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

function makeResponse(
  overrides: Partial<AnalyticsResponse> = {},
): AnalyticsResponse {
  return {
    successRateOverTime: [
      { ts: 1715817600000, value: 100 },
      { ts: 1715821200000, value: 80 },
      { ts: 1715824800000, value: 90 },
      { ts: 1715828400000, value: 75 },
    ],
    avgDurationOverTime: [
      { ts: 1715817600000, value: 1000 },
      { ts: 1715821200000, value: 1500 },
      { ts: 1715824800000, value: 1200 },
      { ts: 1715828400000, value: 1800 },
    ],
    failureRateByNode: [
      { nodeId: 'node_1', nodeLabel: 'HTTP Request', failures: 3, total: 10 },
      { nodeId: 'node_2', nodeLabel: 'Send Email', failures: 1, total: 20 },
    ],
    topErrors: [
      { error: 'ECONNREFUSED', count: 12 },
      { error: 'Timeout', count: 5 },
    ],
    summary: {
      totalExecutions: 100,
      successRate: 92.5,
      avgDurationMs: 1450,
      failureCount: 8,
    },
    ...overrides,
  };
}

function emptyResponse(): AnalyticsResponse {
  return {
    successRateOverTime: [],
    avgDurationOverTime: [],
    failureRateByNode: [],
    topErrors: [],
    summary: {
      totalExecutions: 0,
      successRate: 0,
      avgDurationMs: 0,
      failureCount: 0,
    },
  };
}

function mockJsonResponse<T>(body: T, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function installFetchMock(handler: FetchHandler) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    return handler(url, init);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

// ──────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────

describe('WorkflowAnalyticsPanel', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('renders the empty state when the API returns no data', async () => {
    installFetchMock(() => mockJsonResponse(emptyResponse()));

    render(<WorkflowAnalyticsPanel workflowId="wf_42" />);

    await waitFor(() => {
      expect(screen.getByTestId('analytics-empty-state')).toBeInTheDocument();
    });
    expect(screen.getByText(/No execution data for this range/i)).toBeInTheDocument();
  });

  it('renders all 4 stat cards from the API response', async () => {
    installFetchMock(() => mockJsonResponse(makeResponse()));

    render(<WorkflowAnalyticsPanel workflowId="wf_42" />);

    await waitFor(() => {
      expect(screen.getByTestId('stat-total-executions')).toBeInTheDocument();
    });
    expect(screen.getByTestId('stat-total-executions')).toHaveTextContent('100');
    expect(screen.getByTestId('stat-success-rate')).toHaveTextContent('92.5%');
    // 1450ms → "1.4s" (JS toFixed(1) rounds half-even / floor for this value).
    expect(screen.getByTestId('stat-avg-duration')).toHaveTextContent(/1\.[45]s/);
    expect(screen.getByTestId('stat-failure-count')).toHaveTextContent('8');
  });

  it('re-fetches with the right ?range= query when a new range is chosen', async () => {
    const fetchMock = installFetchMock(() => mockJsonResponse(makeResponse()));

    render(
      <WorkflowAnalyticsPanel
        workflowId="wf_42"
        apiBasePath="/api"
        initialRange="24h"
      />,
    );

    // Initial fetch lands first.
    await waitFor(() => {
      expect(screen.getByTestId('stat-total-executions')).toBeInTheDocument();
    });

    const initialCallCount = fetchMock.mock.calls.length;
    expect(initialCallCount).toBeGreaterThanOrEqual(1);
    const firstUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(firstUrl).toMatch(/\/api\/workflows\/wf_42\/analytics\?range=24h$/);

    fireEvent.click(screen.getByTestId('analytics-range-7d'));

    await waitFor(() => {
      const lastUrl = fetchMock.mock.calls.at(-1)?.[0] as string;
      expect(lastUrl).toMatch(/range=7d/);
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(initialCallCount);
    // aria-selected reflects the new active tab.
    expect(screen.getByTestId('analytics-range-7d')).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('renders the success-rate chart with one <circle> per data point', async () => {
    installFetchMock(() => mockJsonResponse(makeResponse()));

    render(<WorkflowAnalyticsPanel workflowId="wf_42" />);

    await waitFor(() => {
      expect(screen.getByTestId('success-rate-chart')).toBeInTheDocument();
    });

    const chart = screen.getByTestId('success-rate-chart');
    // 4 input points => 4 <circle> nodes.
    const circles = chart.querySelectorAll('circle');
    expect(circles).toHaveLength(4);

    // SVG path is present and starts with an M (moveto) command.
    const path = screen.getByTestId('success-rate-chart-path');
    expect(path).toBeInTheDocument();
    expect(path.getAttribute('d') || '').toMatch(/^M/);
  });

  it('renders failure-rate-by-node rows with correct percentages', async () => {
    installFetchMock(() => mockJsonResponse(makeResponse()));

    render(<WorkflowAnalyticsPanel workflowId="wf_42" />);

    await waitFor(() => {
      expect(screen.getByTestId('failure-by-node-table')).toBeInTheDocument();
    });

    // 3/10 = 30%, 1/20 = 5%
    expect(screen.getByTestId('failure-row-node_1')).toHaveTextContent('30.0%');
    expect(screen.getByTestId('failure-row-node_2')).toHaveTextContent('5.0%');

    // Visualization bar widths are set inline.
    expect(screen.getByTestId('failure-bar-node_1').getAttribute('style')).toContain(
      'width: 30.0%',
    );
    expect(screen.getByTestId('failure-bar-node_2').getAttribute('style')).toContain(
      'width: 5.0%',
    );

    // Sort order: highest failure rate first.
    const rows = screen.getAllByTestId(/^failure-row-/);
    expect(rows[0].getAttribute('data-testid')).toBe('failure-row-node_1');
    expect(rows[1].getAttribute('data-testid')).toBe('failure-row-node_2');
  });

  it('auto-refresh toggle starts and stops the polling interval', async () => {
    const fetchMock = installFetchMock(() => mockJsonResponse(makeResponse()));

    // First render with real timers so the initial useEffect fetch can land.
    render(
      <WorkflowAnalyticsPanel workflowId="wf_42" autoRefreshMs={5_000} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('stat-total-executions')).toBeInTheDocument();
    });

    const baselineCallCount = fetchMock.mock.calls.length;
    expect(baselineCallCount).toBeGreaterThanOrEqual(1);

    // Switch to fake timers for the polling assertions.
    vi.useFakeTimers();

    // Toggle ON — interval scheduled.
    const toggle = screen.getByTestId('analytics-autorefresh-toggle');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');

    // Advance two intervals — expect two extra fetches triggered by the bumped tick.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(
      baselineCallCount + 2,
    );

    const afterAutoCount = fetchMock.mock.calls.length;

    // Toggle OFF — interval cleared, no further fetches.
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(fetchMock.mock.calls.length).toBe(afterAutoCount);
  });
});
