/**
 * Project Indexer
 * Deep codebase understanding and indexing
 * Creates a semantic map of the project for intelligent suggestions
 */

import * as vscode from 'vscode';
import { AIClient } from './ai-client';

export interface ProjectFile {
  path: string;
  relativePath: string;
  language: string;
  size: number;
  lastModified: number;
  symbols: ProjectSymbol[];
  imports: string[];
  exports: string[];
  summary?: string;
}

export interface ProjectSymbol {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'method' | 'property';
  signature?: string;
  line: number;
  documentation?: string;
}

export interface ProjectIndex {
  name: string;
  rootPath: string;
  files: Map<string, ProjectFile>;
  symbols: Map<string, ProjectSymbol & { file: string }>;
  dependencies: string[];
  devDependencies: string[];
  scripts: Record<string, string>;
  projectType: ProjectType;
  lastIndexed: number;
  summary?: string;
}

export type ProjectType =
  | 'nodejs'
  | 'python'
  | 'go'
  | 'rust'
  | 'java'
  | 'unknown';

export class ProjectIndexer implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private index: ProjectIndex | null = null;
  private indexingInProgress = false;
  private statusBarItem: vscode.StatusBarItem;

  private _onIndexUpdate = new vscode.EventEmitter<ProjectIndex>();
  readonly onIndexUpdate = this._onIndexUpdate.event;

  constructor(private readonly aiClient: AIClient) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.statusBarItem.text = '$(sync~spin) Indexing...';
    this.setupListeners();
  }

  private setupListeners(): void {
    // Re-index on file changes
    this.disposables.push(
      vscode.workspace.onDidCreateFiles(() => this.scheduleReindex()),
      vscode.workspace.onDidDeleteFiles(() => this.scheduleReindex()),
      vscode.workspace.onDidRenameFiles(() => this.scheduleReindex())
    );
  }

  private reindexTimeout: NodeJS.Timeout | null = null;

  private scheduleReindex(): void {
    if (this.reindexTimeout) {
      clearTimeout(this.reindexTimeout);
    }
    this.reindexTimeout = setTimeout(() => {
      this.indexProject();
    }, 5000);
  }

  /**
   * Index the entire project
   */
  async indexProject(forceReindex = false): Promise<ProjectIndex | null> {
    if (this.indexingInProgress && !forceReindex) {
      return this.index;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders?.length) {
      return null;
    }

    this.indexingInProgress = true;
    this.statusBarItem.show();

    const rootPath = workspaceFolders[0].uri.fsPath;
    const projectName = workspaceFolders[0].name;

    try {
      // Detect project type
      const projectType = await this.detectProjectType(rootPath);

      // Get all source files
      const files = await this.getAllSourceFiles();

      // Index each file
      const indexedFiles = new Map<string, ProjectFile>();
      const allSymbols = new Map<string, ProjectSymbol & { file: string }>();

      let processed = 0;
      for (const file of files) {
        this.statusBarItem.text = `$(sync~spin) Indexing ${++processed}/${files.length}...`;

        const indexed = await this.indexFile(file);
        if (indexed) {
          indexedFiles.set(indexed.relativePath, indexed);

          // Add symbols to global index
          for (const symbol of indexed.symbols) {
            const key = `${symbol.name}:${symbol.kind}`;
            allSymbols.set(key, { ...symbol, file: indexed.relativePath });
          }
        }
      }

      // Get package info
      const { dependencies, devDependencies, scripts } = await this.getPackageInfo(rootPath, projectType);

      // Generate project summary
      const summary = await this.generateProjectSummary(indexedFiles, projectType);

      this.index = {
        name: projectName,
        rootPath,
        files: indexedFiles,
        symbols: allSymbols,
        dependencies,
        devDependencies,
        scripts,
        projectType,
        lastIndexed: Date.now(),
        summary,
      };

      this._onIndexUpdate.fire(this.index);
      this.statusBarItem.text = `$(check) Indexed ${indexedFiles.size} files`;
      setTimeout(() => this.statusBarItem.hide(), 3000);

      return this.index;
    } catch (error) {
      console.error('Indexing error:', error);
      this.statusBarItem.text = '$(error) Indexing failed';
      setTimeout(() => this.statusBarItem.hide(), 3000);
      return null;
    } finally {
      this.indexingInProgress = false;
    }
  }

  /**
   * Detect project type
   */
  private async detectProjectType(_rootPath: string): Promise<ProjectType> {
    const indicators: Record<string, ProjectType> = {
      'package.json': 'nodejs',
      'pyproject.toml': 'python',
      'requirements.txt': 'python',
      'go.mod': 'go',
      'Cargo.toml': 'rust',
      'pom.xml': 'java',
      'build.gradle': 'java',
    };

    for (const [file, type] of Object.entries(indicators)) {
      const found = await vscode.workspace.findFiles(file, null, 1);
      if (found.length > 0) {
        return type;
      }
    }

    return 'unknown';
  }

  /**
   * Get all source files in the workspace
   */
  private async getAllSourceFiles(): Promise<vscode.Uri[]> {
    const patterns = [
      '**/*.ts',
      '**/*.tsx',
      '**/*.js',
      '**/*.jsx',
      '**/*.py',
      '**/*.go',
      '**/*.rs',
      '**/*.java',
      '**/*.vue',
      '**/*.svelte',
    ];

    const excludes = [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.git/**',
      '**/vendor/**',
      '**/target/**',
      '**/__pycache__/**',
    ];

    const allFiles: vscode.Uri[] = [];

    for (const pattern of patterns) {
      const files = await vscode.workspace.findFiles(pattern, `{${excludes.join(',')}}`, 1000);
      allFiles.push(...files);
    }

    return allFiles;
  }

  /**
   * Index a single file
   */
  private async indexFile(uri: vscode.Uri): Promise<ProjectFile | null> {
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const content = doc.getText();
      const relativePath = vscode.workspace.asRelativePath(uri);

      // Extract symbols
      const symbols = await this.extractSymbols(uri, doc.languageId, content);

      // Extract imports/exports
      const { imports, exports } = this.extractDependencies(content, doc.languageId);

      // Get file stats
      const stat = await vscode.workspace.fs.stat(uri);

      return {
        path: uri.fsPath,
        relativePath,
        language: doc.languageId,
        size: stat.size,
        lastModified: stat.mtime,
        symbols,
        imports,
        exports,
      };
    } catch {
      return null;
    }
  }

  /**
   * Extract symbols from a file
   */
  private async extractSymbols(
    uri: vscode.Uri,
    language: string,
    content: string
  ): Promise<ProjectSymbol[]> {
    const symbols: ProjectSymbol[] = [];

    try {
      // Use VS Code's symbol provider
      const docSymbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        'vscode.executeDocumentSymbolProvider',
        uri
      );

      if (docSymbols) {
        const processSymbol = (sym: vscode.DocumentSymbol) => {
          const kind = this.mapSymbolKind(sym.kind);
          if (kind) {
            symbols.push({
              name: sym.name,
              kind,
              line: sym.range.start.line + 1,
              signature: sym.detail,
            });
          }

          // Process children
          for (const child of sym.children || []) {
            processSymbol(child);
          }
        };

        for (const sym of docSymbols) {
          processSymbol(sym);
        }
      }
    } catch {
      // Fallback to regex-based extraction
      symbols.push(...this.extractSymbolsWithRegex(content, language));
    }

    return symbols;
  }

  /**
   * Map VS Code symbol kind to our symbol kind
   */
  private mapSymbolKind(kind: vscode.SymbolKind): ProjectSymbol['kind'] | null {
    switch (kind) {
      case vscode.SymbolKind.Function:
        return 'function';
      case vscode.SymbolKind.Class:
        return 'class';
      case vscode.SymbolKind.Interface:
        return 'interface';
      case vscode.SymbolKind.Method:
        return 'method';
      case vscode.SymbolKind.Property:
        return 'property';
      case vscode.SymbolKind.Variable:
      case vscode.SymbolKind.Constant:
        return 'variable';
      case vscode.SymbolKind.TypeParameter:
        return 'type';
      default:
        return null;
    }
  }

  /**
   * Fallback regex-based symbol extraction
   */
  private extractSymbolsWithRegex(content: string, language: string): ProjectSymbol[] {
    const symbols: ProjectSymbol[] = [];
    const _lines = content.split('\n');

    const patterns: Record<string, { regex: RegExp; kind: ProjectSymbol['kind'] }[]> = {
      typescript: [
        { regex: /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g, kind: 'function' },
        { regex: /(?:export\s+)?class\s+(\w+)/g, kind: 'class' },
        { regex: /(?:export\s+)?interface\s+(\w+)/g, kind: 'interface' },
        { regex: /(?:export\s+)?type\s+(\w+)/g, kind: 'type' },
        { regex: /(?:export\s+)?const\s+(\w+)/g, kind: 'variable' },
      ],
      python: [
        { regex: /^def\s+(\w+)/gm, kind: 'function' },
        { regex: /^class\s+(\w+)/gm, kind: 'class' },
      ],
      go: [
        { regex: /^func\s+(\w+)/gm, kind: 'function' },
        { regex: /^type\s+(\w+)\s+struct/gm, kind: 'class' },
        { regex: /^type\s+(\w+)\s+interface/gm, kind: 'interface' },
      ],
    };

    const langPatterns = patterns[language] || patterns.typescript;

    for (const { regex, kind } of langPatterns) {
      let match;
      while ((match = regex.exec(content)) !== null) {
        const line = content.substring(0, match.index).split('\n').length;
        symbols.push({
          name: match[1],
          kind,
          line,
        });
      }
    }

    return symbols;
  }

  /**
   * Extract imports and exports from file
   */
  private extractDependencies(content: string, language: string): { imports: string[]; exports: string[] } {
    const imports: string[] = [];
    const exports: string[] = [];

    if (['typescript', 'javascript', 'typescriptreact', 'javascriptreact'].includes(language)) {
      // Imports
      const importMatches = content.matchAll(/import\s+.*?\s+from\s+['"]([^'"]+)['"]/g);
      for (const match of importMatches) {
        imports.push(match[1]);
      }

      // Exports
      const exportMatches = content.matchAll(/export\s+(?:default\s+)?(?:const|function|class|interface|type)\s+(\w+)/g);
      for (const match of exportMatches) {
        exports.push(match[1]);
      }
    }

    if (language === 'python') {
      const importMatches = content.matchAll(/^(?:from\s+(\S+)\s+)?import\s+/gm);
      for (const match of importMatches) {
        if (match[1]) {
          imports.push(match[1]);
        }
      }
    }

    return { imports, exports };
  }

  /**
   * Get package info (dependencies, scripts)
   */
  private async getPackageInfo(
    rootPath: string,
    projectType: ProjectType
  ): Promise<{
    dependencies: string[];
    devDependencies: string[];
    scripts: Record<string, string>;
  }> {
    if (projectType === 'nodejs') {
      try {
        const packageJson = await vscode.workspace.findFiles('package.json', null, 1);
        if (packageJson.length > 0) {
          const content = await vscode.workspace.fs.readFile(packageJson[0]);
          const pkg = JSON.parse(new TextDecoder().decode(content));

          return {
            dependencies: Object.keys(pkg.dependencies || {}),
            devDependencies: Object.keys(pkg.devDependencies || {}),
            scripts: pkg.scripts || {},
          };
        }
      } catch {
        // Ignore
      }
    }

    if (projectType === 'python') {
      try {
        const requirements = await vscode.workspace.findFiles('requirements.txt', null, 1);
        if (requirements.length > 0) {
          const content = await vscode.workspace.fs.readFile(requirements[0]);
          const deps = new TextDecoder()
            .decode(content)
            .split('\n')
            .filter(line => line.trim() && !line.startsWith('#'))
            .map(line => line.split('==')[0].split('>=')[0].trim());

          return {
            dependencies: deps,
            devDependencies: [],
            scripts: {},
          };
        }
      } catch {
        // Ignore
      }
    }

    return { dependencies: [], devDependencies: [], scripts: {} };
  }

  /**
   * Generate project summary using AI
   */
  private async generateProjectSummary(
    files: Map<string, ProjectFile>,
    projectType: ProjectType
  ): Promise<string> {
    const fileList = Array.from(files.values())
      .slice(0, 50)
      .map(f => `- ${f.relativePath}: ${f.symbols.length} symbols`)
      .join('\n');

    try {
      const response = await this.aiClient.chat([
        {
          role: 'system',
          content: 'Generate a brief 2-3 sentence summary of what this project does based on its structure.',
        },
        {
          role: 'user',
          content: `Project type: ${projectType}\n\nFiles:\n${fileList}`,
        },
      ]);

      return response.slice(0, 500);
    } catch {
      return `A ${projectType} project with ${files.size} source files.`;
    }
  }

  /**
   * Search symbols in the index
   */
  searchSymbols(query: string): Array<ProjectSymbol & { file: string }> {
    if (!this.index) return [];

    const results: Array<ProjectSymbol & { file: string }> = [];
    const lowerQuery = query.toLowerCase();

    for (const [_key, symbol] of this.index.symbols) {
      if (symbol.name.toLowerCase().includes(lowerQuery)) {
        results.push(symbol);
      }
    }

    return results.sort((a, b) => {
      // Exact matches first
      const aExact = a.name.toLowerCase() === lowerQuery;
      const bExact = b.name.toLowerCase() === lowerQuery;
      if (aExact && !bExact) return -1;
      if (bExact && !aExact) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  /**
   * Get files related to a symbol
   */
  getRelatedFiles(symbolName: string): string[] {
    if (!this.index) return [];

    const relatedFiles = new Set<string>();

    for (const [path, file] of this.index.files) {
      // Check if file uses or defines the symbol
      if (file.symbols.some(s => s.name === symbolName)) {
        relatedFiles.add(path);
      }

      // Check imports
      if (file.imports.some(i => i.includes(symbolName))) {
        relatedFiles.add(path);
      }
    }

    return Array.from(relatedFiles);
  }

  /**
   * Get the current index
   */
  getIndex(): ProjectIndex | null {
    return this.index;
  }

  dispose(): void {
    if (this.reindexTimeout) {
      clearTimeout(this.reindexTimeout);
    }
    this.statusBarItem.dispose();
    this._onIndexUpdate.dispose();
    this.disposables.forEach(d => d.dispose());
  }
}
