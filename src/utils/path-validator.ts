/**
 * Path Validation Utility
 *
 * Provides secure path validation to prevent:
 * - Path traversal attacks (../)
 * - Symlink-based traversal
 * - Access outside allowed directories
 *
 * Based on text-editor.ts implementation, extracted for reuse across tools.
 */

import * as fs from "fs-extra";
import * as path from "path";

export interface PathValidationResult {
  valid: boolean;
  resolved: string;
  error?: string;
}

export interface PathValidatorOptions {
  /** Base directory for path validation (default: cwd) */
  baseDirectory?: string;
  /** Allow paths outside base directory (default: false) */
  allowOutsideBase?: boolean;
  /** Follow symlinks for validation (default: true) */
  checkSymlinks?: boolean;
  /** Additional allowed directories outside base */
  additionalAllowedPaths?: string[];
}

/**
 * Path Validator class for secure file operations
 */
export class PathValidator {
  private baseDirectory: string;
  private allowOutsideBase: boolean;
  private checkSymlinks: boolean;
  private additionalAllowedPaths: string[];

  constructor(options: PathValidatorOptions = {}) {
    this.baseDirectory = path.resolve(options.baseDirectory || process.cwd());
    this.allowOutsideBase = options.allowOutsideBase ?? false;
    this.checkSymlinks = options.checkSymlinks ?? true;
    this.additionalAllowedPaths = (options.additionalAllowedPaths || []).map(p =>
      path.resolve(p)
    );
  }

  /**
   * Set the base directory for path validation
   */
  setBaseDirectory(dir: string): void {
    this.baseDirectory = path.resolve(dir);
  }

  /**
   * Get the current base directory
   */
  getBaseDirectory(): string {
    return this.baseDirectory;
  }

  /**
   * Validate a file path for security
   */
  validate(filePath: string): PathValidationResult {
    if (!filePath || typeof filePath !== "string") {
      return {
        valid: false,
        resolved: "",
        error: "Invalid file path: path must be a non-empty string",
      };
    }

    // Normalize and resolve the path
    const resolved = path.resolve(filePath);
    const normalizedBase = path.normalize(this.baseDirectory);
    const normalizedResolved = path.normalize(resolved);

    // Check if path is within base directory or additional allowed paths
    const isWithinBase = normalizedResolved.startsWith(normalizedBase + path.sep) ||
      normalizedResolved === normalizedBase;

    const isWithinAllowed = this.additionalAllowedPaths.some(
      allowedPath =>
        normalizedResolved.startsWith(allowedPath + path.sep) ||
        normalizedResolved === allowedPath
    );

    if (!this.allowOutsideBase && !isWithinBase && !isWithinAllowed) {
      return {
        valid: false,
        resolved,
        error: `Path traversal not allowed: ${filePath} resolves outside allowed directories`,
      };
    }

    // Check symlinks if enabled and file exists
    if (this.checkSymlinks) {
      try {
        if (fs.existsSync(resolved)) {
          const realPath = fs.realpathSync(resolved);
          const realBase = fs.realpathSync(this.baseDirectory);

          const realIsWithinBase =
            realPath.startsWith(realBase + path.sep) || realPath === realBase;

          const realIsWithinAllowed = this.additionalAllowedPaths.some(allowedPath => {
            try {
              const realAllowed = fs.realpathSync(allowedPath);
              return (
                realPath.startsWith(realAllowed + path.sep) || realPath === realAllowed
              );
            } catch {
              return false;
            }
          });

          if (!this.allowOutsideBase && !realIsWithinBase && !realIsWithinAllowed) {
            return {
              valid: false,
              resolved,
              error: `Symlink traversal not allowed: ${filePath} points outside allowed directories`,
            };
          }
        }
      } catch (_err) {
        // If realpath fails, allow the operation (file may not exist yet)
        // But we've already validated the normalized path
      }
    }

    return { valid: true, resolved };
  }

  /**
   * Validate multiple paths
   */
  validateMany(filePaths: string[]): {
    valid: boolean;
    results: Map<string, PathValidationResult>;
    errors: string[];
  } {
    const results = new Map<string, PathValidationResult>();
    const errors: string[] = [];

    for (const filePath of filePaths) {
      const result = this.validate(filePath);
      results.set(filePath, result);
      if (!result.valid && result.error) {
        errors.push(result.error);
      }
    }

    return {
      valid: errors.length === 0,
      results,
      errors,
    };
  }

  /**
   * Check if a path is safe (returns boolean only)
   */
  isSafe(filePath: string): boolean {
    return this.validate(filePath).valid;
  }

  /**
   * Resolve a path and throw if invalid
   */
  resolveOrThrow(filePath: string): string {
    const result = this.validate(filePath);
    if (!result.valid) {
      throw new Error(result.error || "Path validation failed");
    }
    return result.resolved;
  }
}

// Singleton instance for convenience
let defaultValidator: PathValidator | null = null;

/**
 * Get the default path validator (lazily initialized)
 */
export function getPathValidator(): PathValidator {
  if (!defaultValidator) {
    defaultValidator = new PathValidator();
  }
  return defaultValidator;
}

/**
 * Initialize the default path validator with custom options
 */
export function initializePathValidator(options: PathValidatorOptions): PathValidator {
  defaultValidator = new PathValidator(options);
  return defaultValidator;
}

/**
 * Convenience function to validate a path using the default validator
 */
export function validatePath(filePath: string): PathValidationResult {
  return getPathValidator().validate(filePath);
}

/**
 * Convenience function to check if a path is safe
 */
export function isPathSafe(filePath: string): boolean {
  return getPathValidator().isSafe(filePath);
}

export default {
  PathValidator,
  getPathValidator,
  initializePathValidator,
  validatePath,
  isPathSafe,
};
