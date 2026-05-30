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

  // File writing
  {
    name: 'create_file',
    category: 'file_write',
    keywords: ['create', 'new', 'write', 'generate', 'make', 'add', 'initialize', 'init', 'touch'],
    priority: 8,
    description: 'Create new files with content'
  },
  {
    name: 'str_replace_editor',
    category: 'file_write',
    keywords: ['edit', 'modify', 'change', 'update', 'replace', 'fix', 'refactor', 'alter', 'patch'],
    priority: 10,
    description: 'Replace text in existing files'
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
    name: 'process',
    category: 'system',
    keywords: ['process', 'spawn', 'kill', 'list', 'logs', 'pid', 'monitor'],
    priority: 6,
    description: 'Manage system processes (spawn, inspect, logs, terminate)'
  },
  {
    name: 'js_repl',
    category: 'system',
    keywords: ['javascript', 'repl', 'eval', 'node', 'snippet', 'runtime'],
    priority: 5,
    description: 'Execute JavaScript snippets in a controlled runtime'
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
    keywords: ['search', 'google', 'web', 'internet', 'online', 'latest', 'news', 'documentation', 'docs', 'how to', 'weather', 'météo', 'meteo', 'forecast', 'temperature', 'info', 'find', 'lookup'],
    priority: 8,
    description: 'Search the web for information including weather, news, documentation, and general queries',
    fleetSafe: true,
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
    name: 'audio',
    category: 'media',
    keywords: ['audio', 'sound', 'music', 'transcribe', 'speech', 'voice', 'mp3', 'wav'],
    priority: 5,
    description: 'Process audio files'
  },
  {
    name: 'video',
    category: 'media',
    keywords: ['video', 'movie', 'frames', 'thumbnail', 'mp4', 'extract'],
    priority: 5,
    description: 'Process video files'
  },
  {
    name: 'ocr',
    category: 'media',
    keywords: ['ocr', 'text', 'extract', 'image', 'recognize', 'read'],
    priority: 5,
    description: 'Extract text from images'
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
    name: 'gitnexus_ask',
    category: 'utility' as ToolCategory,
    keywords: ['gitnexus', 'ask', 'query', 'understand', 'explain', 'search', 'related files', 'dependents', 'tests'],
    priority: 6,
    description: 'Consult GitNexus for a query or code understanding request (read-only)',
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
  media: ['image', 'audio', 'video', 'screenshot', 'picture', 'photo', 'sound', 'music', 'capture', 'camera', 'webcam', 'vision'],
  document: ['pdf', 'document', 'docx', 'xlsx', 'word', 'excel', 'archive', 'zip'],
  utility: ['diagram', 'chart', 'export', 'qr', 'visualize', 'convert'],
  codebase: ['codebase', 'structure', 'architecture', 'analyze', 'overview', 'dependencies'],
  mcp: ['mcp', 'external', 'server', 'plugin']
};
