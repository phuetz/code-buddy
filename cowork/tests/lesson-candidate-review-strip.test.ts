/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LessonCandidateReviewStrip,
  buildLessonCandidateReviewCommand,
} from '../src/renderer/components/lesson-candidate-review-strip';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOptions?: string | Record<string, unknown>, maybeOptions?: Record<string, unknown>) => {
      const template = typeof fallbackOrOptions === 'string' ? fallbackOrOptions : key;
      const options = typeof fallbackOrOptions === 'object' ? fallbackOrOptions : maybeOptions;
      return Object.entries(options ?? {}).reduce(
        (value, [optionKey, optionValue]) =>
          value.replaceAll(`{{${optionKey}}}`, String(optionValue)),
        template,
      );
    },
  }),
}));

describe('LessonCandidateReviewStrip', () => {
  let root: Root | null = null;
  const container = () => {
    const element = document.createElement('div');
    document.body.appendChild(element);
    return element;
  };

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    document.body.innerHTML = '';
  });

  it('renders lesson candidate review counts and opens the review panel', () => {
    const target = container();
    const onOpenReview = vi.fn();
    root = createRoot(target);

    act(() => {
      root?.render(
        React.createElement(LessonCandidateReviewStrip, {
          error: 'stats file unreadable',
          onOpenReview,
          stats: {
            byStatus: {
              approved: 1,
              discarded: 1,
              pending: 2,
            },
            total: 4,
          },
        }),
      );
    });

    const strip = target.querySelector('[data-testid="fleet-lesson-candidate-review"]');
    expect(strip?.textContent).toContain('Lesson candidate review');
    expect(strip?.textContent).toContain('2 pending');
    expect(strip?.textContent).toContain('1 approved');
    expect(strip?.textContent).toContain('1 discarded');
    expect(strip?.textContent).toContain('Lesson candidate stats failed');
    expect(strip?.textContent).toContain('stats file unreadable');
    expect(strip?.textContent).toContain('Lessons are written only after a human opens the review queue');
    expect(strip?.textContent).toContain('buddy lessons candidate list --status pending');

    const button = target.querySelector<HTMLButtonElement>('[data-testid="lesson-candidate-open-review"]');
    expect(button?.textContent).toContain('Open review panel');

    act(() => {
      button?.click();
    });

    expect(onOpenReview).toHaveBeenCalledTimes(1);
  });

  it('keeps the CLI helper command stable', () => {
    expect(buildLessonCandidateReviewCommand()).toBe('buddy lessons candidate list --status pending');
  });

  it('loads stats from the readonly Electron bridge when no stats are provided', async () => {
    const target = container();
    const stats = vi.fn().mockResolvedValue({
      ok: true,
      stats: {
        byStatus: {
          approved: 0,
          discarded: 0,
          pending: 3,
        },
        total: 3,
      },
    });
    (window as unknown as {
      electronAPI?: {
        lessonCandidate?: {
          stats: typeof stats;
        };
      };
    }).electronAPI = {
      lessonCandidate: {
        stats,
      },
    };
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(LessonCandidateReviewStrip));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(stats).toHaveBeenCalledTimes(1);
    expect(target.textContent).toContain('3 pending');
    expect(target.textContent).toContain('0 approved');
    expect(target.textContent).toContain('0 discarded');
  });
});
