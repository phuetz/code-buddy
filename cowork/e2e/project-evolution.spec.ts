import { mkdirSync } from 'fs';
import path from 'path';
import { expect, test } from './fixtures';

test('reviews, approves, and rolls back a local Project learning proposal', async ({
  appPage,
  userDataDir,
}) => {
  const workspacePath = path.join(userDataDir, 'project-evolution-workspace');
  mkdirSync(path.join(workspacePath, 'docs'), { recursive: true });

  await appPage.evaluate(async () => {
    await window.electronAPI.config.save({ onboardingCompleted: true });
  });
  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toBeHidden();
  }

  const projectId = await appPage.evaluate(async ({ workspacePath: root }) => {
    const project = await window.electronAPI.project.create({
      name: 'Living Novel',
      workspacePath: root,
      contextConfig: { masterInstruction: 'Write in French.' },
    });
    await window.electronAPI.project.setActive(project.id);
    return project.id;
  }, { workspacePath });

  await appPage.getByTestId('shell-settings-button').click();
  await expect(appPage.getByTestId('settings-panel')).toBeVisible();
  await appPage.getByTestId('settings-tab-projects').click();
  await expect(appPage.getByTestId('project-evolution-panel')).toBeVisible();

  await appPage.getByTestId('project-evolution-source-summary').check();
  await appPage.getByTestId('project-evolution-summary').fill(
    'Always cite the source date. Never invent a quotation.'
  );
  await appPage.getByTestId('project-evolution-create').click();

  const proposal = appPage.locator('[data-testid^="project-evolution-proposal-"]').first();
  await expect(proposal).toBeVisible();
  await expect(proposal.getByTestId('project-evolution-status')).toHaveText('pending');
  await expect(proposal.getByTestId('project-evolution-before')).toContainText('Write in French.');
  await expect(proposal.getByTestId('project-evolution-after')).toContainText('Always cite the source date.');

  await expect.poll(() => appPage.evaluate(async (id) => (
    await window.electronAPI.project.get(id)
  )?.contextConfig?.masterInstruction, projectId)).toBe('Write in French.');

  await proposal.getByTestId('project-evolution-approve').click();
  await expect(proposal.getByTestId('project-evolution-status')).toHaveText('approved');
  await expect.poll(() => appPage.evaluate(async (id) => (
    await window.electronAPI.project.get(id)
  )?.contextConfig?.masterInstruction, projectId)).toContain('Always cite the source date.');

  appPage.once('dialog', (dialog) => dialog.accept());
  await proposal.getByTestId('project-evolution-rollback').click();
  await expect(proposal.getByTestId('project-evolution-status')).toHaveText('rolled back');
  await expect.poll(() => appPage.evaluate(async (id) => (
    await window.electronAPI.project.get(id)
  )?.contextConfig?.masterInstruction, projectId)).toBe('Write in French.');
});
