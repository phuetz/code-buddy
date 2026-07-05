export type StudioTemplateId = 'react-ts' | 'express-api' | 'node-cli';

export function suggestTemplate(prompt: string): StudioTemplateId {
  const text = prompt.toLowerCase();
  if (/\b(api|express|crud|endpoint|route|backend|serveur|webhook)\b/.test(text)) return 'express-api';
  if (/\b(cli|terminal|commande|script|outil ligne|command line)\b/.test(text)) return 'node-cli';
  return 'react-ts';
}
