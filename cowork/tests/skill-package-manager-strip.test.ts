/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SkillPackageManagerStrip,
  buildSkillPackageManagerGoal,
} from '../src/renderer/components/skill-package-manager-strip';

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

describe('SkillPackageManagerStrip', () => {
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

  it('renders installed skills with review-gated lifecycle guidance', () => {
    const target = container();
    const onUseAsGoal = vi.fn();
    root = createRoot(target);

    act(() => {
      root?.render(
        React.createElement(SkillPackageManagerStrip, {
          error: 'lockfile unreadable',
          onUseAsGoal,
          summary: {
            cacheDir: 'D:/workspace/.codebuddy/skills-cache',
            disabledCount: 1,
            enabledCount: 1,
            installedCount: 2,
            lockfilePath: 'D:/workspace/.codebuddy/skills-lock.json',
            packages: [
              {
                contentPreview: '# Audit Helper\n\nRun real checks and capture evidence.',
                enabled: true,
                exists: true,
                installedAt: 1,
                integrityOk: true,
                invocationCount: 2,
                lastLifecycleReason: 'Reviewed wording.',
                lastLifecycleReviewer: 'Patrice',
                name: 'audit-helper',
                path: 'D:/workspace/.codebuddy/skills/audit-helper/SKILL.md',
                rollbackableCount: 1,
                source: 'local',
                status: 'active',
                version: '1.0.0',
              },
              {
                enabled: false,
                exists: true,
                installedAt: 2,
                integrityOk: true,
                name: 'deprecated-helper',
                path: 'D:/workspace/.codebuddy/skills/deprecated-helper/SKILL.md',
                rollbackableCount: 0,
                source: 'local',
                status: 'deprecated',
                version: '1.0.0',
              },
            ],
            reviewCommands: [
              'buddy skills list --all --json',
              'buddy skills doctor --json',
              'buddy skills learning-usage --json',
            ],
            rollbackableCount: 1,
            skillRoot: 'D:/workspace/.codebuddy/skills',
          },
        }),
      );
    });

    const strip = target.querySelector('[data-testid="fleet-skill-package-manager"]');
    expect(strip?.textContent).toContain('Skill package manager');
    expect(strip?.textContent).toContain('2 installed');
    expect(strip?.textContent).toContain('1 enabled');
    expect(strip?.textContent).toContain('1 inactive');
    expect(strip?.textContent).toContain('1 rollback snapshots');
    expect(strip?.textContent).toContain('Skill package load failed');
    expect(strip?.textContent).toContain('lockfile unreadable');
    expect(strip?.textContent).toContain('audit-helper');
    expect(strip?.textContent).toContain('v1.0.0');
    expect(strip?.textContent).toContain('integrity ok');
    expect(strip?.textContent).toContain('Run real checks and capture evidence.');
    expect(strip?.textContent).toContain('1 rollback');
    expect(strip?.textContent).toContain('2 run(s)');
    expect(strip?.textContent).toContain('Patrice: Reviewed wording.');
    expect(strip?.textContent).toContain('buddy skills list --all --json');
    expect(strip?.textContent).toContain('buddy skills doctor --json');
    expect(strip?.textContent).toContain('buddy skills learning-usage --json');

    const button = target.querySelector('button');
    expect(button?.textContent).toContain('Manage skills as goal');

    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onUseAsGoal).toHaveBeenCalledTimes(1);
    const goal = onUseAsGoal.mock.calls[0]?.[0] as string;
    expect(goal).toContain('Review installed Code Buddy SKILL.md packages from Cowork.');
    expect(goal).toContain('skill_manage action=enable|disable|deprecate|patch|rollback|update');
    expect(goal).toContain('Do not mutate an installed skill without a named reviewer.');
  });

  it('loads packages from the readonly Electron bridge when no summary is provided', async () => {
    const target = container();
    const list = vi.fn().mockResolvedValue({
      cacheDir: 'D:/workspace/.codebuddy/skills-cache',
      disabledCount: 0,
      enabledCount: 1,
      installedCount: 1,
      lockfilePath: 'D:/workspace/.codebuddy/skills-lock.json',
      packages: [
        {
          enabled: true,
          exists: true,
          installedAt: 1,
          integrityOk: true,
          name: 'loaded-helper',
          path: 'D:/workspace/.codebuddy/skills/loaded-helper/SKILL.md',
          rollbackableCount: 0,
          source: 'local',
          status: 'active',
          version: '1.0.0',
        },
      ],
      reviewCommands: ['buddy skills list --all --json'],
      rollbackableCount: 0,
      skillRoot: 'D:/workspace/.codebuddy/skills',
    });
    (window as unknown as {
      electronAPI?: {
        tools?: {
          skillPackage?: {
            list: typeof list;
          };
        };
      };
    }).electronAPI = {
      tools: {
        skillPackage: {
          list,
        },
      },
    };
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(SkillPackageManagerStrip, { cwd: 'D:/CascadeProjects/grok-cli-weekend' }));
      await Promise.resolve();
    });

    expect(list).toHaveBeenCalledWith({
      cwd: 'D:/CascadeProjects/grok-cli-weekend',
      limit: 6,
    });
    expect(target.textContent).toContain('loaded-helper');
  });

  it('keeps the goal helper focused on review-gated lifecycle work', () => {
    expect(buildSkillPackageManagerGoal()).toContain('approved_by=<reviewer>');
  });
});
