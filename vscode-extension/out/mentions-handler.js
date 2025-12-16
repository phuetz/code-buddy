"use strict";
/**
 * Mentions Handler
 * GitHub Copilot-style @mentions for context injection
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MentionsHandler = void 0;
const vscode = __importStar(require("vscode"));
class MentionsHandler {
    constructor() {
        this.terminalBuffer = [];
        this.maxTerminalLines = 100;
        // Listen to terminal output
        this.setupTerminalListener();
    }
    setupTerminalListener() {
        // Listen to terminal data
        vscode.window.onDidOpenTerminal(_terminal => {
            // Note: VSCode doesn't expose terminal output directly
            // We'll capture it when user explicitly references @terminal
        });
    }
    /**
     * Capture terminal selection or recent output
     */
    async captureTerminalContent() {
        const terminal = vscode.window.activeTerminal;
        if (!terminal) {
            return 'No active terminal';
        }
        // Try to get selection from terminal (if supported)
        // Note: VSCode terminal API is limited, so we provide guidance
        return `Terminal: ${terminal.name}\n(Paste terminal content directly or use terminal selection)`;
    }
    /**
     * Parse and resolve all @mentions in a message
     */
    async resolveMentions(message) {
        const mentions = [];
        let cleanedMessage = message;
        // @file:path - Include specific file
        const fileMatches = message.matchAll(/@file:([^\s]+)/g);
        for (const match of fileMatches) {
            const filePath = match[1];
            const content = await this.resolveFile(filePath);
            if (content) {
                mentions.push({
                    type: 'file',
                    content,
                    label: `@file:${filePath}`,
                });
            }
            cleanedMessage = cleanedMessage.replace(match[0], '');
        }
        // @selection - Current editor selection
        if (message.includes('@selection')) {
            const selection = await this.resolveSelection();
            if (selection) {
                mentions.push({
                    type: 'selection',
                    content: selection,
                    label: '@selection',
                });
            }
            cleanedMessage = cleanedMessage.replace(/@selection/g, '');
        }
        // @workspace:query - Search workspace
        const workspaceMatches = message.matchAll(/@workspace:([^\s]+)/g);
        for (const match of workspaceMatches) {
            const query = match[1];
            const results = await this.searchWorkspace(query);
            if (results) {
                mentions.push({
                    type: 'workspace',
                    content: results,
                    label: `@workspace:${query}`,
                });
            }
            cleanedMessage = cleanedMessage.replace(match[0], '');
        }
        // @workspace (without query) - Include workspace context
        if (message.match(/@workspace(?![:])/)) {
            const context = await this.getWorkspaceContext();
            mentions.push({
                type: 'workspace',
                content: context,
                label: '@workspace',
            });
            cleanedMessage = cleanedMessage.replace(/@workspace(?![:])/g, '');
        }
        // @terminal - Recent terminal output
        if (message.includes('@terminal')) {
            const terminalContent = await this.captureTerminalContent();
            mentions.push({
                type: 'terminal',
                content: terminalContent,
                label: '@terminal',
            });
            cleanedMessage = cleanedMessage.replace(/@terminal/g, '');
        }
        // @git - Git status and diff
        if (message.includes('@git')) {
            const gitInfo = await this.resolveGit();
            if (gitInfo) {
                mentions.push({
                    type: 'git',
                    content: gitInfo,
                    label: '@git',
                });
            }
            cleanedMessage = cleanedMessage.replace(/@git/g, '');
        }
        // @errors - Current problems/diagnostics
        if (message.includes('@errors')) {
            const errors = await this.resolveErrors();
            if (errors) {
                mentions.push({
                    type: 'errors',
                    content: errors,
                    label: '@errors',
                });
            }
            cleanedMessage = cleanedMessage.replace(/@errors/g, '');
        }
        // @codebase - Search entire codebase for relevant context
        const codebaseMatches = message.matchAll(/@codebase:([^\s]+)/g);
        for (const match of codebaseMatches) {
            const query = match[1];
            const results = await this.searchCodebase(query);
            if (results) {
                mentions.push({
                    type: 'codebase',
                    content: results,
                    label: `@codebase:${query}`,
                });
            }
            cleanedMessage = cleanedMessage.replace(match[0], '');
        }
        // @symbols - Symbols in current file
        if (message.includes('@symbols')) {
            const symbols = await this.resolveSymbols();
            if (symbols) {
                mentions.push({
                    type: 'symbols',
                    content: symbols,
                    label: '@symbols',
                });
            }
            cleanedMessage = cleanedMessage.replace(/@symbols/g, '');
        }
        return {
            mentions,
            cleanedMessage: cleanedMessage.trim(),
        };
    }
    /**
     * Resolve a file path to its content
     */
    async resolveFile(filePath) {
        try {
            // Try to find the file
            const files = await vscode.workspace.findFiles(`**/${filePath}`, '**/node_modules/**', 1);
            if (files.length === 0) {
                // Try as absolute or relative path
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (workspaceFolders) {
                    const uri = vscode.Uri.joinPath(workspaceFolders[0].uri, filePath);
                    try {
                        const doc = await vscode.workspace.openTextDocument(uri);
                        return `File: ${filePath}\n\`\`\`${doc.languageId}\n${doc.getText()}\n\`\`\``;
                    }
                    catch {
                        return null;
                    }
                }
                return null;
            }
            const doc = await vscode.workspace.openTextDocument(files[0]);
            const relativePath = vscode.workspace.asRelativePath(files[0]);
            return `File: ${relativePath}\n\`\`\`${doc.languageId}\n${doc.getText()}\n\`\`\``;
        }
        catch {
            return null;
        }
    }
    /**
     * Get current editor selection
     */
    async resolveSelection() {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.selection.isEmpty) {
            return null;
        }
        const selection = editor.document.getText(editor.selection);
        const language = editor.document.languageId;
        const fileName = vscode.workspace.asRelativePath(editor.document.uri);
        return `Selection from ${fileName}:\n\`\`\`${language}\n${selection}\n\`\`\``;
    }
    /**
     * Search workspace for files matching query
     */
    async searchWorkspace(query) {
        try {
            const files = await vscode.workspace.findFiles(`**/*${query}*`, '**/node_modules/**', 10);
            if (files.length === 0) {
                return `No files found matching: ${query}`;
            }
            const results = [`Files matching "${query}":`];
            for (const file of files.slice(0, 5)) {
                results.push(`- ${vscode.workspace.asRelativePath(file)}`);
            }
            return results.join('\n');
        }
        catch {
            return null;
        }
    }
    /**
     * Get general workspace context
     */
    async getWorkspaceContext() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders?.length) {
            return 'No workspace open';
        }
        const root = workspaceFolders[0];
        const context = [`Workspace: ${root.name}`];
        // Get file structure
        const files = await vscode.workspace.findFiles('**/*.{ts,js,py,go,rs,java,tsx,jsx,vue,svelte}', '**/node_modules/**', 50);
        // Group by directory
        const byDir = new Map();
        for (const file of files) {
            const relativePath = vscode.workspace.asRelativePath(file);
            const dir = relativePath.split('/').slice(0, -1).join('/') || '.';
            if (!byDir.has(dir)) {
                byDir.set(dir, []);
            }
            byDir.get(dir).push(relativePath.split('/').pop());
        }
        context.push('\nProject structure:');
        for (const [dir, fileNames] of Array.from(byDir.entries()).slice(0, 10)) {
            context.push(`${dir}/`);
            for (const name of fileNames.slice(0, 5)) {
                context.push(`  - ${name}`);
            }
            if (fileNames.length > 5) {
                context.push(`  ... and ${fileNames.length - 5} more`);
            }
        }
        // Check for common config files
        const configFiles = ['package.json', 'tsconfig.json', 'pyproject.toml', 'go.mod', 'Cargo.toml'];
        for (const config of configFiles) {
            const found = await vscode.workspace.findFiles(config, null, 1);
            if (found.length > 0) {
                try {
                    const doc = await vscode.workspace.openTextDocument(found[0]);
                    const content = doc.getText();
                    if (content.length < 2000) {
                        context.push(`\n${config}:\n\`\`\`json\n${content}\n\`\`\``);
                    }
                }
                catch {
                    // Skip if can't read
                }
                break; // Only include one config file
            }
        }
        return context.join('\n');
    }
    /**
     * Get git status and diff
     */
    async resolveGit() {
        try {
            const gitExtension = vscode.extensions.getExtension('vscode.git');
            if (!gitExtension) {
                return 'Git extension not available';
            }
            const git = gitExtension.exports.getAPI(1);
            if (!git.repositories.length) {
                return 'No git repository found';
            }
            const repo = git.repositories[0];
            const info = [];
            // Branch info
            const branch = repo.state.HEAD?.name;
            info.push(`Branch: ${branch || 'unknown'}`);
            // Status
            const changes = repo.state.workingTreeChanges;
            const staged = repo.state.indexChanges;
            if (staged.length > 0) {
                info.push(`\nStaged changes (${staged.length}):`);
                for (const change of staged.slice(0, 10)) {
                    info.push(`  - ${vscode.workspace.asRelativePath(change.uri)}`);
                }
            }
            if (changes.length > 0) {
                info.push(`\nUnstaged changes (${changes.length}):`);
                for (const change of changes.slice(0, 10)) {
                    info.push(`  - ${vscode.workspace.asRelativePath(change.uri)}`);
                }
            }
            return info.join('\n');
        }
        catch (_error) {
            return 'Error getting git info';
        }
    }
    /**
     * Get current errors/diagnostics
     */
    async resolveErrors() {
        const diagnostics = vscode.languages.getDiagnostics();
        const errors = [];
        for (const [uri, diags] of diagnostics) {
            const relevantDiags = diags.filter(d => d.severity === vscode.DiagnosticSeverity.Error ||
                d.severity === vscode.DiagnosticSeverity.Warning);
            if (relevantDiags.length > 0) {
                const relativePath = vscode.workspace.asRelativePath(uri);
                for (const diag of relevantDiags.slice(0, 5)) {
                    const severity = diag.severity === vscode.DiagnosticSeverity.Error ? 'ERROR' : 'WARNING';
                    errors.push(`[${severity}] ${relativePath}:${diag.range.start.line + 1} - ${diag.message}`);
                }
            }
        }
        if (errors.length === 0) {
            return 'No errors or warnings found';
        }
        return `Current problems (${errors.length}):\n${errors.slice(0, 20).join('\n')}`;
    }
    /**
     * Search codebase for relevant code
     */
    async searchCodebase(query) {
        try {
            // Search for files containing the query
            const files = await vscode.workspace.findFiles('**/*.{ts,js,py,go,rs,java,tsx,jsx}', '**/node_modules/**', 100);
            const results = [];
            for (const file of files) {
                try {
                    const doc = await vscode.workspace.openTextDocument(file);
                    const text = doc.getText();
                    if (text.toLowerCase().includes(query.toLowerCase())) {
                        const lines = text.split('\n');
                        const matchingLines = [];
                        for (let i = 0; i < lines.length; i++) {
                            if (lines[i].toLowerCase().includes(query.toLowerCase())) {
                                // Get context (line before and after)
                                const start = Math.max(0, i - 1);
                                const end = Math.min(lines.length - 1, i + 1);
                                matchingLines.push(`L${i + 1}: ${lines.slice(start, end + 1).join('\n')}`);
                                if (matchingLines.length >= 3)
                                    break;
                            }
                        }
                        if (matchingLines.length > 0) {
                            const relativePath = vscode.workspace.asRelativePath(file);
                            results.push(`\n${relativePath}:\n${matchingLines.join('\n---\n')}`);
                        }
                    }
                }
                catch {
                    // Skip files that can't be read
                }
                if (results.length >= 5)
                    break;
            }
            if (results.length === 0) {
                return `No code found matching: ${query}`;
            }
            return `Code search results for "${query}":${results.join('\n')}`;
        }
        catch {
            return null;
        }
    }
    /**
     * Get symbols in current file
     */
    async resolveSymbols() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return 'No active editor';
        }
        try {
            const symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', editor.document.uri);
            if (!symbols || symbols.length === 0) {
                return 'No symbols found';
            }
            const formatSymbols = (syms, indent = 0) => {
                const result = [];
                for (const sym of syms) {
                    const kindName = vscode.SymbolKind[sym.kind];
                    result.push(`${'  '.repeat(indent)}${kindName}: ${sym.name}`);
                    if (sym.children && sym.children.length > 0) {
                        result.push(...formatSymbols(sym.children, indent + 1));
                    }
                }
                return result;
            };
            const fileName = vscode.workspace.asRelativePath(editor.document.uri);
            return `Symbols in ${fileName}:\n${formatSymbols(symbols).join('\n')}`;
        }
        catch {
            return 'Error getting symbols';
        }
    }
    /**
     * Get mention suggestions for autocomplete
     */
    getMentionSuggestions() {
        return [
            { label: '@file:', description: 'Include a specific file', insertText: '@file:' },
            { label: '@selection', description: 'Current editor selection', insertText: '@selection' },
            { label: '@workspace', description: 'Workspace context', insertText: '@workspace' },
            { label: '@workspace:', description: 'Search workspace files', insertText: '@workspace:' },
            { label: '@terminal', description: 'Recent terminal output', insertText: '@terminal' },
            { label: '@git', description: 'Git status and diff', insertText: '@git' },
            { label: '@errors', description: 'Current problems/diagnostics', insertText: '@errors' },
            { label: '@codebase:', description: 'Search code for pattern', insertText: '@codebase:' },
            { label: '@symbols', description: 'Symbols in current file', insertText: '@symbols' },
        ];
    }
}
exports.MentionsHandler = MentionsHandler;
//# sourceMappingURL=mentions-handler.js.map