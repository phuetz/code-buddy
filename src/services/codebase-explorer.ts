/**
 * Codebase Explorer Service
 *
 * Provides comprehensive codebase exploration capabilities including:
 * - Directory structure visualization
 * - File statistics and metrics
 * - Language detection and distribution
 * - Project type detection
 * - Smart file recommendations
 *
 * Based on hurry-mode's codebase exploration features.
 */

import * as fs from "fs";
import * as path from "path";

/**
 * Supported languages and their extensions
 */
export const LANGUAGE_EXTENSIONS: Record<string, string[]> = {
  typescript: [".ts", ".tsx", ".mts", ".cts"],
  javascript: [".js", ".jsx", ".mjs", ".cjs"],
  python: [".py", ".pyw", ".pyi"],
  go: [".go"],
  rust: [".rs"],
  java: [".java"],
  csharp: [".cs"],
  cpp: [".cpp", ".cc", ".cxx", ".c", ".h", ".hpp"],
  ruby: [".rb", ".rake"],
  php: [".php"],
  swift: [".swift"],
  kotlin: [".kt", ".kts"],
  scala: [".scala"],
  html: [".html", ".htm"],
  css: [".css", ".scss", ".sass", ".less"],
  sql: [".sql"],
  shell: [".sh", ".bash", ".zsh"],
  yaml: [".yaml", ".yml"],
  json: [".json"],
  markdown: [".md", ".mdx"],
  xml: [".xml"],
};

/**
 * File type categories
 */
export type FileCategory =
  | "source"
  | "test"
  | "config"
  | "documentation"
  | "asset"
  | "build"
  | "other";

/**
 * File information
 */
export interface FileInfo {
  path: string;
  name: string;
  extension: string;
  language: string;
  category: FileCategory;
  size: number;
  lines: number;
  modifiedAt: Date;
  isHidden: boolean;
}

/**
 * Directory information
 */
export interface DirectoryInfo {
  path: string;
  name: string;
  fileCount: number;
  directoryCount: number;
  totalSize: number;
  depth: number;
  isHidden: boolean;
}

/**
 * Project type
 */
export type ProjectType =
  | "nodejs"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "dotnet"
  | "ruby"
  | "php"
  | "unknown";

/**
 * Project information
 */
export interface ProjectInfo {
  type: ProjectType;
  name: string;
  version?: string;
  description?: string;
  entryPoints: string[];
  configFiles: string[];
  dependencies: number;
  devDependencies: number;
}

/**
 * Codebase statistics
 */
export interface CodebaseStats {
  totalFiles: number;
  totalDirectories: number;
  totalSize: number;
  totalLines: number;
  filesByLanguage: Map<string, number>;
  linesByLanguage: Map<string, number>;
  filesByCategory: Map<FileCategory, number>;
  largestFiles: FileInfo[];
  recentlyModified: FileInfo[];
  deepestPaths: string[];
}

/**
 * Exploration options
 */
export interface ExplorationOptions {
  maxDepth?: number;
  includeHidden?: boolean;
  excludePatterns?: string[];
  followSymlinks?: boolean;
  countLines?: boolean;
}

/**
 * Default exploration options
 */
const DEFAULT_OPTIONS: ExplorationOptions = {
  maxDepth: 20,
  includeHidden: false,
  excludePatterns: [
    "node_modules",
    ".git",
    "dist",
    "build",
    "coverage",
    "__pycache__",
    ".next",
    ".nuxt",
    "vendor",
    "target",
  ],
  followSymlinks: false,
  countLines: true,
};

/**
 * Codebase Explorer Service
 */
export class CodebaseExplorer {
  private options: ExplorationOptions;
  private rootPath: string;
  private files: FileInfo[] = [];
  private directories: DirectoryInfo[] = [];
  private projectInfo: ProjectInfo | null = null;

  constructor(rootPath: string, options: Partial<ExplorationOptions> = {}) {
    this.rootPath = path.resolve(rootPath);
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Explore the codebase
   */
  async explore(): Promise<CodebaseStats> {
    this.files = [];
    this.directories = [];

    await this.scanDirectory(this.rootPath, 0);
    this.projectInfo = await this.detectProject();

    return this.calculateStats();
  }

  /**
   * Scan a directory recursively
   */
  private async scanDirectory(dirPath: string, depth: number): Promise<void> {
    if (this.options.maxDepth && depth > this.options.maxDepth) {
      return;
    }

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      let fileCount = 0;
      let directoryCount = 0;
      let totalSize = 0;

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const relativePath = path.relative(this.rootPath, fullPath);

        // Check if hidden
        const isHidden = entry.name.startsWith(".");
        if (isHidden && !this.options.includeHidden) {
          continue;
        }

        // Check exclude patterns
        if (this.shouldExclude(relativePath, entry.name)) {
          continue;
        }

        if (entry.isDirectory()) {
          directoryCount++;
          await this.scanDirectory(fullPath, depth + 1);
        } else if (entry.isFile()) {
          fileCount++;
          const fileInfo = await this.analyzeFile(fullPath, relativePath);
          if (fileInfo) {
            this.files.push(fileInfo);
            totalSize += fileInfo.size;
          }
        }
      }

      this.directories.push({
        path: path.relative(this.rootPath, dirPath) || ".",
        name: path.basename(dirPath),
        fileCount,
        directoryCount,
        totalSize,
        depth,
        isHidden: path.basename(dirPath).startsWith("."),
      });
    } catch (error) {
      // Skip directories we can't read
    }
  }

  /**
   * Analyze a single file
   */
  private async analyzeFile(
    fullPath: string,
    relativePath: string
  ): Promise<FileInfo | null> {
    try {
      const stats = fs.statSync(fullPath);
      const ext = path.extname(fullPath).toLowerCase();
      const name = path.basename(fullPath);

      const language = this.detectLanguage(ext);
      const category = this.categorizeFile(relativePath, name, ext);

      let lines = 0;
      if (this.options.countLines && this.isTextFile(ext)) {
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          lines = content.split("\n").length;
        } catch {
          // Binary file or encoding issue
        }
      }

      return {
        path: relativePath,
        name,
        extension: ext,
        language,
        category,
        size: stats.size,
        lines,
        modifiedAt: stats.mtime,
        isHidden: name.startsWith("."),
      };
    } catch {
      return null;
    }
  }

  /**
   * Detect language from extension
   */
  private detectLanguage(ext: string): string {
    for (const [lang, extensions] of Object.entries(LANGUAGE_EXTENSIONS)) {
      if (extensions.includes(ext)) {
        return lang;
      }
    }
    return "unknown";
  }

  /**
   * Categorize a file
   */
  private categorizeFile(
    relativePath: string,
    name: string,
    ext: string
  ): FileCategory {
    const pathLower = relativePath.toLowerCase();
    const nameLower = name.toLowerCase();

    // Test files
    if (
      pathLower.includes("test") ||
      pathLower.includes("spec") ||
      pathLower.includes("__tests__") ||
      nameLower.includes(".test.") ||
      nameLower.includes(".spec.")
    ) {
      return "test";
    }

    // Config files
    if (
      nameLower.startsWith(".") ||
      nameLower.includes("config") ||
      nameLower.includes("rc") ||
      [".json", ".yaml", ".yml", ".toml", ".ini"].includes(ext)
    ) {
      if (!pathLower.includes("src/")) {
        return "config";
      }
    }

    // Documentation
    if (
      ext === ".md" ||
      ext === ".mdx" ||
      ext === ".txt" ||
      ext === ".rst" ||
      pathLower.includes("docs/") ||
      pathLower.includes("documentation/")
    ) {
      return "documentation";
    }

    // Assets
    if (
      [".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp"].includes(ext) ||
      [".mp3", ".mp4", ".wav", ".webm"].includes(ext) ||
      [".woff", ".woff2", ".ttf", ".eot"].includes(ext)
    ) {
      return "asset";
    }

    // Build artifacts
    if (
      pathLower.includes("dist/") ||
      pathLower.includes("build/") ||
      pathLower.includes("out/") ||
      ext === ".map"
    ) {
      return "build";
    }

    // Source code
    const sourceLangs = [
      "typescript",
      "javascript",
      "python",
      "go",
      "rust",
      "java",
      "csharp",
      "cpp",
      "ruby",
      "php",
      "swift",
      "kotlin",
      "scala",
    ];
    if (sourceLangs.includes(this.detectLanguage(ext))) {
      return "source";
    }

    return "other";
  }

  /**
   * Check if a file is a text file
   */
  private isTextFile(ext: string): boolean {
    const textExtensions = [
      ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java",
      ".cs", ".cpp", ".c", ".h", ".rb", ".php", ".swift", ".kt",
      ".scala", ".html", ".css", ".scss", ".sass", ".less", ".sql",
      ".sh", ".bash", ".yaml", ".yml", ".json", ".md", ".mdx",
      ".xml", ".txt", ".env", ".gitignore", ".dockerignore",
    ];
    return textExtensions.includes(ext);
  }

  /**
   * Check if a path should be excluded
   */
  private shouldExclude(relativePath: string, name: string): boolean {
    for (const pattern of this.options.excludePatterns || []) {
      if (name === pattern || relativePath.includes(pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Detect project type and information
   */
  private async detectProject(): Promise<ProjectInfo> {
    const info: ProjectInfo = {
      type: "unknown",
      name: path.basename(this.rootPath),
      entryPoints: [],
      configFiles: [],
      dependencies: 0,
      devDependencies: 0,
    };

    // Check for Node.js project
    const packageJsonPath = path.join(this.rootPath, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
        info.type = "nodejs";
        info.name = pkg.name || info.name;
        info.version = pkg.version;
        info.description = pkg.description;
        info.dependencies = Object.keys(pkg.dependencies || {}).length;
        info.devDependencies = Object.keys(pkg.devDependencies || {}).length;
        info.configFiles.push("package.json");

        if (pkg.main) info.entryPoints.push(pkg.main);
        if (pkg.module) info.entryPoints.push(pkg.module);
      } catch {
        // Invalid JSON
      }
    }

    // Check for Python project
    if (fs.existsSync(path.join(this.rootPath, "setup.py")) ||
        fs.existsSync(path.join(this.rootPath, "pyproject.toml"))) {
      info.type = "python";
      info.configFiles.push("setup.py", "pyproject.toml");
    }

    // Check for Go project
    if (fs.existsSync(path.join(this.rootPath, "go.mod"))) {
      info.type = "go";
      info.configFiles.push("go.mod");
      try {
        const goMod = fs.readFileSync(path.join(this.rootPath, "go.mod"), "utf-8");
        const moduleMatch = goMod.match(/module\s+(.+)/);
        if (moduleMatch) {
          info.name = moduleMatch[1].trim();
        }
      } catch {
        // Can't read go.mod
      }
    }

    // Check for Rust project
    if (fs.existsSync(path.join(this.rootPath, "Cargo.toml"))) {
      info.type = "rust";
      info.configFiles.push("Cargo.toml");
    }

    // Check for Java project
    if (fs.existsSync(path.join(this.rootPath, "pom.xml")) ||
        fs.existsSync(path.join(this.rootPath, "build.gradle"))) {
      info.type = "java";
      info.configFiles.push("pom.xml", "build.gradle");
    }

    // Check for .NET project
    const csprojFiles = this.files.filter((f) => f.extension === ".csproj");
    if (csprojFiles.length > 0) {
      info.type = "dotnet";
      info.configFiles.push(...csprojFiles.map((f) => f.path));
    }

    return info;
  }

  /**
   * Calculate codebase statistics
   */
  private calculateStats(): CodebaseStats {
    const filesByLanguage = new Map<string, number>();
    const linesByLanguage = new Map<string, number>();
    const filesByCategory = new Map<FileCategory, number>();

    for (const file of this.files) {
      // By language
      filesByLanguage.set(
        file.language,
        (filesByLanguage.get(file.language) || 0) + 1
      );
      linesByLanguage.set(
        file.language,
        (linesByLanguage.get(file.language) || 0) + file.lines
      );

      // By category
      filesByCategory.set(
        file.category,
        (filesByCategory.get(file.category) || 0) + 1
      );
    }

    // Get largest files
    const largestFiles = [...this.files]
      .sort((a, b) => b.size - a.size)
      .slice(0, 10);

    // Get recently modified
    const recentlyModified = [...this.files]
      .sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime())
      .slice(0, 10);

    // Get deepest paths
    const deepestPaths = [...this.files]
      .sort((a, b) => b.path.split("/").length - a.path.split("/").length)
      .slice(0, 5)
      .map((f) => f.path);

    return {
      totalFiles: this.files.length,
      totalDirectories: this.directories.length,
      totalSize: this.files.reduce((sum, f) => sum + f.size, 0),
      totalLines: this.files.reduce((sum, f) => sum + f.lines, 0),
      filesByLanguage,
      linesByLanguage,
      filesByCategory,
      largestFiles,
      recentlyModified,
      deepestPaths,
    };
  }

  /**
   * Get all files
   */
  getFiles(): FileInfo[] {
    return [...this.files];
  }

  /**
   * Get all directories
   */
  getDirectories(): DirectoryInfo[] {
    return [...this.directories];
  }

  /**
   * Get project info
   */
  getProjectInfo(): ProjectInfo | null {
    return this.projectInfo;
  }

  /**
   * Find files matching a pattern
   */
  findFiles(pattern: string): FileInfo[] {
    const regex = new RegExp(pattern, "i");
    return this.files.filter(
      (f) => regex.test(f.path) || regex.test(f.name)
    );
  }

  /**
   * Find files by language
   */
  findByLanguage(language: string): FileInfo[] {
    return this.files.filter((f) => f.language === language);
  }

  /**
   * Find files by category
   */
  findByCategory(category: FileCategory): FileInfo[] {
    return this.files.filter((f) => f.category === category);
  }

  /**
   * Get important files (entry points, configs, main sources)
   */
  getImportantFiles(): FileInfo[] {
    const important: FileInfo[] = [];

    // Add config files
    const configNames = [
      "package.json",
      "tsconfig.json",
      "setup.py",
      "pyproject.toml",
      "go.mod",
      "Cargo.toml",
      "pom.xml",
      "build.gradle",
      ".eslintrc.js",
      ".prettierrc",
      "Dockerfile",
      "docker-compose.yml",
    ];

    for (const file of this.files) {
      if (configNames.includes(file.name)) {
        important.push(file);
      }
    }

    // Add main entry files
    const entryNames = [
      "index.ts",
      "index.js",
      "main.ts",
      "main.js",
      "app.ts",
      "app.js",
      "main.py",
      "__init__.py",
      "main.go",
      "main.rs",
      "lib.rs",
      "Main.java",
      "Program.cs",
    ];

    for (const file of this.files) {
      if (entryNames.includes(file.name) && !important.includes(file)) {
        important.push(file);
      }
    }

    return important;
  }

  /**
   * Generate a tree view of the codebase
   */
  generateTree(maxDepth = 3): string {
    const lines: string[] = [];
    lines.push(path.basename(this.rootPath));

    const addEntry = (
      dirPath: string,
      prefix: string,
      depth: number
    ): void => {
      if (depth > maxDepth) {
        return;
      }

      try {
        const fullPath = path.join(this.rootPath, dirPath);
        const entries = fs.readdirSync(fullPath, { withFileTypes: true });

        // Sort: directories first, then files
        const sorted = entries.sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name);
        });

        // Filter excluded
        const filtered = sorted.filter(
          (e) =>
            !this.shouldExclude(path.join(dirPath, e.name), e.name) &&
            (this.options.includeHidden || !e.name.startsWith("."))
        );

        for (let i = 0; i < filtered.length; i++) {
          const entry = filtered[i];
          const isLast = i === filtered.length - 1;
          const connector = isLast ? "└── " : "├── ";
          const childPrefix = isLast ? "    " : "│   ";

          if (entry.isDirectory()) {
            lines.push(`${prefix}${connector}${entry.name}/`);
            addEntry(
              path.join(dirPath, entry.name),
              prefix + childPrefix,
              depth + 1
            );
          } else {
            lines.push(`${prefix}${connector}${entry.name}`);
          }
        }
      } catch {
        // Skip unreadable directories
      }
    };

    addEntry("", "", 0);
    return lines.join("\n");
  }

  /**
   * Generate a summary report
   */
  generateReport(): string {
    const stats = this.calculateStats();
    const lines: string[] = [];

    lines.push("═".repeat(60));
    lines.push("📁 CODEBASE EXPLORER REPORT");
    lines.push("═".repeat(60));
    lines.push("");

    if (this.projectInfo) {
      lines.push("─".repeat(40));
      lines.push("PROJECT INFO");
      lines.push("─".repeat(40));
      lines.push(`Name: ${this.projectInfo.name}`);
      lines.push(`Type: ${this.projectInfo.type}`);
      if (this.projectInfo.version) {
        lines.push(`Version: ${this.projectInfo.version}`);
      }
      if (this.projectInfo.description) {
        lines.push(`Description: ${this.projectInfo.description}`);
      }
      lines.push(`Dependencies: ${this.projectInfo.dependencies}`);
      lines.push(`Dev Dependencies: ${this.projectInfo.devDependencies}`);
      lines.push("");
    }

    lines.push("─".repeat(40));
    lines.push("STATISTICS");
    lines.push("─".repeat(40));
    lines.push(`Total Files: ${stats.totalFiles}`);
    lines.push(`Total Directories: ${stats.totalDirectories}`);
    lines.push(`Total Size: ${this.formatSize(stats.totalSize)}`);
    lines.push(`Total Lines: ${stats.totalLines.toLocaleString()}`);
    lines.push("");

    lines.push("─".repeat(40));
    lines.push("FILES BY LANGUAGE");
    lines.push("─".repeat(40));
    const langEntries = Array.from(stats.filesByLanguage.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    for (const [lang, count] of langEntries) {
      const lines_ = stats.linesByLanguage.get(lang) || 0;
      lines.push(`  ${lang}: ${count} files (${lines_.toLocaleString()} lines)`);
    }
    lines.push("");

    lines.push("─".repeat(40));
    lines.push("FILES BY CATEGORY");
    lines.push("─".repeat(40));
    for (const [category, count] of stats.filesByCategory) {
      lines.push(`  ${category}: ${count} files`);
    }
    lines.push("");

    lines.push("─".repeat(40));
    lines.push("LARGEST FILES");
    lines.push("─".repeat(40));
    for (const file of stats.largestFiles.slice(0, 5)) {
      lines.push(`  ${file.path} (${this.formatSize(file.size)})`);
    }
    lines.push("");

    lines.push("─".repeat(40));
    lines.push("RECENTLY MODIFIED");
    lines.push("─".repeat(40));
    for (const file of stats.recentlyModified.slice(0, 5)) {
      lines.push(`  ${file.path} (${file.modifiedAt.toLocaleString()})`);
    }
    lines.push("");

    lines.push("═".repeat(60));

    return lines.join("\n");
  }

  /**
   * Format file size
   */
  private formatSize(bytes: number): string {
    const units = ["B", "KB", "MB", "GB"];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }
}

/**
 * Create a codebase explorer instance
 */
export function createCodebaseExplorer(
  rootPath: string,
  options?: Partial<ExplorationOptions>
): CodebaseExplorer {
  return new CodebaseExplorer(rootPath, options);
}

/**
 * Quick explore function
 */
export async function exploreCodebase(
  rootPath: string,
  options?: Partial<ExplorationOptions>
): Promise<{
  stats: CodebaseStats;
  project: ProjectInfo | null;
  tree: string;
  report: string;
}> {
  const explorer = createCodebaseExplorer(rootPath, options);
  const stats = await explorer.explore();

  return {
    stats,
    project: explorer.getProjectInfo(),
    tree: explorer.generateTree(),
    report: explorer.generateReport(),
  };
}
