/**
 * Optional `sharp` loader.
 *
 * `sharp` is an optionalDependency. A static `import 'sharp'` throws
 * ERR_MODULE_NOT_FOUND at module evaluation — which, because vision tools
 * sit on the default tool registry, crashes even a text-only `buddy -p`.
 */

export const SHARP_SPECIFIER = 'sharp';

export class SharpUnavailableError extends Error {
  constructor(cause?: unknown) {
    super(
      "Optional package 'sharp' is not installed. Image tools need it: npm install sharp",
    );
    this.name = 'SharpUnavailableError';
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

export type SharpImporter = (specifier: string) => Promise<unknown>;

let importer: SharpImporter = (specifier) => import(specifier);

/** Test-only seam. Pass null to restore the real dynamic import. */
export function setSharpImporterForTests(next: SharpImporter | null): void {
  importer = next ?? ((specifier) => import(specifier));
}

type SharpChain = {
  metadata: () => Promise<{
    width?: number;
    height?: number;
    format?: string;
    size?: number;
    hasAlpha?: boolean;
    channels?: number;
    density?: number;
  }>;
  stats: () => Promise<{ dominant: { r: number; g: number; b: number } }>;
  resize: (opts: Record<string, unknown>) => SharpChain;
  jpeg: () => SharpChain;
  png: () => SharpChain;
  webp: () => SharpChain;
  avif: () => SharpChain;
  toFile: (path: string) => Promise<unknown>;
};

export type SharpFn = ((input: string | Buffer) => SharpChain) & Record<string, unknown>;

function asSharpFn(mod: unknown): SharpFn | null {
  if (typeof mod === 'function') {
    return mod as SharpFn;
  }
  if (mod && typeof mod === 'object' && typeof (mod as { default?: unknown }).default === 'function') {
    return (mod as { default: SharpFn }).default;
  }
  return null;
}

export async function loadSharp(): Promise<SharpFn> {
  try {
    const mod = await importer(SHARP_SPECIFIER);
    const sharp = asSharpFn(mod);
    if (!sharp) {
      throw new SharpUnavailableError();
    }
    return sharp;
  } catch (err) {
    if (err instanceof SharpUnavailableError) {
      throw err;
    }
    throw new SharpUnavailableError(err);
  }
}
