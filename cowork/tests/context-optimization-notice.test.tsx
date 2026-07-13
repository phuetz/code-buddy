/** @vitest-environment happy-dom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextOptimizationNotice } from '../src/renderer/components/message/ContextOptimizationNotice';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Cowork context optimization notice', () => {
  it('shows savings and exposes a copy-only restore action without loading raw output', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const contextOptimization = {
      optimizer: 'lm-resizer',
      reason: 'optimized',
      rawRef: 'call_ux_42',
      originalBytes: 10_000,
      finalBytes: 1_800,
      bytesSaved: 8_200,
      transport: 'http' as const,
    };

    render(
      <>
        <ContextOptimizationNotice metadata={contextOptimization} compact />
        <ContextOptimizationNotice metadata={contextOptimization} />
      </>,
    );

    expect(screen.getAllByText('lm-resizer · 82% saved')).toHaveLength(2);
    expect(screen.queryByText('SECRET RAW ORIGINAL')).toBeNull();
    expect(screen.getByText('call_ux_42')).toBeTruthy();
    expect(screen.getByText('restore_context({"identifier":"call_ux_42"})')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Copy restore command' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        'restore_context({"identifier":"call_ux_42"})',
      );
    });
    expect(screen.getByText('Copied')).toBeTruthy();
  });
});
