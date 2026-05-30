/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { act, Simulate } from 'react-dom/test-utils';
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

    const button = Array.from(target.querySelectorAll('button')).find((candidate) =>
      candidate.textContent?.includes('Manage skills as goal')
    );
    expect(button?.textContent).toContain('Manage skills as goal');

    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onUseAsGoal).toHaveBeenCalledTimes(1);
    const goal = onUseAsGoal.mock.calls[0]?.[0] as string;
    expect(goal).toContain('Review installed Code Buddy SKILL.md packages from Cowork.');
    expect(goal).toContain('skill_manage action=enable|disable|deprecate|delete|patch|rollback|update');
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

  it('requires reviewer identity before changing an installed skill lifecycle', async () => {
    const target = container();
    const lifecycle = vi.fn().mockResolvedValue({
      ok: true,
      package: {
        enabled: false,
        exists: true,
        installedAt: 1,
        integrityOk: true,
        lastLifecycleReviewer: 'Patrice',
        name: 'loaded-helper',
        path: 'D:/workspace/.codebuddy/skills/loaded-helper/SKILL.md',
        rollbackableCount: 0,
        source: 'local',
        status: 'disabled',
        version: '1.0.0',
      },
    });
    (window as unknown as {
      electronAPI?: {
        tools?: {
          skillPackage?: {
            lifecycle: typeof lifecycle;
          };
        };
      };
    }).electronAPI = {
      tools: {
        skillPackage: {
          lifecycle,
        },
      },
    };
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(SkillPackageManagerStrip, {
        cwd: 'D:/CascadeProjects/grok-cli-weekend',
        summary: {
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
        },
      }));
      await Promise.resolve();
    });

    let disableButton = target.querySelector('[data-testid="skill-package-disable"]') as HTMLButtonElement;
    expect(disableButton.disabled).toBe(true);

    const input = target.querySelector('[data-testid="skill-package-reviewer-input"]') as HTMLInputElement;
    await act(async () => {
      Simulate.change(input, { target: { value: 'Patrice' } } as unknown as Event);
      await Promise.resolve();
    });

    disableButton = target.querySelector('[data-testid="skill-package-disable"]') as HTMLButtonElement;
    expect(disableButton.disabled).toBe(false);

    await act(async () => {
      Simulate.click(disableButton);
      await Promise.resolve();
    });

    expect(lifecycle).toHaveBeenCalledWith({
      action: 'disable',
      approvedBy: 'Patrice',
      cwd: 'D:/CascadeProjects/grok-cli-weekend',
      name: 'loaded-helper',
    });
    expect(target.textContent).toContain('disable loaded-helper by Patrice.');
  });

  it('requires reviewer identity before rolling back an installed skill', async () => {
    const target = container();
    const rollback = vi.fn().mockResolvedValue({
      ok: true,
      package: {
        enabled: true,
        exists: true,
        installedAt: 1,
        integrityOk: true,
        lastLifecycleReviewer: 'Patrice',
        name: 'rollback-helper',
        path: 'D:/workspace/.codebuddy/skills/rollback-helper/SKILL.md',
        rollbackableCount: 2,
        source: 'local',
        status: 'active',
        version: '1.0.0',
      },
    });
    (window as unknown as {
      electronAPI?: {
        tools?: {
          skillPackage?: {
            rollback: typeof rollback;
          };
        };
      };
    }).electronAPI = {
      tools: {
        skillPackage: {
          rollback,
        },
      },
    };
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(SkillPackageManagerStrip, {
        cwd: 'D:/CascadeProjects/grok-cli-weekend',
        summary: {
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
              name: 'rollback-helper',
              path: 'D:/workspace/.codebuddy/skills/rollback-helper/SKILL.md',
              rollbackableCount: 1,
              source: 'local',
              status: 'active',
              version: '1.0.0',
            },
          ],
          reviewCommands: ['buddy skills list --all --json'],
          rollbackableCount: 1,
          skillRoot: 'D:/workspace/.codebuddy/skills',
        },
      }));
      await Promise.resolve();
    });

    let rollbackButton = target.querySelector('[data-testid="skill-package-rollback"]') as HTMLButtonElement;
    expect(rollbackButton.disabled).toBe(true);

    const input = target.querySelector('[data-testid="skill-package-reviewer-input"]') as HTMLInputElement;
    await act(async () => {
      Simulate.change(input, { target: { value: 'Patrice' } } as unknown as Event);
      await Promise.resolve();
    });

    rollbackButton = target.querySelector('[data-testid="skill-package-rollback"]') as HTMLButtonElement;
    expect(rollbackButton.disabled).toBe(false);

    await act(async () => {
      Simulate.click(rollbackButton);
      await Promise.resolve();
    });

    expect(rollback).toHaveBeenCalledWith({
      approvedBy: 'Patrice',
      cwd: 'D:/CascadeProjects/grok-cli-weekend',
      name: 'rollback-helper',
    });
    expect(target.textContent).toContain('rollback rollback-helper by Patrice.');
  });

  it('requires reviewer identity before deleting an installed skill', async () => {
    const target = container();
    const deletePackage = vi.fn().mockResolvedValue({
      deletedName: 'obsolete-helper',
      ok: true,
      summary: {
        cacheDir: 'D:/workspace/.codebuddy/skills-cache',
        disabledCount: 0,
        enabledCount: 0,
        installedCount: 0,
        lockfilePath: 'D:/workspace/.codebuddy/skills-lock.json',
        packages: [],
        reviewCommands: ['buddy skills list --all --json'],
        rollbackableCount: 0,
        skillRoot: 'D:/workspace/.codebuddy/skills',
      },
    });
    (window as unknown as {
      electronAPI?: {
        tools?: {
          skillPackage?: {
            delete: typeof deletePackage;
          };
        };
      };
    }).electronAPI = {
      tools: {
        skillPackage: {
          delete: deletePackage,
        },
      },
    };
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(SkillPackageManagerStrip, {
        cwd: 'D:/CascadeProjects/grok-cli-weekend',
        summary: {
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
              name: 'obsolete-helper',
              path: 'D:/workspace/.codebuddy/skills/obsolete-helper/SKILL.md',
              rollbackableCount: 0,
              source: 'local',
              status: 'active',
              version: '1.0.0',
            },
          ],
          reviewCommands: ['buddy skills list --all --json'],
          rollbackableCount: 0,
          skillRoot: 'D:/workspace/.codebuddy/skills',
        },
      }));
      await Promise.resolve();
    });

    let deleteButton = target.querySelector('[data-testid="skill-package-delete"]') as HTMLButtonElement;
    expect(deleteButton.disabled).toBe(true);

    const input = target.querySelector('[data-testid="skill-package-reviewer-input"]') as HTMLInputElement;
    await act(async () => {
      Simulate.change(input, { target: { value: 'Patrice' } } as unknown as Event);
      await Promise.resolve();
    });

    deleteButton = target.querySelector('[data-testid="skill-package-delete"]') as HTMLButtonElement;
    expect(deleteButton.disabled).toBe(false);

    await act(async () => {
      Simulate.click(deleteButton);
      await Promise.resolve();
    });

    expect(deletePackage).toHaveBeenCalledWith({
      approvedBy: 'Patrice',
      cwd: 'D:/CascadeProjects/grok-cli-weekend',
      name: 'obsolete-helper',
    });
    expect(target.textContent).toContain('delete obsolete-helper by Patrice.');
  });

  it('requires reviewer identity before updating an installed skill', async () => {
    const target = container();
    const update = vi.fn().mockResolvedValue({
      ok: true,
      package: {
        enabled: true,
        exists: true,
        installedAt: 1,
        integrityOk: true,
        lastLifecycleReviewer: 'Patrice',
        name: 'cached-helper',
        path: 'D:/workspace/.codebuddy/skills/cached-helper/SKILL.md',
        rollbackableCount: 1,
        source: 'hub',
        status: 'active',
        version: '0.2.0',
      },
    });
    (window as unknown as {
      electronAPI?: {
        tools?: {
          skillPackage?: {
            update: typeof update;
          };
        };
      };
    }).electronAPI = {
      tools: {
        skillPackage: {
          update,
        },
      },
    };
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(SkillPackageManagerStrip, {
        cwd: 'D:/CascadeProjects/grok-cli-weekend',
        summary: {
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
              name: 'cached-helper',
              path: 'D:/workspace/.codebuddy/skills/cached-helper/SKILL.md',
              rollbackableCount: 0,
              source: 'hub',
              status: 'active',
              version: '0.1.0',
            },
          ],
          reviewCommands: ['buddy skills list --all --json'],
          rollbackableCount: 0,
          skillRoot: 'D:/workspace/.codebuddy/skills',
        },
      }));
      await Promise.resolve();
    });

    let updateButton = target.querySelector('[data-testid="skill-package-update"]') as HTMLButtonElement;
    expect(updateButton.disabled).toBe(true);

    const input = target.querySelector('[data-testid="skill-package-reviewer-input"]') as HTMLInputElement;
    await act(async () => {
      Simulate.change(input, { target: { value: 'Patrice' } } as unknown as Event);
      await Promise.resolve();
    });

    updateButton = target.querySelector('[data-testid="skill-package-update"]') as HTMLButtonElement;
    expect(updateButton.disabled).toBe(false);

    await act(async () => {
      Simulate.click(updateButton);
      await Promise.resolve();
    });

    expect(update).toHaveBeenCalledWith({
      approvedBy: 'Patrice',
      cwd: 'D:/CascadeProjects/grok-cli-weekend',
      name: 'cached-helper',
    });
    expect(target.textContent).toContain('update cached-helper by Patrice.');
  });

  it('requires reviewer identity and old text before patching an installed skill', async () => {
    const target = container();
    const patch = vi.fn().mockResolvedValue({
      ok: true,
      package: {
        contentPreview: 'Reviewed patch wording.',
        enabled: true,
        exists: true,
        installedAt: 1,
        integrityOk: true,
        lastLifecycleReviewer: 'Patrice',
        name: 'patch-helper',
        path: 'D:/workspace/.codebuddy/skills/patch-helper/SKILL.md',
        rollbackableCount: 1,
        source: 'local',
        status: 'active',
        version: '1.0.0',
      },
    });
    (window as unknown as {
      electronAPI?: {
        tools?: {
          skillPackage?: {
            patch: typeof patch;
          };
        };
      };
    }).electronAPI = {
      tools: {
        skillPackage: {
          patch,
        },
      },
    };
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(SkillPackageManagerStrip, {
        cwd: 'D:/CascadeProjects/grok-cli-weekend',
        summary: {
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
              name: 'patch-helper',
              path: 'D:/workspace/.codebuddy/skills/patch-helper/SKILL.md',
              rollbackableCount: 0,
              source: 'local',
              status: 'active',
              version: '1.0.0',
            },
          ],
          reviewCommands: ['buddy skills list --all --json'],
          rollbackableCount: 0,
          skillRoot: 'D:/workspace/.codebuddy/skills',
        },
      }));
      await Promise.resolve();
    });

    let patchButton = target.querySelector('[data-testid="skill-package-patch"]') as HTMLButtonElement;
    expect(patchButton.disabled).toBe(true);

    const reviewerInput = target.querySelector('[data-testid="skill-package-reviewer-input"]') as HTMLInputElement;
    const oldTextInput = target.querySelector(
      '[data-testid="skill-package-patch-old-patch-helper"]',
    ) as HTMLTextAreaElement;
    const newTextInput = target.querySelector(
      '[data-testid="skill-package-patch-new-patch-helper"]',
    ) as HTMLTextAreaElement;

    await act(async () => {
      Simulate.change(reviewerInput, { target: { value: 'Patrice' } } as unknown as Event);
      await Promise.resolve();
    });
    patchButton = target.querySelector('[data-testid="skill-package-patch"]') as HTMLButtonElement;
    expect(patchButton.disabled).toBe(true);

    await act(async () => {
      Simulate.change(oldTextInput, { target: { value: 'Original patch wording.' } } as unknown as Event);
      Simulate.change(newTextInput, { target: { value: 'Reviewed patch wording.' } } as unknown as Event);
      await Promise.resolve();
    });

    const patchPreview = target.querySelector('[data-testid="skill-package-patch-preview-patch-helper"]');
    expect(patchPreview?.textContent).toContain('Patch preview');
    expect(patchPreview?.textContent).toContain('1 exact replacement');
    expect(patchPreview?.textContent).toContain('- Original patch wording.');
    expect(patchPreview?.textContent).toContain('+ Reviewed patch wording.');

    patchButton = target.querySelector('[data-testid="skill-package-patch"]') as HTMLButtonElement;
    expect(patchButton.disabled).toBe(false);

    await act(async () => {
      Simulate.click(patchButton);
      await Promise.resolve();
    });

    expect(patch).toHaveBeenCalledWith({
      approvedBy: 'Patrice',
      cwd: 'D:/CascadeProjects/grok-cli-weekend',
      expectedReplacements: 1,
      name: 'patch-helper',
      newText: 'Reviewed patch wording.',
      oldText: 'Original patch wording.',
    });
    expect(target.textContent).toContain('patch patch-helper by Patrice.');
  });
});
