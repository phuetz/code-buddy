import path from 'node:path';

import { extractIr } from './extract-ir.js';
import { generateUtilityCss } from './generate-css.js';
import { generateReactFiles } from './generate-react.js';
import { loadFigmaSource, type FigmaFetchLike, type LoadFigmaSourceInput } from './load-source.js';
import { parseFigmaFile } from './parse-document.js';
import { renderImportReport } from './report.js';
import type { FigmaImportResult, GeneratedFile } from './types.js';
import { writeGeneratedProject } from './write-project.js';

export interface ImportFigmaOptions extends LoadFigmaSourceInput {
  outDir?: string;
  designSystemId?: string;
  dryRun?: boolean;
  cwd?: string;
}

export interface ImportFigmaDeps {
  readFile?: (filePath: string, encoding: 'utf8') => Promise<string>;
  fetch?: FigmaFetchLike;
  writeProject?: typeof writeGeneratedProject;
}

export function buildGeneratedFiles(ir: ReturnType<typeof extractIr>): GeneratedFile[] {
  const files: GeneratedFile[] = [
    { relativePath: 'src/figma-utilities.css', content: generateUtilityCss(ir) },
    { relativePath: 'IMPORT-REPORT.md', content: renderImportReport(ir) },
    { relativePath: 'ir.json', content: `${JSON.stringify(ir, null, 2)}\n` },
    ...generateReactFiles(ir),
  ];
  return files;
}

export async function importFigma(
  options: ImportFigmaOptions,
  deps: ImportFigmaDeps = {},
): Promise<FigmaImportResult> {
  const loaded = await loadFigmaSource(options, { readFile: deps.readFile, fetch: deps.fetch });
  const file = parseFigmaFile(loaded.json);
  const ir = extractIr(file, {
    kind: loaded.kind,
    name: file.name ?? loaded.nameHint,
    fileKey: loaded.fileKey,
  });
  const files = buildGeneratedFiles(ir);
  const reportMarkdown = renderImportReport(ir);

  if (options.dryRun || !options.outDir) {
    return { ir, files, reportMarkdown, written: [] };
  }

  const cwd = options.cwd ?? process.cwd();
  const outDir = path.isAbsolute(options.outDir) ? options.outDir : path.resolve(cwd, options.outDir);
  const write = deps.writeProject ?? writeGeneratedProject;
  const written = await write(outDir, files, { designSystemId: options.designSystemId });
  return { ir, files, reportMarkdown, outDir, written };
}
