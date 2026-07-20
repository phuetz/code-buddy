import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../..');

async function script(name: string): Promise<string> {
  return fs.readFile(path.join(ROOT, 'scripts', 'darkstar', name), 'utf8');
}

describe('Darkstar Krea 2 training chain', () => {
  it('does not restart ComfyUI before the final checkpoint is promoted', async () => {
    const source = await script('start-lisa-krea2-training.ps1');
    expect(source).not.toContain('schtasks.exe /Run /TN "CodeBuddy-ComfyUI"');
    expect(source).toContain('Training exit code: %TRAIN_EXIT%');
  });

  it('waits for a successful terminal task and the exact expected step', async () => {
    const source = await script('wait-and-promote-lisa-krea2.ps1');
    expect(source).toContain("$task.State -eq 'Running'");
    expect(source).toContain("'^Training exit code: (-?\\d+)$'");
    expect(source).toContain("$ExpectedSteps.ToString('D9')");
    expect(source).not.toContain("Get-ChildItem -Path $outputDir -Filter '*.safetensors'");
  });

  it('refuses intermediate promotion and preserves the installed LoRA', async () => {
    const source = await script('promote-lisa-krea2-checkpoint.ps1');
    expect(source).toContain('is still running; refusing to promote an intermediate checkpoint');
    expect(source).toContain("'^Training exit code: 0$'");
    expect(source).toContain("$ExpectedSteps.ToString('D9')");
    expect(source).toContain('Get-FileHash');
    expect(source).toContain('Previous LoRA preserved');
    expect(source).not.toContain('Stop-ScheduledTask -TaskName $TrainingTask');
  });
});
