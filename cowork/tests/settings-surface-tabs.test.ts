import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const settingsPanelPath = path.resolve(process.cwd(), 'src/renderer/components/SettingsPanel.tsx');
const settingsSchedulePath = path.resolve(
  process.cwd(),
  'src/renderer/components/settings/SettingsSchedule.tsx'
);

describe('Settings surface tabs', () => {
  it('includes customize and projects tabs in SettingsPanel', () => {
    const source = fs.readFileSync(settingsPanelPath, 'utf8');
    expect(source).toContain("id: 'customize' as TabId");
    expect(source).toContain("id: 'projects' as TabId");
    expect(source).toContain("id: 'instructions' as TabId");
    expect(source).toContain('<SettingsCustomize');
    expect(source).toContain('<SettingsProjects');
    expect(source).toContain('<SettingsFolderInstructions');
  });

  it('hydrates the schedule form from a pending schedule draft', () => {
    const source = fs.readFileSync(settingsSchedulePath, 'utf8');
    expect(source).toContain('scheduleDraft');
    expect(source).toContain('clearScheduleDraft');
    expect(source).toContain('setScheduleMode(scheduleDraft.scheduleMode);');
  });
});
