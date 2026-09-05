import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const modelInstallDialogPath = path.resolve(
  process.cwd(),
  'src/renderer/components/ModelInstallDialog.tsx'
);

describe('ModelInstallDialog dismissal', () => {
  it('does not auto-open on first run when the face model is missing', () => {
    const source = fs.readFileSync(modelInstallDialogPath, 'utf8');
    expect(source).toContain('if (!showModelInstallDialog)');
    expect(source).toContain('return null;');
    expect(source).not.toContain('installed === false && !showModelInstallDialog && dismissedForSession');
    expect(source).toContain('setDismissedForSession(true)');
    expect(source).toContain('data-testid="model-install-dialog"');
    expect(source).toContain('data-testid="model-install-close"');
  });

  it('uses renderer i18n instead of hardcoded French copy', () => {
    const source = fs.readFileSync(modelInstallDialogPath, 'utf8');
    expect(source).toContain("'modelInstall.title'");
    expect(source).toContain("'modelInstall.body'");
    expect(source).toContain("'modelInstall.download'");
    expect(source).toContain("'modelInstall.localFile'");
    expect(source).toContain("aria-label={t('common.close'");
  });
});
