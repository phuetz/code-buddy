/**
 * Specialized Language/Framework Agents (Item 102)
 * Agents optimized for specific languages and frameworks
 */

import { EventEmitter } from 'events';

export type Language = 'typescript' | 'javascript' | 'python' | 'rust' | 'go' | 'java' | 'csharp';
export type Framework = 'react' | 'vue' | 'angular' | 'nextjs' | 'express' | 'fastapi' | 'django';

export interface AgentCapability {
  languages: Language[];
  frameworks: Framework[];
  specialties: string[];
}

export interface SpecializedAgent {
  id: string;
  name: string;
  description: string;
  capabilities: AgentCapability;
  systemPrompt: string;
  examples: Array<{ input: string; output: string }>;
}

const SPECIALIZED_AGENTS: SpecializedAgent[] = [
  {
    id: 'typescript-expert',
    name: 'TypeScript Expert',
    description: 'Specialized in TypeScript, type systems, and advanced patterns',
    capabilities: {
      languages: ['typescript', 'javascript'],
      frameworks: ['react', 'nextjs', 'express'],
      specialties: ['type inference', 'generics', 'decorators', 'module systems'],
    },
    systemPrompt: `You are a TypeScript expert. Focus on:
- Strict type safety and proper type annotations
- Advanced generics and conditional types
- Best practices for large codebases
- Performance optimization`,
    examples: [],
  },
  {
    id: 'python-expert',
    name: 'Python Expert',
    description: 'Specialized in Python, data science, and backend development',
    capabilities: {
      languages: ['python'],
      frameworks: ['fastapi', 'django'],
      specialties: ['async/await', 'data processing', 'type hints', 'testing'],
    },
    systemPrompt: `You are a Python expert. Focus on:
- Pythonic code and PEP standards
- Type hints and mypy compatibility
- Async programming patterns
- Testing with pytest`,
    examples: [],
  },
  {
    id: 'rust-expert',
    name: 'Rust Expert',
    description: 'Specialized in Rust, memory safety, and systems programming',
    capabilities: {
      languages: ['rust'],
      frameworks: [],
      specialties: ['ownership', 'lifetimes', 'concurrency', 'unsafe code'],
    },
    systemPrompt: `You are a Rust expert. Focus on:
- Memory safety and ownership rules
- Lifetime annotations
- Error handling with Result
- Zero-cost abstractions`,
    examples: [],
  },
  {
    id: 'react-expert',
    name: 'React Expert',
    description: 'Specialized in React, hooks, and frontend architecture',
    capabilities: {
      languages: ['typescript', 'javascript'],
      frameworks: ['react', 'nextjs'],
      specialties: ['hooks', 'state management', 'performance', 'testing'],
    },
    systemPrompt: `You are a React expert. Focus on:
- Functional components and hooks
- State management patterns
- Performance optimization
- Accessibility best practices`,
    examples: [],
  },
];

export class SpecializedAgentManager extends EventEmitter {
  private agents: Map<string, SpecializedAgent> = new Map();
  private currentAgent: SpecializedAgent | null = null;

  constructor() {
    super();
    SPECIALIZED_AGENTS.forEach(agent => this.agents.set(agent.id, agent));
  }

  getAgents(): SpecializedAgent[] {
    return Array.from(this.agents.values());
  }

  getAgent(id: string): SpecializedAgent | undefined {
    return this.agents.get(id);
  }

  selectAgentForLanguage(language: Language): SpecializedAgent | undefined {
    for (const agent of this.agents.values()) {
      if (agent.capabilities.languages.includes(language)) {
        return agent;
      }
    }
    return undefined;
  }

  selectAgentForFramework(framework: Framework): SpecializedAgent | undefined {
    for (const agent of this.agents.values()) {
      if (agent.capabilities.frameworks.includes(framework)) {
        return agent;
      }
    }
    return undefined;
  }

  autoSelectAgent(context: { language?: Language; framework?: Framework }): SpecializedAgent | undefined {
    if (context.framework) {
      const agent = this.selectAgentForFramework(context.framework);
      if (agent) return agent;
    }
    if (context.language) {
      return this.selectAgentForLanguage(context.language);
    }
    return undefined;
  }

  setCurrentAgent(id: string): boolean {
    const agent = this.agents.get(id);
    if (agent) {
      this.currentAgent = agent;
      this.emit('agent-selected', agent);
      return true;
    }
    return false;
  }

  getCurrentAgent(): SpecializedAgent | null {
    return this.currentAgent;
  }

  registerAgent(agent: SpecializedAgent): void {
    this.agents.set(agent.id, agent);
    this.emit('agent-registered', agent);
  }
}

let instance: SpecializedAgentManager | null = null;

export function getSpecializedAgentManager(): SpecializedAgentManager {
  if (!instance) instance = new SpecializedAgentManager();
  return instance;
}

export default SpecializedAgentManager;
