# Chapitre 11 — Plugins & Model Context Protocol 🔌

---

## 🎬 Scène d'ouverture

*Lina a 41 outils intégrés dans son agent. C'est beaucoup, mais ce n'est jamais assez.*

**Marc** : "J'ai besoin d'un outil pour interagir avec notre API interne."

**Sophie** *(du support)* : "Et moi avec Jira."

**Thomas** *(du SRE)* : "Et moi avec notre système de monitoring."

*Lina regarde la liste de demandes qui s'allonge. Elle ne peut pas tout coder elle-même.*

**Lina** : "Il me faut un système de plugins. Une façon pour chacun de créer et partager ses propres outils."

**Marc** : "Et si on utilisait **MCP** ? C'est le standard d'Anthropic pour connecter des outils aux LLMs. Il y a déjà tout un écosystème."

*Lina ouvre la documentation MCP. C'est exactement ce qu'il lui faut.*

---

## 📋 Table des matières

| Section | Titre | Description |
|:-------:|-------|-------------|
| 11.1 | 🏗️ Architecture des Plugins | Pourquoi et comment |
| 11.2 | 📦 Plugin Loader | Découverte et chargement |
| 11.3 | 🔗 Model Context Protocol | Le standard MCP |
| 11.4 | 🛠️ Intégration Grok-CLI | Configuration et usage |
| 11.5 | 🔧 Créer un Serveur MCP | Guide pratique |
| 11.6 | 🏪 Marketplace | Découverte et distribution |
| 11.7 | 🔒 Sécurité | Sandboxing et vérification |

---

## 11.1 🏗️ Architecture des Plugins

### 11.1.1 Le problème des outils figés

Un agent avec des outils hardcodés atteint vite ses limites :

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   🏗️ MONOLITHIQUE vs EXTENSIBLE                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ❌ AGENT MONOLITHIQUE                                                  │
│  ═══════════════════════                                                │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                  │   │
│  │  │ read │ │write │ │ bash │ │ git  │ │search│  ...             │   │
│  │  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘                  │   │
│  │                                                                 │   │
│  │  Problèmes :                                                    │   │
│  │  • Nouvel outil = modifier le code source                      │   │
│  │  • Rebuild, redeploy à chaque ajout                            │   │
│  │  • Maintenance centralisée (bottleneck)                        │   │
│  │  • Pas de personnalisation par projet                          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ✅ AGENT EXTENSIBLE (plugins)                                          │
│  ═══════════════════════════════                                        │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                                                                 │   │
│  │   CORE              PLUGINS (chargés dynamiquement)            │   │
│  │   ┌──────┐          ┌──────────────────────────────────────┐   │   │
│  │   │Agent │ ◄──────► │ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ │   │   │
│  │   │ API  │   MCP    │ │ Jira │ │Slack │ │GitHub│ │Custom│ │   │   │
│  │   └──────┘          │ └──────┘ └──────┘ └──────┘ └──────┘ │   │   │
│  │                     └──────────────────────────────────────┘   │   │
│  │                                                                 │   │
│  │  Avantages :                                                    │   │
│  │  • Nouvel outil = créer un plugin externe                      │   │
│  │  • Pas de rebuild de l'agent                                   │   │
│  │  • Maintenance décentralisée (communauté)                      │   │
│  │  • Personnalisation par projet                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 11.1.2 Interface Plugin

```typescript
// src/plugins/types.ts

export interface Plugin {
  // 🏷️ Métadonnées
  id: string;                    // Identifiant unique
  name: string;                  // Nom affichable
  version: string;               // Version semver
  description: string;           // Description
  author?: string;               // Auteur

  // 🔧 Outils fournis
  tools: Tool[];

  // 🔄 Lifecycle
  initialize?(context: PluginContext): Promise<void>;
  shutdown?(): Promise<void>;

  // ⚙️ Configuration
  configSchema?: JSONSchema;
  configure?(config: unknown): Promise<void>;
}

export interface PluginContext {
  agent: AgentInterface;         // Accès à l'agent
  config: PluginConfig;          // Configuration
  logger: Logger;                // Logger dédié
  storage: PluginStorage;        // Storage persistant
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  main: string;                  // Point d'entrée
  tools: ToolDefinition[];       // Outils déclarés
  permissions: Permission[];     // Permissions requises
  dependencies?: string[];       // Dépendances
}
```

| Champ | Type | Description |
|-------|------|-------------|
| `id` | string | Identifiant unique (kebab-case) |
| `name` | string | Nom affichable |
| `version` | string | Version semver (1.2.3) |
| `tools` | Tool[] | Liste des outils exposés |
| `initialize` | function | Appelée au chargement |
| `shutdown` | function | Appelée à la fermeture |

### 11.1.3 Exemple de plugin simple

```typescript
// plugins/hello-world/index.ts
import { Plugin, Tool, PluginContext } from '@grok-cli/plugin-sdk';

export default class HelloWorldPlugin implements Plugin {
  id = 'hello-world';
  name = 'Hello World Plugin';
  version = '1.0.0';
  description = 'A simple example plugin';

  tools: Tool[] = [
    {
      name: 'say_hello',
      description: 'Say hello to someone',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name to greet' }
        },
        required: ['name']
      },
      async execute(args: { name: string }) {
        return {
          success: true,
          output: `Hello, ${args.name}! 👋 This message comes from a plugin.`
        };
      }
    }
  ];

  async initialize(context: PluginContext): Promise<void> {
    context.logger.info('🎉 Hello World plugin initialized');
  }

  async shutdown(): Promise<void> {
    // Cleanup if needed
  }
}
```

---

## 11.2 📦 Plugin Loader

### 11.2.1 Découverte des plugins

Le loader cherche les plugins dans plusieurs emplacements :

```typescript
// src/plugins/loader.ts

export class PluginLoader {
  private pluginDirs: string[] = [
    path.join(os.homedir(), '.grok/plugins'),   // 👤 User plugins
    path.join(process.cwd(), '.grok/plugins'),  // 📁 Project plugins
    path.join(__dirname, '../builtin-plugins')  // 🏠 Builtin plugins
  ];

  async discoverPlugins(): Promise<PluginManifest[]> {
    const manifests: PluginManifest[] = [];

    for (const dir of this.pluginDirs) {
      if (!await this.exists(dir)) continue;

      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const manifestPath = path.join(dir, entry.name, 'manifest.json');
        if (await this.exists(manifestPath)) {
          const manifest = await this.loadManifest(manifestPath);
          manifest._path = path.join(dir, entry.name);
          manifests.push(manifest);
        }
      }
    }

    return manifests;
  }

  async loadPlugin(manifest: PluginManifest): Promise<Plugin> {
    const mainPath = path.join(manifest._path, manifest.main);

    // 1️⃣ Vérifier les permissions
    await this.checkPermissions(manifest);

    // 2️⃣ Charger le module
    const module = await import(mainPath);
    const PluginClass = module.default || module[manifest.id];

    if (!PluginClass) {
      throw new Error(`Plugin ${manifest.id} has no default export`);
    }

    // 3️⃣ Instancier
    const plugin = new PluginClass() as Plugin;

    // 4️⃣ Valider
    this.validatePlugin(plugin, manifest);

    return plugin;
  }
}
```

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    📁 STRUCTURE D'UN PLUGIN                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ~/.grok/plugins/                                                      │
│  └── my-plugin/                                                        │
│      ├── manifest.json      # 📋 Métadonnées et déclarations          │
│      ├── index.ts           # 🔧 Point d'entrée                        │
│      ├── package.json       # 📦 Dépendances (optionnel)               │
│      └── tools/                                                        │
│          ├── tool-one.ts    # 🔨 Implémentation outil 1                │
│          └── tool-two.ts    # 🔨 Implémentation outil 2                │
│                                                                         │
│  manifest.json :                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  {                                                               │   │
│  │    "id": "my-plugin",                                           │   │
│  │    "name": "My Custom Plugin",                                  │   │
│  │    "version": "1.0.0",                                          │   │
│  │    "main": "index.ts",                                          │   │
│  │    "tools": [                                                   │   │
│  │      { "name": "tool_one", "description": "..." },              │   │
│  │      { "name": "tool_two", "description": "..." }               │   │
│  │    ],                                                           │   │
│  │    "permissions": ["read", "network"]                           │   │
│  │  }                                                               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 11.2.2 Plugin Manager

```typescript
// src/plugins/manager.ts

export class PluginManager {
  private loader: PluginLoader;
  private plugins: Map<string, LoadedPlugin> = new Map();
  private tools: Map<string, Tool> = new Map();

  async loadAllPlugins(): Promise<void> {
    const manifests = await this.loader.discoverPlugins();

    for (const manifest of manifests) {
      try {
        await this.loadPlugin(manifest);
        console.log(`✅ Loaded plugin: ${manifest.name}`);
      } catch (error) {
        console.warn(`⚠️ Failed to load ${manifest.id}:`, error);
      }
    }
  }

  async loadPlugin(manifest: PluginManifest): Promise<void> {
    if (this.plugins.has(manifest.id)) {
      throw new Error(`Plugin ${manifest.id} already loaded`);
    }

    const plugin = await this.loader.loadPlugin(manifest);

    // Créer le contexte
    const context: PluginContext = {
      agent: this.agentInterface,
      config: await this.loadPluginConfig(manifest.id),
      logger: new PluginLogger(manifest.id),
      storage: new PluginStorage(manifest.id)
    };

    // Initialiser
    if (plugin.initialize) {
      await plugin.initialize(context);
    }

    // Configurer
    if (plugin.configure && context.config) {
      await plugin.configure(context.config);
    }

    // Enregistrer les outils avec namespace
    for (const tool of plugin.tools) {
      const namespacedName = `${manifest.id}:${tool.name}`;
      this.tools.set(namespacedName, tool);
    }

    this.plugins.set(manifest.id, { plugin, manifest, context });
  }

  async unloadPlugin(id: string): Promise<void> {
    const loaded = this.plugins.get(id);
    if (!loaded) return;

    // Shutdown
    if (loaded.plugin.shutdown) {
      await loaded.plugin.shutdown();
    }

    // Retirer les outils
    for (const tool of loaded.plugin.tools) {
      this.tools.delete(`${id}:${tool.name}`);
    }

    this.plugins.delete(id);
    console.log(`🗑️ Unloaded plugin: ${id}`);
  }

  getTools(): Tool[] {
    return Array.from(this.tools.values());
  }
}
```

---

## 11.3 🔗 Model Context Protocol (MCP)

### 11.3.1 Qu'est-ce que MCP ?

**MCP** est un protocole standardisé par Anthropic pour connecter des outils aux LLMs. Il définit comment un **client** (l'agent) communique avec un **serveur** (les outils).

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    🔗 MODEL CONTEXT PROTOCOL                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌─────────────────┐                    ┌─────────────────┐           │
│   │     CLIENT      │ ◄────── MCP ─────► │     SERVER      │           │
│   │  (Grok Agent)   │    JSON-RPC 2.0    │  (Outil/API)    │           │
│   └─────────────────┘                    └─────────────────┘           │
│                                                                         │
│  ════════════════════════════════════════════════════════════════════  │
│  FONCTIONNALITÉS MCP                                                   │
│  ════════════════════════════════════════════════════════════════════  │
│                                                                         │
│  🔧 Tools                                                              │
│     Serveur expose des outils que le LLM peut appeler                  │
│                                                                         │
│  📄 Resources                                                          │
│     Serveur expose des ressources (fichiers, configs, data)            │
│                                                                         │
│  📝 Prompts                                                            │
│     Templates de prompts pré-définis                                   │
│                                                                         │
│  🤖 Sampling                                                           │
│     Serveur peut demander au LLM de générer du texte                   │
│                                                                         │
│  ════════════════════════════════════════════════════════════════════  │
│  TRANSPORTS SUPPORTÉS                                                  │
│  ════════════════════════════════════════════════════════════════════  │
│                                                                         │
│  📟 stdio     Communication via stdin/stdout (process local)           │
│  🌐 HTTP      API REST (serveur distant)                               │
│  📡 SSE       Server-Sent Events (streaming)                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

| Feature | Description | Exemple |
|---------|-------------|---------|
| 🔧 **Tools** | Outils appelables | `get_weather`, `query_database` |
| 📄 **Resources** | Données accessibles | `config://settings`, `file://log` |
| 📝 **Prompts** | Templates réutilisables | `code_review`, `explain` |
| 🤖 **Sampling** | Génération LLM | Demander une complétion |

### 11.3.2 Structure des messages

MCP utilise JSON-RPC 2.0 :

```typescript
// Types MCP

// Requête
interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

// Réponse
interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// Méthodes principales
type MCPMethod =
  | 'initialize'           // 🤝 Handshake initial
  | 'tools/list'           // 🔧 Lister les outils
  | 'tools/call'           // ▶️ Appeler un outil
  | 'resources/list'       // 📄 Lister les ressources
  | 'resources/read'       // 📖 Lire une ressource
  | 'prompts/list'         // 📝 Lister les prompts
  | 'prompts/get';         // 📥 Obtenir un prompt
```

### 11.3.3 Client MCP

```typescript
// src/mcp/client.ts

export class MCPClient {
  private transport: MCPTransport;
  private serverInfo: ServerInfo | null = null;

  constructor(transport: MCPTransport) {
    this.transport = transport;
  }

  async connect(): Promise<void> {
    await this.transport.connect();

    // 🤝 Handshake
    const response = await this.request('initialize', {
      protocolVersion: '0.1.0',
      clientInfo: {
        name: 'grok-cli',
        version: '1.0.0'
      },
      capabilities: {
        tools: {},
        resources: {},
        prompts: {}
      }
    });

    this.serverInfo = response.serverInfo;
    console.log(`🔗 Connected to MCP server: ${this.serverInfo.name}`);
  }

  async listTools(): Promise<MCPTool[]> {
    const response = await this.request('tools/list', {});
    return response.tools;
  }

  async callTool(name: string, args: unknown): Promise<MCPToolResult> {
    return this.request('tools/call', { name, arguments: args });
  }

  async listResources(): Promise<MCPResource[]> {
    const response = await this.request('resources/list', {});
    return response.resources;
  }

  async readResource(uri: string): Promise<MCPResourceContent> {
    return this.request('resources/read', { uri });
  }

  async disconnect(): Promise<void> {
    await this.transport.disconnect();
  }

  private async request(method: string, params: unknown): Promise<any> {
    const id = Date.now().toString();
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params
    };
    return this.transport.send(request);
  }
}
```

### 11.3.4 Transports

```typescript
// src/mcp/transports/stdio.ts

/**
 * Transport stdio : le serveur MCP tourne comme un process local
 * et communique via stdin/stdout.
 */
export class StdioTransport implements MCPTransport {
  private process: ChildProcess | null = null;
  private buffer = '';
  private handlers = new Map<string | number, (response: any) => void>();

  constructor(
    private command: string,
    private args: string[] = [],
    private options: SpawnOptions = {}
  ) {}

  async connect(): Promise<void> {
    this.process = spawn(this.command, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      ...this.options
    });

    // Écouter stdout
    this.process.stdout!.on('data', (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    // Écouter stderr (logs du serveur)
    this.process.stderr!.on('data', (data: Buffer) => {
      console.error(`[MCP] ${data.toString().trim()}`);
    });

    this.process.on('exit', (code) => {
      console.log(`[MCP] Server exited with code ${code}`);
    });
  }

  async send(request: MCPRequest): Promise<MCPResponse> {
    return new Promise((resolve, reject) => {
      this.handlers.set(request.id, resolve);

      // Envoyer la requête
      const message = JSON.stringify(request) + '\n';
      this.process!.stdin!.write(message);

      // Timeout
      setTimeout(() => {
        if (this.handlers.has(request.id)) {
          this.handlers.delete(request.id);
          reject(new Error('MCP request timeout'));
        }
      }, 30_000);
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const message = JSON.parse(line);
        const handler = this.handlers.get(message.id);
        if (handler) {
          this.handlers.delete(message.id);
          handler(message);
        }
      } catch {
        console.error('[MCP] Failed to parse:', line);
      }
    }
  }

  async disconnect(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}

// src/mcp/transports/http.ts

/**
 * Transport HTTP : le serveur MCP tourne comme service HTTP.
 */
export class HTTPTransport implements MCPTransport {
  constructor(private baseUrl: string) {}

  async connect(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/health`);
    if (!response.ok) {
      throw new Error(`MCP server not healthy: ${response.status}`);
    }
  }

  async send(request: MCPRequest): Promise<MCPResponse> {
    const response = await fetch(`${this.baseUrl}/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    return response.json();
  }

  async disconnect(): Promise<void> {
    // HTTP is stateless
  }
}
```

---

## 11.4 🛠️ Intégration Grok-CLI

### 11.4.1 Configuration MCP

```json
// .grok/mcp.json
{
  "servers": [
    {
      "id": "filesystem",
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-filesystem"],
      "enabled": true
    },
    {
      "id": "github",
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-github"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      },
      "enabled": true
    },
    {
      "id": "postgres",
      "url": "http://localhost:3001",
      "transport": "http",
      "enabled": false
    },
    {
      "id": "custom",
      "command": "./my-mcp-server",
      "cwd": "/path/to/server",
      "enabled": true
    }
  ]
}
```

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    ⚙️ CONFIGURATION MCP                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Serveurs officiels Anthropic :                                        │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  @anthropic/mcp-server-filesystem    📁 Accès fichiers          │   │
│  │  @anthropic/mcp-server-github        🐙 API GitHub              │   │
│  │  @anthropic/mcp-server-slack         💬 API Slack               │   │
│  │  @anthropic/mcp-server-postgres      🗃️ Base de données         │   │
│  │  @anthropic/mcp-server-fetch         🌐 HTTP requests           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Options de configuration :                                            │
│  ┌────────────────┬────────────────────────────────────────────────┐   │
│  │ id             │ Identifiant unique du serveur                  │   │
│  │ command        │ Commande pour lancer (stdio)                   │   │
│  │ args           │ Arguments de la commande                       │   │
│  │ url            │ URL du serveur (HTTP)                          │   │
│  │ env            │ Variables d'environnement                      │   │
│  │ cwd            │ Répertoire de travail                          │   │
│  │ enabled        │ Activer/désactiver                             │   │
│  └────────────────┴────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 11.4.2 MCP Manager

```typescript
// src/mcp/manager.ts

export class MCPManager {
  private clients: Map<string, MCPClient> = new Map();
  private tools: Map<string, { client: MCPClient; tool: MCPTool }> = new Map();

  async loadConfig(configPath: string): Promise<void> {
    const config = JSON.parse(await fs.readFile(configPath, 'utf-8'));

    for (const server of config.servers) {
      if (!server.enabled) continue;

      try {
        await this.connectServer(server);
      } catch (error) {
        console.warn(`⚠️ Failed to connect ${server.id}:`, error);
      }
    }
  }

  private async connectServer(config: MCPServerConfig): Promise<void> {
    // Créer le transport
    let transport: MCPTransport;

    if (config.url) {
      transport = new HTTPTransport(config.url);
    } else if (config.command) {
      const env = this.resolveEnv(config.env || {});
      transport = new StdioTransport(config.command, config.args || [], {
        cwd: config.cwd,
        env: { ...process.env, ...env }
      });
    } else {
      throw new Error(`Invalid config for ${config.id}`);
    }

    // Connecter
    const client = new MCPClient(transport);
    await client.connect();

    this.clients.set(config.id, client);

    // Découvrir les outils
    const tools = await client.listTools();
    for (const tool of tools) {
      const fullName = `mcp:${config.id}:${tool.name}`;
      this.tools.set(fullName, { client, tool });
    }

    console.log(`✅ MCP ${config.id}: ${tools.length} tools`);
  }

  /**
   * Résout les variables d'environnement ${VAR}.
   */
  private resolveEnv(env: Record<string, string>): Record<string, string> {
    const resolved: Record<string, string> = {};

    for (const [key, value] of Object.entries(env)) {
      resolved[key] = value.replace(/\$\{(\w+)\}/g, (_, name) =>
        process.env[name] || ''
      );
    }

    return resolved;
  }

  /**
   * Retourne tous les outils MCP comme des Tool standards.
   */
  getTools(): Tool[] {
    return Array.from(this.tools.entries()).map(([name, { tool }]) => ({
      name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      execute: async (args) => this.executeTool(name, args)
    }));
  }

  private async executeTool(fullName: string, args: unknown): Promise<ToolResult> {
    const entry = this.tools.get(fullName);
    if (!entry) {
      return { success: false, error: `Tool not found: ${fullName}` };
    }

    const { client, tool } = entry;

    try {
      const result = await client.callTool(tool.name, args);

      if (result.isError) {
        return {
          success: false,
          error: result.content[0]?.text || 'Unknown error'
        };
      }

      const output = result.content
        .map(c => c.type === 'text' ? c.text : `[${c.type}]`)
        .join('\n');

      return { success: true, output };

    } catch (error) {
      return {
        success: false,
        error: `MCP call failed: ${(error as Error).message}`
      };
    }
  }

  async shutdown(): Promise<void> {
    for (const [id, client] of this.clients) {
      try {
        await client.disconnect();
      } catch (error) {
        console.warn(`Error disconnecting ${id}:`, error);
      }
    }
    this.clients.clear();
    this.tools.clear();
  }
}
```

---

## 11.5 🔧 Créer un Serveur MCP

### 11.5.1 Structure de base

```typescript
// my-mcp-server/index.ts

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new Server(
  {
    name: 'my-custom-server',
    version: '1.0.0'
  },
  {
    capabilities: {
      tools: {},
      resources: {}
    }
  }
);

// 🔧 Déclarer les outils
server.setRequestHandler('tools/list', async () => ({
  tools: [
    {
      name: 'get_weather',
      description: 'Get current weather for a city',
      inputSchema: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City name' }
        },
        required: ['city']
      }
    },
    {
      name: 'get_forecast',
      description: 'Get 5-day weather forecast',
      inputSchema: {
        type: 'object',
        properties: {
          city: { type: 'string' },
          days: { type: 'number', default: 5 }
        },
        required: ['city']
      }
    }
  ]
}));

// ▶️ Implémenter les outils
server.setRequestHandler('tools/call', async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'get_weather': {
      const weather = await fetchWeatherAPI(args.city);
      return {
        content: [{
          type: 'text',
          text: `☀️ Weather in ${args.city}: ${weather.temp}°C, ${weather.condition}`
        }]
      };
    }

    case 'get_forecast': {
      const forecast = await fetchForecastAPI(args.city, args.days);
      return {
        content: [{
          type: 'text',
          text: formatForecast(forecast)
        }]
      };
    }

    default:
      return {
        isError: true,
        content: [{ type: 'text', text: `Unknown tool: ${name}` }]
      };
  }
});

// 🚀 Démarrer
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('🚀 MCP server running on stdio');
}

main();
```

### 11.5.2 Serveur avec ressources

```typescript
// 📄 Exposer des ressources
server.setRequestHandler('resources/list', async () => ({
  resources: [
    {
      uri: 'config://app/settings',
      name: 'Application Settings',
      description: 'Current application configuration',
      mimeType: 'application/json'
    },
    {
      uri: 'log://app/recent',
      name: 'Recent Logs',
      description: 'Last 100 log entries',
      mimeType: 'text/plain'
    },
    {
      uri: 'metrics://app/dashboard',
      name: 'Dashboard Metrics',
      description: 'Current performance metrics',
      mimeType: 'application/json'
    }
  ]
}));

// 📖 Lire les ressources
server.setRequestHandler('resources/read', async (request) => {
  const { uri } = request.params;

  if (uri === 'config://app/settings') {
    const settings = await loadSettings();
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(settings, null, 2)
      }]
    };
  }

  if (uri === 'log://app/recent') {
    const logs = await getRecentLogs(100);
    return {
      contents: [{
        uri,
        mimeType: 'text/plain',
        text: logs.join('\n')
      }]
    };
  }

  if (uri === 'metrics://app/dashboard') {
    const metrics = await getMetrics();
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(metrics, null, 2)
      }]
    };
  }

  throw new Error(`Resource not found: ${uri}`);
});
```

---

## 11.6 🏪 Marketplace de Plugins

### 11.6.1 CLI pour les plugins

```typescript
// src/commands/plugin-commands.ts

export const pluginCommands = {
  'plugin:list': async () => {
    const manager = getPluginManager();
    const plugins = manager.listPlugins();

    console.log('\n📦 Installed Plugins:\n');
    for (const p of plugins) {
      console.log(`  ${p.id} v${p.version}`);
      console.log(`    ${p.description}\n`);
    }
  },

  'plugin:search': async (query: string) => {
    const marketplace = new PluginMarketplace();
    const results = await marketplace.search(query);

    console.log(`\n🔍 Results for "${query}":\n`);
    for (const p of results) {
      console.log(`  ${p.id} v${p.version}`);
      console.log(`    ${p.description}`);
      console.log(`    ⭐ ${p.rating} | 📥 ${p.downloads}\n`);
    }
  },

  'plugin:install': async (pluginId: string) => {
    console.log(`📥 Installing ${pluginId}...`);

    const marketplace = new PluginMarketplace();
    await marketplace.install(pluginId);

    // Recharger
    const manager = getPluginManager();
    await manager.reloadPlugins();

    console.log(`✅ Plugin ${pluginId} installed`);
  },

  'plugin:uninstall': async (pluginId: string) => {
    const manager = getPluginManager();
    await manager.unloadPlugin(pluginId);

    const marketplace = new PluginMarketplace();
    await marketplace.uninstall(pluginId);

    console.log(`🗑️ Plugin ${pluginId} uninstalled`);
  }
};
```

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    🏪 COMMANDES PLUGIN                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Commande                     Description                              │
│  ─────────────────────────────────────────────────────────────────     │
│  grok plugin:list             Lister les plugins installés             │
│  grok plugin:search <query>   Chercher des plugins                     │
│  grok plugin:install <id>     Installer un plugin                      │
│  grok plugin:uninstall <id>   Désinstaller un plugin                   │
│  grok plugin:update <id>      Mettre à jour un plugin                  │
│                                                                         │
│  Exemples :                                                             │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  $ grok plugin:search jira                                      │   │
│  │  🔍 Results for "jira":                                          │   │
│  │                                                                  │   │
│  │    jira-tools v2.1.0                                            │   │
│  │      Create and manage Jira issues                              │   │
│  │      ⭐ 4.5 | 📥 12,340                                          │   │
│  │                                                                  │   │
│  │  $ grok plugin:install jira-tools                               │   │
│  │  📥 Installing jira-tools...                                     │   │
│  │  ✅ Plugin jira-tools installed                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 11.7 🔒 Sécurité des Plugins

### 11.7.1 Système de permissions

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    🔒 PERMISSIONS PLUGINS                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Permission      Description                    Risque                 │
│  ─────────────────────────────────────────────────────────────────     │
│  read            Lire des fichiers             🟢 Faible               │
│  write           Écrire des fichiers           🟡 Moyen                │
│  execute         Exécuter des commandes        🔴 Élevé                │
│  network         Accès réseau                  🔴 Élevé                │
│  system          Opérations système            🔴 Critique             │
│                                                                         │
│  Politique d'approbation :                                             │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  🟢 read : Auto-approuvé                                        │   │
│  │  🟡 write : Demande confirmation                                │   │
│  │  🔴 execute, network, system : Demande confirmation + warning   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 11.7.2 Sandboxing

```typescript
// src/plugins/sandbox.ts

import { VM } from 'vm2';

export class PluginSandbox {
  private vm: VM;

  constructor(permissions: Permission[]) {
    this.vm = new VM({
      timeout: 30_000,
      sandbox: this.buildSandbox(permissions),
      eval: false,
      wasm: false
    });
  }

  private buildSandbox(permissions: Permission[]): object {
    const sandbox: any = {
      // Console limitée
      console: {
        log: (...args: any[]) => console.log('[Plugin]', ...args),
        error: (...args: any[]) => console.error('[Plugin]', ...args)
      }
    };

    // Ajouter les APIs selon les permissions
    if (permissions.includes('network')) {
      sandbox.fetch = this.sandboxedFetch.bind(this);
    }

    if (permissions.includes('filesystem')) {
      sandbox.fs = this.sandboxedFs();
    }

    return sandbox;
  }

  private sandboxedFetch(url: string, options?: RequestInit): Promise<Response> {
    // 🔒 Bloquer l'accès au réseau local
    const blocked = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
    const parsed = new URL(url);

    if (blocked.some(b => parsed.hostname.includes(b))) {
      throw new Error('🚫 Access to local network blocked');
    }

    return fetch(url, options);
  }

  private sandboxedFs() {
    // 🔒 Limiter l'accès au répertoire du plugin
    const allowedDir = path.join(os.homedir(), '.grok/plugin-data');

    return {
      readFile: async (filePath: string) => {
        const resolved = path.resolve(allowedDir, filePath);
        if (!resolved.startsWith(allowedDir)) {
          throw new Error('🚫 Access outside allowed directory');
        }
        return fs.readFile(resolved, 'utf-8');
      },
      writeFile: async (filePath: string, content: string) => {
        const resolved = path.resolve(allowedDir, filePath);
        if (!resolved.startsWith(allowedDir)) {
          throw new Error('🚫 Access outside allowed directory');
        }
        return fs.writeFile(resolved, content);
      }
    };
  }

  run(code: string): unknown {
    return this.vm.run(code);
  }
}
```

### 11.7.3 Vérification des signatures

```typescript
// src/plugins/verification.ts

import * as crypto from 'crypto';

export class PluginVerifier {
  private trustedKeys: string[] = [];

  async verify(pluginPath: string): Promise<VerificationResult> {
    const manifestPath = path.join(pluginPath, 'manifest.json');
    const signaturePath = path.join(pluginPath, 'manifest.sig');

    // Vérifier que la signature existe
    if (!await this.exists(signaturePath)) {
      return {
        verified: false,
        reason: '⚠️ No signature found (unsigned plugin)'
      };
    }

    // Lire et vérifier
    const manifest = await fs.readFile(manifestPath);
    const signature = await fs.readFile(signaturePath);

    for (const publicKey of this.trustedKeys) {
      const verify = crypto.createVerify('SHA256');
      verify.update(manifest);

      if (verify.verify(publicKey, signature)) {
        return {
          verified: true,
          signer: this.getKeyId(publicKey)
        };
      }
    }

    return {
      verified: false,
      reason: '❌ Signature verification failed'
    };
  }
}
```

---

## 📝 Points Clés

| Concept | Point clé |
|---------|-----------|
| 🔌 **Plugins** | Extension dynamique sans rebuild |
| 📦 **Interface** | id, tools, initialize, shutdown |
| 🔗 **MCP** | Standard Anthropic (JSON-RPC 2.0) |
| 📟 **Transports** | stdio (local) ou HTTP (distant) |
| 🏪 **Marketplace** | search, install, uninstall |
| 🔒 **Sécurité** | Permissions, sandbox, signatures |

---

## 🏋️ Exercices

### Exercice 1 : Plugin simple
**Objectif** : Créer un plugin `random_joke`

```typescript
// Créer un plugin qui expose un outil random_joke
// Utilise l'API https://official-joke-api.appspot.com/random_joke
```

### Exercice 2 : Serveur MCP
**Objectif** : Créer un serveur MCP pour vos bookmarks

| Resource | URI | Description |
|----------|-----|-------------|
| Tous les bookmarks | `bookmarks://all` | Liste complète |
| Par catégorie | `bookmarks://category/{cat}` | Filtré |

### Exercice 3 : Sécurité
**Objectif** : Identifier les risques

| Risque | Impact | Mitigation |
|--------|--------|------------|
| 1. | | |
| 2. | | |
| 3. | | |
| 4. | | |
| 5. | | |

### Exercice 4 : Manifest
**Objectif** : Concevoir le schéma JSON du registry

```json
// Votre schéma PluginRegistryEntry
{
  "id": "...",
  // ...
}
```

---

## 📚 Références

| Type | Référence |
|------|-----------|
| 📖 Spec | Anthropic. "Model Context Protocol Specification" |
| 💻 Code | Grok-CLI : `src/plugins/`, `src/mcp/` |
| 📦 NPM | @modelcontextprotocol/sdk |

---

## 🌅 Épilogue

*Quelques semaines plus tard. Standup du lundi matin.*

**Marc** : "J'ai publié un plugin pour notre API interne. Installez-le avec `grok plugin:install internal-api`."

**Sophie** : "Le plugin Jira marche super bien. J'ai pu créer 20 tickets en 5 minutes."

**Thomas** : "J'ai connecté notre monitoring via MCP. L'agent peut maintenant lire les métriques en direct."

**Lina** *(souriant)* : "Le système de plugins a changé la donne. Chacun peut étendre l'agent selon ses besoins."

*Mais son sourire s'efface quand elle regarde les métriques de la semaine dernière.*

**Lina** : "Par contre... regardez ça."

*Elle affiche un graphique sur l'écran.*

```
📊 Métriques de la semaine :
├── Requêtes totales     : 3,247
├── Coût API             : $847.32
├── Latence moyenne      : 2.8 secondes
└── Requêtes identiques  : 41% (!!)
```

**Marc** *(fronçant les sourcils)* : "41% de requêtes identiques ?"

**Lina** : "Les mêmes questions, encore et encore. 'Comment lancer les tests ?' — 156 fois. 'Où est le fichier de config ?' — 89 fois."

**Thomas** : "Et on paye l'API à chaque fois ?"

**Lina** : "À chaque fois. Même question, même réponse, même coût."

*Un silence s'installe.*

**Sophie** : "On ne peut pas... cacher les réponses ?"

**Lina** *(les yeux brillants)* : "Si. Mais pas un cache bête. Un cache **sémantique**. Qui comprend que 'lance les tests' et 'run npm test' c'est la même question."

*Elle ouvre son laptop.*

**Lina** : "J'ai lu un papier là-dessus ce week-end. On peut réduire les appels API de 68% sans perdre en qualité. Avec le bon système de cache et quelques optimisations cognitives."

**Marc** : "Cognitives ?"

**Lina** : "Des optimisations qui touchent à **comment** le modèle réfléchit, pas juste à combien de fois on l'appelle."

*Elle ferme le standup.*

**Lina** : "On se retrouve cet après-midi. J'ai des choses à vous montrer."

---

*Fin de la Partie IV — Action et Outils*

---

**À suivre** : *Chapitre 12 — Optimisations Cognitives*

*$847 de coûts API en une semaine. 41% de requêtes redondantes. Lina découvre que la clé n'est pas de faire plus — mais de faire moins, plus intelligemment. Bienvenue dans le monde du cache sémantique.*

---

<div align="center">

**← [Chapitre 10 : Tool-Use](10-tool-use.md)** | **[Sommaire](README.md)** | **[Chapitre 12 : Optimisations Cognitives](12-optimisations-cognitives.md) →**

</div>
