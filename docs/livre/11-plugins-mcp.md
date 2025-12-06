# Chapitre 11 — Plugins & Dynamic Tool Loading

---

> **Scène**
>
> *Lina a 41 outils intégrés dans son agent. C'est beaucoup, mais ce n'est jamais assez.*
>
> *"J'ai besoin d'un outil pour interagir avec notre API interne," dit son collègue Marc.*
>
> *"Et moi avec Jira," ajoute Sophie du support.*
>
> *"Et moi avec notre système de monitoring," enchérit Thomas du SRE.*
>
> *Lina ne peut pas tout coder elle-même. Elle a besoin d'un système de plugins — une façon pour les autres de créer et de partager leurs propres outils.*
>
> *"Et si on utilisait MCP ?" suggère Marc. "C'est le standard d'Anthropic pour ça."*

---

## Introduction

Un agent figé avec des outils hardcodés atteint vite ses limites. Les **plugins** permettent d'étendre dynamiquement les capacités de l'agent sans modifier son code source.

**MCP** (Model Context Protocol) est le standard émergent pour connecter des outils aux LLMs. Ce chapitre explore l'architecture des plugins et l'intégration de MCP.

---

## 11.1 Architecture des Plugins

### 11.1.1 Pourquoi des plugins ?

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PROBLÈME DES OUTILS HARDCODÉS                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   AGENT MONOLITHIQUE                                                │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │                                                              │   │
│   │   ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐            │   │
│   │   │ read │ │write │ │ bash │ │ git  │ │search│  ...        │   │
│   │   └──────┘ └──────┘ └──────┘ └──────┘ └──────┘            │   │
│   │                                                              │   │
│   │   + Nouvel outil = modifier le code source                   │   │
│   │   + Rebuild, redeploy                                        │   │
│   │   + Maintenance centralisée                                  │   │
│   │                                                              │   │
│   └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│   VS                                                                │
│                                                                      │
│   AGENT EXTENSIBLE                                                  │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │                                                              │   │
│   │   CORE           PLUGINS                                     │   │
│   │   ┌──────┐       ┌──────────────────────────────────────┐   │   │
│   │   │Agent │ ◄───► │ ┌──────┐ ┌──────┐ ┌──────┐ ...      │   │   │
│   │   │ API  │       │ │ Jira │ │Slack │ │Custom│          │   │   │
│   │   └──────┘       │ └──────┘ └──────┘ └──────┘          │   │   │
│   │                  └──────────────────────────────────────┘   │   │
│   │                                                              │   │
│   │   + Nouvel outil = créer un plugin                          │   │
│   │   + Pas de rebuild de l'agent                               │   │
│   │   + Maintenance décentralisée                               │   │
│   │                                                              │   │
│   └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 11.1.2 Interface Plugin

```typescript
// src/plugins/types.ts
export interface Plugin {
  // Métadonnées
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;

  // Outils fournis
  tools: Tool[];

  // Lifecycle
  initialize?(context: PluginContext): Promise<void>;
  shutdown?(): Promise<void>;

  // Configuration
  configSchema?: JSONSchema;
  configure?(config: unknown): Promise<void>;
}

export interface PluginContext {
  // Accès à l'agent
  agent: AgentInterface;

  // Configuration
  config: PluginConfig;

  // Logger
  logger: Logger;

  // Storage persistant
  storage: PluginStorage;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  main: string;           // Point d'entrée
  tools: ToolDefinition[];
  permissions: Permission[];
  dependencies?: string[];
}
```

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
          output: `Hello, ${args.name}! This message comes from a plugin.`
        };
      }
    }
  ];

  async initialize(context: PluginContext): Promise<void> {
    context.logger.info('Hello World plugin initialized');
  }

  async shutdown(): Promise<void> {
    // Cleanup if needed
  }
}
```

---

## 11.2 Plugin Loader

### 11.2.1 Découverte des plugins

```typescript
// src/plugins/loader.ts
export class PluginLoader {
  private pluginDirs: string[] = [
    path.join(os.homedir(), '.grok/plugins'),  // User plugins
    path.join(process.cwd(), '.grok/plugins'), // Project plugins
    path.join(__dirname, '../builtin-plugins') // Builtin plugins
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

    // Vérifier les permissions
    await this.checkPermissions(manifest);

    // Charger le module
    const module = await import(mainPath);
    const PluginClass = module.default || module[manifest.id];

    if (!PluginClass) {
      throw new Error(`Plugin ${manifest.id} has no default export`);
    }

    // Instancier
    const plugin = new PluginClass() as Plugin;

    // Valider
    this.validatePlugin(plugin, manifest);

    return plugin;
  }

  private async checkPermissions(manifest: PluginManifest): Promise<void> {
    const dangerous = ['execute', 'network', 'system'];
    const hasDangerous = manifest.permissions?.some(p => dangerous.includes(p));

    if (hasDangerous) {
      const approved = await this.promptPermissions(manifest);
      if (!approved) {
        throw new Error(`Plugin ${manifest.id} requires permissions that were not approved`);
      }
    }
  }

  private validatePlugin(plugin: Plugin, manifest: PluginManifest): void {
    // Vérifier que les outils déclarés sont présents
    for (const toolDef of manifest.tools) {
      const tool = plugin.tools.find(t => t.name === toolDef.name);
      if (!tool) {
        throw new Error(`Plugin ${manifest.id} declares tool ${toolDef.name} but doesn't provide it`);
      }
    }
  }
}
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
      } catch (error) {
        console.warn(`Failed to load plugin ${manifest.id}:`, error);
      }
    }
  }

  async loadPlugin(manifest: PluginManifest): Promise<void> {
    if (this.plugins.has(manifest.id)) {
      throw new Error(`Plugin ${manifest.id} is already loaded`);
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

    // Enregistrer les outils
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
  }

  getTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  getTool(name: string): Tool | undefined {
    // Chercher d'abord avec namespace
    if (this.tools.has(name)) {
      return this.tools.get(name);
    }

    // Chercher sans namespace (premier match)
    for (const [fullName, tool] of this.tools) {
      if (fullName.endsWith(`:${name}`)) {
        return tool;
      }
    }

    return undefined;
  }
}
```

---

## 11.3 MCP : Model Context Protocol

### 11.3.1 Qu'est-ce que MCP ?

MCP est un protocole standardisé par Anthropic pour connecter des outils aux LLMs :

```
┌─────────────────────────────────────────────────────────────────────┐
│                    MODEL CONTEXT PROTOCOL                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   ┌─────────────┐          ┌─────────────┐                         │
│   │   CLIENT    │ ◄──────► │   SERVER    │                         │
│   │ (Agent)     │   MCP    │ (Tool)      │                         │
│   └─────────────┘          └─────────────┘                         │
│                                                                      │
│   Protocol features:                                                │
│   ├── Tool Discovery  : Serveur expose ses outils                  │
│   ├── Tool Execution  : Client appelle les outils                  │
│   ├── Resource Access : Accès à des ressources (fichiers, etc.)    │
│   ├── Prompts         : Templates de prompts pré-définis           │
│   └── Sampling        : Demander au LLM de générer                 │
│                                                                      │
│   Transports:                                                       │
│   ├── stdio   : Communication par stdin/stdout                     │
│   ├── HTTP    : API REST                                           │
│   └── SSE     : Server-Sent Events (streaming)                     │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 11.3.2 Structure des messages MCP

```typescript
// Types MCP
interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

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
  | 'initialize'           // Handshake initial
  | 'tools/list'           // Lister les outils disponibles
  | 'tools/call'           // Appeler un outil
  | 'resources/list'       // Lister les ressources
  | 'resources/read'       // Lire une ressource
  | 'prompts/list'         // Lister les prompts
  | 'prompts/get'          // Obtenir un prompt
  | 'sampling/createMessage'; // Demander génération LLM
```

### 11.3.3 Client MCP

```typescript
// src/mcp/client.ts
import { JSONRPCClient } from 'json-rpc-2.0';

export class MCPClient {
  private rpc: JSONRPCClient;
  private transport: MCPTransport;
  private serverInfo: ServerInfo | null = null;

  constructor(transport: MCPTransport) {
    this.transport = transport;
    this.rpc = new JSONRPCClient(async (request) => {
      return this.transport.send(request);
    });
  }

  async connect(): Promise<void> {
    await this.transport.connect();

    // Handshake
    const response = await this.rpc.request('initialize', {
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
  }

  async listTools(): Promise<MCPTool[]> {
    const response = await this.rpc.request('tools/list', {});
    return response.tools;
  }

  async callTool(name: string, args: unknown): Promise<MCPToolResult> {
    const response = await this.rpc.request('tools/call', {
      name,
      arguments: args
    });
    return response;
  }

  async listResources(): Promise<MCPResource[]> {
    const response = await this.rpc.request('resources/list', {});
    return response.resources;
  }

  async readResource(uri: string): Promise<MCPResourceContent> {
    const response = await this.rpc.request('resources/read', { uri });
    return response;
  }

  async disconnect(): Promise<void> {
    await this.transport.disconnect();
  }
}
```

### 11.3.4 Transports MCP

```typescript
// src/mcp/transports/stdio.ts
export class StdioTransport implements MCPTransport {
  private process: ChildProcess | null = null;
  private buffer = '';
  private responseHandlers = new Map<string | number, (response: any) => void>();

  constructor(private command: string, private args: string[] = []) {}

  async connect(): Promise<void> {
    this.process = spawn(this.command, this.args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.process.stdout!.on('data', (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    this.process.stderr!.on('data', (data: Buffer) => {
      console.error(`[MCP Server Error] ${data.toString()}`);
    });

    this.process.on('exit', (code) => {
      console.log(`MCP server exited with code ${code}`);
    });
  }

  async send(request: MCPRequest): Promise<MCPResponse> {
    return new Promise((resolve, reject) => {
      this.responseHandlers.set(request.id, resolve);

      const message = JSON.stringify(request) + '\n';
      this.process!.stdin!.write(message);

      // Timeout
      setTimeout(() => {
        if (this.responseHandlers.has(request.id)) {
          this.responseHandlers.delete(request.id);
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
        const handler = this.responseHandlers.get(message.id);
        if (handler) {
          this.responseHandlers.delete(message.id);
          handler(message);
        }
      } catch (error) {
        console.error('Failed to parse MCP message:', line);
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
export class HTTPTransport implements MCPTransport {
  constructor(private baseUrl: string) {}

  async connect(): Promise<void> {
    // Vérifier que le serveur répond
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

## 11.4 Intégration MCP dans Grok-CLI

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
        console.warn(`Failed to connect MCP server ${server.id}:`, error);
      }
    }
  }

  private async connectServer(config: MCPServerConfig): Promise<void> {
    // Créer le transport
    let transport: MCPTransport;

    if (config.url) {
      transport = new HTTPTransport(config.url);
    } else if (config.command) {
      // Remplacer les variables d'environnement
      const env = this.resolveEnv(config.env || {});

      transport = new StdioTransport(config.command, config.args || [], {
        cwd: config.cwd,
        env: { ...process.env, ...env }
      });
    } else {
      throw new Error(`Invalid MCP server config: ${config.id}`);
    }

    // Créer et connecter le client
    const client = new MCPClient(transport);
    await client.connect();

    this.clients.set(config.id, client);

    // Découvrir les outils
    const tools = await client.listTools();
    for (const tool of tools) {
      const fullName = `mcp:${config.id}:${tool.name}`;
      this.tools.set(fullName, { client, tool });
    }

    console.log(`Connected MCP server ${config.id}: ${tools.length} tools`);
  }

  private resolveEnv(env: Record<string, string>): Record<string, string> {
    const resolved: Record<string, string> = {};

    for (const [key, value] of Object.entries(env)) {
      // Remplacer ${VAR} par process.env.VAR
      resolved[key] = value.replace(/\$\{(\w+)\}/g, (_, name) =>
        process.env[name] || ''
      );
    }

    return resolved;
  }

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
        return { success: false, error: result.content[0]?.text || 'Unknown error' };
      }

      // Formater le résultat
      const output = result.content
        .map(c => c.type === 'text' ? c.text : `[${c.type}]`)
        .join('\n');

      return { success: true, output };
    } catch (error) {
      return { success: false, error: `MCP call failed: ${(error as Error).message}` };
    }
  }

  async shutdown(): Promise<void> {
    for (const [id, client] of this.clients) {
      try {
        await client.disconnect();
      } catch (error) {
        console.warn(`Error disconnecting MCP server ${id}:`, error);
      }
    }
    this.clients.clear();
    this.tools.clear();
  }
}
```

---

## 11.5 Créer un Serveur MCP

### 11.5.1 Structure d'un serveur

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

// Déclarer les outils
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
    }
  ]
}));

// Implémenter les outils
server.setRequestHandler('tools/call', async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'get_weather':
      const weather = await fetchWeather(args.city);
      return {
        content: [{ type: 'text', text: JSON.stringify(weather) }]
      };

    default:
      return {
        isError: true,
        content: [{ type: 'text', text: `Unknown tool: ${name}` }]
      };
  }
});

// Démarrer le serveur
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP server running on stdio');
}

main();
```

### 11.5.2 Serveur avec ressources

```typescript
// Exposer des ressources
server.setRequestHandler('resources/list', async () => ({
  resources: [
    {
      uri: 'config://app/settings',
      name: 'Application Settings',
      description: 'Current application configuration',
      mimeType: 'application/json'
    },
    {
      uri: 'file://logs/app.log',
      name: 'Application Logs',
      description: 'Recent application logs'
    }
  ]
}));

server.setRequestHandler('resources/read', async (request) => {
  const { uri } = request.params;

  if (uri === 'config://app/settings') {
    const settings = await loadSettings();
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(settings, null, 2)
        }
      ]
    };
  }

  if (uri.startsWith('file://logs/')) {
    const logPath = uri.replace('file://logs/', '/var/log/');
    const content = await fs.readFile(logPath, 'utf-8');
    return {
      contents: [{ uri, mimeType: 'text/plain', text: content }]
    };
  }

  throw new Error(`Resource not found: ${uri}`);
});
```

---

## 11.6 Marketplace de Plugins

### 11.6.1 Registry

```typescript
// src/plugins/marketplace.ts
interface PluginRegistryEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  repository: string;
  downloads: number;
  rating: number;
  tags: string[];
}

export class PluginMarketplace {
  private registryUrl = 'https://plugins.grok-cli.dev/api';

  async search(query: string): Promise<PluginRegistryEntry[]> {
    const response = await fetch(
      `${this.registryUrl}/search?q=${encodeURIComponent(query)}`
    );
    return response.json();
  }

  async install(pluginId: string): Promise<void> {
    // Récupérer les infos du plugin
    const info = await this.getPluginInfo(pluginId);

    // Télécharger
    const tarball = await this.downloadTarball(info.tarballUrl);

    // Extraire dans le dossier plugins
    const pluginDir = path.join(os.homedir(), '.grok/plugins', pluginId);
    await this.extractTarball(tarball, pluginDir);

    // Vérifier le manifest
    const manifest = await this.loadManifest(pluginDir);
    this.validateManifest(manifest);

    // Installer les dépendances
    if (await this.hasPackageJson(pluginDir)) {
      await this.runNpmInstall(pluginDir);
    }

    console.log(`Installed plugin: ${info.name} v${info.version}`);
  }

  async uninstall(pluginId: string): Promise<void> {
    const pluginDir = path.join(os.homedir(), '.grok/plugins', pluginId);

    if (!await this.exists(pluginDir)) {
      throw new Error(`Plugin not installed: ${pluginId}`);
    }

    await fs.rm(pluginDir, { recursive: true });
    console.log(`Uninstalled plugin: ${pluginId}`);
  }

  async update(pluginId: string): Promise<void> {
    // Vérifier les mises à jour
    const installed = await this.getInstalledVersion(pluginId);
    const latest = await this.getLatestVersion(pluginId);

    if (semver.gte(installed, latest)) {
      console.log(`Plugin ${pluginId} is already up to date`);
      return;
    }

    // Réinstaller
    await this.uninstall(pluginId);
    await this.install(pluginId);
  }
}
```

### 11.6.2 CLI pour les plugins

```typescript
// src/commands/plugin-commands.ts
export const pluginCommands = {
  'plugin:list': async () => {
    const manager = getPluginManager();
    const plugins = manager.listPlugins();

    console.log('\nInstalled Plugins:');
    for (const plugin of plugins) {
      console.log(`  ${plugin.id} v${plugin.version} - ${plugin.description}`);
    }
  },

  'plugin:search': async (query: string) => {
    const marketplace = new PluginMarketplace();
    const results = await marketplace.search(query);

    console.log(`\nSearch results for "${query}":`);
    for (const plugin of results) {
      console.log(`  ${plugin.id} v${plugin.version}`);
      console.log(`    ${plugin.description}`);
      console.log(`    ⭐ ${plugin.rating} | 📥 ${plugin.downloads}`);
      console.log();
    }
  },

  'plugin:install': async (pluginId: string) => {
    const marketplace = new PluginMarketplace();
    await marketplace.install(pluginId);

    // Recharger les plugins
    const manager = getPluginManager();
    await manager.reloadPlugins();
  },

  'plugin:uninstall': async (pluginId: string) => {
    const manager = getPluginManager();
    await manager.unloadPlugin(pluginId);

    const marketplace = new PluginMarketplace();
    await marketplace.uninstall(pluginId);
  }
};
```

---

## 11.7 Sécurité des Plugins

### 11.7.1 Sandboxing

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
      console: {
        log: (...args: any[]) => console.log('[Plugin]', ...args),
        error: (...args: any[]) => console.error('[Plugin]', ...args)
      }
    };

    if (permissions.includes('network')) {
      sandbox.fetch = this.sandboxedFetch.bind(this);
    }

    if (permissions.includes('filesystem')) {
      sandbox.fs = this.sandboxedFs();
    }

    return sandbox;
  }

  private sandboxedFetch(url: string, options?: RequestInit): Promise<Response> {
    // Bloquer certains domaines
    const blocked = ['localhost', '127.0.0.1', '0.0.0.0'];
    const parsed = new URL(url);

    if (blocked.some(b => parsed.hostname.includes(b))) {
      throw new Error('Access to local network blocked');
    }

    return fetch(url, options);
  }

  private sandboxedFs() {
    const allowedDir = path.join(os.homedir(), '.grok/plugin-data');

    return {
      readFile: async (filePath: string) => {
        const resolved = path.resolve(allowedDir, filePath);
        if (!resolved.startsWith(allowedDir)) {
          throw new Error('Access outside allowed directory');
        }
        return fs.readFile(resolved, 'utf-8');
      },
      writeFile: async (filePath: string, content: string) => {
        const resolved = path.resolve(allowedDir, filePath);
        if (!resolved.startsWith(allowedDir)) {
          throw new Error('Access outside allowed directory');
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

### 11.7.2 Vérification des signatures

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
      return { verified: false, reason: 'No signature found' };
    }

    // Lire le manifest et la signature
    const manifest = await fs.readFile(manifestPath);
    const signature = await fs.readFile(signaturePath);

    // Vérifier avec chaque clé de confiance
    for (const publicKey of this.trustedKeys) {
      const verify = crypto.createVerify('SHA256');
      verify.update(manifest);

      if (verify.verify(publicKey, signature)) {
        return { verified: true, signer: this.getKeyId(publicKey) };
      }
    }

    return { verified: false, reason: 'Signature verification failed' };
  }

  addTrustedKey(publicKey: string): void {
    this.trustedKeys.push(publicKey);
  }
}
```

---

## Résumé

Dans ce chapitre, nous avons vu :

| Concept | Point clé |
|---------|-----------|
| **Plugins** | Extension dynamique des capacités |
| **Interface** | id, tools, initialize, shutdown |
| **MCP** | Standard Anthropic pour les outils |
| **Transports** | stdio, HTTP, SSE |
| **Marketplace** | Découverte et installation |
| **Sécurité** | Sandbox, permissions, signatures |

---

## Exercices

1. **Plugin** : Créez un plugin qui expose un outil `random_joke` utilisant une API de blagues.

2. **MCP Server** : Implémentez un serveur MCP qui expose vos bookmarks comme ressources.

3. **Sécurité** : Identifiez 5 risques de sécurité des plugins et proposez des mitigations.

4. **Marketplace** : Concevez le schéma JSON d'un registry de plugins.

---

## Pour aller plus loin

- Anthropic. "Model Context Protocol Specification"
- Grok-CLI : `src/plugins/`, `src/mcp/`

---

*Fin de la Partie IV — Action et Outils*

*Prochainement : Partie V — Optimisation & Performance*
*Chapitre 12 — Optimisations Cognitives*

