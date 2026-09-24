import { getPersonaManager } from '../../personas/persona-manager.js';
import type { CommandHandlerResult } from './branch-handlers.js';
import { failureFlag } from '../slash-failure.js';

/**
 * Handler for the `/persona` slash command.
 *
 * Subcommands:
 *   list              — list all available personas
 *   use <id|name>     — switch to a persona
 *   info [id|name]    — show details about the active (or named) persona
 *   reset             — revert to the default persona
 */
export function handlePersonaCommand(args: string): CommandHandlerResult {
  const manager = getPersonaManager();
  const parts = args.trim().split(/\s+/);
  const sub = parts[0]?.toLowerCase() ?? 'list';

  // ── list ──────────────────────────────────────────────────────────────────
  if (sub === 'list' || sub === '') {
    const personas = manager.getAllPersonas();
    const active = manager.getActivePersona();
    const lines = ['**Available Personas**\n'];
    for (const p of personas) {
      const marker = p.id === active?.id ? '→' : ' ';
      const type = p.isBuiltin ? '📦' : '✨';
      lines.push(`${marker} ${type} **${p.id}** — ${p.description}`);
    }
    lines.push('\nUse `/persona use <id>` to switch.');
    return {
      handled: true,
...failureFlag(lines.join('\n')),
      entry: { type: 'assistant', content: lines.join('\n'), timestamp: new Date() },
    };
  }

  // ── use <id> ─────────────────────────────────────────────────────────────
  if (sub === 'use' && parts.length > 1) {
    const target = parts.slice(1).join('-').toLowerCase();
    // Try exact ID first, then fuzzy name match
    const personas = manager.getAllPersonas();
    const match = personas.find(p =>
      p.id === target ||
      p.name.toLowerCase() === target ||
      p.name.toLowerCase().replace(/\s+/g, '-') === target
    );
    if (!match) {
      return {
        handled: true,
...failureFlag(`Persona "${parts.slice(1).join(' ')}" not found. Use \`/persona list\` to see available personas.`),
        entry: {
          type: 'assistant',
          content: `Persona "${parts.slice(1).join(' ')}" not found. Use \`/persona list\` to see available personas.`,
          timestamp: new Date(),
        },
      };
    }
    manager.setActivePersona(match.id);
    return {
      handled: true,
...failureFlag(`Switched to persona **${match.name}**.\n${match.description}`),
      entry: {
        type: 'assistant',
        content: `Switched to persona **${match.name}**.\n${match.description}`,
        timestamp: new Date(),
      },
    };
  }

  // ── info [id] ─────────────────────────────────────────────────────────────
  if (sub === 'info') {
    const targetId = parts[1];
    const persona = targetId
      ? manager.getPersona(targetId) ?? manager.getAllPersonas().find(p => p.name.toLowerCase() === targetId.toLowerCase())
      : manager.getActivePersona();

    if (!persona) {
      return {
        handled: true,
...failureFlag(targetId ? `Persona "${targetId}" not found.` : 'No active persona.'),
        entry: {
          type: 'assistant',
          content: targetId ? `Persona "${targetId}" not found.` : 'No active persona.',
          timestamp: new Date(),
        },
      };
    }

    const lines = [
      `**${persona.name}** (${persona.id})`,
      persona.description,
      '',
      `Type: ${persona.isBuiltin ? 'Built-in' : 'Custom'}`,
      `Expertise: ${persona.expertise.join(', ') || 'General'}`,
      `Style: ${persona.style.verbosity} • ${persona.style.tone} • ${persona.style.codeStyle}`,
    ];

    if (persona.traits.length > 0) {
      lines.push('', 'Traits:');
      for (const t of persona.traits) {
        const bar = '█'.repeat(Math.round(t.value / 10)) + '░'.repeat(10 - Math.round(t.value / 10));
        lines.push(`  ${t.name.padEnd(16)} [${bar}] ${t.value}`);
      }
    }

    return {
      handled: true,
...failureFlag(lines.join('\n')),
      entry: { type: 'assistant', content: lines.join('\n'), timestamp: new Date() },
    };
  }

  // ── reset ─────────────────────────────────────────────────────────────────
  if (sub === 'reset') {
    manager.setActivePersona('default');
    return {
      handled: true,
...failureFlag('Persona reset to **Default Assistant**.'),
      entry: {
        type: 'assistant',
        content: 'Persona reset to **Default Assistant**.',
        timestamp: new Date(),
      },
    };
  }

  // Unknown sub-command
  return {
    handled: true,
...failureFlag('Usage: /persona [list|use <name>|info [name]|reset]'),
    entry: {
      type: 'assistant',
      content: 'Usage: /persona [list|use <name>|info [name]|reset]',
      timestamp: new Date(),
    },
  };
}
