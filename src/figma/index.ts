export { extractIr } from './extract-ir.js';
export { generateUtilityCss } from './generate-css.js';
export { generateReactFiles } from './generate-react.js';
export { importFigma, buildGeneratedFiles } from './import-figma.js';
export { loadFigmaSource, resolveToken } from './load-source.js';
export { parseFigmaFile } from './parse-document.js';
export { renderImportReport } from './report.js';
export { writeGeneratedProject, assertSafeOutDir } from './write-project.js';
export { FigmaImportError } from './types.js';
export type {
  FigmaImportIR,
  FigmaImportResult,
  GeneratedFile,
  IrComponent,
  IrNode,
  IrScreen,
  SkipEntry,
} from './types.js';
