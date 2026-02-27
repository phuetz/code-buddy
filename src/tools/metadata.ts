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
    description: 'View file contents or directory listings'
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
    description: 'List files and directories with type, size, and modification time'
  },

  // File search
  {
    name: 'search',
    category: 'file_search',
    keywords: ['search', 'find', 'locate', 'grep', 'look for', 'where', 'which', 'query', 'pattern', 'regex'],
    priority: 10,
    description: 'Search for text content or files'
  },

  // System operations
  {
    name: 'bash',
    category: 'system',
    keywords: ['bash', 'terminal', 'command', 'run', 'execute', 'shell', 'npm', 'yarn', 'pip', 'install', 'build', 'test', 'compile'],
    priority: 9,
    description: 'Execute bash commands'
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
    description: 'Search the web for information including weather, news, documentation, and general queries'
  },
  {
    name: 'web_fetch',
    category: 'web',
    keywords: ['fetch', 'url', 'website', 'page', 'download', 'http', 'https', 'link', 'read'],
    priority: 7,
    description: 'Fetch web page content'
  },
  {
    name: 'browser',
    category: 'web',
    keywords: ['browser', 'automate', 'click', 'fill', 'form', 'screenshot', 'scrape', 'navigate', 'headless', 'puppeteer', 'playwright', 'selenium', 'test', 'ui', 'automation', 'web'],
    priority: 6,
    description: 'Automate web browser for navigation, interaction, and testing'
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
    description: 'View current todo list and task status'
  },
  {
    name: 'update_todo_list',
    category: 'planning',
    keywords: ['todo', 'update', 'complete', 'done', 'progress', 'status', 'mark'],
    priority: 6,
    description: 'Update todo list progress'
  },

  // Codebase analysis
  {
    name: 'codebase_map',
    category: 'codebase',
    keywords: ['codebase', 'structure', 'architecture', 'map', 'overview', 'symbols', 'dependencies', 'analyze'],
    priority: 6,
    description: 'Analyze codebase structure'
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
    keywords: ['docx', 'xlsx', 'pptx', 'word', 'excel', 'powerpoint', 'office', 'spreadsheet'],
    priority: 5,
    description: 'Read Office documents'
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
    description: 'Solve complex problems using Tree-of-Thought reasoning with MCTS'
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
    description: 'Restore compressed context content by identifier'
  },
  {
    name: 'knowledge_search',
    category: 'utility',
    keywords: ['knowledge', 'search', 'convention', 'docs', 'domain', 'procedure'],
    priority: 5,
    description: 'Search the agent knowledge base'
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
    name: 'device_manage',
    category: 'utility',
    keywords: ['device', 'ssh', 'adb', 'android', 'remote', 'screenshot', 'camera', 'pair'],
    priority: 4,
    description: 'Manage paired devices (SSH/ADB/local)'
  },
  {
    name: 'lessons_add',
    category: 'utility',
    keywords: ['lesson', 'learn', 'correction', 'pattern', 'rule', 'mistake'],
    priority: 5,
    description: 'Capture a lesson learned'
  },
  {
    name: 'lessons_search',
    category: 'utility',
    keywords: ['lesson', 'search', 'pattern', 'rule', 'past', 'history', 'mistake'],
    priority: 5,
    description: 'Search lessons learned'
  },
  {
    name: 'lessons_list',
    category: 'utility',
    keywords: ['lesson', 'list', 'all', 'show', 'history'],
    priority: 4,
    description: 'List all lessons learned'
  },
  {
    name: 'task_verify',
    category: 'utility',
    keywords: ['verify', 'test', 'typecheck', 'lint', 'check', 'validate', 'ci'],
    priority: 7,
    description: 'Run verification contract (tsc, test, lint)'
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
  web: ['search online', 'google', 'web', 'internet', 'fetch url', 'website', 'documentation', 'latest', 'news', 'browser', 'automate', 'click', 'fill form', 'screenshot', 'scrape', 'headless', 'ui test', 'weather', 'météo', 'meteo', 'forecast', 'temperature', 'actualité', 'actualite', 'current events', 'real time', 'real-time'],
  planning: ['plan', 'todo', 'task', 'organize', 'steps', 'breakdown'],
  media: ['image', 'audio', 'video', 'screenshot', 'picture', 'photo', 'sound', 'music', 'capture'],
  document: ['pdf', 'document', 'docx', 'xlsx', 'word', 'excel', 'archive', 'zip'],
  utility: ['diagram', 'chart', 'export', 'qr', 'visualize', 'convert'],
  codebase: ['codebase', 'structure', 'architecture', 'analyze', 'overview', 'dependencies'],
  mcp: ['mcp', 'external', 'server', 'plugin']
};
