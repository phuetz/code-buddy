import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildResearchScriptJobArtifact } from '../../src/agent/research-script-job-artifact.js';
import { materializeResearchScriptJobArtifact } from '../../src/agent/research-script-job-materializer.js';

describe('research script job materializer', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-script-job-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('writes a reviewable, not-run artifact folder without executing the script', async () => {
    const job = buildResearchScriptJobArtifact({
      id: 'research-script-demo',
      goal: 'Find public architect contact details',
      title: 'Architect public-data job',
      language: 'python',
      inputContract: { LEADS_JSON: 'Input leads.' },
      outputContract: { OUTPUT_JSON: 'Enriched leads.' },
      scriptFileName: 'enrich-leads.py',
    });

    const result = await materializeResearchScriptJobArtifact(job, {
      rootDir: tempDir,
      scriptSource: 'print("reviewed")',
      inputData: [{ nom: 'Atelier Demo', source_url: 'https://example.test/profile' }],
      summaryNote: 'Prepared for human review.',
    });

    expect(result).toMatchObject({
      executed: false,
      jobId: 'research-script-demo',
      commandPreview: 'python research-scripts/research-script-demo/enrich-leads.py',
    });
    expect(result.manifestPath).toBe(path.join(tempDir, 'research-scripts', 'research-script-demo', 'manifest.json'));

    const manifest = JSON.parse(fs.readFileSync(result.absoluteFiles.manifest, 'utf8')) as typeof job;
    expect(manifest.id).toBe(job.id);
    expect(fs.readFileSync(result.absoluteFiles.readme, 'utf8')).toContain('# Architect public-data job');
    expect(fs.readFileSync(result.absoluteFiles.script, 'utf8')).toContain('print("reviewed")');
    expect(JSON.parse(fs.readFileSync(result.absoluteFiles.input, 'utf8'))).toEqual([
      { nom: 'Atelier Demo', source_url: 'https://example.test/profile' },
    ]);
    expect(JSON.parse(fs.readFileSync(result.absoluteFiles.output, 'utf8'))).toMatchObject({
      status: 'not_run',
      jobId: job.id,
    });
    expect(fs.readFileSync(result.absoluteFiles.stdout, 'utf8')).toBe('\n');
    expect(fs.readFileSync(result.absoluteFiles.stderr, 'utf8')).toBe('\n');
    expect(fs.readFileSync(result.absoluteFiles.summary, 'utf8')).toContain('Prepared for human review.');
  });

  it('refuses artifact file paths that escape the materialization root', async () => {
    const job = buildResearchScriptJobArtifact({
      id: 'research-script-escape',
      goal: 'Unsafe path check',
      title: 'Unsafe path check',
      language: 'typescript',
      inputContract: { INPUT_JSON: 'Input.' },
      outputContract: { OUTPUT_JSON: 'Output.' },
    });
    const unsafeJob = {
      ...job,
      files: {
        ...job.files,
        manifest: '../manifest.json',
      },
    };

    await expect(materializeResearchScriptJobArtifact(unsafeJob, { rootDir: tempDir }))
      .rejects
      .toThrow('escapes root');
  });

  it('protects existing artifacts unless overwrite is requested', async () => {
    const job = buildResearchScriptJobArtifact({
      id: 'research-script-overwrite',
      goal: 'Overwrite guard',
      title: 'Overwrite guard',
      language: 'javascript',
      inputContract: { INPUT_JSON: 'Input.' },
      outputContract: { OUTPUT_JSON: 'Output.' },
    });

    await materializeResearchScriptJobArtifact(job, {
      rootDir: tempDir,
      scriptSource: 'console.log("first");',
    });

    await expect(materializeResearchScriptJobArtifact(job, {
      rootDir: tempDir,
      scriptSource: 'console.log("second");',
    })).rejects.toThrow(/EEXIST|file already exists/i);

    await materializeResearchScriptJobArtifact(job, {
      rootDir: tempDir,
      overwrite: true,
      scriptSource: 'console.log("second");',
    });
    expect(fs.readFileSync(path.join(tempDir, job.files.script), 'utf8')).toContain('second');
  });
});
