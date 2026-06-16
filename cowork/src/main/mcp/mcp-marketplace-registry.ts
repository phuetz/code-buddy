/**
 * MCP Marketplace Registry — Claude Cowork parity Phase 2
 *
 * Bundled catalog of popular community MCP servers that users can install
 * with one click. Each entry includes metadata, command/args, required env
 * vars with descriptions, and an install guide URL.
 *
 * @module main/mcp/mcp-marketplace-registry
 */

export interface MCPRegistryEntry {
  /** Unique slug */
  id: string;
  /** Display name */
  name: string;
  /** Short description */
  description: string;
  /** Category for filtering */
  category:
    | 'browser'
    | 'productivity'
    | 'filesystem'
    | 'search'
    | 'dev'
    | 'ai'
    | 'database'
    | 'utility'
    | 'official';
  /** Whether the server comes with Code Buddy Cowork */
  bundled: boolean;
  /** Tags for search */
  tags: string[];
  /** MCP transport type */
  type: 'stdio' | 'sse' | 'http';
  /** Command to run (stdio) */
  command?: string;
  /** Command arguments */
  args?: string[];
  /** HTTP/SSE URL */
  url?: string;
  /** Required environment variables */
  requiresEnv?: string[];
  /** Human-readable description of each env var */
  envDescription?: Record<string, string>;
  /** Homepage URL */
  homepage?: string;
  /** Publisher */
  publisher?: string;
}

/**
 * Curated catalog of popular MCP servers from the community.
 * Sourced from https://github.com/modelcontextprotocol/servers
 */
export const MCP_MARKETPLACE_REGISTRY: MCPRegistryEntry[] = [
  // ── Official reference servers ─────────────────────────────────────
  {
    id: 'filesystem',
    name: 'Filesystem',
    description:
      'Secure file operations with configurable access controls. Read, write, search, and manipulate files in allowed directories.',
    category: 'filesystem',
    bundled: false,
    tags: ['files', 'read', 'write', 'search', 'official'],
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '{WORKSPACE}'],
    requiresEnv: [],
    envDescription: {},
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    publisher: 'ModelContextProtocol',
  },
  {
    id: 'git',
    name: 'Git',
    description:
      'Git operations: read/search/manipulate Git repositories from within your MCP session.',
    category: 'dev',
    bundled: false,
    tags: ['git', 'version-control', 'official'],
    type: 'stdio',
    command: 'uvx',
    args: ['mcp-server-git', '--repository', '{WORKSPACE}'],
    requiresEnv: [],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/git',
    publisher: 'ModelContextProtocol',
  },
  {
    id: 'github',
    name: 'GitHub',
    description:
      'Repository management, file operations, issues, pull requests, and more via the GitHub API.',
    category: 'dev',
    bundled: false,
    tags: ['github', 'git', 'pr', 'issues', 'official'],
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    requiresEnv: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
    envDescription: {
      GITHUB_PERSONAL_ACCESS_TOKEN:
        'Personal access token with repo scope — create at github.com/settings/tokens',
    },
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
    publisher: 'ModelContextProtocol',
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    description: 'GitLab API integration for repo management, issues, and merge requests.',
    category: 'dev',
    bundled: false,
    tags: ['gitlab', 'git', 'mr', 'official'],
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-gitlab'],
    requiresEnv: ['GITLAB_PERSONAL_ACCESS_TOKEN'],
    envDescription: {
      GITLAB_PERSONAL_ACCESS_TOKEN: 'GitLab PAT — create at gitlab.com/-/profile/personal_access_tokens',
    },
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/gitlab',
    publisher: 'ModelContextProtocol',
  },
  {
    id: 'memory',
    name: 'Memory',
    description: 'Knowledge graph-based persistent memory system.',
    category: 'ai',
    bundled: false,
    tags: ['memory', 'knowledge-graph', 'persistent', 'official'],
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    requiresEnv: [],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    publisher: 'ModelContextProtocol',
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    description: 'Web and local search using the Brave Search API.',
    category: 'search',
    bundled: false,
    tags: ['search', 'web', 'brave', 'official'],
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    requiresEnv: ['BRAVE_API_KEY'],
    envDescription: {
      BRAVE_API_KEY: 'Brave Search API key — get one at api.search.brave.com',
    },
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search',
    publisher: 'ModelContextProtocol',
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Notion API integration. Create, read, and manage pages, databases, and blocks.',
    category: 'productivity',
    bundled: false,
    tags: ['notion', 'docs', 'productivity', 'official'],
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@notionhq/notion-mcp-server'],
    requiresEnv: ['NOTION_TOKEN'],
    envDescription: {
      NOTION_TOKEN: 'Notion integration token (ntn_...) — create at www.notion.so/my-integrations',
    },
    homepage: 'https://github.com/makenotion/notion-mcp-server',
    publisher: 'Notion',
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Slack API integration. Read and send messages, manage channels, and interact with your workspace.',
    category: 'productivity',
    bundled: false,
    tags: ['slack', 'chat', 'productivity', 'official'],
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    requiresEnv: ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID'],
    envDescription: {
      SLACK_BOT_TOKEN: 'Slack bot user OAuth token (xoxb-...)',
      SLACK_TEAM_ID: 'Your Slack workspace Team ID (T...)',
    },
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/slack',
    publisher: 'ModelContextProtocol',
  },
  {
    id: 'trello',
    name: 'Trello',
    description: 'Trello API integration. Manage boards, lists, and cards directly from Cowork.',
    category: 'productivity',
    bundled: false,
    tags: ['trello', 'kanban', 'productivity'],
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'mcp-server-trello'],
    requiresEnv: ['TRELLO_API_KEY', 'TRELLO_API_TOKEN'],
    envDescription: {
      TRELLO_API_KEY: 'Trello API key — get one at trello.com/app-key',
      TRELLO_API_TOKEN: 'Trello API token',
    },
    homepage: 'https://github.com/community/mcp-trello',
    publisher: 'Community',
  },

  {
    id: 'puppeteer',
    name: 'Puppeteer',
    description: 'Browser automation and web scraping via Puppeteer.',
    category: 'browser',
    bundled: false,
    tags: ['browser', 'scraping', 'automation', 'official'],
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    requiresEnv: [],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer',
    publisher: 'ModelContextProtocol',
  },
  {
    id: 'fetch',
    name: 'Fetch',
    description:
      'Web content fetching and conversion to markdown, optimized for LLM consumption.',
    category: 'utility',
    bundled: false,
    tags: ['fetch', 'web', 'markdown', 'official'],
    type: 'stdio',
    command: 'uvx',
    args: ['mcp-server-fetch'],
    requiresEnv: [],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
    publisher: 'ModelContextProtocol',
  },
  {
    id: 'sqlite',
    name: 'SQLite',
    description: 'Read and query SQLite databases safely.',
    category: 'database',
    bundled: false,
    tags: ['sql', 'database', 'sqlite', 'official'],
    type: 'stdio',
    command: 'uvx',
    args: ['mcp-server-sqlite', '--db-path', '{DB_PATH}'],
    requiresEnv: [],
    envDescription: {},
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite',
    publisher: 'ModelContextProtocol',
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    description: 'Read-only access to PostgreSQL databases with schema inspection.',
    category: 'database',
    bundled: false,
    tags: ['sql', 'database', 'postgres', 'official'],
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres', '{POSTGRES_URL}'],
    requiresEnv: [],
    envDescription: {},
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/postgres',
    publisher: 'ModelContextProtocol',
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    description: 'Search and access files from Google Drive.',
    category: 'productivity',
    bundled: false,
    tags: ['google', 'drive', 'files', 'official'],
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-gdrive'],
    requiresEnv: [],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/gdrive',
    publisher: 'ModelContextProtocol',
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Channel management and messaging via the Slack API.',
    category: 'productivity',
    bundled: false,
    tags: ['slack', 'messaging', 'official'],
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    requiresEnv: ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID'],
    envDescription: {
      SLACK_BOT_TOKEN: 'Slack bot token (starts with xoxb-)',
      SLACK_TEAM_ID: 'Slack workspace/team ID',
    },
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/slack',
    publisher: 'ModelContextProtocol',
  },
  {
    id: 'sentry',
    name: 'Sentry',
    description: 'Retrieve and analyze error data from Sentry.io.',
    category: 'dev',
    bundled: false,
    tags: ['errors', 'monitoring', 'sentry'],
    type: 'stdio',
    command: 'uvx',
    args: ['mcp-server-sentry', '--auth-token', '{SENTRY_AUTH_TOKEN}'],
    requiresEnv: [],
    envDescription: {},
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sentry',
    publisher: 'ModelContextProtocol',
  },
  {
    id: 'time',
    name: 'Time',
    description: 'Time and timezone utilities.',
    category: 'utility',
    bundled: false,
    tags: ['time', 'timezone', 'official'],
    type: 'stdio',
    command: 'uvx',
    args: ['mcp-server-time'],
    requiresEnv: [],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/time',
    publisher: 'ModelContextProtocol',
  },
  {
    id: 'everart',
    name: 'EverArt',
    description: 'AI image generation via EverArt models.',
    category: 'ai',
    bundled: false,
    tags: ['images', 'generation', 'ai'],
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-everart'],
    requiresEnv: ['EVERART_API_KEY'],
    envDescription: {
      EVERART_API_KEY: 'EverArt API key — everart.ai/account',
    },
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/everart',
    publisher: 'ModelContextProtocol',
  },
];

export function getRegistryById(id: string): MCPRegistryEntry | undefined {
  return MCP_MARKETPLACE_REGISTRY.find((entry) => entry.id === id);
}

export function searchRegistry(query: string): MCPRegistryEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return MCP_MARKETPLACE_REGISTRY;
  return MCP_MARKETPLACE_REGISTRY.filter(
    (entry) =>
      entry.id.toLowerCase().includes(q) ||
      entry.name.toLowerCase().includes(q) ||
      entry.description.toLowerCase().includes(q) ||
      entry.tags.some((tag) => tag.toLowerCase().includes(q)) ||
      entry.category.toLowerCase().includes(q)
  );
}
