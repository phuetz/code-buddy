/**
 * Starter Pack Slash Command Handler
 *
 * /starter, /starter list - List all starter packs grouped by language
 * /starter <name>       - Activate a specific starter pack (name or alias)
 * /starter search <q>   - Search starters by keyword
 */

import type { CommandHandlerResult } from './extra-handlers.js';
import { getStarterPacks, resolveStarterAlias, findStarterPack } from '../../skills/starter-packs.js';
import { getSkillRegistry } from '../../skills/registry.js';
import { failureFlag } from '../slash-failure.js';

/** Language family grouping for display */
const LANGUAGE_FAMILIES: Record<string, string[]> = {
  'TypeScript / JavaScript': ['typescript', 'typescript-node', 'typescript-react', 'typescript-nextjs',
    'typescript-vue', 'typescript-svelte', 'typescript-angular', 'typescript-electron', 'typescript-react-native'],
  'Python': ['python', 'python-django', 'python-flask', 'python-fastapi'],
  'Rust': ['rust', 'rust-axum', 'rust-tauri'],
  'Go': ['go', 'go-gin', 'go-fiber'],
  'JVM': ['java', 'java-spring', 'kotlin', 'kotlin-ktor'],
  'C# / .NET': ['csharp-dotnet', 'csharp-aspnet', 'csharp-maui'],
  'Ruby': ['ruby', 'ruby-rails'],
  'PHP': ['php', 'php-laravel'],
  'Elixir': ['elixir', 'elixir-phoenix'],
  'Swift': ['swift', 'swift-vapor'],
  'Zig': ['zig'],
};

function formatStarterList(): string {
  const starters = getStarterPacks();
  if (starters.length === 0) {
    // No starter pack ships with the package today: say where packs are found
    // instead of implying a loading failure.
    return [
      'No starter packs are installed.',
      '',
      'Starter packs are SKILL.md skills tagged "starter", discovered in:',
      '  .codebuddy/skills/        (this project)',
      '  ~/.codebuddy/skills/      (user)',
      '  the bundled skills directory shipped with Code Buddy',
    ].join('\n');
  }

  const lines: string[] = [
    `Starter Packs (${starters.length} available)`,
    '═'.repeat(50),
    '',
  ];

  // Group by family
  const assigned = new Set<string>();

  for (const [family, prefixes] of Object.entries(LANGUAGE_FAMILIES)) {
    const familyStarters = starters.filter(s =>
      prefixes.some(p => s.metadata.name === p) && !assigned.has(s.metadata.name)
    );
    if (familyStarters.length === 0) continue;

    lines.push(`  ${family}:`);
    for (const s of familyStarters) {
      lines.push(`    ${s.metadata.name.padEnd(28)} ${s.metadata.description.slice(0, 60)}`);
      assigned.add(s.metadata.name);
    }
    lines.push('');
  }

  // Any remaining (not in a family)
  const remaining = starters.filter(s => !assigned.has(s.metadata.name));
  if (remaining.length > 0) {
    lines.push('  Other:');
    for (const s of remaining) {
      lines.push(`    ${s.metadata.name.padEnd(28)} ${s.metadata.description.slice(0, 60)}`);
    }
    lines.push('');
  }

  lines.push('Usage: /starter <name>  or  /starter search <query>');
  lines.push('Aliases: react, next, django, rails, axum, spring, etc.');

  return lines.join('\n');
}

export async function handleStarter(args: string[]): Promise<CommandHandlerResult> {
  // /starter (no args) — list all
  if (args.length === 0) {
    return {
      handled: true,
...failureFlag(formatStarterList()),
      entry: {
        type: 'assistant',
        content: formatStarterList(),
        timestamp: new Date(),
      },
    };
  }

  const first = args[0];
  if (first === undefined) {
    return {
      handled: true,
...failureFlag(formatStarterList()),
      entry: {
        type: 'assistant',
        content: formatStarterList(),
        timestamp: new Date(),
      },
    };
  }
  const action = first.toLowerCase();

  // /starter list — documented alias of the bare command
  if (action === 'list' && args.length === 1) {
    return {
      handled: true,
...failureFlag(formatStarterList()),
      entry: {
        type: 'assistant',
        content: formatStarterList(),
        timestamp: new Date(),
      },
    };
  }

  if (action === 'search' && args.length === 1) {
    return {
      handled: true,
...failureFlag('Usage: /starter search <query>'),
      entry: {
        type: 'assistant',
        content: 'Usage: /starter search <query>',
        timestamp: new Date(),
      },
    };
  }

  // /starter search <query>
  if (action === 'search' && args.length > 1) {
    const query = args.slice(1).join(' ');
    const match = findStarterPack(query);
    if (!match) {
      return {
        handled: true,
...failureFlag(`No starter pack found for "${query}". Try /starter to see all available packs.`),
        entry: {
          type: 'assistant',
          content: `No starter pack found for "${query}". Try /starter to see all available packs.`,
          timestamp: new Date(),
        },
      };
    }
    return {
      handled: true,
...failureFlag(`Best match: **${match.skill.metadata.name}** (${(match.confidence * 100).toFixed(0)}% confidence)\n${match.skill.metadata.description}\n\nActivate with: /starter ${match.skill.metadata.name}`),
      entry: {
        type: 'assistant',
        content: `Best match: **${match.skill.metadata.name}** (${(match.confidence * 100).toFixed(0)}% confidence)\n${match.skill.metadata.description}\n\nActivate with: /starter ${match.skill.metadata.name}`,
        timestamp: new Date(),
      },
    };
  }

  // /starter <name> — activate
  const resolved = resolveStarterAlias(args.join('-'));
  const registry = getSkillRegistry();
  let skill = registry.get(resolved);

  // Try without join (single word alias)
  if (!skill) {
    const altResolved = resolveStarterAlias(first);
    skill = registry.get(altResolved);
  }

  // Direct name match
  if (!skill) {
    skill = registry.get(args.join('-'));
  }

  if (!skill) {
    // Fuzzy search fallback
    const match = findStarterPack(args.join(' '));
    if (match && match.confidence >= 0.3) {
      skill = match.skill;
    }
  }

  if (!skill) {
    return {
      handled: true,
...failureFlag(`Starter pack "${args.join(' ')}" not found. Try /starter to see all available packs.`),
      entry: {
        type: 'assistant',
        content: `Starter pack "${args.join(' ')}" not found. Try /starter to see all available packs.`,
        timestamp: new Date(),
      },
    };
  }

  // Activate: pass the skill content to the AI as context
  const prompt = skill.content.rawMarkdown;
  return {
    handled: true,
...failureFlag(`Activated starter pack: **${skill.metadata.name}**\n${skill.metadata.description}\n\nI'll use this as guidance for setting up your project.`),
    passToAI: true,
    prompt: `[Starter Pack: ${skill.metadata.name}]\n\nThe user wants to scaffold a new project. Use the following starter pack as guidance:\n\n${prompt}`,
    entry: {
      type: 'assistant',
      content: `Activated starter pack: **${skill.metadata.name}**\n${skill.metadata.description}\n\nI'll use this as guidance for setting up your project.`,
      timestamp: new Date(),
    },
  };
}
