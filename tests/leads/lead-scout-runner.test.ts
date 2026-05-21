import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  renderLeadScoutRunResult,
  runLeadScout,
} from '../../src/leads/lead-scout-runner.js';

describe('runLeadScout', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lead-scout-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('loads local JSON data, normalizes, deduplicates, scores, and drafts a review queue', async () => {
    const datasetPath = join(tempDir, 'architectes.json');
    await writeFile(datasetPath, JSON.stringify([
      {
        nom: 'Atelier Lumiere',
        type: 'architecte',
        email: 'contact@atelier.example',
        site_web: 'https://atelier.example',
        ville: 'Epinay-sur-Seine',
        description: 'Architecte actif sur renovation et controle acces',
        url: 'https://atelier.example/contact',
      },
      {
        name: 'Atelier Lumiere',
        phone: '01 23 45 67 89',
        website: 'https://atelier.example',
        city: 'Epinay-sur-Seine',
      },
      {
        nom: 'Syndic Nord',
        type: 'syndic',
        telephone: '01 98 76 54 32',
        ville: 'Saint-Denis',
        url: 'https://syndic.example',
      },
      {
        ville: 'No Name City',
      },
    ]), 'utf8');

    const result = await runLeadScout({
      goal: 'trouver des architectes proches pour une offre BTP',
      target: 'architectes',
      zone: 'Epinay-sur-Seine',
      offer: 'controle acces renovation',
      maxProspects: 2,
      localDatasetPaths: [datasetPath],
    });

    expect(result.success).toBe(true);
    expect(result.stats.rawRecords).toBe(4);
    expect(result.stats.normalizedRecords).toBe(3);
    expect(result.stats.uniqueLeads).toBe(2);
    expect(result.stats.selectedLeads).toBe(2);
    expect(result.reviewQueue[0]).toMatchObject({
      nom: 'Atelier Lumiere',
      ville: 'Epinay-sur-Seine',
      status: 'review',
    });
    expect(result.reviewQueue[0].metadata.duplicateCount).toBe(1);
    expect(result.reviewQueue[0].score).toBeGreaterThan(result.reviewQueue[1].score);
    expect(result.reviewQueue[0].draftOutreach).toContain('Bonjour');
    expect(result.warnings.join('\n')).toContain('records were skipped');
  });

  it('loads CSV data and writes an optional CSV export', async () => {
    const datasetPath = join(tempDir, 'agences.csv');
    const outputPath = join(tempDir, 'queue.csv');
    await writeFile(
      datasetPath,
      [
        'nom,type,email,ville,site_web,evidence',
        '"Agence, Centre",agence immobiliere,contact@agence.example,Epinay-sur-Seine,https://agence.example,"travaux renovation copropriete"',
        'Bureau Nord,bureau etudes,,Saint-Denis,https://bureau.example,"controle acces immeuble"',
      ].join('\n'),
      'utf8',
    );

    const result = await runLeadScout({
      goal: 'qualifier des partenaires locaux',
      target: 'agences_immobilieres',
      zone: 'Epinay-sur-Seine',
      offer: 'renovation copropriete',
      maxProspects: 5,
      localDatasetPaths: [datasetPath],
      outputFormat: 'csv',
      path: outputPath,
    });

    expect(result.filesWritten).toEqual([outputPath]);
    const exported = await readFile(outputPath, 'utf8');

    expect(exported).toContain('id,nom,type,email');
    expect(exported).toContain('"Agence, Centre"');
    expect(exported).toContain('lead_');
  });

  it('filters the review queue with minScore and renders a compact summary', async () => {
    const datasetPath = join(tempDir, 'leads.json');
    await writeFile(datasetPath, JSON.stringify([
      {
        nom: 'Lead Fort',
        email: 'hello@lead.example',
        ville: 'Epinay-sur-Seine',
        evidence: 'controle acces renovation',
        source_url: 'https://lead.example',
      },
      {
        nom: 'Lead Faible',
        ville: 'Lyon',
      },
    ]), 'utf8');

    const result = await runLeadScout({
      goal: 'selection stricte',
      target: 'custom',
      customTarget: 'partenaires BTP',
      zone: 'Epinay-sur-Seine',
      offer: 'controle acces renovation',
      minScore: 60,
      localDatasetPaths: [datasetPath],
      includeOutreachDrafts: false,
    });
    const rendered = renderLeadScoutRunResult(result);

    expect(result.reviewQueue).toHaveLength(1);
    expect(result.reviewQueue[0].draftOutreach).toBeUndefined();
    expect(rendered).toContain('# Lead Scout Run: selection stricte');
    expect(rendered).toContain('Needs public enrichment: 0');
    expect(rendered).toContain('does not send emails');
  });
});
