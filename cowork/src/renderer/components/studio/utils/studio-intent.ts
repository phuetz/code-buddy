export type StudioTemplateId = 'react-tailwind' | 'react-ts' | 'express-api' | 'node-cli' | 'expo-rn';

export function suggestTemplate(prompt: string): StudioTemplateId {
  const text = prompt.toLowerCase();
  if (/\b(expo|react native|react-native|mobile|android|ios|apk)\b/.test(text)) return 'expo-rn';
  if (/\b(api|express|crud|endpoint|route|backend|serveur|webhook)\b/.test(text)) return 'express-api';
  if (/\b(cli|terminal|commande|script|outil ligne|command line)\b/.test(text)) return 'node-cli';
  return 'react-tailwind';
}
