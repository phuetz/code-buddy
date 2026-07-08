import { ToolMetadata, ToolCategory } from "./types.js";

/**
 * Default tool metadata for all built-in tools
 */
export const TOOL_METADATA: ToolMetadata[] = [
  // File reading
  {
    name: 'view_file',
    category: 'file_read',
    keywords: ['view', 'read', 'show', 'display', 'content', 'file', 'open', 'look', 'see', 'check', 'list', 'directory', 'ls', 'cat'],
    priority: 10,
    description: 'View file contents or directory listings',
    fleetSafe: true,
  },
  {
    name: 'read_file',
    category: 'file_read',
    keywords: ['read', 'view', 'show', 'display', 'content', 'file', 'hermes'],
    priority: 10,
    description: 'Read file contents with optional line range',
    fleetSafe: true,
  },

  // File writing
  {
    name: 'create_file',
    category: 'file_write',
    keywords: ['create', 'new', 'write', 'generate', 'make', 'add', 'initialize', 'init', 'touch'],
    priority: 8,
    description: 'Create new files with content'
  },
  {
    name: 'write_file',
    category: 'file_write',
    keywords: ['write', 'create', 'new', 'file', 'content', 'hermes'],
    priority: 8,
    description: 'Create a new file with content',
  },
  {
    name: 'str_replace_editor',
    category: 'file_write',
    keywords: ['edit', 'modify', 'change', 'update', 'replace', 'fix', 'refactor', 'alter', 'patch'],
    priority: 10,
    description: 'Replace text in existing files'
  },
  {
    name: 'patch',
    category: 'file_write',
    keywords: ['patch', 'edit', 'replace', 'modify', 'file', 'text', 'hermes'],
    priority: 9,
    description: 'Replace text in an existing file',
  },
  {
    name: 'edit_file',
    category: 'file_write',
    keywords: ['edit', 'modify', 'change', 'update', 'fast', 'morph', 'apply', 'bulk'],
    priority: 9,
    description: 'High-speed file editing with Morph'
  },
  {
    name: 'multi_edit',
    category: 'file_write',
    keywords: ['multi', 'edit', 'replace', 'batch', 'atomic', 'refactor', 'multiple', 'edits', 'rename'],
    priority: 8,
    description: 'Apply multiple text replacements to a single file atomically'
  },
  {
    name: 'apply_patch',
    category: 'file_write',
    keywords: ['patch', 'diff', 'apply', 'unified', 'edit', 'update', 'add', 'delete', 'file', 'diff-first'],
    priority: 8,
    description: 'Apply a diff-first patch to add/update/delete files (required by WritePolicy strict mode)'
  },

  // Self-model — the robot's own components/bricks
  {
    name: 'self_describe',
    category: 'file_read',
    keywords: ['self', 'describe', 'components', 'composants', 'briques', 'bricks', 'architecture', 'de quoi es-tu fait', 'de quoi es-tu compose', 'qui es-tu', 'capabilities', 'modules', 'buddy-sense', 'buddy-vision', 'buddy-memory'],
    priority: 6,
    description: "Describe the robot's own components/bricks and live faculties (self-model)",
    fleetSafe: true,
  },

  // Directory listing
  {
    name: 'list_directory',
    category: 'file_read',
    keywords: ['list', 'directory', 'files', 'ls', 'folder', 'contents', 'dir', 'entries'],
    priority: 9,
    description: 'List files and directories with type, size, and modification time',
    fleetSafe: true,
  },

  // File search
  {
    name: 'search',
    category: 'file_search',
    keywords: ['search', 'find', 'locate', 'grep', 'look for', 'where', 'which', 'query', 'pattern', 'regex'],
    priority: 10,
    description: 'Search for text content or files',
    fleetSafe: true,
  },
  {
    name: 'search_files',
    category: 'file_search',
    keywords: ['search', 'files', 'grep', 'find', 'pattern', 'text', 'hermes'],
    priority: 10,
    description: 'Search for text content or files',
    fleetSafe: true,
  },
  {
    name: 'find_symbols',
    category: 'file_search',
    keywords: ['symbols', 'functions', 'classes', 'definitions', 'code', 'index', 'semantic'],
    priority: 8,
    description: 'Find symbols (functions, classes, variables) in the codebase',
    fleetSafe: true,
  },
  {
    name: 'find_references',
    category: 'file_search',
    keywords: ['references', 'usages', 'where used', 'callers', 'semantic'],
    priority: 8,
    description: 'Find references/usages of a symbol',
    fleetSafe: true,
  },
  {
    name: 'find_definition',
    category: 'file_search',
    keywords: ['definition', 'go to definition', 'declaration', 'symbol'],
    priority: 8,
    description: 'Find definition/declaration location of a symbol',
    fleetSafe: true,
  },
  {
    name: 'search_multi',
    category: 'file_search',
    keywords: ['multi', 'search', 'batch', 'parallel', 'patterns', 'queries'],
    priority: 7,
    description: 'Run multiple searches in one call',
    fleetSafe: true,
  },

  // System operations
  {
    name: 'bash',
    category: 'system',
    keywords: ['bash', 'terminal', 'command', 'run', 'execute', 'shell', 'npm', 'yarn', 'pip', 'install', 'build', 'test', 'compile'],
    priority: 9,
    description: 'Execute bash commands'
  },
  {
    name: 'terminal',
    category: 'system',
    keywords: ['terminal', 'bash', 'shell', 'command', 'execute', 'run', 'hermes'],
    priority: 9,
    description: 'Execute shell commands through the existing bash safety checks',
  },
  {
    name: 'process',
    category: 'system',
    keywords: ['process', 'spawn', 'kill', 'list', 'logs', 'pid', 'monitor'],
    priority: 6,
    description: 'Manage system processes (spawn, inspect, logs, terminate)'
  },
  {
    name: 'app_server',
    category: 'system',
    keywords: ['dev server', 'app server', 'localhost', 'preview', 'test app', 'serve', 'npm run dev', 'vite', 'test ui'],
    priority: 7,
    description: 'Start/stop a managed local dev server and make its loopback URL browsable for testing the app'
  },
  {
    name: 'js_repl',
    category: 'system',
    keywords: ['javascript', 'repl', 'eval', 'node', 'snippet', 'runtime'],
    priority: 5,
    description: 'Execute JavaScript snippets in a controlled runtime'
  },
  {
    name: 'execute_code',
    category: 'system',
    keywords: ['execute_code', 'hermes', 'code', 'script', 'runtime', 'subprocess', 'artifact', 'run'],
    priority: 8,
    description: 'Execute a bounded code snippet as a real subprocess and persist run artifacts',
  },

  // Git operations
  {
    name: 'git',
    category: 'git',
    keywords: ['git', 'commit', 'push', 'pull', 'branch', 'merge', 'diff', 'status', 'checkout', 'stash', 'version', 'control'],
    priority: 8,
    description: 'Git version control operations'
  },

  // Docker operations
  {
    name: 'docker',
    category: 'system',
    keywords: ['docker', 'container', 'image', 'build', 'run', 'stop', 'logs', 'exec', 'compose', 'pull', 'push', 'prune', 'volume', 'network', 'dockerfile'],
    priority: 7,
    description: 'Docker container management operations'
  },

  // Kubernetes operations
  {
    name: 'kubernetes',
    category: 'system',
    keywords: ['kubernetes', 'k8s', 'kubectl', 'pod', 'deployment', 'service', 'namespace', 'cluster', 'node', 'scale', 'rollout', 'configmap', 'secret', 'ingress', 'helm'],
    priority: 7,
    description: 'Kubernetes cluster management operations'
  },

  // Web operations
  {
    name: 'web_search',
    category: 'web',
    keywords: ['search', 'google', 'web', 'internet', 'online', 'latest', 'news', 'documentation', 'docs', 'how to', 'info', 'find', 'lookup'],
    priority: 8,
    description: 'Search the web for information including news, documentation, and general queries',
    fleetSafe: true,
  },
  {
    name: 'weather',
    category: 'web',
    keywords: ['weather', 'météo', 'meteo', 'forecast', 'prévisions', 'previsions', 'température', 'temperature', 'pluie', 'neige', 'vent'],
    priority: 8,
    description: 'Current weather and forecast for a city via Open-Meteo (no API key)',
    // Read-only (public weather API) — answerable under the plan posture.
    fleetSafe: true,
  },
  {
    name: 'design_system',
    category: 'utility',
    keywords: ['design', 'design system', 'ui', 'brand', 'branding', 'style', 'theme', 'spotify', 'apple', 'brutalism', 'interface', 'landing', 'esthétique', 'charte', 'palette', 'typographie'],
    priority: 7,
    description: 'List 150 brand design systems and read a chosen DESIGN.md to generate branded UIs',
    // Read-only (reads vendored DESIGN.md assets) — answerable under the plan posture.
    fleetSafe: true,
  },
  {
    name: 'csv_analyze',
    category: 'utility',
    keywords: ['csv', 'table', 'tabular', 'columns', 'colonnes', 'numeric', 'stats', 'statistiques', 'preview', 'data', 'analyze', 'analyse', 'spreadsheet'],
    priority: 6,
    description: 'Read-only CSV analysis: dimensions, column types, numeric stats, and a row preview',
    // Read-only (deterministic local parse, no network) — answerable under the plan posture.
    fleetSafe: true,
  },
  {
    name: 'deep_research',
    category: 'web',
    keywords: [
      'research', 'deep research', 'investigate', 'investigation', 'sources', 'cite', 'citation',
      'report', 'literature', 'state of the art', "état de l'art", 'etat de l\'art',
      'recherche approfondie', 'recherche', 'enquête', 'due diligence', 'compare', 'comparison',
      'storm', 'perspectives', 'multi-source', 'cited',
    ],
    priority: 7,
    description: 'Bounded multi-source cited research pipeline (deep/wide/STORM) returning a report with references',
  },
  {
    name: 'paper_qa',
    category: 'web',
    keywords: [
      'paper', 'papers', 'pdf', 'scientific', 'science', 'article', 'articles', 'corpus',
      'cite', 'citation', 'cited', 'page', 'section', 'papier', 'papiers', 'scientifique',
      'cite la source', 'preuves', 'grounded', 'publication', 'étude', 'research paper',
    ],
    priority: 7,
    description: 'Grounded, cited QA over a local corpus of scientific PDFs (page/section provenance, honest refusal)',
  },
  {
    name: 'web_fetch',
    category: 'web',
    keywords: ['fetch', 'url', 'website', 'page', 'download', 'http', 'https', 'link', 'read'],
    priority: 7,
    description: 'Fetch web page content',
    fleetSafe: true,
  },
  {
    name: 'web_extract',
    category: 'web',
    keywords: ['extract', 'fetch', 'url', 'website', 'page', 'http', 'https', 'read', 'hermes'],
    priority: 7,
    description: 'Fetch and extract web page content',
    fleetSafe: true,
  },
  {
    name: 'internet_scout_plan',
    category: 'web',
    keywords: ['internet scout', 'surf', 'browse', 'navigation', 'osint', 'prospecting', 'lead', 'profile enrichment', 'search', 'fetch', 'observe', 'extract', 'assert', 'stagehand', 'evidence', 'rate limit', 'captcha', 'proof'],
    priority: 8,
    description: 'Plan safe evidence-first web surfing with search, fetch, browser observe/extract/assert, blockers, and optional persistence',
    fleetSafe: true,
  },
  {
    name: 'internet_scout_run',
    category: 'web',
    keywords: ['internet scout', 'run', 'surf', 'browse', 'playwright', 'browser', 'navigation', 'osint', 'prospecting', 'lead', 'profile enrichment', 'search', 'fetch', 'observe', 'extract', 'assert', 'stagehand', 'evidence', 'rate limit', 'captcha', 'proof'],
    priority: 9,
    description: 'Execute bounded evidence-first web surfing with search, fetch, Playwright browser observe/extract/assert, and blocker-aware stops',
    fleetSafe: false,
  },
  {
    name: 'browser_navigate',
    category: 'web',
    keywords: ['browser', 'navigate', 'goto', 'url', 'playwright', 'hermes'],
    priority: 8,
    description: 'Navigate the active browser page to a URL using the shared Playwright session',
  },
  {
    name: 'browser_click',
    category: 'web',
    keywords: ['browser', 'click', 'ref', 'element', 'playwright', 'hermes'],
    priority: 8,
    description: 'Click a browser element by numeric ref from browser_snapshot',
  },
  {
    name: 'browser_type',
    category: 'web',
    keywords: ['browser', 'type', 'input', 'text', 'ref', 'playwright', 'hermes'],
    priority: 8,
    description: 'Type text into a browser element by numeric ref from browser_snapshot',
  },
  {
    name: 'browser_scroll',
    category: 'web',
    keywords: ['browser', 'scroll', 'page', 'viewport', 'ref', 'playwright', 'hermes'],
    priority: 7,
    description: 'Scroll the active browser page or scroll to an element ref',
  },
  {
    name: 'browser_back',
    category: 'web',
    keywords: ['browser', 'back', 'history', 'navigation', 'playwright', 'hermes'],
    priority: 7,
    description: 'Navigate the active browser page back in history',
  },
  {
    name: 'browser_press',
    category: 'web',
    keywords: ['browser', 'press', 'keyboard', 'key', 'playwright', 'hermes'],
    priority: 7,
    description: 'Press a keyboard key in the active browser page',
  },
  {
    name: 'browser_vision',
    category: 'web',
    keywords: ['browser', 'vision', 'screenshot', 'analyze', 'playwright', 'hermes'],
    priority: 8,
    description: 'Capture and analyze the active browser page with local vision evidence',
  },
  {
    name: 'browser_dialog',
    category: 'web',
    keywords: ['browser', 'dialog', 'alert', 'confirm', 'prompt', 'beforeunload', 'modal', 'playwright', 'hermes'],
    priority: 7,
    description: 'List, accept, or dismiss native browser dialogs blocking the active browser page',
  },
  {
    name: 'browser_get_images',
    category: 'web',
    keywords: ['browser', 'image', 'images', 'img', 'media', 'alt', 'playwright', 'hermes'],
    priority: 7,
    description: 'List image elements on the active browser page with resolved URLs, alt text, dimensions, and visibility',
  },
  {
    name: 'browser_console',
    category: 'web',
    keywords: ['browser', 'console', 'logs', 'javascript', 'pageerror', 'debug', 'playwright', 'hermes'],
    priority: 7,
    description: 'List or clear browser console messages and page runtime errors captured from the active browser session',
  },
  {
    name: 'browser_snapshot',
    category: 'web',
    keywords: ['browser', 'snapshot', 'accessibility', 'refs', 'observe', 'playwright', 'hermes'],
    priority: 8,
    description: 'Take an accessibility-oriented snapshot of the active browser page and return element refs',
  },
  {
    name: 'lead_scout_plan',
    category: 'planning',
    keywords: ['lead scout', 'prospecting', 'prospect', 'leads', 'b2b', 'architectes', 'syndics', 'agences immobilieres', 'maitres oeuvre', 'promoteurs', 'bureaux etudes', 'sirene', 'rnc', 'osint', 'public data', 'script recipe', 'scoring', 'human review'],
    priority: 9,
    description: 'Plan safe B2B lead discovery with public sources, schema, scoring, script recipe, evidence, and human-review gates',
    fleetSafe: true,
  },
  {
    name: 'lead_scout_run',
    category: 'planning',
    keywords: ['lead scout', 'run', 'prospecting', 'prospect', 'leads', 'b2b', 'architectes', 'syndics', 'agences immobilieres', 'dataset', 'json', 'csv', 'dedupe', 'scoring', 'review queue', 'email draft', 'human review'],
    priority: 10,
    description: 'Run local-first B2B lead discovery over JSON/CSV datasets with dedupe, scoring, drafts, and optional review export',
    fleetSafe: false,
  },
  {
    name: 'lead_scout_enrichment_plan',
    category: 'planning',
    keywords: ['lead scout', 'enrichment', 'multi-hop', 'script generation', 'sandbox', 'manus', 'architectes', 'website', 'contact page', 'phone', 'telephone', 'email', 'evidence chain', 'public data'],
    priority: 10,
    description: 'Plan multi-hop public B2B enrichment with principles, evidence chain, generated script contract, and sandbox execution policy',
    fleetSafe: true,
  },
  {
    name: 'lead_scout_lesson_candidates',
    category: 'planning',
    keywords: ['lead scout', 'lessons', 'learning', 'self improvement', 'script feedback', 'sandbox logs', 'patterns', 'enrichment', 'lessons_add'],
    priority: 9,
    description: 'Generate reviewed lesson candidates from Lead Scout runs and sandbox script observations without persisting automatically',
    fleetSafe: true,
  },
  // Firecrawl (Native Engine v2026.3.14)
  {
    name: 'firecrawl_search',
    category: 'web',
    keywords: ['search', 'firecrawl', 'crawl', 'web', 'find', 'query', 'results', 'internet'],
    priority: 8,
    description: 'Search the web via Firecrawl API',
    fleetSafe: true,
  },
  {
    name: 'firecrawl_scrape',
    category: 'web',
    keywords: ['scrape', 'firecrawl', 'crawl', 'extract', 'web', 'page', 'content', 'markdown', 'fetch'],
    priority: 8,
    description: 'Scrape a web page via Firecrawl API',
    fleetSafe: true,
  },

  {
    name: 'browser',
    category: 'web',
    keywords: ['browser', 'automate', 'click', 'fill', 'form', 'screenshot', 'scrape', 'navigate', 'headless', 'puppeteer', 'playwright', 'selenium', 'test', 'ui', 'automation', 'web', 'observe', 'extract', 'assert', 'assertion', 'stagehand', 'page.act', 'page.extract', 'page.observe'],
    priority: 6,
    description: 'Automate web browser for navigation, interaction, extraction, observation, and testing'
  },
  {
    name: 'web_test',
    category: 'web',
    keywords: ['web test', 'test ui', 'verify app', 'smoke test', 'e2e', 'console errors', 'check page', 'test app'],
    priority: 7,
    description: 'One-call structured UI test with evidence: console + server logs + snapshot + screenshot + assertions'
  },
  {
    name: 'browser_operator',
    category: 'web',
    keywords: ['browser operator', 'browser', 'web automation', 'live web', 'navigate', 'login', 'interaction', 'consent', 'stagehand', 'computer use', 'session', 'stop control', 'proof export', 'operator', 'propose'],
    priority: 6,
    description: 'Propose a consent-gated Browser Operator session (action log, consent scopes, stop control, proof export) for live web goals beyond web_search/web_fetch — without launching a browser'
  },
  {
    name: 'computer_control',
    category: 'system',
    keywords: ['computer', 'control', 'desktop', 'mouse', 'keyboard', 'window', 'dialog', 'modal', 'prompt', 'click', 'type', 'automation', 'form', 'field', 'dropdown', 'listbox', 'checkbox', 'radio', 'tab', 'menu', 'tree', 'treeitem', 'slider', 'range', 'link', 'button', 'assert', 'application', 'profile', 'excel', 'spreadsheet', 'notepad', 'calculator'],
    priority: 6,
    description: 'Control desktop applications with app profiles, Excel automation, mouse, keyboard, windows, dialogs, form fields, dropdowns, lists, buttons, links, radios, tabs, menus, tree items, sliders, checkboxes, and assertions'
  },
  {
    name: 'office_macro_execute',
    category: 'system',
    keywords: ['office', 'excel', 'word', 'powerpoint', 'vba', 'macro', 'powershell', 'com', 'windows', 'automation'],
    priority: 4,
    description: 'Execute VBA or PowerShell macros in Microsoft Office apps (Excel/Word/PowerPoint) via COM — Windows only. Dangerous: runs arbitrary code, requires confirmation. Not exposed to fleet peers.'
  },

  // Planning
  {
    name: 'create_todo_list',
    category: 'planning',
    keywords: ['todo', 'plan', 'task', 'list', 'organize', 'steps', 'breakdown', 'project'],
    priority: 6,
    description: 'Create todo list for task planning'
  },
  {
    name: 'get_todo_list',
    category: 'planning',
    keywords: ['todo', 'task', 'list', 'view', 'show', 'what', 'do', 'faire', 'tâches', 'taches', 'pending', 'status'],
    priority: 7,
    description: 'View current todo list and task status',
    fleetSafe: true,
  },
  {
    name: 'update_todo_list',
    category: 'planning',
    keywords: ['todo', 'update', 'complete', 'done', 'progress', 'status', 'mark'],
    priority: 6,
    description: 'Update todo list progress'
  },
  {
    name: 'kanban_show',
    category: 'planning',
    keywords: ['kanban', 'hermes', 'show', 'card', 'task', 'board', 'coordination'],
    priority: 8,
    description: 'Show a persistent Hermes-compatible Kanban card by id',
  },
  {
    name: 'kanban_list',
    category: 'planning',
    keywords: ['kanban', 'hermes', 'list', 'cards', 'tasks', 'board', 'coordination'],
    priority: 8,
    description: 'List persistent Hermes-compatible Kanban cards',
  },
  {
    name: 'kanban_complete',
    category: 'planning',
    keywords: ['kanban', 'hermes', 'complete', 'done', 'finish', 'task', 'board'],
    priority: 8,
    description: 'Mark a persistent Kanban card as done',
  },
  {
    name: 'kanban_block',
    category: 'planning',
    keywords: ['kanban', 'hermes', 'block', 'blocked', 'stuck', 'reason', 'task'],
    priority: 8,
    description: 'Mark a persistent Kanban card as blocked with a reason',
  },
  {
    name: 'kanban_heartbeat',
    category: 'planning',
    keywords: ['kanban', 'hermes', 'heartbeat', 'progress', 'status', 'task', 'agent'],
    priority: 8,
    description: 'Record a progress heartbeat on a persistent Kanban card',
  },
  {
    name: 'kanban_comment',
    category: 'planning',
    keywords: ['kanban', 'hermes', 'comment', 'note', 'task', 'board', 'coordination'],
    priority: 8,
    description: 'Append a comment to a persistent Kanban card',
  },
  {
    name: 'kanban_create',
    category: 'planning',
    keywords: ['kanban', 'hermes', 'create', 'card', 'task', 'board', 'coordination'],
    priority: 8,
    description: 'Create a persistent Hermes-compatible Kanban card',
  },
  {
    name: 'kanban_link',
    category: 'planning',
    keywords: ['kanban', 'hermes', 'link', 'artifact', 'url', 'commit', 'issue', 'task'],
    priority: 8,
    description: 'Attach an artifact, URL, commit, issue, or related reference to a Kanban card',
  },
  {
    name: 'kanban_unblock',
    category: 'planning',
    keywords: ['kanban', 'hermes', 'unblock', 'resume', 'progress', 'task', 'board'],
    priority: 8,
    description: 'Clear a Kanban block and move the card back to in_progress',
  },
  {
    name: 'send_message',
    category: 'web',
    keywords: ['send', 'message', 'channel', 'gateway', 'telegram', 'discord', 'slack', 'email', 'hermes'],
    priority: 8,
    description: 'Prepare or deliver outbound channel messages with dry-run outbox logging by default',
  },
  {
    name: 'discord',
    category: 'web',
    keywords: ['discord', 'server', 'guild', 'channel', 'messages', 'members', 'thread', 'hermes'],
    priority: 8,
    description: 'Read Discord channel messages, search members, and create threads via the Discord REST API',
  },
  {
    name: 'discord_admin',
    category: 'web',
    keywords: ['discord', 'admin', 'server', 'guild', 'channels', 'roles', 'pins', 'moderation', 'hermes'],
    priority: 8,
    description: 'Inspect and manage Discord server metadata, pins, messages, and member roles through the Discord REST API',
  },
  {
    name: 'yb_query_group_info',
    category: 'web',
    keywords: ['yuanbao', 'yb', 'group', 'pai', 'owner', 'member count', 'hermes'],
    priority: 8,
    description: 'Query Yuanbao group name, owner, and member count through a configured gateway adapter',
  },
  {
    name: 'yb_query_group_members',
    category: 'web',
    keywords: ['yuanbao', 'yb', 'group', 'members', 'mention', 'bots', 'pai', 'hermes'],
    priority: 8,
    description: 'Query Yuanbao group members for mention lookup, bot listing, or full member listing',
  },
  {
    name: 'yb_send_dm',
    category: 'web',
    keywords: ['yuanbao', 'yb', 'dm', 'direct message', 'private message', 'media', 'hermes'],
    priority: 8,
    description: 'Send an approval-gated Yuanbao private message through a configured gateway adapter',
  },
  {
    name: 'yb_search_sticker',
    category: 'web',
    keywords: ['yuanbao', 'yb', 'sticker', 'search', 'tim face', 'emoji', 'hermes'],
    priority: 8,
    description: 'Search Yuanbao stickers through a configured gateway adapter or local fallback catalog',
  },
  {
    name: 'yb_send_sticker',
    category: 'web',
    keywords: ['yuanbao', 'yb', 'sticker', 'send', 'chat', 'tim face', 'hermes'],
    priority: 8,
    description: 'Send an approval-gated Yuanbao sticker through a configured gateway adapter',
  },
  {
    name: 'ha_list_entities',
    category: 'web',
    keywords: ['homeassistant', 'home assistant', 'hass', 'entity', 'entities', 'smart home', 'hermes'],
    priority: 8,
    description: 'List Home Assistant entities through the REST API',
  },
  {
    name: 'ha_get_state',
    category: 'web',
    keywords: ['homeassistant', 'home assistant', 'hass', 'state', 'entity', 'smart home', 'hermes'],
    priority: 8,
    description: 'Get detailed state for one Home Assistant entity',
  },
  {
    name: 'ha_list_services',
    category: 'web',
    keywords: ['homeassistant', 'home assistant', 'hass', 'services', 'actions', 'smart home', 'hermes'],
    priority: 8,
    description: 'List Home Assistant services and compact field metadata',
  },
  {
    name: 'ha_call_service',
    category: 'web',
    keywords: ['homeassistant', 'home assistant', 'hass', 'service', 'control', 'device', 'smart home', 'hermes'],
    priority: 8,
    description: 'Call a Home Assistant service with blocked dangerous domains',
  },
  {
    name: 'mixture_of_agents',
    category: 'utility',
    keywords: ['mixture of agents', 'moa', 'openrouter', 'frontier', 'aggregation', 'reasoning', 'hermes'],
    priority: 8,
    description: 'Route a difficult problem through multiple frontier model references and an aggregator',
  },
  {
    name: 'spotify_playback',
    category: 'web',
    keywords: ['spotify', 'music', 'playback', 'player', 'pause', 'skip', 'volume', 'recently played', 'hermes'],
    priority: 8,
    description: 'Control Spotify playback and inspect current or recently played tracks',
  },
  {
    name: 'spotify_devices',
    category: 'web',
    keywords: ['spotify', 'device', 'devices', 'connect', 'transfer playback', 'speaker', 'hermes'],
    priority: 8,
    description: 'List Spotify Connect devices or transfer playback',
  },
  {
    name: 'spotify_queue',
    category: 'web',
    keywords: ['spotify', 'queue', 'music', 'add to queue', 'play next', 'hermes'],
    priority: 8,
    description: 'Inspect the Spotify queue or add an item to it',
  },
  {
    name: 'spotify_search',
    category: 'web',
    keywords: ['spotify', 'search', 'music', 'track', 'album', 'artist', 'playlist', 'hermes'],
    priority: 8,
    description: 'Search the Spotify catalog',
  },
  {
    name: 'spotify_playlists',
    category: 'web',
    keywords: ['spotify', 'playlist', 'playlists', 'create playlist', 'add items', 'remove items', 'hermes'],
    priority: 8,
    description: 'List, inspect, create, update, and modify Spotify playlists',
  },
  {
    name: 'spotify_albums',
    category: 'web',
    keywords: ['spotify', 'album', 'albums', 'tracks', 'music', 'hermes'],
    priority: 8,
    description: 'Fetch Spotify album metadata or album tracks',
  },
  {
    name: 'spotify_library',
    category: 'web',
    keywords: ['spotify', 'library', 'saved tracks', 'saved albums', 'save music', 'remove saved', 'hermes'],
    priority: 8,
    description: 'List, save, or remove Spotify library tracks and albums',
  },
  {
    name: 'x_search',
    category: 'web',
    keywords: ['x', 'twitter', 'xai', 'grok', 'posts', 'threads', 'citations', 'current discussion', 'hermes'],
    priority: 8,
    description: "Search X posts and threads through xAI's built-in x_search Responses API tool",
  },
  {
    name: 'feishu_doc_read',
    category: 'web',
    keywords: ['feishu', 'lark', 'document', 'docx', 'read', 'raw content', 'hermes'],
    priority: 8,
    description: 'Read Feishu/Lark document raw content through the Open API',
  },
  {
    name: 'feishu_drive_list_comments',
    category: 'web',
    keywords: ['feishu', 'lark', 'drive', 'comments', 'list', 'document', 'hermes'],
    priority: 8,
    description: 'List Feishu/Lark drive file comments through the Open API',
  },
  {
    name: 'feishu_drive_list_comment_replies',
    category: 'web',
    keywords: ['feishu', 'lark', 'drive', 'comments', 'replies', 'thread', 'hermes'],
    priority: 8,
    description: 'List Feishu/Lark drive comment replies through the Open API',
  },
  {
    name: 'feishu_drive_reply_comment',
    category: 'web',
    keywords: ['feishu', 'lark', 'drive', 'comment', 'reply', 'document', 'hermes'],
    priority: 8,
    description: 'Reply to a Feishu/Lark drive comment through the Open API',
  },
  {
    name: 'feishu_drive_add_comment',
    category: 'web',
    keywords: ['feishu', 'lark', 'drive', 'comment', 'add', 'document', 'hermes'],
    priority: 8,
    description: 'Add a whole-document Feishu/Lark drive comment through the Open API',
  },
  {
    name: 'cronjob',
    category: 'planning',
    keywords: ['cron', 'cronjob', 'schedule', 'scheduled', 'job', 'jobs', 'reminder', 'monitor', 'heartbeat', 'watchdog', 'hermes'],
    priority: 8,
    description: 'Create, list, pause, resume, run, and remove persisted scheduled jobs through CronScheduler'
  },

  // Codebase analysis
  {
    name: 'codebase_map',
    category: 'codebase',
    keywords: ['codebase', 'structure', 'architecture', 'map', 'overview', 'symbols', 'dependencies', 'analyze', 'graph', 'imports', 'who imports', 'neighbors', 'path', 'layers', 'components', 'modules', 'relationships', 'calls', 'call graph', 'extends', 'inherits', 'methods', 'flowchart', 'organigramme'],
    priority: 6,
    description: 'Analyze codebase structure and query code graph',
    fleetSafe: true,
  },
  {
    name: 'code_graph',
    category: 'codebase',
    keywords: ['code graph', 'call graph', 'who calls', 'what calls', 'callers', 'callees', 'impact analysis', 'what breaks', 'affected', 'flowchart', 'mermaid', 'diagram', 'organigramme', 'class hierarchy', 'inheritance', 'extends', 'implements', 'file functions', 'methods', 'signatures', 'dependency path', 'module dependencies', 'communities', 'clusters', 'subsystems', 'semantic search', 'embedding', 'similarity', 'pagerank', 'dead code', 'unused', 'uncalled', 'orphan', 'coupling', 'heatmap', 'refactoring', 'god function', 'hub module', 'drift', 'snapshot', 'evolution', 'visualize', 'interactive', 'd3', 'impact preview', 'pr impact', 'diff impact'],
    priority: 7,
    description: 'Query code dependency graph: callers, callees, impact analysis, Mermaid flowcharts, class hierarchies',
    fleetSafe: true,
  },
  {
    name: 'spawn_subagent',
    category: 'codebase',
    keywords: ['subagent', 'agent', 'review', 'debug', 'test', 'explore', 'document', 'refactor'],
    priority: 5,
    description: 'Spawn specialized subagent'
  },

  // Media tools
  {
    name: 'screenshot',
    category: 'media',
    keywords: ['screenshot', 'capture', 'screen', 'image', 'snap', 'window'],
    priority: 5,
    description: 'Capture screenshots'
  },
  {
    name: 'camera_snapshot',
    category: 'media',
    keywords: ['camera', 'webcam', 'snapshot', 'photo', 'vision', 'see', 'look', 'companion', 'eyes'],
    priority: 6,
    description: 'Capture one local webcam frame and record a vision percept'
  },
  {
    name: 'camera_analyze',
    category: 'media',
    keywords: ['camera', 'webcam', 'see', 'vision', 'describe', 'look', 'photo', 'companion', 'eyes', 'analyze', 'what do you see'],
    priority: 7,
    description: 'Capture a local webcam frame and describe it with a local multimodal vision model'
  },
  {
    name: 'audio',
    category: 'media',
    keywords: ['audio', 'sound', 'music', 'transcribe', 'speech', 'voice', 'mp3', 'wav'],
    priority: 5,
    description: 'Process audio files'
  },
  {
    name: 'text_to_speech',
    category: 'media',
    keywords: ['tts', 'speech', 'audio', 'voice', 'synthesize', 'hermes'],
    priority: 7,
    description: 'Convert text to a local speech audio file'
  },
  {
    name: 'tool_search',
    category: 'system',
    keywords: ['tool', 'search', 'discover', 'find', 'capability', 'mcp', 'schema'],
    priority: 9,
    description: 'Search available tools by keyword (progressive disclosure)'
  },
  {
    name: 'image_generate',
    category: 'media',
    keywords: ['image', 'generate', 'picture', 'photo', 'openai', 'xai', 'hermes', 'gener', 'cree', 'dessin', 'illustration'],
    priority: 8,
    description: 'Generate an image through the configured image backend and cache returned media when possible'
  },
  {
    name: 'video',
    category: 'media',
    keywords: ['video', 'movie', 'frames', 'thumbnail', 'mp4', 'extract'],
    priority: 5,
    description: 'Process video files'
  },
  {
    name: 'video_analyze',
    category: 'media',
    keywords: ['video', 'analyze', 'vision', 'movie', 'mp4', 'gemini', 'openai', 'hermes'],
    priority: 8,
    description: 'Analyze a local or remote video with a configured video-capable model'
  },
  {
    name: 'video_generate',
    category: 'media',
    keywords: ['video', 'generate', 'text-to-video', 'image-to-video', 'xai', 'fal', 'hermes', 'gener', 'cree', 'clip', 'film', 'animation'],
    priority: 8,
    description: 'Generate a video through the configured video backend and cache returned media when possible'
  },
  {
    name: 'video_stitch',
    category: 'media',
    keywords: ['video', 'stitch', 'montage', 'film', 'concatenate', 'concat', 'chain', 'transition', 'xfade', 'crossfade', 'enchainer', 'assembler', 'monter', 'clip', 'produire', 'production', 'long', 'music', 'voiceover'],
    priority: 8,
    description: 'Chain multiple local video clips into one longer film with transitions (xfade/gl), optional background music (ducked) and voiceover, via ffmpeg; saved under .codebuddy/media-generation/films/'
  },
  {
    name: 'understand_video',
    category: 'media',
    keywords: ['video', 'youtube', 'transcribe', 'transcript', 'captions', 'subtitles', 'vidéo', 'résume vidéo', 'summarize', 'watch', 'movie', 'mp4', 'visual', 'screencast', 'frames', 'on-screen', 'shown', 'cloud', 'gemini'],
    priority: 8,
    description: 'Understand a video (YouTube/URL/local file): timestamped transcript + optional on-screen visual analysis (visual:true) + optional opt-in cloud (Gemini) understanding (cloud:true)'
  },
  {
    name: 'ocr',
    category: 'media',
    keywords: ['ocr', 'text', 'extract', 'image', 'recognize', 'read'],
    priority: 5,
    description: 'Extract text from images'
  },
  {
    name: 'vision_analyze',
    category: 'media',
    keywords: ['vision', 'image', 'analyze', 'metadata', 'ocr', 'hermes'],
    priority: 8,
    description: 'Analyze a local image with metadata, colors, labels, and optional OCR evidence',
  },
  {
    name: 'object_detect',
    category: 'media',
    keywords: ['vision', 'image', 'object', 'detect', 'detection', 'yolo', 'yolov8', 'ultralytics', 'person', 'people', 'presence', 'camera'],
    priority: 8,
    description: 'Detect objects in a local image using local YOLOv8/Ultralytics inference',
  },
  {
    name: 'clipboard',
    category: 'media',
    keywords: ['clipboard', 'copy', 'paste', 'cut'],
    priority: 4,
    description: 'Clipboard operations'
  },

  // Document tools
  {
    name: 'pdf',
    category: 'document',
    keywords: ['pdf', 'document', 'extract', 'read', 'pages'],
    priority: 5,
    description: 'Read PDF documents'
  },
  {
    name: 'document',
    category: 'document',
    keywords: ['docx', 'xlsx', 'pptx', 'word', 'excel', 'powerpoint', 'office', 'spreadsheet', 'embedded images', 'screenshots'],
    priority: 5,
    description: 'Read Office documents and extract DOCX embedded images'
  },
  {
    name: 'archive',
    category: 'document',
    keywords: ['zip', 'tar', 'archive', 'compress', 'extract', 'unzip', 'rar', '7z'],
    priority: 5,
    description: 'Work with archives'
  },

  // Reasoning
  {
    name: 'reason',
    category: 'codebase',
    keywords: ['reason', 'think', 'plan', 'analyze', 'architecture', 'design', 'debug', 'complex', 'trade-off', 'compare', 'evaluate', 'strategy', 'decision', 'mcts', 'tree-of-thought'],
    priority: 6,
    description: 'Solve complex problems using Tree-of-Thought reasoning with MCTS',
    fleetSafe: true,
  },

  // Docs search
  {
    name: 'docs_search',
    category: 'codebase',
    keywords: ['docs', 'documentation', 'architecture', 'subsystem', 'api', 'security', 'config', 'design', 'how does', 'explain', 'overview'],
    priority: 5,
    description: 'Search project documentation for architecture, API, security, and configuration information',
    fleetSafe: true,
  },

  // Plan management
  {
    name: 'plan',
    category: 'planning',
    keywords: ['plan', 'goal', 'steps', 'track', 'progress', 'todo', 'organize', 'breakdown', 'checklist', 'PLAN.md'],
    priority: 7,
    description: 'Manage a persistent execution plan (PLAN.md) with step tracking'
  },

  // Script execution
  {
    name: 'run_script',
    category: 'utility',
    keywords: ['script', 'python', 'typescript', 'javascript', 'shell', 'execute', 'run', 'sandbox', 'docker', 'compute', 'data'],
    priority: 5,
    description: 'Execute scripts in a secure sandboxed Docker environment'
  },

  // Utility tools
  {
    name: 'diagram',
    category: 'utility',
    keywords: ['diagram', 'flowchart', 'chart', 'mermaid', 'sequence', 'class', 'uml', 'graph', 'visualize'],
    priority: 5,
    description: 'Generate diagrams'
  },
  {
    name: 'export',
    category: 'utility',
    keywords: ['export', 'save', 'convert', 'format', 'json', 'markdown', 'html'],
    priority: 4,
    description: 'Export data to various formats'
  },
  {
    name: 'qr',
    category: 'utility',
    keywords: ['qr', 'code', 'barcode', 'scan', 'generate'],
    priority: 4,
    description: 'QR code operations'
  },
  {
    name: 'a2ui',
    category: 'utility',
    keywords: ['a2ui', 'surface', 'component', 'ui', 'interface', 'canvas', 'render'],
    priority: 4,
    description: 'Build dynamic UI surfaces and components with the A2UI protocol'
  },
  {
    name: 'canvas',
    category: 'utility',
    keywords: ['canvas', 'visual', 'workspace', 'diagram', 'layout', 'element', 'render', 'export', 'import'],
    priority: 4,
    description: 'Create and manipulate visual workspaces with positioned elements'
  },
  {
    name: 'deploy',
    category: 'utility',
    keywords: ['deploy', 'cloud', 'fly', 'railway', 'render', 'gcp', 'hosting', 'production', 'hetzner', 'northflank'],
    priority: 6,
    description: 'Deploy applications to cloud platforms'
  },

  // Agent Tools — attention, knowledge, lessons, discovery, device, verification
  {
    name: 'todo_update',
    category: 'planning',
    keywords: ['todo', 'task', 'plan', 'track', 'progress', 'attention', 'focus'],
    priority: 8,
    description: 'Manage persistent task list for tracking progress'
  },
  {
    name: 'restore_context',
    category: 'utility',
    keywords: ['restore', 'context', 'memory', 'compressed', 'retrieve', 'earlier'],
    priority: 7,
    description: 'Restore compressed context content by identifier',
    fleetSafe: true,
  },
  {
    name: 'knowledge_search',
    category: 'utility',
    keywords: ['knowledge', 'search', 'convention', 'docs', 'domain', 'procedure'],
    priority: 5,
    description: 'Search the agent knowledge base',
    fleetSafe: true,
  },
  {
    name: 'knowledge_add',
    category: 'utility',
    keywords: ['knowledge', 'add', 'save', 'persist', 'remember', 'convention'],
    priority: 4,
    description: 'Add a new knowledge entry'
  },
  {
    name: 'ask_human',
    category: 'utility',
    keywords: ['ask', 'human', 'clarify', 'question', 'input', 'pause', 'confirm'],
    priority: 6,
    description: 'Ask the user a clarifying question'
  },
  {
    name: 'create_skill',
    category: 'utility',
    keywords: ['skill', 'create', 'workflow', 'reusable', 'procedure', 'automate'],
    priority: 3,
    description: 'Create a new SKILL.md workflow'
  },
  {
    name: 'skill_discover',
    category: 'utility',
    keywords: ['skill', 'discover', 'search', 'hub', 'install', 'capability', 'plugin'],
    priority: 3,
    description: 'Search Skills Hub for capabilities'
  },
  {
    name: 'skills_list',
    category: 'utility',
    keywords: ['skill', 'skills', 'list', 'installed', 'enabled', 'disabled', 'hub', 'hermes'],
    priority: 5,
    description: 'List installed SKILL.md packages from the local SkillsHub',
    fleetSafe: true,
  },
  {
    name: 'skill_view',
    category: 'utility',
    keywords: ['skill', 'skills', 'view', 'read', 'content', 'inspect', 'show', 'hub', 'hermes'],
    priority: 6,
    description: 'Read one installed SKILL.md package and its integrity metadata from the local SkillsHub',
    fleetSafe: true,
  },
  {
    name: 'skill_manage',
    category: 'utility',
    keywords: ['skill', 'skills', 'manage', 'list', 'view', 'history', 'create', 'discover', 'candidate', 'review', 'install', 'enable', 'disable', 'deprecate', 'delete', 'patch', 'rollback', 'update', 'lifecycle', 'hub', 'hermes'],
    priority: 6,
    description: 'Hermes-style facade for installed skills, lifecycle actions, and review-gated SKILL.md candidates',
  },
  {
    name: 'device_manage',
    category: 'utility',
    keywords: ['device', 'ssh', 'adb', 'android', 'remote', 'screenshot', 'camera', 'pair'],
    priority: 4,
    description: 'Manage paired devices (SSH/ADB/local)'
  },
  {
    name: 'spawn_parallel_agents',
    category: 'codebase',
    keywords: ['parallel', 'agents', 'concurrent', 'subtasks', 'batch', 'delegate'],
    priority: 5,
    description: 'Execute multiple subtasks concurrently with specialized sub-agents'
  },
  {
    name: 'remember',
    category: 'utility',
    keywords: ['memory', 'remember', 'persist', 'context', 'store', 'preference'],
    priority: 5,
    description: 'Store persistent memory entries'
  },
  {
    name: 'replace_memory',
    category: 'utility',
    keywords: ['memory', 'replace', 'rewrite', 'update', 'persist', 'preference'],
    priority: 5,
    description: 'Replace an existing persistent memory entry under the memory char budget'
  },
  {
    name: 'memory_propose',
    category: 'utility',
    keywords: ['memory', 'candidate', 'propose', 'review', 'long-term', 'persist'],
    priority: 5,
    description: 'Propose a review-gated long-term memory candidate without silently writing prompt-injected memory'
  },
  {
    name: 'recall',
    category: 'utility',
    keywords: ['memory', 'recall', 'retrieve', 'lookup', 'context'],
    priority: 5,
    description: 'Retrieve persistent memory by key',
    fleetSafe: true,
  },
  {
    name: 'forget',
    category: 'utility',
    keywords: ['memory', 'forget', 'remove', 'delete', 'cleanup'],
    priority: 4,
    description: 'Delete a persistent memory entry'
  },
  {
    name: 'relationship_context',
    category: 'utility',
    keywords: [
      'relationship',
      'identity',
      'person',
      'people',
      'public figure',
      'world memory',
      'people memory',
      'robot',
      'recognition',
      'permission',
      'evidence',
      'context'
    ],
    priority: 6,
    description: 'Build a safe relationship/world-memory context card with permissions and evidence',
    fleetSafe: true,
  },
  {
    name: 'lessons_add',
    category: 'utility',
    keywords: ['lesson', 'learn', 'correction', 'pattern', 'rule', 'mistake'],
    priority: 5,
    description: 'Capture a lesson learned'
  },
  {
    name: 'lessons_propose',
    category: 'utility',
    keywords: ['lesson', 'propose', 'candidate', 'review', 'learn', 'self improvement', 'pattern'],
    priority: 5,
    description: 'Propose a lesson candidate for human review (no silent write)'
  },
  {
    name: 'lessons_search',
    category: 'utility',
    keywords: ['lesson', 'search', 'pattern', 'rule', 'past', 'history', 'mistake'],
    priority: 5,
    description: 'Search lessons learned',
    fleetSafe: true,
  },
  {
    name: 'lessons_list',
    category: 'utility',
    keywords: ['lesson', 'list', 'all', 'show', 'history'],
    priority: 4,
    description: 'List all lessons learned',
    fleetSafe: true,
  },
  {
    name: 'lessons_graph',
    category: 'utility',
    keywords: ['lesson', 'graph', 'obsidian', 'wiki', 'related', 'concepts', 'links', 'notions'],
    priority: 5,
    description: 'Build a concept graph over lessons.md to find related lessons and nearby notions',
    fleetSafe: true,
  },
  {
    name: 'user_model_observe',
    category: 'utility',
    keywords: ['user', 'model', 'preference', 'observe', 'profile', 'personalization', 'working style', 'trait'],
    priority: 4,
    description: 'Propose an observation about the user for human review (no silent write)'
  },
  {
    name: 'user_model_recall',
    category: 'utility',
    keywords: ['user', 'model', 'preference', 'recall', 'profile', 'personalization', 'who'],
    priority: 4,
    description: 'Recall accepted observations about the user',
    fleetSafe: true,
  },
  {
    name: 'task_verify',
    category: 'utility',
    keywords: ['verify', 'test', 'typecheck', 'lint', 'check', 'validate', 'ci'],
    priority: 7,
    description: 'Run verification contract (tsc, test, lint)'
  },
  {
    name: 'knowledge_graph',
    category: 'codebase',
    keywords: ['knowledge', 'graph', 'relationships', 'imports', 'calls', 'extends', 'dependencies', 'code', 'architecture'],
    priority: 6,
    description: 'Query code entity relationships and dependencies',
    fleetSafe: true,
  },

  // LSP rename/refactor
  {
    name: 'lsp_rename',
    category: 'codebase',
    keywords: ['rename', 'refactor', 'symbol', 'lsp', 'language server', 'cross-file', 'identifier'],
    priority: 7,
    description: 'Rename a symbol across the codebase using LSP'
  },
  {
    name: 'lsp_code_action',
    category: 'codebase',
    keywords: ['code action', 'quickfix', 'refactor', 'lsp', 'language server', 'suggestion'],
    priority: 6,
    description: 'Get available code actions (quick fixes, refactorings) from LSP'
  },

  // Bug finder (static analysis)
  {
    name: 'find_bugs',
    category: 'codebase',
    keywords: ['bug', 'find', 'scan', 'analysis', 'static', 'security', 'lint', 'check', 'vulnerability', 'error', 'leak', 'dead code', 'race condition', 'null', 'injection'],
    priority: 7,
    description: 'Scan source files for potential bugs using regex-based static analysis',
    fleetSafe: true,
  },

  // Merge conflict resolution
  {
    name: 'resolve_conflicts',
    category: 'git',
    keywords: ['merge', 'conflict', 'resolve', 'git', 'ours', 'theirs', 'rebase', 'cherry-pick', 'markers'],
    priority: 7,
    description: 'Detect and resolve Git merge conflicts in files'
  },

  // Vulnerability scanning
  {
    name: 'scan_vulnerabilities',
    category: 'system',
    keywords: ['vulnerability', 'security', 'audit', 'dependency', 'npm', 'pip', 'cargo', 'cve', 'scan', 'advisory'],
    priority: 7,
    description: 'Scan project dependencies for known security vulnerabilities'
  },

  // Control
  {
    name: 'terminate',
    category: 'control' as ToolCategory,
    keywords: ['terminate', 'finish', 'done', 'complete', 'end', 'stop', 'exit', 'signal'],
    priority: 5,
    description: 'Signal task completion and end the agent loop',
    fleetSafe: true,
  },

  // Secrets detection
  {
    name: 'scan_secrets',
    category: 'security' as ToolCategory,
    keywords: ['secrets', 'credentials', 'api key', 'token', 'password', 'leak', 'scan', 'security', 'hardcoded', 'detect', 'aws', 'github', 'stripe', 'jwt'],
    priority: 7,
    description: 'Scan source files for hardcoded secrets, credentials, and API keys'
  },

  // Advisor (second opinion from a stronger reviewer model)
  {
    name: 'advisor',
    category: 'utility' as ToolCategory,
    keywords: ['advisor', 'review', 'second opinion', 'consult', 'check', 'validate', 'expert', 'critique', 'feedback'],
    priority: 6,
    description: 'Consult a stronger reviewer model for a second opinion (full conversation forwarded)'
  },

  // Verify (explicit delegation to the independent, fresh-context Verifier agent)
  {
    name: 'verify',
    category: 'utility' as ToolCategory,
    keywords: ['verify', 'verification', 'evidence', 'confirm', 'validate', 'oracle', 'independent', 'proof', 'check', 'works'],
    priority: 6,
    description: 'Delegate to an independent fresh-context Verifier that runs real oracles and returns a CONFIRMED / NEEDS REVIEW verdict with evidence (read-only)'
    // No fleetSafe: the Verifier drives execution tools (bash/app_server) — not peer-exposable.
  },

  // Delegate agent (single tool that reaches the built-in specialized agents)
  {
    name: 'delegate_agent',
    category: 'utility' as ToolCategory,
    keywords: ['delegate', 'agent', 'specialized', 'pdf', 'excel', 'xlsx', 'csv', 'data', 'analysis', 'sql', 'database', 'query', 'archive', 'zip', 'tar', 'swe', 'refactor', 'debug', 'pivot', 'correlate'],
    priority: 6,
    description: 'Delegate a bounded multi-step task to a built-in specialized agent (pdf/excel/data_analysis/sql/archive/swe)'
    // No fleetSafe: swe/excel-write/sql-import/archive-create can write — not peer-exposable.
  },

  // Document generator (PPTX/DOCX/XLSX/PDF) — complements the read-only `document` tool
  {
    name: 'generate_document',
    category: 'document' as ToolCategory,
    keywords: ['generate', 'document', 'pptx', 'docx', 'xlsx', 'pdf', 'powerpoint', 'word', 'excel', 'slides', 'deck', 'report', 'create', 'export'],
    priority: 6,
    description: 'Generate professional documents (PowerPoint/Word/Excel/PDF) from markdown content'
  },

  // Fleet — multi-Claude orchestration via peer-RPC (Phase (d).17)
  {
    name: 'peer_delegate',
    category: 'utility' as ToolCategory,
    keywords: ['peer', 'delegate', 'fleet', 'consult', 'ask', 'collaborate', 'remote', 'claude', 'orchestrate', 'sub-agent', 'multi-ai', 'distributed', 'hermes', 'dispatch', 'dispatchProfile', 'profile', 'toolset', 'toolsets', 'policy'],
    priority: 7,
    description: 'Delegate a one-shot question to a connected fleet peer Code Buddy and get its answer plus Hermes-style dispatch policy metadata back inline'
  },
  {
    name: 'peer_chain',
    category: 'utility' as ToolCategory,
    keywords: ['peer', 'chain', 'fleet', 'delegate', 'multi-agent', 'collaborate', 'orchestrate', 'hermes', 'handoff', 'roles', 'review', 'safe', 'code'],
    priority: 8,
    description: 'Route and execute an ordered Fleet collaboration chain with handoff context between specialist peers'
  },
  {
    name: 'list_peers',
    category: 'utility' as ToolCategory,
    keywords: ['peers', 'fleet', 'connected', 'remote', 'claudes', 'list', 'discover', 'status', 'provider', 'model', 'capabilities', 'route', 'routing', 'hermes', 'dispatch'],
    priority: 5,
    description: 'List connected fleet peers with status, last-seen, peer chat availability, and optional provider/model capabilities'
  },
  {
    name: 'route_peer',
    category: 'utility' as ToolCategory,
    keywords: ['peer', 'route', 'fleet', 'model', 'provider', 'capability', 'delegate', 'multi-ai', 'orchestrate', 'select', 'hermes', 'dispatch', 'chain', 'roles', 'dispatchProfile', 'profile', 'toolset', 'toolsets', 'policy', 'safe', 'review', 'research', 'code'],
    priority: 7,
    description: 'Choose the best connected fleet peer/model or ordered role chain for a prompt using peer.describe capabilities, Fleet TaskRouter, and optional Hermes-style dispatch profile'
  },

  // AskUserQuestion (structured multi-option mid-task questions)
  {
    name: 'ask_user_question',
    category: 'utility' as ToolCategory,
    keywords: ['ask', 'question', 'user', 'clarify', 'choose', 'option', 'decide', 'multi-choice', 'prompt', 'interactive', 'pick'],
    priority: 7,
    description: 'Ask the user 1-4 structured multi-option questions mid-task'
  },

  // ExitPlanMode (request approval to leave plan mode)
  {
    name: 'exit_plan_mode',
    category: 'utility' as ToolCategory,
    keywords: ['plan', 'exit', 'approve', 'approval', 'leave', 'execute', 'proceed', 'unlock', 'sign-off'],
    priority: 7,
    description: 'Request user approval to leave plan mode and start executing'
  },

  // Codebase replace
  {
    name: 'codebase_replace',
    category: 'file_write' as ToolCategory,
    keywords: ['replace', 'find', 'rename', 'refactor', 'codebase', 'search', 'substitute', 'sed', 'bulk', 'mass', 'global'],
    priority: 7,
    description: 'Find and replace text across multiple files in the codebase'
  },

  // Session tools — multi-agent coordination (Phase E wake of SessionToolExecutor).
  // These let the LLM coordinate with other in-process sessions: discover them,
  // read their transcript, message them, or spawn isolated sandboxed sub-agents.
  {
    name: 'sessions_list',
    category: 'utility' as ToolCategory,
    keywords: ['sessions', 'list', 'active', 'agents', 'discover', 'coordination', 'multi-agent'],
    priority: 5,
    description: 'List active sessions in the multi-agent system (discover who you can communicate with)',
    fleetSafe: true,
  },
  {
    name: 'sessions_history',
    category: 'utility' as ToolCategory,
    keywords: ['sessions', 'history', 'transcript', 'messages', 'review', 'context', 'multi-agent'],
    priority: 5,
    description: 'Get conversation history from another session by key or id',
    fleetSafe: true,
  },
  {
    name: 'session_search',
    category: 'utility' as ToolCategory,
    keywords: ['session', 'sessions', 'search', 'history', 'saved', 'recall', 'fts', 'conversation', 'hermes'],
    priority: 6,
    description: 'Search saved local sessions by title or message content with real session-store snippets',
    fleetSafe: true,
  },
  {
    name: 'sessions_send',
    category: 'utility' as ToolCategory,
    keywords: ['sessions', 'send', 'message', 'communicate', 'notify', 'multi-agent', 'broadcast'],
    priority: 6,
    description: 'Send a message to another session (fire-and-forget, or wait for response)',
  },
  {
    name: 'sessions_spawn',
    category: 'utility' as ToolCategory,
    keywords: ['sessions', 'spawn', 'create', 'subagent', 'delegate', 'parallel', 'subtask', 'multi-agent'],
    priority: 7,
    description: 'Spawn an isolated sandboxed sub-agent session for a delegated task (depth-3 + 10/workflow caps)',
  },
  {
    name: 'code_explorer_ask',
    category: 'utility' as ToolCategory,
    keywords: ['code-explorer', 'ask', 'query', 'understand', 'explain', 'search', 'related files', 'dependents', 'tests'],
    priority: 6,
    description: 'Consult CodeExplorer for a query or code understanding request (read-only)',
    fleetSafe: true,
  },
  {
    name: 'screen_memory',
    category: 'utility' as ToolCategory,
    keywords: ['screen', 'memory', 'screenpipe', 'recall', 'what did i see', 'history', 'ocr', 'audio', 'transcript', 'said', 'heard'],
    priority: 5,
    description: 'Recall what was on screen / said / heard via a local screenpipe instance (read-only, redacted)',
  },

  // ---- 20 pre-authored tools (wired 2026-07-05) ----
  {
    name: 'scaffold_app',
    category: 'file_write',
    keywords: ['scaffold', 'template', 'app', 'project', 'generate', 'node-cli', 'react', 'express'],
    priority: 85,
    description: 'Scaffold a new project from a template (node-cli, react, express).',
    fleetSafe: false,
  },
  {
    name: 'project_map',
    category: 'codebase',
    keywords: ['project', 'map', 'tree', 'structure', 'entrypoint', 'languages'],
    priority: 80,
    description: 'Read-only map of a project: directory tree, entry points and languages.',
    fleetSafe: true,
  },
  {
    name: 'dep_inspect',
    category: 'codebase',
    keywords: ['dependencies', 'package.json', 'scripts', 'engines', 'lockfile', 'npm'],
    priority: 78,
    description: 'Inspect package.json dependencies, scripts, engines and lockfile.',
    fleetSafe: true,
  },
  {
    name: 'code_stats',
    category: 'codebase',
    keywords: ['code', 'stats', 'lines', 'languages', 'comments', 'largest files'],
    priority: 76,
    description: 'Compute code statistics: line counts by language, comments and largest files.',
    fleetSafe: true,
  },
  {
    name: 'git_summary',
    category: 'git',
    keywords: ['git', 'summary', 'status', 'branch', 'commit', 'ahead', 'behind'],
    priority: 82,
    description: 'Read-only git summary: branch, ahead/behind, staged/modified counts and last commit.',
    fleetSafe: true,
  },
  {
    name: 'todo_scan',
    category: 'codebase',
    keywords: ['todo', 'fixme', 'hack', 'xxx', 'scan', 'markers'],
    priority: 72,
    description: 'Scan a codebase for TODO/FIXME/HACK/XXX markers.',
    fleetSafe: true,
  },
  {
    name: 'json_query',
    category: 'utility',
    keywords: ['json', 'query', 'path', 'inspect', 'data'],
    priority: 70,
    description: 'Query a JSON file by a dotted/bracket path.',
    fleetSafe: true,
  },
  {
    name: 'csv_preview',
    category: 'utility',
    keywords: ['csv', 'preview', 'columns', 'rows', 'types', 'data'],
    priority: 70,
    description: 'Preview a CSV file: inferred columns, row counts and value types.',
    fleetSafe: true,
  },
  {
    name: 'env_doctor',
    category: 'system',
    keywords: ['environment', 'doctor', 'node', 'node_modules', 'scripts', 'config', 'git', 'docker'],
    priority: 75,
    description: 'Diagnose a project environment: node, node_modules, scripts, config, git, docker.',
    fleetSafe: true,
  },
  {
    name: 'port_check',
    category: 'system',
    keywords: ['port', 'check', 'loopback', 'available', 'listening', 'server'],
    priority: 74,
    description: 'Check whether a loopback port is available or already listening.',
    fleetSafe: true,
  },
  {
    name: 'lint_project',
    category: 'system',
    keywords: ['lint', 'eslint', 'quality'],
    priority: 80,
    description: 'Run the project linter (eslint) and report issues.',
    fleetSafe: false,
  },
  {
    name: 'test_runner',
    category: 'system',
    keywords: ['test', 'vitest', 'jest'],
    priority: 80,
    description: 'Run the project test suite (vitest/jest) and report results.',
    fleetSafe: false,
  },
  {
    name: 'format_project',
    category: 'system',
    keywords: ['format', 'prettier'],
    priority: 70,
    description: 'Run the project formatter (prettier).',
    fleetSafe: false,
  },
  {
    name: 'bundle_analyze',
    category: 'codebase',
    keywords: ['bundle', 'dist', 'gzip'],
    priority: 70,
    description: 'Analyze build output size (dist, gzip) for the project.',
    fleetSafe: true,
  },
  {
    name: 'build_project',
    category: 'system',
    keywords: ['build', 'compile'],
    priority: 80,
    description: 'Build/compile the project and report the outcome.',
    fleetSafe: false,
  },
  {
    name: 'license_check',
    category: 'codebase',
    keywords: ['license', 'compliance', 'dependencies'],
    priority: 75,
    description: 'Check dependency licenses for compliance.',
    fleetSafe: true,
  },
  {
    name: 'sbom_generate',
    category: 'codebase',
    keywords: ['sbom', 'dependencies', 'supply-chain'],
    priority: 75,
    description: 'Generate a software bill of materials (SBOM) from the dependency tree.',
    fleetSafe: true,
  },
  {
    name: 'http_probe',
    category: 'web',
    keywords: ['http', 'probe', 'loopback'],
    priority: 65,
    description: 'Probe a loopback HTTP endpoint for status and headers.',
    fleetSafe: true,
  },
  {
    name: 'file_search',
    category: 'file_search',
    keywords: ['search', 'regex', 'files'],
    priority: 65,
    description: 'Regex search in text files under a bounded root (ignores node_modules/.git/binaries).',
    fleetSafe: true,
  },
  {
    name: 'diff_files',
    category: 'file_search',
    keywords: ['diff', 'files', 'lcs'],
    priority: 65,
    description: 'Compute an LCS-based diff between two files.',
    fleetSafe: true,
  },
];

/**
 * Category keyword mappings for query classification
 */
export const CATEGORY_KEYWORDS: Record<ToolCategory, string[]> = {
  file_read: ['read', 'view', 'show', 'display', 'content', 'open', 'look', 'see', 'check', 'what is in', 'contents of'],
  file_write: ['create', 'edit', 'modify', 'change', 'update', 'write', 'add', 'fix', 'refactor', 'replace', 'delete', 'remove'],
  file_search: ['search', 'find', 'locate', 'where', 'grep', 'look for', 'which file', 'contains'],
  system: ['run', 'execute', 'install', 'build', 'test', 'compile', 'npm', 'yarn', 'pip', 'command', 'terminal', 'docker', 'container', 'kubernetes', 'k8s', 'kubectl', 'pod', 'deployment', 'compose'],
  git: ['git', 'commit', 'push', 'pull', 'branch', 'merge', 'diff', 'status', 'version control'],
  web: ['search online', 'google', 'web', 'internet', 'fetch url', 'website', 'documentation', 'latest', 'news', 'browser', 'automate', 'click', 'fill form', 'screenshot', 'scrape', 'headless', 'ui test', 'observe', 'extract from page', 'assert page', 'stagehand', 'weather', 'météo', 'meteo', 'forecast', 'temperature', 'actualité', 'actualite', 'current events', 'real time', 'real-time'],
  planning: ['plan', 'todo', 'task', 'organize', 'steps', 'breakdown'],
  media: ['image', 'audio', 'video', 'screenshot', 'picture', 'photo', 'sound', 'music', 'capture', 'camera', 'webcam', 'vision', 'clip', 'film', 'animation', 'dessin', 'illustration', 'voix'],
  document: ['pdf', 'document', 'docx', 'xlsx', 'word', 'excel', 'archive', 'zip'],
  utility: ['diagram', 'chart', 'export', 'qr', 'visualize', 'convert'],
  codebase: ['codebase', 'structure', 'architecture', 'analyze', 'overview', 'dependencies'],
  mcp: ['mcp', 'external', 'server', 'plugin']
};
