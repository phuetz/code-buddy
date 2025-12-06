# Chapitre 10 — Tool-Use et Tool-Calling

---

> **Scène**
>
> *Lina a construit le reasoning, la mémoire, le RAG. Son agent peut réfléchir et se souvenir. Mais il ne peut toujours pas agir.*
>
> *"Crée un fichier test.txt," dit-elle à l'agent.*
>
> *"Voici comment créer un fichier test.txt : utilisez la commande touch test.txt ou ouvrez votre éditeur..."*
>
> *"Non !" s'exclame-t-elle. "Je ne veux pas que tu m'expliques. Je veux que tu le fasses !"*
>
> *C'est le moment de donner des mains à son agent.*

---

## Introduction

Un LLM sans outils est comme un cerveau sans corps : il peut penser, mais pas agir. Les **outils** (tools) transforment un chatbot passif en agent actif capable d'interagir avec le monde : lire des fichiers, exécuter du code, chercher sur le web, modifier des bases de données.

Ce chapitre explore l'architecture des outils, leur implémentation, et les patterns de sécurité essentiels.

---

## 10.1 Anatomie d'un Outil

### 10.1.1 Interface standard

```typescript
// src/tools/types.ts
export interface Tool {
  // Identité
  name: string;                    // Identifiant unique
  description: string;             // Description pour le LLM

  // Schema
  inputSchema: JSONSchema;         // Paramètres acceptés
  outputSchema?: JSONSchema;       // Format de sortie (optionnel)

  // Comportement
  requiresConfirmation?: boolean;  // Demander avant d'exécuter
  timeout?: number;                // Timeout en ms
  category?: string;               // Pour regroupement

  // Exécution
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}

export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}
```

### 10.1.2 Exemple complet : read_file

```typescript
// src/tools/text-editor.ts
export class ReadFileTool implements Tool {
  name = 'read_file';

  description = `Read the contents of a file at the specified path.
Returns the file content as a string. For large files, content may be truncated.
Supports text files, code files, and common formats like JSON, YAML, etc.`;

  inputSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute or relative path to the file to read'
      },
      startLine: {
        type: 'number',
        description: 'Optional: First line to read (1-indexed)'
      },
      endLine: {
        type: 'number',
        description: 'Optional: Last line to read (1-indexed)'
      },
      encoding: {
        type: 'string',
        enum: ['utf-8', 'utf-16', 'ascii', 'base64'],
        default: 'utf-8',
        description: 'File encoding'
      }
    },
    required: ['path']
  };

  requiresConfirmation = false;  // Lecture = safe
  timeout = 10_000;              // 10 secondes
  category = 'filesystem';

  async execute(args: {
    path: string;
    startLine?: number;
    endLine?: number;
    encoding?: BufferEncoding;
  }): Promise<ToolResult> {
    try {
      // 1. Valider le chemin
      const safePath = this.validatePath(args.path);

      // 2. Vérifier que le fichier existe
      const stats = await fs.stat(safePath);
      if (!stats.isFile()) {
        return {
          success: false,
          error: `Path is not a file: ${args.path}`
        };
      }

      // 3. Vérifier la taille (éviter de lire des fichiers énormes)
      const MAX_SIZE = 1_000_000;  // 1 MB
      if (stats.size > MAX_SIZE) {
        return {
          success: false,
          error: `File too large (${stats.size} bytes). Maximum: ${MAX_SIZE} bytes`
        };
      }

      // 4. Lire le fichier
      let content = await fs.readFile(safePath, {
        encoding: args.encoding ?? 'utf-8'
      });

      // 5. Extraire les lignes demandées
      if (args.startLine || args.endLine) {
        const lines = content.split('\n');
        const start = (args.startLine ?? 1) - 1;
        const end = args.endLine ?? lines.length;
        content = lines.slice(start, end).join('\n');
      }

      // 6. Tronquer si trop long (pour le contexte)
      const MAX_OUTPUT = 50_000;  // caractères
      let truncated = false;
      if (content.length > MAX_OUTPUT) {
        content = content.substring(0, MAX_OUTPUT);
        truncated = true;
      }

      return {
        success: true,
        output: content,
        metadata: {
          path: safePath,
          size: stats.size,
          lines: content.split('\n').length,
          truncated,
          encoding: args.encoding ?? 'utf-8'
        }
      };

    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {
          success: false,
          error: `File not found: ${args.path}`
        };
      }
      return {
        success: false,
        error: `Failed to read file: ${(error as Error).message}`
      };
    }
  }

  private validatePath(inputPath: string): string {
    // Résoudre le chemin absolu
    const resolved = path.resolve(process.cwd(), inputPath);

    // Empêcher la traversée de répertoire
    const cwd = process.cwd();
    if (!resolved.startsWith(cwd)) {
      throw new Error('Path traversal detected: cannot access files outside working directory');
    }

    // Bloquer certains fichiers sensibles
    const blocked = ['.env', '.git/config', 'id_rsa', '.ssh'];
    if (blocked.some(b => resolved.includes(b))) {
      throw new Error('Access to sensitive file blocked');
    }

    return resolved;
  }
}
```

---

## 10.2 Le Protocole de Tool-Calling

### 10.2.1 Flow standard

```
┌─────────────────────────────────────────────────────────────────────┐
│                    TOOL CALLING FLOW                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   User: "Lis le fichier config.ts"                                  │
│            │                                                         │
│            ▼                                                         │
│   ┌────────────────────┐                                            │
│   │       LLM          │                                            │
│   │  (avec tools)      │                                            │
│   └─────────┬──────────┘                                            │
│             │                                                        │
│             ▼                                                        │
│   Response: {                                                        │
│     "tool_calls": [{                                                │
│       "id": "call_123",                                             │
│       "name": "read_file",                                          │
│       "arguments": { "path": "config.ts" }                          │
│     }]                                                               │
│   }                                                                  │
│             │                                                        │
│             ▼                                                        │
│   ┌────────────────────┐                                            │
│   │   Tool Executor    │ ◄── Valider + Exécuter                     │
│   └─────────┬──────────┘                                            │
│             │                                                        │
│             ▼                                                        │
│   Tool Result: {                                                     │
│     "tool_call_id": "call_123",                                     │
│     "output": "export const config = { ... }"                       │
│   }                                                                  │
│             │                                                        │
│             ▼                                                        │
│   ┌────────────────────┐                                            │
│   │       LLM          │ ◄── Avec le résultat                       │
│   └─────────┬──────────┘                                            │
│             │                                                        │
│             ▼                                                        │
│   Response: "Le fichier config.ts contient..."                      │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 10.2.2 Format des tool calls

```typescript
// Format OpenAI/Grok
interface ToolCall {
  id: string;                      // Identifiant unique du call
  type: 'function';
  function: {
    name: string;                  // Nom de l'outil
    arguments: string;             // JSON stringifié des arguments
  };
}

// Format du message tool result
interface ToolMessage {
  role: 'tool';
  tool_call_id: string;           // Référence au call
  content: string;                 // Résultat (stringifié)
}
```

### 10.2.3 Parallel tool calls

Les modèles modernes peuvent demander plusieurs outils en parallèle :

```typescript
// Réponse LLM avec multiple tool calls
{
  "tool_calls": [
    {
      "id": "call_1",
      "name": "read_file",
      "arguments": { "path": "src/index.ts" }
    },
    {
      "id": "call_2",
      "name": "read_file",
      "arguments": { "path": "src/types.ts" }
    },
    {
      "id": "call_3",
      "name": "search",
      "arguments": { "query": "import.*types" }
    }
  ]
}

// L'agent peut exécuter en parallèle !
const results = await Promise.all(
  toolCalls.map(call => executor.execute(call))
);
```

---

## 10.3 Les 41 Outils de Grok-CLI

### 10.3.1 Catalogue complet

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CATALOGUE D'OUTILS GROK-CLI                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  FICHIERS (12)                      SHELL (4)                       │
│  ├── read_file                      ├── bash                        │
│  ├── write_file                     ├── interactive_bash            │
│  ├── edit_file                      ├── background_task             │
│  ├── multi_edit                     └── kill_process                │
│  ├── list_directory                                                 │
│  ├── create_directory               GIT (5)                         │
│  ├── delete_file                    ├── git_status                  │
│  ├── move_file                      ├── git_diff                    │
│  ├── copy_file                      ├── git_commit                  │
│  ├── file_info                      ├── git_log                     │
│  ├── find_files                     └── git_branch                  │
│  └── search_content                                                 │
│                                      RECHERCHE (4)                   │
│  MÉDIAS (5)                         ├── search_code                 │
│  ├── screenshot                     ├── find_symbol                 │
│  ├── audio_transcribe               ├── find_references             │
│  ├── video_extract                  └── search_web                  │
│  ├── image_analyze                                                  │
│  └── qr_code                        SYSTÈME (6)                      │
│                                      ├── memory_store               │
│  DOCUMENTS (5)                      ├── memory_recall               │
│  ├── pdf_extract                    ├── spawn_agent                 │
│  ├── excel_read                     ├── http_request                │
│  ├── excel_write                    ├── database_query              │
│  ├── archive_extract                └── thinking                    │
│  └── archive_create                                                 │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 10.3.2 Outils critiques détaillés

**1. bash** — Exécution de commandes shell

```typescript
export class BashTool implements Tool {
  name = 'bash';
  description = `Execute a shell command and return the output.
Use for: running builds, tests, git commands, package management, etc.
The command runs in the current working directory.`;

  inputSchema = {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute'
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 30000)',
        default: 30000
      },
      cwd: {
        type: 'string',
        description: 'Working directory (default: current)'
      }
    },
    required: ['command']
  };

  requiresConfirmation = true;  // Dangereux !
  timeout = 60_000;

  async execute(args: { command: string; timeout?: number; cwd?: string }) {
    // Validation des commandes dangereuses
    if (this.isDangerous(args.command)) {
      return {
        success: false,
        error: 'Command blocked: potentially destructive operation'
      };
    }

    try {
      const { stdout, stderr } = await execAsync(args.command, {
        timeout: args.timeout ?? 30_000,
        cwd: args.cwd ?? process.cwd(),
        maxBuffer: 10 * 1024 * 1024  // 10 MB
      });

      return {
        success: true,
        output: stdout + (stderr ? `\n[stderr]\n${stderr}` : ''),
        metadata: { exitCode: 0 }
      };
    } catch (error) {
      const execError = error as ExecException;
      return {
        success: false,
        output: execError.stdout,
        error: execError.stderr || execError.message,
        metadata: { exitCode: execError.code }
      };
    }
  }

  private isDangerous(command: string): boolean {
    const dangerous = [
      /rm\s+-rf\s+[\/~]/,           // rm -rf /
      /mkfs/,                        // Format disks
      /dd\s+.*of=\/dev/,             // Write to devices
      />\s*\/dev\/sd/,               // Redirect to disks
      /chmod\s+777\s+\//,            // Chmod root
      /:(){ :|:& };:/,               // Fork bomb
    ];
    return dangerous.some(pattern => pattern.test(command));
  }
}
```

**2. edit_file** — Modification chirurgicale

```typescript
export class EditFileTool implements Tool {
  name = 'edit_file';
  description = `Edit a file by replacing specific text.
Use for: modifying code, fixing bugs, updating configurations.
Provide the exact text to find and the replacement text.`;

  inputSchema = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file' },
      old_text: { type: 'string', description: 'Exact text to find' },
      new_text: { type: 'string', description: 'Replacement text' },
      occurrence: {
        type: 'number',
        description: 'Which occurrence to replace (default: 1, 0 for all)',
        default: 1
      }
    },
    required: ['path', 'old_text', 'new_text']
  };

  requiresConfirmation = true;
  timeout = 10_000;

  async execute(args: {
    path: string;
    old_text: string;
    new_text: string;
    occurrence?: number;
  }) {
    const safePath = this.validatePath(args.path);

    // Lire le contenu actuel
    const content = await fs.readFile(safePath, 'utf-8');

    // Vérifier que old_text existe
    if (!content.includes(args.old_text)) {
      return {
        success: false,
        error: `Text not found in file: "${args.old_text.substring(0, 50)}..."`
      };
    }

    // Compter les occurrences
    const occurrences = content.split(args.old_text).length - 1;

    // Remplacer
    let newContent: string;
    if (args.occurrence === 0) {
      // Toutes les occurrences
      newContent = content.split(args.old_text).join(args.new_text);
    } else {
      // Occurrence spécifique
      const parts = content.split(args.old_text);
      const index = (args.occurrence ?? 1) - 1;
      if (index >= parts.length - 1) {
        return {
          success: false,
          error: `Occurrence ${args.occurrence} not found (only ${occurrences} occurrences)`
        };
      }
      parts[index] = parts[index] + args.new_text;
      newContent = parts.join(args.old_text);
      // Fix: need to properly rebuild
      const before = parts.slice(0, index + 1).join(args.old_text);
      const after = parts.slice(index + 1).join(args.old_text);
      newContent = before + after;
    }

    // Écrire le fichier
    await fs.writeFile(safePath, newContent, 'utf-8');

    return {
      success: true,
      output: `Replaced ${args.occurrence === 0 ? occurrences : 1} occurrence(s)`,
      metadata: {
        path: safePath,
        occurrencesFound: occurrences,
        occurrencesReplaced: args.occurrence === 0 ? occurrences : 1
      }
    };
  }
}
```

**3. multi_edit** — Éditions atomiques multiples

```typescript
export class MultiEditTool implements Tool {
  name = 'multi_edit';
  description = `Apply multiple edits to one or more files atomically.
All edits succeed or all fail. Use for refactoring across files.`;

  inputSchema = {
    type: 'object',
    properties: {
      edits: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            old_text: { type: 'string' },
            new_text: { type: 'string' }
          },
          required: ['path', 'old_text', 'new_text']
        },
        description: 'Array of edits to apply'
      }
    },
    required: ['edits']
  };

  requiresConfirmation = true;
  timeout = 30_000;

  async execute(args: { edits: Edit[] }) {
    // Phase 1 : Validation
    const backups: Map<string, string> = new Map();

    for (const edit of args.edits) {
      const safePath = this.validatePath(edit.path);
      const content = await fs.readFile(safePath, 'utf-8');

      if (!content.includes(edit.old_text)) {
        return {
          success: false,
          error: `Edit validation failed: text not found in ${edit.path}`
        };
      }

      backups.set(safePath, content);
    }

    // Phase 2 : Application
    const applied: string[] = [];

    try {
      for (const edit of args.edits) {
        const safePath = this.validatePath(edit.path);
        const content = backups.get(safePath)!;
        const newContent = content.replace(edit.old_text, edit.new_text);

        await fs.writeFile(safePath, newContent, 'utf-8');
        applied.push(safePath);
      }

      return {
        success: true,
        output: `Applied ${args.edits.length} edits to ${new Set(applied).size} files`,
        metadata: { filesModified: [...new Set(applied)] }
      };

    } catch (error) {
      // Phase 3 : Rollback en cas d'erreur
      for (const [path, content] of backups) {
        if (applied.includes(path)) {
          await fs.writeFile(path, content, 'utf-8');
        }
      }

      return {
        success: false,
        error: `Multi-edit failed, all changes rolled back: ${(error as Error).message}`
      };
    }
  }
}
```

---

## 10.4 Validation et Sécurité

### 10.4.1 Validation des arguments

```typescript
// src/tools/validator.ts
import Ajv from 'ajv';

export class ToolValidator {
  private ajv = new Ajv({ allErrors: true });

  validate(tool: Tool, args: unknown): ValidationResult {
    const schema = tool.inputSchema;

    // Compiler le schema
    const validate = this.ajv.compile(schema);

    // Valider
    const valid = validate(args);

    if (!valid) {
      return {
        valid: false,
        errors: validate.errors?.map(e => ({
          path: e.instancePath,
          message: e.message,
          keyword: e.keyword
        }))
      };
    }

    return { valid: true };
  }
}
```

### 10.4.2 Système de permissions

```typescript
// src/tools/permissions.ts
export enum Permission {
  READ = 'read',           // Lire des fichiers
  WRITE = 'write',         // Modifier des fichiers
  EXECUTE = 'execute',     // Exécuter des commandes
  NETWORK = 'network',     // Accès réseau
  SYSTEM = 'system'        // Opérations système
}

interface ToolPermissions {
  [toolName: string]: Permission[];
}

const TOOL_PERMISSIONS: ToolPermissions = {
  'read_file': [Permission.READ],
  'write_file': [Permission.WRITE],
  'edit_file': [Permission.READ, Permission.WRITE],
  'bash': [Permission.EXECUTE, Permission.READ, Permission.WRITE],
  'http_request': [Permission.NETWORK],
  'search_web': [Permission.NETWORK]
};

export class PermissionManager {
  private grantedPermissions: Set<Permission>;

  constructor(mode: 'read-only' | 'auto' | 'full-access') {
    switch (mode) {
      case 'read-only':
        this.grantedPermissions = new Set([Permission.READ]);
        break;
      case 'auto':
        this.grantedPermissions = new Set([
          Permission.READ,
          Permission.WRITE,
          Permission.EXECUTE
        ]);
        break;
      case 'full-access':
        this.grantedPermissions = new Set(Object.values(Permission));
        break;
    }
  }

  canExecute(toolName: string): boolean {
    const required = TOOL_PERMISSIONS[toolName] ?? [];
    return required.every(p => this.grantedPermissions.has(p));
  }

  getMissingPermissions(toolName: string): Permission[] {
    const required = TOOL_PERMISSIONS[toolName] ?? [];
    return required.filter(p => !this.grantedPermissions.has(p));
  }
}
```

### 10.4.3 Confirmation utilisateur

```typescript
// src/tools/confirmation.ts
export class ConfirmationService {
  private autoApprovePatterns: RegExp[] = [
    /^read_file$/,
    /^list_directory$/,
    /^search/,
    /^find_/
  ];

  async confirm(
    toolCall: ToolCall,
    mode: 'auto' | 'always' | 'never'
  ): Promise<ConfirmationResult> {
    // Mode never = tout approuver
    if (mode === 'never') {
      return { approved: true };
    }

    // Mode auto = approuver les outils safe
    if (mode === 'auto') {
      const isSafe = this.autoApprovePatterns.some(p => p.test(toolCall.name));
      if (isSafe) {
        return { approved: true };
      }
    }

    // Demander confirmation à l'utilisateur
    const formatted = this.formatToolCall(toolCall);
    console.log(`\n🔧 Tool: ${toolCall.name}`);
    console.log(`📝 Arguments: ${formatted}`);

    const answer = await this.prompt('Execute? [y/N/e(dit)] ');

    switch (answer.toLowerCase()) {
      case 'y':
      case 'yes':
        return { approved: true };
      case 'e':
      case 'edit':
        const edited = await this.editArguments(toolCall);
        return { approved: true, modifiedArgs: edited };
      default:
        return { approved: false, reason: 'User rejected' };
    }
  }
}
```

---

## 10.5 Orchestration des Outils

### 10.5.1 Tool Executor

```typescript
// src/tools/executor.ts
export class ToolExecutor {
  private tools: Map<string, Tool>;
  private validator: ToolValidator;
  private permissions: PermissionManager;
  private confirmation: ConfirmationService;

  async execute(toolCall: ToolCall): Promise<ToolResult> {
    const startTime = Date.now();

    // 1. Trouver l'outil
    const tool = this.tools.get(toolCall.name);
    if (!tool) {
      return {
        success: false,
        error: `Unknown tool: ${toolCall.name}`
      };
    }

    // 2. Parser les arguments
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(toolCall.arguments);
    } catch {
      return {
        success: false,
        error: 'Invalid JSON arguments'
      };
    }

    // 3. Valider les arguments
    const validation = this.validator.validate(tool, args);
    if (!validation.valid) {
      return {
        success: false,
        error: `Validation failed: ${validation.errors?.map(e => e.message).join(', ')}`
      };
    }

    // 4. Vérifier les permissions
    if (!this.permissions.canExecute(toolCall.name)) {
      const missing = this.permissions.getMissingPermissions(toolCall.name);
      return {
        success: false,
        error: `Permission denied. Missing: ${missing.join(', ')}`
      };
    }

    // 5. Demander confirmation si nécessaire
    if (tool.requiresConfirmation) {
      const conf = await this.confirmation.confirm(toolCall, this.confirmMode);
      if (!conf.approved) {
        return {
          success: false,
          error: `Execution cancelled: ${conf.reason}`
        };
      }
      if (conf.modifiedArgs) {
        args = conf.modifiedArgs;
      }
    }

    // 6. Exécuter avec timeout
    try {
      const result = await withTimeout(
        tool.execute(args),
        tool.timeout ?? 30_000
      );

      // 7. Logger pour audit
      await this.auditLog({
        tool: toolCall.name,
        args,
        result,
        duration: Date.now() - startTime
      });

      return result;

    } catch (error) {
      if (error instanceof TimeoutError) {
        return {
          success: false,
          error: `Tool execution timed out after ${tool.timeout}ms`
        };
      }
      return {
        success: false,
        error: `Execution failed: ${(error as Error).message}`
      };
    }
  }
}
```

### 10.5.2 Exécution parallèle

```typescript
// src/tools/parallel-executor.ts
export class ParallelToolExecutor {
  private executor: ToolExecutor;
  private maxConcurrency: number = 5;

  async executeParallel(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    // Analyser les dépendances
    const groups = this.groupByDependency(toolCalls);

    const results: ToolResult[] = [];

    // Exécuter groupe par groupe
    for (const group of groups) {
      // Dans chaque groupe, exécuter en parallèle
      const groupResults = await this.executeGroup(group);
      results.push(...groupResults);

      // Si une erreur critique, arrêter
      if (groupResults.some(r => !r.success && this.isCritical(r))) {
        break;
      }
    }

    return results;
  }

  private async executeGroup(calls: ToolCall[]): Promise<ToolResult[]> {
    // Limiter la concurrence
    const semaphore = new Semaphore(this.maxConcurrency);

    return Promise.all(
      calls.map(async call => {
        await semaphore.acquire();
        try {
          return await this.executor.execute(call);
        } finally {
          semaphore.release();
        }
      })
    );
  }

  private groupByDependency(calls: ToolCall[]): ToolCall[][] {
    // Regrouper les calls indépendants
    // Ex: Plusieurs read_file peuvent être parallèles
    // Mais write_file sur le même fichier doit être séquentiel

    const groups: ToolCall[][] = [];
    const seenPaths = new Set<string>();

    let currentGroup: ToolCall[] = [];

    for (const call of calls) {
      const paths = this.extractPaths(call);
      const hasConflict = paths.some(p => seenPaths.has(p));

      if (hasConflict) {
        // Nouvelle groupe
        if (currentGroup.length > 0) {
          groups.push(currentGroup);
        }
        currentGroup = [call];
        seenPaths.clear();
        paths.forEach(p => seenPaths.add(p));
      } else {
        currentGroup.push(call);
        paths.forEach(p => seenPaths.add(p));
      }
    }

    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }

    return groups;
  }
}
```

---

## 10.6 Gestion des Erreurs

### 10.6.1 Types d'erreurs

```typescript
// src/tools/errors.ts
export class ToolError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public recoverable: boolean = false,
    public suggestion?: string
  ) {
    super(message);
  }
}

export enum ErrorCode {
  // Validation
  INVALID_ARGUMENTS = 'INVALID_ARGUMENTS',
  MISSING_REQUIRED = 'MISSING_REQUIRED',

  // Permission
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  USER_REJECTED = 'USER_REJECTED',

  // Exécution
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  COMMAND_FAILED = 'COMMAND_FAILED',
  TIMEOUT = 'TIMEOUT',
  NETWORK_ERROR = 'NETWORK_ERROR',

  // Système
  OUT_OF_MEMORY = 'OUT_OF_MEMORY',
  DISK_FULL = 'DISK_FULL'
}
```

### 10.6.2 Récupération automatique

```typescript
// src/tools/recovery.ts
export class ToolRecovery {
  async attemptRecovery(
    error: ToolError,
    toolCall: ToolCall
  ): Promise<RecoveryAction> {
    switch (error.code) {
      case ErrorCode.FILE_NOT_FOUND:
        // Suggérer des fichiers similaires
        const similar = await this.findSimilarFiles(toolCall.arguments.path);
        if (similar.length > 0) {
          return {
            action: 'suggest_alternative',
            alternatives: similar,
            message: `File not found. Did you mean: ${similar[0]}?`
          };
        }
        break;

      case ErrorCode.TIMEOUT:
        // Suggérer de réessayer avec timeout plus long
        return {
          action: 'retry',
          modifiedArgs: {
            ...toolCall.arguments,
            timeout: (toolCall.arguments.timeout ?? 30000) * 2
          },
          message: 'Retrying with longer timeout'
        };

      case ErrorCode.PERMISSION_DENIED:
        return {
          action: 'request_permission',
          requiredPermissions: error.suggestion,
          message: 'Requesting additional permissions'
        };
    }

    return { action: 'fail', message: error.message };
  }
}
```

---

## 10.7 Bonnes Pratiques

### 10.7.1 Design des outils

| Faire | Ne pas faire |
|-------|--------------|
| Noms clairs et descriptifs | Noms cryptiques (`do_thing`) |
| Une responsabilité par outil | Outils fourre-tout |
| Descriptions détaillées | Descriptions vagues |
| Valeurs par défaut sensées | Exiger tous les paramètres |
| Messages d'erreur utiles | Erreurs génériques |

### 10.7.2 Sécurité

| Faire | Ne pas faire |
|-------|--------------|
| Valider tous les inputs | Faire confiance aux arguments |
| Limiter les permissions | Donner accès à tout |
| Confirmer les actions destructives | Auto-approuver les suppressions |
| Logger les exécutions | Exécuter silencieusement |
| Sandbox si possible | Exécuter dans l'environnement principal |

### 10.7.3 Performance

| Faire | Ne pas faire |
|-------|--------------|
| Timeout appropriés | Attendre indéfiniment |
| Exécution parallèle quand possible | Tout séquentiel |
| Tronquer les outputs longs | Retourner des MB de données |
| Cache les résultats répétés | Recalculer à chaque fois |

---

## Résumé

Dans ce chapitre, nous avons vu :

| Concept | Point clé |
|---------|-----------|
| **Interface Tool** | name, description, schema, execute |
| **Flow** | LLM → tool_call → execute → result → LLM |
| **41 outils** | Fichiers, shell, git, recherche, médias, docs |
| **Validation** | JSON Schema + permissions + confirmation |
| **Sécurité** | Path traversal, commandes dangereuses, sandbox |
| **Parallélisme** | Analyse dépendances + exécution concurrente |

---

## Exercices

1. **Implémentation** : Créez un outil `word_count` qui compte les mots dans un fichier.

2. **Sécurité** : Listez 10 commandes bash dangereuses et implémentez leur détection.

3. **Parallélisme** : Mesurez le speedup de l'exécution parallèle sur 10 `read_file`.

4. **Recovery** : Implémentez une stratégie de recovery pour les erreurs réseau.

---

## Pour aller plus loin

- OpenAI. "Function Calling Documentation"
- Anthropic. "Tool Use with Claude"
- Grok-CLI : `src/tools/`

---

*Prochainement : Chapitre 11 — Plugins & Dynamic Tool Loading*

