import { describe, expect, it } from 'vitest';
import { isBrowserOperatorTool, buildBrowserActionPayload } from '../src/main/engine/browser-action';

describe('isBrowserOperatorTool', () => {
  it('detects browser-automation tool names', () => {
    expect(isBrowserOperatorTool('browser')).toBe(true);
    expect(isBrowserOperatorTool('browser_navigate')).toBe(true);
    // D3: the browser_operator agent tool must be streamed to the overlay so a
    // proposed session is visible to the operator (not a silent JSON blob).
    expect(isBrowserOperatorTool('browser_operator')).toBe(true);
    expect(isBrowserOperatorTool('internet_scout')).toBe(true);
    expect(isBrowserOperatorTool('Browser')).toBe(true);
  });
  it('rejects non-browser tools (incl. computer-use)', () => {
    expect(isBrowserOperatorTool('computer_control')).toBe(false);
    expect(isBrowserOperatorTool('bash')).toBe(false);
    expect(isBrowserOperatorTool('')).toBe(false);
  });
});

describe('buildBrowserActionPayload', () => {
  const base = { sessionId: 's1', toolUseId: 't1', toolName: 'browser', now: 123 };

  it('extracts action + url + evidence from a navigate call', () => {
    const p = buildBrowserActionPayload({
      ...base,
      rawInput: JSON.stringify({ action: 'navigate', url: 'https://example.com' }),
      output: 'Navigated to https://example.com (200 OK)',
    });
    expect(p).toMatchObject({
      sessionId: 's1',
      toolUseId: 't1',
      action: 'navigate',
      url: 'https://example.com',
      timestamp: 123,
    });
    expect(p.evidence).toContain('Navigated to');
  });

  it('uses selector/text/query as the target', () => {
    expect(buildBrowserActionPayload({ ...base, rawInput: JSON.stringify({ action: 'click', selector: '#login' }) }).target).toBe('#login');
    expect(buildBrowserActionPayload({ ...base, rawInput: JSON.stringify({ action: 'type', text: 'hello' }) }).target).toBe('hello');
    expect(buildBrowserActionPayload({ ...base, rawInput: JSON.stringify({ action: 'search', query: 'cats' }) }).target).toBe('cats');
  });

  it('falls back to the tool name when no action field is present', () => {
    expect(buildBrowserActionPayload({ ...base, rawInput: '{}' }).action).toBe('browser');
  });

  it('caps evidence length to keep payloads small', () => {
    const big = 'x'.repeat(1000);
    const p = buildBrowserActionPayload({ ...base, output: big });
    expect(p.evidence!.length).toBeLessThanOrEqual(280);
  });

  it('extracts a base64 screenshot into a data URI', () => {
    const p = buildBrowserActionPayload({ ...base, data: { screenshot: 'iVBORw0KGgoAAAANSUhEUgAA' } });
    expect(p.screenshot).toMatch(/^data:image\/png;base64,/);
  });

  it('tolerates malformed JSON input without throwing', () => {
    const p = buildBrowserActionPayload({ ...base, rawInput: 'not json', output: 'ok' });
    expect(p.action).toBe('browser');
    expect(p.details).toEqual({});
  });

  it('forwards only the structured browser_operator draft needed by the review gate', () => {
    const operatorDraft = { schemaVersion: 1, sessionId: 'proposal', goal: 'Open docs' };
    const payload = buildBrowserActionPayload({
      ...base,
      toolName: 'browser_operator',
      data: { draft: operatorDraft, plan: { privatePlanningDetail: true } },
    });

    expect(payload.details?.operatorDraft).toEqual(operatorDraft);
    expect(payload.details).not.toHaveProperty('plan');
  });
});
