/**
 * Custom Personas System
 *
 * Features:
 * - Predefined personas (Senior Dev, Code Reviewer, etc.)
 * - Custom persona creation
 * - Context-aware persona selection
 * - Persona switching during conversation
 * - Persona templates and sharing
 *
 * Allows customizing Grok's behavior and expertise.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

export interface Persona {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  traits: PersonaTrait[];
  expertise: string[];
  style: PersonaStyle;
  examples?: ConversationExample[];
  triggers?: PersonaTrigger[];
  isBuiltin: boolean;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PersonaTrait {
  name: string;
  value: number; // 0-100
  description: string;
}

export interface PersonaStyle {
  verbosity: 'concise' | 'balanced' | 'detailed';
  formality: 'casual' | 'professional' | 'formal';
  tone: 'friendly' | 'neutral' | 'authoritative';
  codeStyle: 'minimal' | 'commented' | 'documented';
  explanationDepth: 'surface' | 'moderate' | 'deep';
}

export interface ConversationExample {
  user: string;
  assistant: string;
}

export interface PersonaTrigger {
  type: 'keyword' | 'fileType' | 'context' | 'command';
  pattern: string;
  priority: number;
}

export interface PersonaConfig {
  activePersonaId: string;
  autoSwitch: boolean;
  customPersonasDir: string;
}

const DEFAULT_STYLE: PersonaStyle = {
  verbosity: 'balanced',
  formality: 'professional',
  tone: 'friendly',
  codeStyle: 'commented',
  explanationDepth: 'moderate',
};

// Built-in personas
const BUILTIN_PERSONAS: Omit<Persona, 'createdAt' | 'updatedAt'>[] = [
  {
    id: 'default',
    name: 'Default Assistant',
    description: 'A balanced, helpful coding assistant',
    systemPrompt: `You are a helpful coding assistant. You provide clear, accurate, and practical solutions. You explain your reasoning when helpful but stay focused on the task at hand.`,
    traits: [
      { name: 'helpfulness', value: 90, description: 'Eagerness to help' },
      { name: 'precision', value: 80, description: 'Accuracy and attention to detail' },
      { name: 'creativity', value: 70, description: 'Creative problem solving' },
    ],
    expertise: ['general programming', 'debugging', 'code review'],
    style: DEFAULT_STYLE,
    isBuiltin: true,
    isDefault: true,
  },
  {
    id: 'senior-developer',
    name: 'Senior Developer',
    description: 'An experienced developer focused on best practices and architecture',
    systemPrompt: `You are a senior software developer with 15+ years of experience. You focus on:
- Clean code principles and SOLID design
- Scalable architecture decisions
- Performance optimization
- Security best practices
- Code maintainability
- Mentoring and knowledge sharing

When reviewing code, you look for potential issues, suggest improvements, and explain the reasoning behind best practices. You're direct but supportive, always aiming to help developers grow.`,
    traits: [
      { name: 'experience', value: 95, description: 'Years of industry experience' },
      { name: 'mentorship', value: 85, description: 'Teaching and guidance ability' },
      { name: 'pragmatism', value: 90, description: 'Practical, real-world focus' },
    ],
    expertise: [
      'software architecture',
      'design patterns',
      'code review',
      'performance',
      'security',
      'team leadership',
    ],
    style: {
      verbosity: 'balanced',
      formality: 'professional',
      tone: 'authoritative',
      codeStyle: 'documented',
      explanationDepth: 'deep',
    },
    triggers: [
      { type: 'keyword', pattern: 'architecture', priority: 80 },
      { type: 'keyword', pattern: 'design pattern', priority: 80 },
      { type: 'keyword', pattern: 'refactor', priority: 70 },
    ],
    isBuiltin: true,
    isDefault: false,
  },
  {
    id: 'code-reviewer',
    name: 'Code Reviewer',
    description: 'A thorough code reviewer focused on quality and standards',
    systemPrompt: `You are an expert code reviewer. Your role is to:
- Identify bugs, security vulnerabilities, and performance issues
- Ensure code follows team/project conventions
- Suggest improvements for readability and maintainability
- Check for proper error handling
- Verify test coverage
- Look for potential edge cases

Provide specific, actionable feedback with line references. Categorize issues by severity (critical, major, minor, suggestion). Be constructive and explain why changes are recommended.`,
    traits: [
      { name: 'thoroughness', value: 95, description: 'Attention to every detail' },
      { name: 'constructiveness', value: 85, description: 'Helpful, not harsh feedback' },
      { name: 'standards', value: 90, description: 'Knowledge of best practices' },
    ],
    expertise: [
      'code review',
      'bug detection',
      'security analysis',
      'code standards',
      'testing',
    ],
    style: {
      verbosity: 'detailed',
      formality: 'professional',
      tone: 'neutral',
      codeStyle: 'documented',
      explanationDepth: 'deep',
    },
    triggers: [
      { type: 'command', pattern: 'review', priority: 90 },
      { type: 'keyword', pattern: 'code review', priority: 85 },
      { type: 'keyword', pattern: 'pull request', priority: 80 },
    ],
    isBuiltin: true,
    isDefault: false,
  },
  {
    id: 'debugger',
    name: 'Debugging Expert',
    description: 'A systematic debugger who excels at finding and fixing issues',
    systemPrompt: `You are a debugging expert. Your approach:
1. Gather information about the error (message, stack trace, context)
2. Form hypotheses about potential causes
3. Suggest diagnostic steps to narrow down the issue
4. Identify the root cause
5. Provide a fix with explanation
6. Suggest preventive measures

You think systematically, ask clarifying questions when needed, and explain your debugging process so others can learn.`,
    traits: [
      { name: 'analytical', value: 95, description: 'Systematic problem analysis' },
      { name: 'patience', value: 90, description: 'Methodical investigation' },
      { name: 'intuition', value: 80, description: 'Pattern recognition' },
    ],
    expertise: [
      'debugging',
      'error analysis',
      'stack traces',
      'logging',
      'testing',
      'root cause analysis',
    ],
    style: {
      verbosity: 'detailed',
      formality: 'professional',
      tone: 'friendly',
      codeStyle: 'commented',
      explanationDepth: 'deep',
    },
    triggers: [
      { type: 'keyword', pattern: 'error', priority: 70 },
      { type: 'keyword', pattern: 'bug', priority: 75 },
      { type: 'keyword', pattern: 'debug', priority: 85 },
      { type: 'keyword', pattern: 'fix', priority: 65 },
    ],
    isBuiltin: true,
    isDefault: false,
  },
  {
    id: 'teacher',
    name: 'Patient Teacher',
    description: 'An educational persona focused on learning and understanding',
    systemPrompt: `You are a patient programming teacher. Your approach:
- Start with the fundamentals before diving into complexity
- Use analogies and real-world examples
- Break down complex concepts into digestible parts
- Encourage questions and exploration
- Provide exercises and challenges when appropriate
- Celebrate progress and growth

You adapt your explanations to the learner's level, never make them feel bad for not knowing something, and foster curiosity and love of learning.`,
    traits: [
      { name: 'patience', value: 98, description: 'Infinite patience for learners' },
      { name: 'clarity', value: 95, description: 'Clear explanations' },
      { name: 'encouragement', value: 90, description: 'Supportive and motivating' },
    ],
    expertise: [
      'teaching',
      'fundamentals',
      'explanations',
      'examples',
      'learning paths',
    ],
    style: {
      verbosity: 'detailed',
      formality: 'casual',
      tone: 'friendly',
      codeStyle: 'commented',
      explanationDepth: 'deep',
    },
    triggers: [
      { type: 'keyword', pattern: 'explain', priority: 80 },
      { type: 'keyword', pattern: 'how does', priority: 75 },
      { type: 'keyword', pattern: 'what is', priority: 70 },
      { type: 'keyword', pattern: 'learn', priority: 80 },
    ],
    isBuiltin: true,
    isDefault: false,
  },
  {
    id: 'minimalist',
    name: 'Minimalist Coder',
    description: 'A concise assistant who provides brief, to-the-point responses',
    systemPrompt: `You value brevity and efficiency. You provide:
- Minimal but complete solutions
- Code without unnecessary comments
- Short, direct answers
- No preamble or excessive explanation

Get straight to the point. Show, don't tell. Let the code speak for itself.`,
    traits: [
      { name: 'brevity', value: 98, description: 'Maximum conciseness' },
      { name: 'efficiency', value: 95, description: 'No wasted words or code' },
      { name: 'precision', value: 90, description: 'Exactly what\'s needed' },
    ],
    expertise: [
      'clean code',
      'efficiency',
      'minimalism',
    ],
    style: {
      verbosity: 'concise',
      formality: 'professional',
      tone: 'neutral',
      codeStyle: 'minimal',
      explanationDepth: 'surface',
    },
    isBuiltin: true,
    isDefault: false,
  },
  {
    id: 'security-expert',
    name: 'Security Expert',
    description: 'A security-focused developer who identifies vulnerabilities',
    systemPrompt: `You are a cybersecurity expert. You focus on:
- OWASP Top 10 vulnerabilities
- Input validation and sanitization
- Authentication and authorization
- Secure coding practices
- Encryption and data protection
- Security auditing

When reviewing code, you actively look for security issues. You explain risks clearly and provide secure alternatives. You stay updated on the latest security threats and best practices.`,
    traits: [
      { name: 'vigilance', value: 98, description: 'Always security-conscious' },
      { name: 'knowledge', value: 95, description: 'Deep security expertise' },
      { name: 'paranoia', value: 85, description: 'Healthy skepticism' },
    ],
    expertise: [
      'security',
      'vulnerabilities',
      'OWASP',
      'encryption',
      'authentication',
      'penetration testing',
    ],
    style: {
      verbosity: 'detailed',
      formality: 'professional',
      tone: 'authoritative',
      codeStyle: 'documented',
      explanationDepth: 'deep',
    },
    triggers: [
      { type: 'keyword', pattern: 'security', priority: 90 },
      { type: 'keyword', pattern: 'vulnerability', priority: 85 },
      { type: 'keyword', pattern: 'auth', priority: 75 },
      { type: 'keyword', pattern: 'password', priority: 70 },
    ],
    isBuiltin: true,
    isDefault: false,
  },
];

/**
 * Persona Manager
 */
export class PersonaManager extends EventEmitter {
  private config: PersonaConfig;
  private personas: Map<string, Persona> = new Map();
  private activePersona: Persona | null = null;
  private dataDir: string;

  constructor(config: Partial<PersonaConfig> = {}) {
    super();
    this.config = {
      activePersonaId: config.activePersonaId || 'default',
      autoSwitch: config.autoSwitch ?? true,
      customPersonasDir: config.customPersonasDir ||
        path.join(os.homedir(), '.grok', 'personas'),
    };
    this.dataDir = this.config.customPersonasDir;
    this.initialize();
  }

  /**
   * Initialize persona manager
   */
  private async initialize(): Promise<void> {
    await fs.ensureDir(this.dataDir);

    // Load built-in personas
    for (const persona of BUILTIN_PERSONAS) {
      const fullPersona: Persona = {
        ...persona,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.personas.set(persona.id, fullPersona);
    }

    // Load custom personas
    await this.loadCustomPersonas();

    // Set active persona
    this.setActivePersona(this.config.activePersonaId);
  }

  /**
   * Load custom personas from disk
   */
  private async loadCustomPersonas(): Promise<void> {
    const files = await fs.readdir(this.dataDir);

    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const personaPath = path.join(this.dataDir, file);
          const persona = await fs.readJSON(personaPath);
          persona.isBuiltin = false;
          this.personas.set(persona.id, persona);
        } catch {
          // Skip invalid files
        }
      }
    }
  }

  /**
   * Set active persona
   */
  setActivePersona(id: string): boolean {
    const persona = this.personas.get(id);
    if (!persona) {
      return false;
    }

    const previousPersona = this.activePersona;
    this.activePersona = persona;
    this.config.activePersonaId = id;

    this.emit('persona:changed', {
      previous: previousPersona,
      current: persona,
    });

    return true;
  }

  /**
   * Get active persona
   */
  getActivePersona(): Persona | null {
    return this.activePersona;
  }

  /**
   * Get persona by ID
   */
  getPersona(id: string): Persona | undefined {
    return this.personas.get(id);
  }

  /**
   * Get all personas
   */
  getAllPersonas(): Persona[] {
    return Array.from(this.personas.values());
  }

  /**
   * Get built-in personas
   */
  getBuiltinPersonas(): Persona[] {
    return this.getAllPersonas().filter(p => p.isBuiltin);
  }

  /**
   * Get custom personas
   */
  getCustomPersonas(): Persona[] {
    return this.getAllPersonas().filter(p => !p.isBuiltin);
  }

  /**
   * Create a custom persona
   */
  async createPersona(options: {
    name: string;
    description: string;
    systemPrompt: string;
    traits?: PersonaTrait[];
    expertise?: string[];
    style?: Partial<PersonaStyle>;
    examples?: ConversationExample[];
    triggers?: PersonaTrigger[];
  }): Promise<Persona> {
    const id = options.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

    if (this.personas.has(id)) {
      throw new Error(`Persona with ID "${id}" already exists`);
    }

    const persona: Persona = {
      id,
      name: options.name,
      description: options.description,
      systemPrompt: options.systemPrompt,
      traits: options.traits || [],
      expertise: options.expertise || [],
      style: { ...DEFAULT_STYLE, ...options.style },
      examples: options.examples,
      triggers: options.triggers,
      isBuiltin: false,
      isDefault: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Save to disk
    const personaPath = path.join(this.dataDir, `${id}.json`);
    await fs.writeJSON(personaPath, persona, { spaces: 2 });

    this.personas.set(id, persona);
    this.emit('persona:created', { persona });

    return persona;
  }

  /**
   * Update a persona
   */
  async updatePersona(id: string, updates: Partial<Omit<Persona, 'id' | 'isBuiltin' | 'createdAt'>>): Promise<Persona | null> {
    const persona = this.personas.get(id);
    if (!persona) {
      return null;
    }

    if (persona.isBuiltin) {
      throw new Error('Cannot modify built-in personas');
    }

    const updated: Persona = {
      ...persona,
      ...updates,
      updatedAt: new Date(),
    };

    // Save to disk
    const personaPath = path.join(this.dataDir, `${id}.json`);
    await fs.writeJSON(personaPath, updated, { spaces: 2 });

    this.personas.set(id, updated);
    this.emit('persona:updated', { persona: updated });

    return updated;
  }

  /**
   * Delete a persona
   */
  async deletePersona(id: string): Promise<boolean> {
    const persona = this.personas.get(id);
    if (!persona) {
      return false;
    }

    if (persona.isBuiltin) {
      throw new Error('Cannot delete built-in personas');
    }

    // Remove from disk
    const personaPath = path.join(this.dataDir, `${id}.json`);
    await fs.remove(personaPath);

    this.personas.delete(id);

    // Switch to default if active persona was deleted
    if (this.activePersona?.id === id) {
      this.setActivePersona('default');
    }

    this.emit('persona:deleted', { id });

    return true;
  }

  /**
   * Clone a persona
   */
  async clonePersona(id: string, newName: string): Promise<Persona | null> {
    const source = this.personas.get(id);
    if (!source) {
      return null;
    }

    return this.createPersona({
      name: newName,
      description: `Clone of ${source.name}: ${source.description}`,
      systemPrompt: source.systemPrompt,
      traits: [...source.traits],
      expertise: [...source.expertise],
      style: { ...source.style },
      examples: source.examples ? [...source.examples] : undefined,
      triggers: source.triggers ? [...source.triggers] : undefined,
    });
  }

  /**
   * Auto-select persona based on context
   */
  autoSelectPersona(context: {
    message?: string;
    fileType?: string;
    command?: string;
  }): Persona | null {
    if (!this.config.autoSwitch) {
      return this.activePersona;
    }

    let bestMatch: { persona: Persona; score: number } | null = null;

    for (const persona of this.personas.values()) {
      if (!persona.triggers) continue;

      for (const trigger of persona.triggers) {
        let matches = false;

        switch (trigger.type) {
          case 'keyword':
            if (context.message) {
              matches = context.message.toLowerCase().includes(trigger.pattern.toLowerCase());
            }
            break;

          case 'fileType':
            if (context.fileType) {
              matches = context.fileType === trigger.pattern;
            }
            break;

          case 'command':
            if (context.command) {
              matches = context.command.toLowerCase() === trigger.pattern.toLowerCase();
            }
            break;

          case 'context':
            // More complex context matching could go here
            break;
        }

        if (matches) {
          if (!bestMatch || trigger.priority > bestMatch.score) {
            bestMatch = { persona, score: trigger.priority };
          }
        }
      }
    }

    if (bestMatch && bestMatch.persona.id !== this.activePersona?.id) {
      this.setActivePersona(bestMatch.persona.id);
      return bestMatch.persona;
    }

    return this.activePersona;
  }

  /**
   * Build system prompt for active persona
   */
  buildSystemPrompt(additionalContext?: string): string {
    const persona = this.activePersona;
    if (!persona) {
      return additionalContext || '';
    }

    let prompt = persona.systemPrompt;

    // Add style instructions
    const styleInstructions: string[] = [];

    switch (persona.style.verbosity) {
      case 'concise':
        styleInstructions.push('Be brief and to the point.');
        break;
      case 'detailed':
        styleInstructions.push('Provide thorough explanations.');
        break;
    }

    switch (persona.style.tone) {
      case 'friendly':
        styleInstructions.push('Use a warm, approachable tone.');
        break;
      case 'authoritative':
        styleInstructions.push('Speak with confidence and authority.');
        break;
    }

    switch (persona.style.codeStyle) {
      case 'minimal':
        styleInstructions.push('Write clean code with minimal comments.');
        break;
      case 'documented':
        styleInstructions.push('Include comprehensive documentation in code.');
        break;
    }

    if (styleInstructions.length > 0) {
      prompt += '\n\nStyle guidelines:\n' + styleInstructions.map(s => `- ${s}`).join('\n');
    }

    // Add expertise areas
    if (persona.expertise.length > 0) {
      prompt += `\n\nYour areas of expertise: ${persona.expertise.join(', ')}`;
    }

    // Add examples
    if (persona.examples && persona.examples.length > 0) {
      prompt += '\n\nExample interactions:\n';
      for (const example of persona.examples.slice(0, 2)) {
        prompt += `User: ${example.user}\nAssistant: ${example.assistant}\n\n`;
      }
    }

    // Add additional context
    if (additionalContext) {
      prompt += '\n\n' + additionalContext;
    }

    return prompt;
  }

  /**
   * Export persona to JSON
   */
  async exportPersona(id: string): Promise<string> {
    const persona = this.personas.get(id);
    if (!persona) {
      throw new Error('Persona not found');
    }

    return JSON.stringify(persona, null, 2);
  }

  /**
   * Import persona from JSON
   */
  async importPersona(json: string): Promise<Persona> {
    const data = JSON.parse(json);

    // Validate required fields
    if (!data.name || !data.systemPrompt) {
      throw new Error('Invalid persona: missing required fields');
    }

    // Generate new ID to avoid conflicts
    const baseId = data.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    let id = baseId;
    let counter = 1;

    while (this.personas.has(id)) {
      id = `${baseId}-${counter}`;
      counter++;
    }

    return this.createPersona({
      name: data.name,
      description: data.description || '',
      systemPrompt: data.systemPrompt,
      traits: data.traits,
      expertise: data.expertise,
      style: data.style,
      examples: data.examples,
      triggers: data.triggers,
    });
  }

  /**
   * Format status
   */
  formatStatus(): string {
    const active = this.activePersona;
    const all = this.getAllPersonas();

    const lines = [
      '╔══════════════════════════════════════════════════════════════╗',
      '║                    🎭 PERSONA MANAGER                        ║',
      '╠══════════════════════════════════════════════════════════════╣',
    ];

    if (active) {
      lines.push(`║ Active: ${active.name.padEnd(50)}║`);
      lines.push(`║ ${active.description.slice(0, 58).padEnd(58)}║`);
      lines.push('║                                                              ║');
    }

    lines.push('╠══════════════════════════════════════════════════════════════╣');
    lines.push('║ AVAILABLE PERSONAS                                           ║');

    for (const persona of all) {
      const marker = persona.id === active?.id ? '→' : ' ';
      const type = persona.isBuiltin ? '📦' : '✨';
      lines.push(`║ ${marker} ${type} ${persona.name.slice(0, 30).padEnd(30)} ${persona.expertise.slice(0, 2).join(', ').slice(0, 20).padEnd(20)} ║`);
    }

    lines.push('╠══════════════════════════════════════════════════════════════╣');
    lines.push('║ /persona <name> | /persona create | /persona list            ║');
    lines.push('╚══════════════════════════════════════════════════════════════╝');

    return lines.join('\n');
  }

  /**
   * Get config
   */
  getConfig(): PersonaConfig {
    return { ...this.config };
  }

  /**
   * Dispose
   */
  dispose(): void {
    this.removeAllListeners();
  }
}

// Singleton
let personaManagerInstance: PersonaManager | null = null;

export function getPersonaManager(config?: Partial<PersonaConfig>): PersonaManager {
  if (!personaManagerInstance) {
    personaManagerInstance = new PersonaManager(config);
  }
  return personaManagerInstance;
}

export function resetPersonaManager(): void {
  if (personaManagerInstance) {
    personaManagerInstance.dispose();
  }
  personaManagerInstance = null;
}
