// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OneClickDeployDialog } from '../src/renderer/components/one-click-deploy/OneClickDeployDialog';
import type { OneClickReport } from '../../src/deploy/one-click-types.js';

function report(over: Partial<OneClickReport> = {}): OneClickReport {
  return {
    ok: true,
    dryRun: true,
    target: 'cloudflare-pages',
    projectRoot: '/site',
    durationMs: 42,
    steps: [
      { id: 'config', status: 'ok', detail: 'target=cloudflare-pages outputDir=dist' },
      { id: 'upload', status: 'planned', detail: 'not sent (dry-run)', command: 'wrangler pages deploy dist --project-name site' },
    ],
    rollback: {
      supported: true,
      summary: 'Cloudflare Pages can restore a previous deployment',
      commands: ['wrangler pages deployment list --project-name site'],
    },
    ...over,
  };
}

describe('OneClickDeployDialog', () => {
  afterEach(() => {
    cleanup();
  });

  it('runs a dry-run on open and does not apply until confirm', async () => {
    const run = vi.fn(async (input: { apply?: boolean; dryRun?: boolean }) => {
      expect(input.dryRun).toBe(true);
      expect(input.apply).toBe(false);
      return report();
    });
    render(
      <OneClickDeployDialog isOpen projectRoot="/site" onClose={() => {}} run={run} />,
    );
    await waitFor(() => expect(screen.getByTestId('one-click-deploy-report')).toBeTruthy());
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('one-click-deploy-report').textContent).toMatch(/simulation/);
    expect(screen.getByTestId('one-click-deploy-report').textContent).toMatch(
      /wrangler pages deploy dist --project-name site/,
    );
    fireEvent.click(screen.getByTestId('one-click-deploy-apply'));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    expect(run.mock.calls[1]?.[0]).toMatchObject({ apply: true, dryRun: false });
  });

  it('shows the missing-tool error from the engine', async () => {
    const run = vi.fn(async () =>
      report({
        ok: false,
        error: 'wrangler is not installed. Install Cloudflare Wrangler locally in the project (npm i -D wrangler) — Code Buddy will not download or install it.',
        steps: [{ id: 'tool', status: 'error', detail: 'missing' }],
      }),
    );
    render(<OneClickDeployDialog isOpen projectRoot="/site" onClose={() => {}} run={run} />);
    await waitFor(() => expect(screen.getByTestId('one-click-deploy-error')).toBeTruthy());
    expect(screen.getByTestId('one-click-deploy-error').textContent).toMatch(/will not download/);
    expect((screen.getByTestId('one-click-deploy-apply') as HTMLButtonElement).disabled).toBe(true);
  });
});
