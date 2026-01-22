/**
 * Auto-Lint Integration Module
 *
 * Automatically runs linters after file changes and feeds errors back to the LLM.
 * Research shows this improves code quality and reduces iteration cycles.
 *
 * Supported linters:
 * - ESLint (JavaScript/TypeScript)
 * - Prettier (formatting)
 * - Ruff (Python)
 * - Clippy (Rust)
 * - golangci-lint (Go)
 * - RuboCop (Ruby)
 */

import { spawn, SpawnOptions } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { EventEmitter } from "events";
import { logger } from "../utils/logger.js";

/**
 * Lint error structure
 */
export interface LintError {
  file: string;
  line: number;
  column: number;
  message: string;
  rule: string;
  severity: "error" | "warning" | "info";
  fixable: boolean;
}

/**
 * Lint result
 */
export interface LintResult {
  success: boolean;
  errors: LintError[];
  warnings: LintError[];
  fixedCount: number;
  duration: number;
  linter: string;
}

/**
 * Linter configuration
 */
export interface LinterConfig {
  name: string;
  command: string;
  args: string[];
  extensions: string[];
  parseOutput: (output: string, file: string) => LintError[];
  fixArgs?: string[];
  configFiles?: string[];
}

/**
 * Auto-lint configuration
 */
export interface AutoLintConfig {
  enabled: boolean;
  autoFix: boolean;
  failOnError: boolean;
  maxErrors: number;
  timeout: number;
  linters: LinterConfig[];
}

/**
 * Default auto-lint configuration
 */
export const DEFAULT_AUTOLINT_CONFIG: AutoLintConfig = {
  enabled: true,
  autoFix: true,
  failOnError: false,
  maxErrors: 50,
  timeout: 30000, // 30 seconds
  linters: [],
};

/**
 * Built-in linter configurations
 */
export const BUILTIN_LINTERS: Record<string, LinterConfig> = {
  eslint: {
    name: "ESLint",
    command: "npx",
    args: ["eslint", "--format", "json"],
    extensions: [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"],
    configFiles: [".eslintrc", ".eslintrc.js", ".eslintrc.json", ".eslintrc.yml", "eslint.config.js"],
    fixArgs: ["--fix"],
    parseOutput: (output: string, _file: string): LintError[] => {
      try {
        const results = JSON.parse(output);
        const errors: LintError[] = [];
        for (const result of results) {
          for (const msg of result.messages || []) {
            errors.push({
              file: result.filePath,
              line: msg.line || 1,
              column: msg.column || 1,
              message: msg.message,
              rule: msg.ruleId || "unknown",
              severity: msg.severity === 2 ? "error" : "warning",
              fixable: msg.fix !== undefined,
            });
          }
        }
        return errors;
      } catch {
        return [];
      }
    },
  },

  prettier: {
    name: "Prettier",
    command: "npx",
    args: ["prettier", "--check"],
    extensions: [".js", ".jsx", ".ts", ".tsx", ".json", ".css", ".scss", ".md", ".yaml", ".yml"],
    configFiles: [".prettierrc", ".prettierrc.js", ".prettierrc.json", "prettier.config.js"],
    fixArgs: ["--write"],
    parseOutput: (output: string, file: string): LintError[] => {
      const errors: LintError[] = [];
      if (output.includes("would change")) {
        errors.push({
          file,
          line: 1,
          column: 1,
          message: "File is not formatted",
          rule: "prettier/format",
          severity: "warning",
          fixable: true,
        });
      }
      return errors;
    },
  },

  ruff: {
    name: "Ruff",
    command: "ruff",
    args: ["check", "--output-format", "json"],
    extensions: [".py"],
    configFiles: ["pyproject.toml", "ruff.toml", ".ruff.toml"],
    fixArgs: ["--fix"],
    parseOutput: (output: string, _file: string): LintError[] => {
      try {
        const results = JSON.parse(output);
        return results.map((r: { filename: string; location: { row: number; column: number }; message: string; code: string; fix?: unknown }) => ({
          file: r.filename,
          line: r.location?.row || 1,
          column: r.location?.column || 1,
          message: r.message,
          rule: r.code,
          severity: "error" as const,
          fixable: r.fix !== undefined,
        }));
      } catch {
        return [];
      }
    },
  },

  clippy: {
    name: "Clippy",
    command: "cargo",
    args: ["clippy", "--message-format=json"],
    extensions: [".rs"],
    configFiles: ["Cargo.toml"],
    parseOutput: (output: string, _file: string): LintError[] => {
      const errors: LintError[] = [];
      const lines = output.split("\n");
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.reason === "compiler-message" && msg.message?.spans?.[0]) {
            const span = msg.message.spans[0];
            errors.push({
              file: span.file_name,
              line: span.line_start,
              column: span.column_start,
              message: msg.message.message,
              rule: msg.message.code?.code || "clippy",
              severity: msg.message.level === "error" ? "error" : "warning",
              fixable: false,
            });
          }
        } catch {
          continue;
        }
      }
      return errors;
    },
  },

  golangci: {
    name: "golangci-lint",
    command: "golangci-lint",
    args: ["run", "--out-format=json"],
    extensions: [".go"],
    configFiles: [".golangci.yml", ".golangci.yaml", ".golangci.toml"],
    fixArgs: ["--fix"],
    parseOutput: (output: string, _file: string): LintError[] => {
      try {
        const result = JSON.parse(output);
        return (result.Issues || []).map((issue: { Pos: { Filename: string; Line: number; Column: number }; Text: string; FromLinter: string; SourceLines?: unknown[] }) => ({
          file: issue.Pos.Filename,
          line: issue.Pos.Line,
          column: issue.Pos.Column,
          message: issue.Text,
          rule: issue.FromLinter,
          severity: "error" as const,
          fixable: issue.SourceLines !== undefined,
        }));
      } catch {
        return [];
      }
    },
  },

  rubocop: {
    name: "RuboCop",
    command: "rubocop",
    args: ["--format", "json"],
    extensions: [".rb"],
    configFiles: [".rubocop.yml"],
    fixArgs: ["--autocorrect"],
    parseOutput: (output: string, _file: string): LintError[] => {
      try {
        const result = JSON.parse(output);
        const errors: LintError[] = [];
        for (const file of result.files || []) {
          for (const offense of file.offenses || []) {
            errors.push({
              file: file.path,
              line: offense.location.start_line,
              column: offense.location.start_column,
              message: offense.message,
              rule: offense.cop_name,
              severity: offense.severity === "error" ? "error" : "warning",
              fixable: offense.correctable,
            });
          }
        }
        return errors;
      } catch {
        return [];
      }
    },
  },
};

/**
 * Auto-Lint Manager
 *
 * Manages automatic linting of files after changes.
 */
export class AutoLintManager extends EventEmitter {
  private config: AutoLintConfig;
  private detectedLinters: LinterConfig[] = [];
  private workingDirectory: string;

  constructor(workingDirectory: string, config: Partial<AutoLintConfig> = {}) {
    super();
    this.workingDirectory = workingDirectory;
    this.config = { ...DEFAULT_AUTOLINT_CONFIG, ...config };
    this.detectLinters();
  }

  /**
   * Detect available linters in the project
   */
  private detectLinters(): void {
    this.detectedLinters = [];

    for (const [key, linter] of Object.entries(BUILTIN_LINTERS)) {
      const hasConfig = linter.configFiles?.some((file) =>
        fs.existsSync(path.join(this.workingDirectory, file))
      );

      // Check for package.json scripts
      const pkgPath = path.join(this.workingDirectory, "package.json");
      let hasPkgScript = false;
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
          hasPkgScript = pkg.scripts?.lint !== undefined ||
                        pkg.devDependencies?.[key] !== undefined ||
                        pkg.dependencies?.[key] !== undefined;
        } catch {
          // Ignore parse errors
        }
      }

      if (hasConfig || hasPkgScript) {
        this.detectedLinters.push(linter);
        logger.debug(`Detected linter: ${linter.name}`);
      }
    }

    this.emit("linters:detected", this.detectedLinters.map(l => l.name));
  }

  /**
   * Run linter on a file
   */
  private async runLinter(
    linter: LinterConfig,
    file: string,
    fix: boolean = false
  ): Promise<LintResult> {
    const startTime = Date.now();
    const args = [...linter.args, file];

    if (fix && linter.fixArgs) {
      args.push(...linter.fixArgs);
    }

    return new Promise((resolve) => {
      const options: SpawnOptions = {
        cwd: this.workingDirectory,
        timeout: this.config.timeout,
        shell: true,
      };

      let stdout = "";
      let stderr = "";

      const proc = spawn(linter.command, args, options);

      proc.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("error", (error) => {
        resolve({
          success: false,
          errors: [{
            file,
            line: 1,
            column: 1,
            message: `Linter error: ${error.message}`,
            rule: "linter-error",
            severity: "error",
            fixable: false,
          }],
          warnings: [],
          fixedCount: 0,
          duration: Date.now() - startTime,
          linter: linter.name,
        });
      });

      proc.on("close", (code) => {
        const output = stdout || stderr;
        const errors = linter.parseOutput(output, file);

        const lintErrors = errors.filter((e) => e.severity === "error");
        const lintWarnings = errors.filter((e) => e.severity !== "error");

        resolve({
          success: code === 0 || lintErrors.length === 0,
          errors: lintErrors,
          warnings: lintWarnings,
          fixedCount: fix ? errors.filter((e) => e.fixable).length : 0,
          duration: Date.now() - startTime,
          linter: linter.name,
        });
      });
    });
  }

  /**
   * Get linter for file extension
   */
  private getLinterForFile(file: string): LinterConfig | null {
    const ext = path.extname(file);
    return this.detectedLinters.find((l) => l.extensions.includes(ext)) || null;
  }

  /**
   * Lint a single file
   */
  async lintFile(file: string, autoFix: boolean = false): Promise<LintResult | null> {
    if (!this.config.enabled) return null;

    const linter = this.getLinterForFile(file);
    if (!linter) {
      logger.debug(`No linter found for file: ${file}`);
      return null;
    }

    this.emit("lint:start", { file, linter: linter.name });

    const result = await this.runLinter(linter, file, autoFix && this.config.autoFix);

    this.emit("lint:complete", { file, result });

    return result;
  }

  /**
   * Lint multiple files
   */
  async lintFiles(files: string[], autoFix: boolean = false): Promise<LintResult[]> {
    // Lint files in parallel for better performance
    const lintResults = await Promise.all(
      files.map(file => this.lintFile(file, autoFix))
    );

    // Filter out null results
    return lintResults.filter((result): result is LintResult => result !== null);
  }

  /**
   * Format lint results for LLM context
   */
  formatResultsForLLM(results: LintResult[]): string {
    const allErrors = results.flatMap((r) => r.errors);
    const allWarnings = results.flatMap((r) => r.warnings);

    if (allErrors.length === 0 && allWarnings.length === 0) {
      return "✅ All linting checks passed.";
    }

    const lines: string[] = [];

    if (allErrors.length > 0) {
      lines.push(`❌ Lint Errors (${allErrors.length}):`);
      for (const error of allErrors.slice(0, this.config.maxErrors)) {
        lines.push(`  ${error.file}:${error.line}:${error.column}`);
        lines.push(`    [${error.rule}] ${error.message}`);
        if (error.fixable) {
          lines.push(`    💡 Auto-fixable`);
        }
      }
      if (allErrors.length > this.config.maxErrors) {
        lines.push(`  ... and ${allErrors.length - this.config.maxErrors} more errors`);
      }
    }

    if (allWarnings.length > 0) {
      lines.push(`⚠️ Lint Warnings (${allWarnings.length}):`);
      for (const warning of allWarnings.slice(0, 10)) {
        lines.push(`  ${warning.file}:${warning.line} [${warning.rule}] ${warning.message}`);
      }
      if (allWarnings.length > 10) {
        lines.push(`  ... and ${allWarnings.length - 10} more warnings`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Get detected linters
   */
  getDetectedLinters(): string[] {
    return this.detectedLinters.map((l) => l.name);
  }

  /**
   * Get configuration
   */
  getConfig(): AutoLintConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<AutoLintConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Re-detect linters
   */
  refresh(): void {
    this.detectLinters();
  }
}

// Singleton instance
let lintManager: AutoLintManager | null = null;

/**
 * Get or create auto-lint manager instance
 */
export function getAutoLintManager(
  workingDirectory?: string,
  config?: Partial<AutoLintConfig>
): AutoLintManager {
  if (!lintManager || workingDirectory) {
    lintManager = new AutoLintManager(
      workingDirectory || process.cwd(),
      config
    );
  }
  return lintManager;
}

/**
 * Initialize auto-lint manager
 */
export function initializeAutoLint(
  workingDirectory: string,
  config?: Partial<AutoLintConfig>
): AutoLintManager {
  lintManager = new AutoLintManager(workingDirectory, config);
  return lintManager;
}
