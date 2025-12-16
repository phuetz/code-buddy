"use strict";
/**
 * Knowledge Base
 * Windsurf-inspired persistent project memory
 * Stores and retrieves context about the project for better AI assistance
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
exports.KnowledgeBase = void 0;
const vscode = __importStar(require("vscode"));
class KnowledgeBase {
    constructor(context) {
        this.context = context;
        this.disposables = [];
        this.knowledge = null;
        this.autoSaveTimer = null;
        this._onKnowledgeUpdate = new vscode.EventEmitter();
        this.onKnowledgeUpdate = this._onKnowledgeUpdate.event;
        this.storageUri = context.globalStorageUri;
        this.loadKnowledge();
        this.setupListeners();
    }
    setupListeners() {
        // Auto-save on changes
        this._onKnowledgeUpdate.event(() => {
            this.scheduleAutoSave();
        });
        // Learn from file saves
        this.disposables.push(vscode.workspace.onDidSaveTextDocument(doc => {
            this.learnFromDocument(doc);
        }));
    }
    /**
     * Load knowledge from storage
     */
    async loadKnowledge() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders?.length)
            return;
        const rootPath = workspaceFolders[0].uri.fsPath;
        const projectId = this.getProjectId(rootPath);
        const knowledgeFile = vscode.Uri.joinPath(this.storageUri, `${projectId}.json`);
        try {
            const content = await vscode.workspace.fs.readFile(knowledgeFile);
            this.knowledge = JSON.parse(new TextDecoder().decode(content));
        }
        catch {
            // Create new knowledge base for this project
            this.knowledge = {
                projectId,
                projectName: workspaceFolders[0].name,
                rootPath,
                memories: [],
                preferences: {},
                patterns: [],
                techStack: [],
                lastUpdated: Date.now(),
            };
            // Auto-detect tech stack
            await this.detectTechStack();
        }
    }
    /**
     * Save knowledge to storage
     */
    async saveKnowledge() {
        if (!this.knowledge)
            return;
        try {
            await vscode.workspace.fs.createDirectory(this.storageUri);
            const knowledgeFile = vscode.Uri.joinPath(this.storageUri, `${this.knowledge.projectId}.json`);
            const content = JSON.stringify(this.knowledge, null, 2);
            await vscode.workspace.fs.writeFile(knowledgeFile, Buffer.from(content, 'utf-8'));
        }
        catch (error) {
            console.error('Failed to save knowledge:', error);
        }
    }
    scheduleAutoSave() {
        if (this.autoSaveTimer) {
            clearTimeout(this.autoSaveTimer);
        }
        this.autoSaveTimer = setTimeout(() => {
            this.saveKnowledge();
        }, 5000);
    }
    /**
     * Get project ID from path
     */
    getProjectId(rootPath) {
        return Buffer.from(rootPath).toString('base64').replace(/[/+=]/g, '_').slice(0, 32);
    }
    /**
     * Add a memory to the knowledge base
     */
    addMemory(memory) {
        if (!this.knowledge)
            return;
        const newMemory = {
            ...memory,
            id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            createdAt: Date.now(),
            lastUsed: Date.now(),
            useCount: 0,
            relevance: 1.0,
        };
        // Check for duplicates
        const existing = this.knowledge.memories.find(m => m.content.toLowerCase() === memory.content.toLowerCase());
        if (existing) {
            existing.useCount++;
            existing.lastUsed = Date.now();
            existing.relevance = Math.min(1.0, existing.relevance + 0.1);
        }
        else {
            this.knowledge.memories.push(newMemory);
        }
        this.knowledge.lastUpdated = Date.now();
        this._onKnowledgeUpdate.fire(this.knowledge);
    }
    /**
     * Get relevant memories for a query
     */
    getRelevantMemories(query, maxResults = 10) {
        if (!this.knowledge)
            return [];
        const queryLower = query.toLowerCase();
        const words = queryLower.split(/\s+/);
        return this.knowledge.memories
            .map(memory => {
            const contentLower = memory.content.toLowerCase();
            let score = 0;
            // Exact match bonus
            if (contentLower.includes(queryLower)) {
                score += 5;
            }
            // Word matches
            for (const word of words) {
                if (contentLower.includes(word)) {
                    score += 1;
                }
            }
            // Tag matches
            for (const tag of memory.tags) {
                if (words.includes(tag.toLowerCase())) {
                    score += 2;
                }
            }
            // Recency bonus
            const ageHours = (Date.now() - memory.lastUsed) / (1000 * 60 * 60);
            const recencyBonus = Math.max(0, 1 - ageHours / 24);
            score += recencyBonus;
            // Usage bonus
            score += Math.min(memory.useCount * 0.1, 1);
            return { memory, score };
        })
            .filter(({ score }) => score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, maxResults)
            .map(({ memory }) => {
            // Update usage
            memory.useCount++;
            memory.lastUsed = Date.now();
            return memory;
        });
    }
    /**
     * Set a preference
     */
    setPreference(key, value) {
        if (!this.knowledge)
            return;
        this.knowledge.preferences[key] = value;
        this.knowledge.lastUpdated = Date.now();
        this._onKnowledgeUpdate.fire(this.knowledge);
    }
    /**
     * Get a preference
     */
    getPreference(key) {
        return this.knowledge?.preferences[key];
    }
    /**
     * Get all preferences
     */
    getPreferences() {
        return this.knowledge?.preferences || {};
    }
    /**
     * Add a coding pattern
     */
    addPattern(pattern) {
        if (!this.knowledge)
            return;
        if (!this.knowledge.patterns.includes(pattern)) {
            this.knowledge.patterns.push(pattern);
            this.knowledge.lastUpdated = Date.now();
            this._onKnowledgeUpdate.fire(this.knowledge);
        }
    }
    /**
     * Get coding patterns
     */
    getPatterns() {
        return this.knowledge?.patterns || [];
    }
    /**
     * Get tech stack
     */
    getTechStack() {
        return this.knowledge?.techStack || [];
    }
    /**
     * Auto-detect tech stack from project files
     */
    async detectTechStack() {
        if (!this.knowledge)
            return;
        const techStack = new Set();
        // Check for various config files
        const checks = {
            'package.json': ['Node.js'],
            'tsconfig.json': ['TypeScript'],
            'pyproject.toml': ['Python'],
            'requirements.txt': ['Python'],
            'Cargo.toml': ['Rust'],
            'go.mod': ['Go'],
            'pom.xml': ['Java', 'Maven'],
            'build.gradle': ['Java', 'Gradle'],
            'Gemfile': ['Ruby'],
            'composer.json': ['PHP'],
            '.eslintrc*': ['ESLint'],
            '.prettierrc*': ['Prettier'],
            'tailwind.config.*': ['Tailwind CSS'],
            'next.config.*': ['Next.js'],
            'vite.config.*': ['Vite'],
            'webpack.config.*': ['Webpack'],
            'docker-compose.yml': ['Docker'],
            'Dockerfile': ['Docker'],
            '.github/workflows/*': ['GitHub Actions'],
        };
        for (const [pattern, techs] of Object.entries(checks)) {
            const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 1);
            if (files.length > 0) {
                techs.forEach(tech => techStack.add(tech));
            }
        }
        // Check package.json for frameworks
        try {
            const packageJsonFiles = await vscode.workspace.findFiles('package.json', '**/node_modules/**', 1);
            if (packageJsonFiles.length > 0) {
                const content = await vscode.workspace.fs.readFile(packageJsonFiles[0]);
                const pkg = JSON.parse(new TextDecoder().decode(content));
                const deps = { ...pkg.dependencies, ...pkg.devDependencies };
                if (deps.react)
                    techStack.add('React');
                if (deps.vue)
                    techStack.add('Vue');
                if (deps.angular)
                    techStack.add('Angular');
                if (deps.svelte)
                    techStack.add('Svelte');
                if (deps.express)
                    techStack.add('Express');
                if (deps.fastify)
                    techStack.add('Fastify');
                if (deps.nest)
                    techStack.add('NestJS');
                if (deps.prisma)
                    techStack.add('Prisma');
                if (deps.mongoose)
                    techStack.add('MongoDB');
                if (deps.sequelize)
                    techStack.add('SQL');
                if (deps.jest)
                    techStack.add('Jest');
                if (deps.vitest)
                    techStack.add('Vitest');
                if (deps.mocha)
                    techStack.add('Mocha');
            }
        }
        catch {
            // Ignore
        }
        this.knowledge.techStack = Array.from(techStack);
        this._onKnowledgeUpdate.fire(this.knowledge);
    }
    /**
     * Learn from a document (extract patterns and facts)
     */
    async learnFromDocument(document) {
        if (!this.knowledge)
            return;
        const content = document.getText();
        const _relativePath = vscode.workspace.asRelativePath(document.uri);
        // Learn import patterns
        const importPatterns = content.match(/import\s+.*?\s+from\s+['"]([^'"]+)['"]/g);
        if (importPatterns) {
            for (const pattern of importPatterns.slice(0, 5)) {
                const match = pattern.match(/from\s+['"]([^'"]+)['"]/);
                if (match && match[1].startsWith('.')) {
                    // This is a local import pattern
                    this.addPattern(`Import pattern: ${match[1]}`);
                }
            }
        }
        // Learn function naming conventions
        const functionPatterns = content.match(/(?:function|const|let)\s+(\w+)\s*[=(:]/g);
        if (functionPatterns) {
            const names = functionPatterns.map(p => {
                const match = p.match(/(?:function|const|let)\s+(\w+)/);
                return match ? match[1] : null;
            }).filter(Boolean);
            // Detect naming convention
            const camelCase = names.filter(n => n && /^[a-z][a-zA-Z0-9]*$/.test(n)).length;
            const snakeCase = names.filter(n => n && /^[a-z][a-z0-9_]*$/.test(n)).length;
            const pascalCase = names.filter(n => n && /^[A-Z][a-zA-Z0-9]*$/.test(n)).length;
            if (camelCase > snakeCase && camelCase > pascalCase) {
                this.setPreference('namingConvention', 'camelCase');
            }
            else if (snakeCase > camelCase && snakeCase > pascalCase) {
                this.setPreference('namingConvention', 'snake_case');
            }
            else if (pascalCase > camelCase && pascalCase > snakeCase) {
                this.setPreference('namingConvention', 'PascalCase');
            }
        }
    }
    /**
     * Format knowledge for AI context
     */
    formatForContext() {
        if (!this.knowledge)
            return '';
        const parts = [];
        parts.push(`## Project Knowledge: ${this.knowledge.projectName}`);
        if (this.knowledge.techStack.length > 0) {
            parts.push(`\n### Tech Stack\n${this.knowledge.techStack.join(', ')}`);
        }
        if (Object.keys(this.knowledge.preferences).length > 0) {
            parts.push(`\n### Coding Preferences`);
            for (const [key, value] of Object.entries(this.knowledge.preferences)) {
                parts.push(`- ${key}: ${value}`);
            }
        }
        if (this.knowledge.patterns.length > 0) {
            parts.push(`\n### Coding Patterns`);
            for (const pattern of this.knowledge.patterns.slice(0, 10)) {
                parts.push(`- ${pattern}`);
            }
        }
        const recentMemories = this.knowledge.memories
            .sort((a, b) => b.lastUsed - a.lastUsed)
            .slice(0, 10);
        if (recentMemories.length > 0) {
            parts.push(`\n### Recent Context`);
            for (const memory of recentMemories) {
                parts.push(`- [${memory.type}] ${memory.content}`);
            }
        }
        return parts.join('\n');
    }
    /**
     * Get knowledge summary
     */
    getSummary() {
        return {
            memoriesCount: this.knowledge?.memories.length || 0,
            preferencesCount: Object.keys(this.knowledge?.preferences || {}).length,
            patternsCount: this.knowledge?.patterns.length || 0,
            techStack: this.knowledge?.techStack || [],
        };
    }
    /**
     * Clear all knowledge
     */
    async clearKnowledge() {
        if (!this.knowledge)
            return;
        this.knowledge.memories = [];
        this.knowledge.preferences = {};
        this.knowledge.patterns = [];
        this.knowledge.lastUpdated = Date.now();
        await this.saveKnowledge();
        this._onKnowledgeUpdate.fire(this.knowledge);
    }
    dispose() {
        if (this.autoSaveTimer) {
            clearTimeout(this.autoSaveTimer);
        }
        this.saveKnowledge();
        this._onKnowledgeUpdate.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}
exports.KnowledgeBase = KnowledgeBase;
//# sourceMappingURL=knowledge-base.js.map