/**
 * Language Scanner Registry
 *
 * Maps file extensions to the appropriate language scanner.
 * Tree-sitter scanners are loaded async in the background and swap in when ready.
 */

import { TypeScriptScanner } from './typescript.js';
import { PythonScanner } from './python.js';
import { GoScanner } from './go.js';
import { RustScanner } from './rust.js';
import { JavaScanner } from './java.js';
import type { LanguageScanner } from './types.js';
import { logger } from '../../utils/logger.js';

const scanners: LanguageScanner[] = [
  new TypeScriptScanner(),
  new PythonScanner(),
  new GoScanner(),
  new RustScanner(),
  new JavaScanner(),
];

const extToScanner = new Map<string, LanguageScanner>();
for (const scanner of scanners) {
  for (const ext of scanner.extensions) {
    extToScanner.set(ext, scanner);
  }
}

// Async swap: load tree-sitter scanners in background, replace when ready
// Zero breaking change — getScannerForExt() always returns a valid scanner
let treeSitterInitialized = false;
let treeSitterPreload: Promise<void> | null = null;
let treeSitterWarned = false;

/**
 * Start loading the OPTIONAL tree-sitter grammars, at most once.
 *
 * Deliberately NOT started while this module is being evaluated: importing the
 * scanner registry must never pull a native `.node` addon into a process that
 * scans no file. The load is a floating promise detached from the running
 * command, and on Windows a delay-loaded DLL that cannot be resolved raises an
 * SEH exception (`0xC06D007F`) no `try/catch` can intercept — the process dies
 * carrying that exit code instead of the command's own.
 */
function startTreeSitterScanners(): void {
  if (treeSitterPreload) return;
  treeSitterPreload = (async () => {
    // Load tree-sitter scanners in background for each supported language.
    // If a grammar module is unavailable, the regex scanner remains active.
    const loaders: Array<() => Promise<void>> = [
      // TypeScript/JavaScript
      async () => {
        const { TypeScriptTreeSitterScanner } = await import('./ts-tree-sitter.js');
        const scanner = new TypeScriptTreeSitterScanner();
        const ok = await scanner.treeSitter.initialize();
        if (ok && scanner.treeSitter.isReady()) {
          for (const ext of scanner.extensions) extToScanner.set(ext, scanner);
          treeSitterInitialized = true;
        }
      },
      // Python
      async () => {
        const { PythonTreeSitterScanner } = await import('./py-tree-sitter.js');
        const scanner = new PythonTreeSitterScanner();
        const ok = await scanner.treeSitter.initialize();
        if (ok && scanner.treeSitter.isReady()) {
          for (const ext of scanner.extensions) extToScanner.set(ext, scanner);
          treeSitterInitialized = true;
        }
      },
    ];

    const settled = await Promise.allSettled(loaders.map(fn => fn()));
    const failure = settled.find((outcome) => outcome.status === 'rejected');
    if (failure && !treeSitterWarned) {
      treeSitterWarned = true;
      logger.warn('tree-sitter scanners unavailable; regex scanners stay active', {
        error: String((failure as PromiseRejectedResult).reason),
      });
    }
  })();
}

/**
 * Get the appropriate scanner for a file extension.
 * Returns null if the language is not supported.
 *
 * The first lookup starts the optional tree-sitter upgrade in the background;
 * the regex scanner is returned until a grammar is ready.
 */
export function getScannerForExt(ext: string): LanguageScanner | null {
  startTreeSitterScanners();
  return extToScanner.get(ext.toLowerCase()) ?? null;
}

/**
 * Get all supported file extensions.
 */
export function getSupportedExtensions(): Set<string> {
  return new Set(extToScanner.keys());
}

/**
 * Get all registered scanners.
 */
export function getAllScanners(): LanguageScanner[] {
  return [...scanners];
}

/**
 * Whether tree-sitter scanners have been loaded.
 */
export function isTreeSitterReady(): boolean {
  return treeSitterInitialized;
}

// Re-export types
export type { LanguageScanner, SymbolDef, CallSite, ScanResult, InheritanceInfo } from './types.js';
