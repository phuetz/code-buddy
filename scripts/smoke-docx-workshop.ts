/**
 * Real DOCX workshop smoke.
 *
 * Copies a source DOCX to a temp folder, reads it through DocumentTool,
 * extracts embedded images, and generates a small DOCX deliverable.
 *
 * Usage:
 *   npm run smoke:docx
 *   npm run smoke:docx -- "D:\path\to\questions.docx"
 *   $env:CODEBUDDY_DOCX_SMOKE_PATH = "D:\path\to\questions.docx"; npm run smoke:docx
 */

import { createHash } from 'crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  executeGenerateDocument,
  type DocxValidationEvidence,
  type GeneratedDocumentImage,
} from '../src/tools/document-generator.js';
import {
  DocumentTool,
  type DocumentContent,
  type ExtractedDocumentImage,
} from '../src/tools/document-tool.js';

interface ZipEntryLike {
  entryName: string;
}

interface DocxZipLike {
  getEntry(entryName: string): unknown;
  getEntries(): ZipEntryLike[];
  readAsText(entryName: string): string;
}

interface GenerateDocumentToolData {
  outputPath?: string;
  embeddedImages?: GeneratedDocumentImage[];
  docxValidation?: DocxValidationEvidence;
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const referenceProjectRoot = path.resolve(projectRoot, '..', 'gitnexus-rs-from-c');
const fallbackSourcePath = path.resolve(
  projectRoot,
  '..',
  'gitnexus-rs-from-c',
  'Audit_Methodologique_ASPNET_MVC5.docx'
);
const preferredQuestionsSourcePath = path.join(
  referenceProjectRoot,
  'questions',
  'Questions - Impacts.docx'
);

function fileHash(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function fail(message: string): never {
  console.error(`[smoke:docx] ${message}`);
  process.exit(1);
}

function candidateDefaultSources(): string[] {
  const candidates = [preferredQuestionsSourcePath, fallbackSourcePath];
  const questionsDir = path.join(referenceProjectRoot, 'questions');

  if (existsSync(questionsDir)) {
    for (const entry of readdirSync(questionsDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.docx')) {
        candidates.push(path.join(questionsDir, entry.name));
      }
    }
  }

  return [...new Set(candidates)].filter(existsSync);
}

async function countEmbeddedMedia(filePath: string): Promise<number> {
  const { default: AdmZip } = await import('adm-zip');
  const zip = new AdmZip(filePath);
  return zip.getEntries().filter(entry => entry.entryName.startsWith('word/media/')).length;
}

async function selectDefaultSourcePath(): Promise<string> {
  if (existsSync(preferredQuestionsSourcePath)) {
    try {
      if (await countEmbeddedMedia(preferredQuestionsSourcePath) > 0) {
        return preferredQuestionsSourcePath;
      }
    } catch {
      // Fall through to the broader candidate scan.
    }
  }

  let selectedPath = fallbackSourcePath;
  let selectedMediaCount = -1;

  for (const candidate of candidateDefaultSources()) {
    try {
      const mediaCount = await countEmbeddedMedia(candidate);
      if (mediaCount > selectedMediaCount) {
        selectedPath = candidate;
        selectedMediaCount = mediaCount;
      }
    } catch {
      // Ignore unreadable candidates; resolveSourcePath validates the final path.
    }
  }

  return selectedPath;
}

async function resolveSourcePath(): Promise<string> {
  const requestedPath = process.argv[2] || process.env.CODEBUDDY_DOCX_SMOKE_PATH;
  const selectedPath = requestedPath || await selectDefaultSourcePath();
  const resolvedPath = path.resolve(selectedPath);

  if (!existsSync(resolvedPath)) {
    fail([
      `DOCX source not found: ${resolvedPath}`,
      'Pass a DOCX path as an argument or set CODEBUDDY_DOCX_SMOKE_PATH.',
    ].join('\n'));
  }

  if (path.extname(resolvedPath).toLowerCase() !== '.docx') {
    fail(`Expected a .docx source file, got: ${resolvedPath}`);
  }

  return resolvedPath;
}

function readDocumentData(data: unknown): DocumentContent {
  const candidate = data as Partial<DocumentContent> | undefined;
  return {
    text: typeof candidate?.text === 'string' ? candidate.text : '',
    type: 'docx',
    metadata: candidate?.metadata ?? {},
  };
}

function readExtractedImages(data: unknown): ExtractedDocumentImage[] {
  const candidate = data as { images?: ExtractedDocumentImage[] } | undefined;
  return Array.isArray(candidate?.images) ? candidate.images : [];
}

function excerpt(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1400);
}

function readableLines(text: string): string[] {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function countQuestionMarkers(text: string): number {
  const normalized = readableLines(text)
    .join('\n')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const ids = new Set<string>();
  for (const match of normalized.matchAll(/\bquestion\s+(?:n[°o]\s*)?(\d+)\b/gi)) {
    ids.add(match[1]);
  }
  for (const match of normalized.matchAll(/\bq\s*[-#:]?\s*(\d+)\b/gi)) {
    ids.add(match[1]);
  }
  const interrogativeLines = new Set(
    readableLines(text).filter(line => line.includes('?'))
  );
  return ids.size + interrogativeLines.size;
}

function buildTraceabilityRegisterRows(text: string, imageReferences: string[]): string[] {
  const questionLines = readableLines(text)
    .filter(line => line.includes('?') || /\b(?:question\s+(?:n[°o]\s*)?\d+|q\s*[-#:]?\s*\d+)\b/i.test(line))
    .slice(0, 3);
  const fallbackQuestions = questionLines.length > 0
    ? questionLines
    : ['Question inventory not detected in first pass'];

  return fallbackQuestions.map((question, index) => {
    const screenshotRef = imageReferences[index] ?? imageReferences[0] ?? 'No screenshot reference extracted';
    const cleanedQuestion = question.replace(/\|/g, '/').slice(0, 180);
    return `| Q${index + 1} | ${cleanedQuestion} | ${screenshotRef.replace(/\|/g, '/')} | smoke answer prepared |`;
  });
}

function readRequiredZipText(zip: DocxZipLike, entryName: string): string {
  if (!zip.getEntry(entryName)) {
    fail(`generated DOCX is missing required entry: ${entryName}`);
  }
  return zip.readAsText(entryName);
}

function xmlAttribute(tag: string, attributeName: string): string | null {
  const match = new RegExp(`${attributeName}="([^"]+)"`).exec(tag);
  return match?.[1] ?? null;
}

function relationshipTargets(relsXml: string): Map<string, string> {
  const targets = new Map<string, string>();
  const relationshipTags = relsXml.match(/<Relationship\b[^>]*>/g) ?? [];

  for (const tag of relationshipTags) {
    const id = xmlAttribute(tag, 'Id');
    const target = xmlAttribute(tag, 'Target');
    if (id && target) {
      targets.set(id, target);
    }
  }

  return targets;
}

function resolveWordRelationshipTarget(target: string): string {
  const normalizedTarget = target.replace(/\\/g, '/').replace(/^\.\//, '');
  if (normalizedTarget.startsWith('/')) {
    return normalizedTarget.slice(1);
  }
  return path.posix.normalize(path.posix.join('word', normalizedTarget));
}

function isQuestionWorkshopSource(filePath: string): boolean {
  return path.basename(filePath).toLowerCase().includes('question');
}

function validateGeneratedDocx(
  zip: DocxZipLike,
  expectedTitle: string,
  requiredTextFragments: string[] = []
): { relationshipCount: number; embeddedRelationshipCount: number; mediaFileCount: number } {
  const contentTypes = readRequiredZipText(zip, '[Content_Types].xml');
  const documentXml = readRequiredZipText(zip, 'word/document.xml');
  const relsXml = readRequiredZipText(zip, 'word/_rels/document.xml.rels');

  if (!contentTypes.includes('wordprocessingml.document.main+xml')) {
    fail('generated DOCX is missing the main Word content type');
  }

  if (!documentXml.includes(expectedTitle)) {
    fail('generated DOCX does not contain the smoke title');
  }

  for (const fragment of requiredTextFragments) {
    if (!documentXml.includes(fragment)) {
      fail(`generated DOCX does not contain required workshop evidence: ${fragment}`);
    }
  }

  const targetsById = relationshipTargets(relsXml);
  const embeddedRelationshipIds = Array.from(
    documentXml.matchAll(/r:embed="([^"]+)"/g),
    match => match[1]
  );

  for (const relationshipId of embeddedRelationshipIds) {
    const target = targetsById.get(relationshipId);
    if (!target) {
      fail(`generated DOCX image relationship is missing: ${relationshipId}`);
    }

    const mediaEntry = resolveWordRelationshipTarget(target);
    if (!zip.getEntry(mediaEntry)) {
      fail(`generated DOCX image target is missing: ${mediaEntry}`);
    }
  }

  return {
    relationshipCount: targetsById.size,
    embeddedRelationshipCount: embeddedRelationshipIds.length,
    mediaFileCount: zip.getEntries().filter(entry => entry.entryName.startsWith('word/media/')).length,
  };
}

async function main(): Promise<void> {
  const sourcePath = await resolveSourcePath();
  const sourceHashBefore = fileHash(sourcePath);
  const smokeDir = path.join(tmpdir(), `codebuddy-docx-workshop-${Date.now()}`);
  const sourceCopyPath = path.join(smokeDir, path.basename(sourcePath));
  const extractedDir = path.join(smokeDir, 'extracted-images');
  const outputPath = path.join(smokeDir, 'codebuddy-docx-smoke-deliverable.docx');

  mkdirSync(smokeDir, { recursive: true });
  copyFileSync(sourcePath, sourceCopyPath);

  const documentTool = new DocumentTool();
  const readStart = performance.now();
  const readResult = await documentTool.readDocument(sourceCopyPath);
  const readMs = performance.now() - readStart;

  if (!readResult.success) {
    fail(`readDocument failed: ${readResult.error ?? 'unknown error'}`);
  }

  const documentData = readDocumentData(readResult.data);

  const extractStart = performance.now();
  const extraction = await documentTool.extractEmbeddedImages(sourceCopyPath, extractedDir);
  const extractMs = performance.now() - extractStart;

  if (!extraction.success) {
    fail(`extractEmbeddedImages failed: ${extraction.error ?? 'unknown error'}`);
  }

  const images = readExtractedImages(extraction.data);
  const imageReferences = images.map(image => image.markdownRef);
  const questionCount = countQuestionMarkers(documentData.text);
  if (isQuestionWorkshopSource(sourcePath) && questionCount === 0) {
    fail('question workshop source was read, but no question-like lines were detected');
  }
  const traceabilityRows = buildTraceabilityRegisterRows(documentData.text, imageReferences);
  const content = [
    '# Code Buddy DOCX workshop smoke',
    '',
    '## Source',
    `File: ${path.basename(sourcePath)}`,
    `Characters extracted: ${documentData.text.length}`,
    `Embedded images detected: ${documentData.metadata.embeddedImageCount ?? images.length}`,
    '',
    '## Source excerpt',
    excerpt(documentData.text) || 'No textual content extracted.',
    '',
    '## Question-context traceability register',
    '| Question | Context source | Screenshot/OCR reference | Answer status |',
    '| --- | --- | --- | --- |',
    ...traceabilityRows,
    '',
    ...(imageReferences.length > 0
      ? [
          '## Extracted source screenshots',
          ...imageReferences,
          '',
        ]
      : [
          '## Extracted source screenshots',
          'No embedded source screenshot was present in this DOCX.',
          '',
        ]),
    '## Generated answer sample',
    'This smoke proves the local Code Buddy document path can read a copied Word source, preserve extracted image references, and generate a Word deliverable without modifying the original file.',
  ].join('\n');

  const generateStart = performance.now();
  const generation = await executeGenerateDocument({
    type: 'docx',
    title: 'Code Buddy DOCX workshop smoke',
    content,
    outputPath,
  });
  const generateMs = performance.now() - generateStart;

  const generationData = generation.data as GenerateDocumentToolData | undefined;
  const generatedOutputPath = generationData?.outputPath;
  const toolOutputIncludesDocxValidation = generation.output?.includes('DOCX validation:') === true;

  if (!generation.success || !generatedOutputPath) {
    fail(`generateDocument failed: ${generation.error ?? 'unknown error'}`);
  }
  if (!toolOutputIncludesDocxValidation) {
    fail('generate_document output did not include DOCX validation evidence');
  }
  if (!generationData?.docxValidation) {
    fail('generate_document data did not include docxValidation evidence');
  }
  if (
    images.length > 0 &&
    (generationData.embeddedImages?.length ?? 0) !== images.length
  ) {
    fail(
      `generated DOCX embedded ${generationData.embeddedImages?.length ?? 0} image(s), expected ${images.length}`
    );
  }

  const { default: AdmZip } = await import('adm-zip');
  const zip = new AdmZip(generatedOutputPath);
  const docxValidation = validateGeneratedDocx(
    zip,
    'Code Buddy DOCX workshop smoke',
    [
      'Question-context traceability register',
      'smoke answer prepared',
      ...(images.length > 0 ? ['Source screenshot'] : []),
    ],
  );

  if (
    generationData.docxValidation.embeddedRelationshipCount !== docxValidation.embeddedRelationshipCount
    || generationData.docxValidation.mediaFileCount !== docxValidation.mediaFileCount
  ) {
    fail('generate_document validation evidence does not match package validation');
  }

  const sourceHashAfter = fileHash(sourcePath);
  const summary = {
    sourcePath,
    sourceHashUnchanged: sourceHashBefore === sourceHashAfter,
    smokeDir,
    copiedSourcePath: sourceCopyPath,
    outputPath: generatedOutputPath,
    outputBytes: statSync(generatedOutputPath).size,
    textLength: documentData.text.length,
    questionCount,
    traceabilityRows: traceabilityRows.length,
    embeddedImageCount: documentData.metadata.embeddedImageCount ?? images.length,
    extractedImages: images.length,
    embeddedImagesInGeneratedDocx: generationData.embeddedImages?.length ?? 0,
    docxValidation,
    toolOutputIncludesDocxValidation,
    timingsMs: {
      read: Number(readMs.toFixed(3)),
      extract: Number(extractMs.toFixed(3)),
      generate: Number(generateMs.toFixed(3)),
    },
  };

  if (!summary.sourceHashUnchanged) {
    fail(`source hash changed unexpectedly: ${sourcePath}`);
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  fail(message);
});
