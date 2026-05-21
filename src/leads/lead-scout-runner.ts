import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname } from 'node:path';
import {
  buildLeadScoutPlan,
  type LeadScoutExportFormat,
  type LeadScoutPlan,
  type LeadScoutPlanOptions,
} from './lead-scout-plan.js';

export interface LeadScoutRunOptions extends LeadScoutPlanOptions {
  localDatasetPaths: string[];
  minScore?: number;
  includeOutreachDrafts?: boolean;
  outputFormat?: LeadScoutExportFormat;
  path?: string;
}

export interface LeadScoutLead {
  id: string;
  nom: string;
  type: string;
  email?: string;
  telephone?: string;
  site_web?: string;
  adresse?: string;
  ville?: string;
  departement?: string;
  region?: string;
  source_url: string;
  evidence: string;
  score: number;
  scoreReasons: string[];
  status: 'review' | 'approved' | 'contacted' | 'do_not_contact' | 'stale';
  draftOutreach?: string;
  metadata: {
    sourceFiles: string[];
    duplicateCount: number;
    originalTypes: string[];
  };
}

export interface LeadScoutRunSourceSummary {
  path: string;
  format: 'json' | 'csv';
  recordCount: number;
}

export interface LeadScoutRunResult {
  success: boolean;
  plan: LeadScoutPlan;
  reviewQueue: LeadScoutLead[];
  loadedSources: LeadScoutRunSourceSummary[];
  rejectedSources: Array<{ path: string; error: string }>;
  stats: {
    rawRecords: number;
    normalizedRecords: number;
    uniqueLeads: number;
    selectedLeads: number;
    leadsWithEmail: number;
    leadsWithPhone: number;
    leadsWithWebsite: number;
    needsPublicEnrichment: number;
  };
  filesWritten: string[];
  warnings: string[];
  safetyNotice: string;
}

interface RawLeadRecord {
  data: Record<string, unknown>;
  sourceFile: string;
}

interface NormalizedLeadRecord {
  nom: string;
  type: string;
  email?: string;
  telephone?: string;
  site_web?: string;
  adresse?: string;
  ville?: string;
  departement?: string;
  region?: string;
  source_url?: string;
  evidence?: string;
  sourceFile: string;
  rawType?: string;
}

interface LeadBucket {
  records: NormalizedLeadRecord[];
  merged: Omit<LeadScoutLead, 'id' | 'score' | 'scoreReasons' | 'draftOutreach'>;
}

const DEFAULT_MIN_SCORE = 0;

const FIELD_ALIASES = {
  nom: ['nom', 'name', 'raison_sociale', 'raisonSociale', 'denomination', 'title', 'intitule', 'libelle'],
  type: ['type', 'categorie', 'category', 'activite', 'profession'],
  email: ['email', 'mail', 'courriel', 'e_mail'],
  telephone: ['telephone', 'tel', 'phone', 'mobile', 'portable'],
  site_web: ['site_web', 'siteWeb', 'site', 'website', 'web', 'url_site'],
  adresse: ['adresse', 'address', 'adresse_complete', 'adresseComplete'],
  ville: ['ville', 'city', 'commune', 'localite'],
  departement: ['departement', 'department', 'dept', 'code_departement'],
  region: ['region'],
  source_url: ['source_url', 'sourceUrl', 'url', 'lien', 'link', 'fiche_url'],
  evidence: ['evidence', 'description', 'snippet', 'resume', 'notes'],
} as const;

export async function runLeadScout(options: LeadScoutRunOptions): Promise<LeadScoutRunResult> {
  const plan = buildLeadScoutPlan(options);
  const minScore = normalizeScoreThreshold(options.minScore);
  const includeOutreachDrafts = options.includeOutreachDrafts !== false;
  const rawRecords: RawLeadRecord[] = [];
  const loadedSources: LeadScoutRunSourceSummary[] = [];
  const rejectedSources: Array<{ path: string; error: string }> = [];

  for (const datasetPath of plan.localDatasetPaths) {
    try {
      const loaded = await loadDataset(datasetPath);
      rawRecords.push(...loaded.records);
      loadedSources.push({
        path: datasetPath,
        format: loaded.format,
        recordCount: loaded.records.length,
      });
    } catch (error) {
      rejectedSources.push({
        path: datasetPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const normalizedRecords = rawRecords
    .map((record) => normalizeLeadRecord(record, plan))
    .filter((record): record is NormalizedLeadRecord => record !== null);
  const buckets = dedupeRecords(normalizedRecords);
  const scoredLeads = buckets.map((bucket) => scoreLead(bucket, plan, includeOutreachDrafts));
  const reviewQueue = scoredLeads
    .filter((lead) => lead.score >= minScore)
    .sort(compareLeadPriority)
    .slice(0, plan.maxProspects);

  const filesWritten = await writeOptionalExport(reviewQueue, options, plan);
  const warnings = buildWarnings(plan, rawRecords.length, normalizedRecords.length, rejectedSources);

  return {
    success: rejectedSources.length === 0 || reviewQueue.length > 0,
    plan,
    reviewQueue,
    loadedSources,
    rejectedSources,
    stats: {
      rawRecords: rawRecords.length,
      normalizedRecords: normalizedRecords.length,
      uniqueLeads: buckets.length,
      selectedLeads: reviewQueue.length,
      leadsWithEmail: reviewQueue.filter((lead) => Boolean(lead.email)).length,
      leadsWithPhone: reviewQueue.filter((lead) => Boolean(lead.telephone)).length,
      leadsWithWebsite: reviewQueue.filter((lead) => Boolean(lead.site_web)).length,
      needsPublicEnrichment: reviewQueue.filter((lead) => !lead.email && !lead.telephone && !lead.site_web).length,
    },
    filesWritten,
    warnings,
    safetyNotice:
      'Lead Scout Run builds a human review queue only. It does not send emails, bypass access controls, or collect private consumer data.',
  };
}

export function renderLeadScoutRunResult(result: LeadScoutRunResult): string {
  const lines = [
    `# Lead Scout Run: ${result.plan.goal}`,
    '',
    `Target: ${result.plan.targetLabel}`,
    `Zone: ${result.plan.zone}`,
    `Raw records: ${result.stats.rawRecords}`,
    `Unique leads: ${result.stats.uniqueLeads}`,
    `Selected leads: ${result.stats.selectedLeads}`,
    `Needs public enrichment: ${result.stats.needsPublicEnrichment}`,
    '',
    '## Top Leads',
    ...result.reviewQueue.slice(0, 10).map((lead, index) => (
      `${index + 1}. ${lead.nom} (${lead.ville || 'ville inconnue'}) - score ${lead.score} - ${lead.scoreReasons.join('; ')}`
    )),
    '',
    '## Sources',
    ...result.loadedSources.map((source) => `- ${source.path}: ${source.recordCount} ${source.format} records`),
    '',
    '## Warnings',
    ...(result.warnings.length > 0 ? result.warnings : ['No warnings.']).map((warning) => `- ${warning}`),
    '',
    '## Safety',
    `- ${result.safetyNotice}`,
  ];

  if (result.filesWritten.length > 0) {
    lines.push('', '## Files Written', ...result.filesWritten.map((file) => `- ${file}`));
  }

  return lines.filter((line) => line !== '').join('\n');
}

async function loadDataset(datasetPath: string): Promise<{ format: 'json' | 'csv'; records: RawLeadRecord[] }> {
  const content = await readFile(datasetPath, 'utf8');
  const extension = extname(datasetPath).toLowerCase();
  if (extension === '.json') {
    return {
      format: 'json',
      records: extractJsonRecords(JSON.parse(content)).map((data) => ({ data, sourceFile: datasetPath })),
    };
  }
  if (extension === '.csv') {
    return {
      format: 'csv',
      records: parseCsv(content).map((data) => ({ data, sourceFile: datasetPath })),
    };
  }
  throw new Error(`Unsupported dataset extension "${extension}". Use .json or .csv.`);
}

function extractJsonRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  if (isRecord(value)) {
    for (const key of ['leads', 'prospects', 'data', 'items', 'results']) {
      const nested = value[key];
      if (Array.isArray(nested)) {
        return nested.filter(isRecord);
      }
    }
  }
  throw new Error('JSON dataset must be an array or contain leads/prospects/data/items/results array.');
}

function parseCsv(content: string): Record<string, unknown>[] {
  const rows = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (rows.length === 0) {
    return [];
  }

  const headers = parseCsvLine(rows[0]).map((header) => header.trim());
  return rows.slice(1).map((row) => {
    const cells = parseCsvLine(row);
    const record: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      record[header] = cells[index] ?? '';
    });
    return record;
  });
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index++;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function normalizeLeadRecord(record: RawLeadRecord, plan: LeadScoutPlan): NormalizedLeadRecord | null {
  const nom = firstText(record.data, FIELD_ALIASES.nom);
  if (!nom) {
    return null;
  }

  return {
    nom,
    type: firstText(record.data, FIELD_ALIASES.type) || plan.targetLabel,
    email: firstText(record.data, FIELD_ALIASES.email),
    telephone: firstText(record.data, FIELD_ALIASES.telephone),
    site_web: firstText(record.data, FIELD_ALIASES.site_web),
    adresse: firstText(record.data, FIELD_ALIASES.adresse),
    ville: firstText(record.data, FIELD_ALIASES.ville),
    departement: firstText(record.data, FIELD_ALIASES.departement),
    region: firstText(record.data, FIELD_ALIASES.region),
    source_url: firstText(record.data, FIELD_ALIASES.source_url),
    evidence: firstText(record.data, FIELD_ALIASES.evidence),
    sourceFile: record.sourceFile,
    rawType: firstText(record.data, FIELD_ALIASES.type),
  };
}

function dedupeRecords(records: NormalizedLeadRecord[]): LeadBucket[] {
  const buckets = new Map<string, LeadBucket>();

  for (const record of records) {
    const key = buildDedupeKey(record);
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, {
        records: [record],
        merged: {
          nom: record.nom,
          type: record.type,
          email: record.email,
          telephone: record.telephone,
          site_web: record.site_web,
          adresse: record.adresse,
          ville: record.ville,
          departement: record.departement,
          region: record.region,
          source_url: record.source_url || record.site_web || record.sourceFile,
          evidence: record.evidence || `Imported from ${record.sourceFile}`,
          status: 'review',
          metadata: {
            sourceFiles: [record.sourceFile],
            duplicateCount: 0,
            originalTypes: record.rawType ? [record.rawType] : [],
          },
        },
      });
      continue;
    }

    existing.records.push(record);
    existing.merged = mergeLead(existing.merged, record);
  }

  return [...buckets.values()].map((bucket) => ({
    ...bucket,
    merged: {
      ...bucket.merged,
      metadata: {
        sourceFiles: [...new Set(bucket.records.map((record) => record.sourceFile))],
        duplicateCount: Math.max(0, bucket.records.length - 1),
        originalTypes: [...new Set(bucket.records.map((record) => record.rawType).filter(isNonEmptyString))],
      },
      evidence: mergeEvidence(bucket.records),
    },
  }));
}

function scoreLead(
  bucket: LeadBucket,
  plan: LeadScoutPlan,
  includeOutreachDrafts: boolean,
): LeadScoutLead {
  const lead = bucket.merged;
  const scoreReasons: string[] = [];
  let score = 0;

  const publicContactScore = Math.min(
    25,
    (lead.email ? 10 : 0) + (lead.telephone ? 8 : 0) + (lead.site_web ? 7 : 0),
  );
  if (publicContactScore > 0) {
    score += publicContactScore;
    scoreReasons.push(`public contact +${publicContactScore}`);
  }

  const localFitScore = scoreLocalFit(lead, plan.zone);
  if (localFitScore > 0) {
    score += localFitScore;
    scoreReasons.push(`local fit +${localFitScore}`);
  }

  const targetFitScore = scoreTextFit(`${lead.type} ${lead.evidence}`, plan.targetLabel, 20);
  if (targetFitScore > 0) {
    score += targetFitScore;
    scoreReasons.push(`target fit +${targetFitScore}`);
  }

  const offerFitScore = scoreTextFit(`${lead.nom} ${lead.type} ${lead.evidence}`, plan.offer, 20);
  if (offerFitScore > 0) {
    score += offerFitScore;
    scoreReasons.push(`offer fit +${offerFitScore}`);
  }

  const evidenceScore = scoreEvidence(lead);
  if (evidenceScore > 0) {
    score += evidenceScore;
    scoreReasons.push(`evidence +${evidenceScore}`);
  }

  const id = hashLead(`${lead.nom}|${lead.ville || ''}|${lead.email || ''}|${lead.site_web || ''}`);
  return {
    ...lead,
    id,
    score: Math.min(100, score),
    scoreReasons,
    ...(includeOutreachDrafts ? { draftOutreach: buildDraftOutreach(lead, plan) } : {}),
  };
}

function mergeLead(
  lead: Omit<LeadScoutLead, 'id' | 'score' | 'scoreReasons' | 'draftOutreach'>,
  record: NormalizedLeadRecord,
): Omit<LeadScoutLead, 'id' | 'score' | 'scoreReasons' | 'draftOutreach'> {
  return {
    ...lead,
    type: preferLonger(lead.type, record.type) || lead.type,
    email: lead.email || record.email,
    telephone: lead.telephone || record.telephone,
    site_web: lead.site_web || record.site_web,
    adresse: preferLonger(lead.adresse, record.adresse),
    ville: lead.ville || record.ville,
    departement: lead.departement || record.departement,
    region: lead.region || record.region,
    source_url: lead.source_url || record.source_url || record.site_web || record.sourceFile,
    evidence: lead.evidence,
  };
}

function mergeEvidence(records: NormalizedLeadRecord[]): string {
  const evidence = records.map((record) => record.evidence || record.source_url || record.sourceFile);
  return [...new Set(evidence.filter(isNonEmptyString))].slice(0, 3).join(' | ');
}

function buildDedupeKey(record: NormalizedLeadRecord): string {
  if (record.site_web) {
    return `web:${normalizeWebsite(record.site_web)}`;
  }
  if (record.email) {
    return `email:${normalizeKey(record.email)}`;
  }
  return `name-city:${normalizeKey(record.nom)}:${normalizeKey(record.ville || record.departement || '')}`;
}

function scoreLocalFit(lead: Omit<LeadScoutLead, 'id' | 'score' | 'scoreReasons' | 'draftOutreach'>, zone: string): number {
  const zoneTokens = tokenize(zone);
  if (zoneTokens.length === 0 || zone === 'zone non precisee') {
    return 0;
  }
  const leadText = normalizeKey(`${lead.adresse || ''} ${lead.ville || ''} ${lead.departement || ''} ${lead.region || ''}`);
  const matches = zoneTokens.filter((token) => leadText.includes(token)).length;
  if (matches === zoneTokens.length) {
    return 20;
  }
  if (matches > 0) {
    return 10;
  }
  return 0;
}

function scoreTextFit(text: string, targetText: string, maxScore: number): number {
  const tokens = tokenize(targetText);
  if (tokens.length === 0) {
    return 0;
  }
  const normalizedText = normalizeKey(text);
  const matches = tokens.filter((token) => normalizedText.includes(token)).length;
  return Math.round((matches / tokens.length) * maxScore);
}

function scoreEvidence(lead: Omit<LeadScoutLead, 'id' | 'score' | 'scoreReasons' | 'draftOutreach'>): number {
  let score = 0;
  if (lead.source_url) {
    score += 8;
  }
  if (lead.evidence && lead.evidence.length > 10) {
    score += 5;
  }
  if (lead.source_url.startsWith('https://')) {
    score += 2;
  }
  return Math.min(15, score);
}

function buildDraftOutreach(
  lead: Omit<LeadScoutLead, 'id' | 'score' | 'scoreReasons' | 'draftOutreach'>,
  plan: LeadScoutPlan,
): string {
  const location = lead.ville ? ` a ${lead.ville}` : '';
  return [
    `Bonjour,`,
    '',
    `Je me permets de vous contacter car votre structure (${lead.nom}) semble active${location}.`,
    `Je travaille sur une offre autour de ${plan.offer}.`,
    `Si cela peut vous etre utile sur un prochain projet, je serais ravi d'echanger rapidement.`,
    '',
    `Cordialement,`,
  ].join('\n');
}

async function writeOptionalExport(
  leads: LeadScoutLead[],
  options: LeadScoutRunOptions,
  plan: LeadScoutPlan,
): Promise<string[]> {
  const outputPath = options.path?.trim();
  if (!outputPath) {
    return [];
  }

  const format = options.outputFormat || inferFormatFromPath(outputPath);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, renderExport(leads, format, plan), 'utf8');
  return [outputPath];
}

function inferFormatFromPath(outputPath: string): LeadScoutExportFormat {
  const extension = extname(outputPath).toLowerCase();
  if (extension === '.csv') {
    return 'csv';
  }
  if (extension === '.md' || extension === '.markdown') {
    return 'markdown';
  }
  return 'json';
}

function renderExport(leads: LeadScoutLead[], format: LeadScoutExportFormat, plan: LeadScoutPlan): string {
  if (format === 'csv') {
    return renderCsv(leads);
  }
  if (format === 'markdown') {
    return renderMarkdown(leads, plan);
  }
  return `${JSON.stringify({ generatedAt: new Date().toISOString(), goal: plan.goal, leads }, null, 2)}\n`;
}

function renderCsv(leads: LeadScoutLead[]): string {
  const headers = [
    'id',
    'nom',
    'type',
    'email',
    'telephone',
    'site_web',
    'adresse',
    'ville',
    'departement',
    'region',
    'source_url',
    'evidence',
    'score',
    'scoreReasons',
    'status',
  ];
  const rows = leads.map((lead) => headers.map((header) => csvEscape(formatCsvValue(lead, header))).join(','));
  return `${headers.join(',')}\n${rows.join('\n')}\n`;
}

function renderMarkdown(leads: LeadScoutLead[], plan: LeadScoutPlan): string {
  return [
    `# Lead review queue: ${plan.goal}`,
    '',
    ...leads.map((lead, index) => [
      `## ${index + 1}. ${lead.nom}`,
      '',
      `- Score: ${lead.score}`,
      `- Ville: ${lead.ville || 'inconnue'}`,
      `- Contact: ${lead.email || lead.telephone || lead.site_web || 'a enrichir'}`,
      `- Source: ${lead.source_url}`,
      `- Evidence: ${lead.evidence}`,
      `- Status: ${lead.status}`,
      lead.draftOutreach ? `\nDraft:\n\n${lead.draftOutreach}` : '',
    ].filter((line) => line !== '').join('\n')),
  ].join('\n');
}

function formatCsvValue(lead: LeadScoutLead, header: string): string {
  if (header === 'scoreReasons') {
    return lead.scoreReasons.join('; ');
  }
  const value = lead[header as keyof LeadScoutLead];
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }
  return '';
}

function csvEscape(value: string): string {
  if (!/[",\n\r]/.test(value)) {
    return value;
  }
  return `"${value.replaceAll('"', '""')}"`;
}

function buildWarnings(
  plan: LeadScoutPlan,
  rawRecords: number,
  normalizedRecords: number,
  rejectedSources: Array<{ path: string; error: string }>,
): string[] {
  const warnings: string[] = [];
  if (plan.localDatasetPaths.length === 0) {
    warnings.push('No local datasets were provided; lead_scout_run is local-first and did not browse the web.');
  }
  if (rawRecords === 0) {
    warnings.push('No records were loaded from local datasets.');
  }
  if (normalizedRecords < rawRecords) {
    warnings.push(`${rawRecords - normalizedRecords} records were skipped because no business name was found.`);
  }
  for (const rejected of rejectedSources) {
    warnings.push(`${rejected.path}: ${rejected.error}`);
  }
  return warnings;
}

function compareLeadPriority(left: LeadScoutLead, right: LeadScoutLead): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }
  return left.nom.localeCompare(right.nom);
}

function normalizeScoreThreshold(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_MIN_SCORE;
  }
  return Math.min(100, Math.max(0, Math.floor(value)));
}

function firstText(record: Record<string, unknown>, aliases: readonly string[]): string | undefined {
  for (const alias of aliases) {
    const value = record[alias];
    if (typeof value === 'string' && value.trim()) {
      return value.trim().replace(/\s+/g, ' ');
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
}

function preferLonger(current: string | undefined, next: string | undefined): string | undefined {
  if (!current) {
    return next;
  }
  if (!next) {
    return current;
  }
  return next.length > current.length ? next : current;
}

function tokenize(text: string): string[] {
  return [...new Set(normalizeKey(text).split(/[^a-z0-9]+/).filter((token) => token.length >= 4))];
}

function normalizeKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/www\./g, '')
    .trim();
}

function normalizeWebsite(value: string): string {
  return normalizeKey(value).replace(/\/.*$/, '');
}

function hashLead(value: string): string {
  return `lead_${createHash('sha1').update(value).digest('hex').slice(0, 12)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
