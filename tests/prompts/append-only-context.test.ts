/**
 * Le contexte variable s'ajoute. Il ne réécrit pas un message déjà produit.
 */
import { describe, expect, it } from 'vitest';
import {
  appendEnvironmentChange,
  appendEnvironmentFromVolatile,
  appendMemoryIfChanged,
  dedupeContextMessages,
  sealAppendOnlyTranscript,
} from '../../src/prompts/append-only-context.js';

const PROMPT = [
  'Consignes stables.',
  '',
  '<persistent_memory>',
  'Project: dossier-alpha',
  'Note: memoire-stable',
  '</persistent_memory>',
  '',
  '<context>',
  '- Current date: 2026-10-04',
  '- Working directory: /tmp/alpha',
  '- Platform: linux',
  '</context>',
].join('\n');

describe('contexte en ajout seul', () => {
  it('scelle le premier envoi et garde ce préfixe quand la date et le dossier changent', () => {
    const history = [
      { role: 'system' as const, content: PROMPT },
      { role: 'user' as const, content: 'premier' },
    ];
    const first = sealAppendOnlyTranscript(history, history, {
      date: '2026-10-04',
      directory: '/tmp/alpha',
    });
    expect(first).toBe(history);
    expect(String(history[0]?.content)).not.toContain('Working directory:');
    expect(String(history[0]?.content)).toContain('Note: memoire-stable');
    expect(String(history[0]?.content)).not.toContain('Project:');
    expect(String(history.at(-1)?.content)).toContain('<environment_context>');
    expect(String(history.at(-1)?.content)).toContain('/tmp/alpha');

    const sent = history.map(message => ({ ...message }));
    history.push({ role: 'assistant', content: 'ok' });
    history.push({ role: 'user', content: 'suite' });
    appendEnvironmentChange(history, { date: '2026-12-15', directory: '/tmp/beta', project: 'dossier-beta' });
    const second = sealAppendOnlyTranscript(history, history, {
      date: '2026-12-15',
      directory: '/tmp/beta',
      project: 'dossier-beta',
    });

    const sentJson = JSON.stringify(sent);
    expect(JSON.stringify(second.slice(0, sent.length))).toBe(sentJson);
    expect(String(history[0]?.content)).toBe(String(sent[0]?.content));
    expect(JSON.stringify(second)).toContain('2026-12-15');
    expect(JSON.stringify(second)).toContain('/tmp/beta');
    expect(JSON.stringify(second)).toContain('dossier-beta');
    expect(JSON.stringify(second)).toContain('/tmp/alpha');
  });

  it('n’ajoute la mémoire et l’environnement qu’une fois, puis seulement s’ils changent', () => {
    const messages = [
      { role: 'system' as const, content: 'Consignes stables.\n\n<persistent_memory>\nNote: memoire-stable\n</persistent_memory>' },
      { role: 'system' as const, content: '<environment_context>\nProject: dossier-alpha\n<context>\n- Date actuelle: 2026-10-04\n- Répertoire de travail: /tmp/alpha\n</context>\n</environment_context>' },
    ];
    expect(appendMemoryIfChanged(messages, PROMPT)).toBe(false);
    expect(appendEnvironmentFromVolatile(messages, [
      'Project: dossier-alpha',
      '<context>',
      '- Date actuelle: 2026-10-04',
      '- Répertoire de travail: /tmp/alpha',
      '</context>',
    ].join('\n'))).toBe(false);

    const changed = PROMPT
      .replace('memoire-stable', 'memoire-apres-changement')
      .replace('dossier-alpha', 'dossier-beta')
      .replace('/tmp/alpha', '/tmp/beta')
      .replace('2026-10-04', '2026-12-15');
    expect(appendMemoryIfChanged(messages, changed)).toBe(true);
    expect(appendEnvironmentFromVolatile(messages, [
      'Project: dossier-beta',
      '<context>',
      '- Date actuelle: 2026-12-15',
      '- Répertoire de travail: /tmp/beta',
      '</context>',
    ].join('\n'))).toBe(true);
    expect(messages).toHaveLength(4);
    expect(String(messages[0]?.content)).toContain('memoire-stable');
    expect(String(messages[2]?.content)).toContain('memoire-apres-changement');
    expect(String(messages[2]?.content)).not.toContain('Project:');
    expect(String(messages[1]?.content)).toContain('/tmp/alpha');
    expect(String(messages[3]?.content)).toContain('/tmp/beta');
  });

  it('n’ajoute pas un todo identique au dernier bloc, et laisse le ton du tour hors historique', () => {
    const todo = '<context type="todo">\n<todo_context>\nfaire\n</todo_context>\n</context>';
    const history = [
      { role: 'system' as const, content: 'stable' },
      { role: 'user' as const, content: 'premier' },
      { role: 'system' as const, content: todo },
    ];
    const outbound = [
      ...history,
      { role: 'assistant' as const, content: 'ok' },
      { role: 'user' as const, content: 'suite' },
      { role: 'system' as const, content: todo },
      { role: 'system' as const, content: '<interaction_context ephemeral="true">\ncalme\n</interaction_context>' },
    ];
    const provider = sealAppendOnlyTranscript(history, outbound);
    expect(provider.some(message => String(message.content).includes('calme'))).toBe(true);
    expect(history.some(message => String(message.content).includes('calme'))).toBe(false);
    expect(history.filter(message => String(message.content).includes('<todo_context>'))).toHaveLength(1);
    expect(JSON.stringify(provider.slice(0, 3))).toBe(JSON.stringify([
      { role: 'system', content: 'stable' },
      { role: 'user', content: 'premier' },
      { role: 'system', content: todo },
    ]));
  });

  it('laisse A en dernier quand le todo revient de A,B à A', () => {
    const todo = (body: string) =>
      `<context type="todo">\n<todo_context>\n${body}\n</todo_context>\n</context>`;
    const history = [
      { role: 'system' as const, content: 'stable' },
      { role: 'user' as const, content: 't1' },
      { role: 'system' as const, content: todo('A') },
    ];
    const first = sealAppendOnlyTranscript(history, history);
    const firstCount = first.length;
    const firstJson = JSON.stringify(first);

    history.push(
      { role: 'assistant' as const, content: 'ok' },
      { role: 'user' as const, content: 't2' },
      { role: 'system' as const, content: todo('A\nB') },
    );
    const second = sealAppendOnlyTranscript(history, history);
    expect(JSON.stringify(second.slice(0, firstCount))).toBe(firstJson);
    const secondCount = second.length;
    const secondJson = JSON.stringify(second);

    history.push(
      { role: 'assistant' as const, content: 'ok' },
      { role: 'user' as const, content: 't3' },
      { role: 'system' as const, content: todo('A') },
    );
    const third = sealAppendOnlyTranscript(history, history);
    expect(JSON.stringify(third.slice(0, secondCount))).toBe(secondJson);
    const todos = third.filter(message => String(message.content).includes('<todo_context>'));
    expect(todos.map(message => message.content)).toEqual([
      todo('A'),
      todo('A\nB'),
      todo('A'),
    ]);
    expect(String(third.at(-1)?.content)).toBe(todo('A'));
  });

  it('ne répète pas une leçon inchangée quand le todo change, et réémet un JIT revenu en arrière', () => {
    const lesson = '<context type="lessons">\n<lessons_context>\nL\n</lessons_context>\n</context>';
    const todo = (body: string) =>
      `<context type="todo">\n<todo_context>\n${body}\n</todo_context>\n</context>`;
    const jit = (body: string) => `--- Discovered Context ---\n${body}\n--- End Context ---`;
    const kept = dedupeContextMessages([
      { role: 'system' as const, content: lesson },
      { role: 'system' as const, content: todo('A') },
      { role: 'system' as const, content: jit('v1') },
      { role: 'system' as const, content: lesson },
      { role: 'system' as const, content: todo('A\nB') },
      { role: 'system' as const, content: jit('v2') },
      { role: 'system' as const, content: jit('v1') },
    ]);
    expect(kept.filter(message => String(message.content).includes('lessons'))).toHaveLength(1);
    expect(kept.filter(message => String(message.content).includes('<todo_context>')).map(message => message.content))
      .toEqual([todo('A'), todo('A\nB')]);
    expect(kept.filter(message => String(message.content).includes('Discovered Context')).map(message => message.content))
      .toEqual([jit('v1'), jit('v2'), jit('v1')]);
  });

  it('réémet une mémoire revenue à un texte déjà vu', () => {
    const memory = (note: string) => `<persistent_memory>\nNote: ${note}\n</persistent_memory>`;
    const messages = [
      { role: 'system' as const, content: `Consignes stables.\n\n${memory('memoire-stable')}` },
    ];
    expect(appendMemoryIfChanged(messages, memory('memoire-apres-changement'))).toBe(true);
    expect(appendMemoryIfChanged(messages, memory('memoire-stable'))).toBe(true);
    expect(String(messages[0]?.content)).toContain('memoire-stable');
    expect(String(messages[0]?.content)).not.toContain('memoire-apres-changement');
    expect(String(messages.at(-1)?.content)).toBe(memory('memoire-stable'));
    expect(messages.filter(message => String(message.content).includes('memoire-apres-changement'))).toHaveLength(1);
  });

  it('ne déduplique pas deux messages utilisateur identiques', () => {
    const messages = [
      { role: 'user' as const, content: 'ok' },
      { role: 'assistant' as const, content: 'ok' },
      { role: 'user' as const, content: 'ok' },
    ];
    expect(dedupeContextMessages(messages)).toHaveLength(3);
  });

  it('n’invente pas d’environnement quand le prompt n’en a jamais eu', () => {
    const history = [
      { role: 'system' as const, content: 'Consignes seulement.' },
      { role: 'user' as const, content: 'bonjour' },
    ];
    const sealed = sealAppendOnlyTranscript(history, history, {
      date: '2026-10-04',
      directory: '/tmp/alpha',
    });
    expect(sealed).toHaveLength(2);
    expect(JSON.stringify(sealed)).not.toContain('environment_context');
  });
});
