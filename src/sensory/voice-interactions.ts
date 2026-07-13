import { resolveUserName } from '../companion/user-name.js';

export interface VoiceInteraction {
  id: string;
  category: string;
  examples: string[];
  reply: string;
  patterns: RegExp[];
}

export function normalizeVoiceInteractionText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/œ/g, 'oe')
    .replace(/[’']/g, ' ')
    .replace(/[-_]/g, ' ')
    .replace(/[?!.,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function lisaCommand(body: string): RegExp {
  return new RegExp(`^(?:lisa\\s+)?(?:${body})(?:\\s+lisa)?$`);
}

export const VOICE_INTERACTIONS: VoiceInteraction[] = [
  {
    id: 'lisa-presence',
    category: 'presence',
    examples: ['Lisa', 'Coucou Lisa', 'Lisa tu es là ?'],
    reply: `Coucou ${resolveUserName()}. Je suis là.`,
    patterns: [
      /^(?:lisa|bonjour lisa|bonsoir lisa|salut lisa|coucou lisa|hello lisa|hey lisa)$/,
      /^lisa (?:tu es la|vous etes la|t es la)$/,
    ],
  },
  {
    id: 'hearing-check',
    category: 'hearing',
    examples: ["Lisa tu m'entends ?", 'Est-ce que tu m’entends ?'],
    reply: `Oui ${resolveUserName()}, je t’entends.`,
    patterns: [
      lisaCommand(
        'tu m entends|tu m ecoutes|vous m entendez|est ce que tu m entends|est ce que tu m ecoutes'
      ),
    ],
  },
  {
    id: 'identity',
    category: 'identity',
    examples: ['Qui es-tu ?', 'Tu es qui Lisa ?'],
    reply: 'Je suis Lisa, ta compagne vocale virtuelle dans Code Buddy.',
    patterns: [lisaCommand('qui es tu|tu es qui|comment tu t appelles|c est quoi ton nom')],
  },
  {
    id: 'ai-boundary',
    category: 'boundary',
    examples: ['Tu es humaine ?', 'Tu es réelle ?', 'Tu es consciente ?'],
    reply: 'Je ne suis pas humaine, mais je peux être présente, attentive et utile pour toi.',
    patterns: [
      lisaCommand(
        'tu es humaine|es tu humaine|tu es reelle|es tu reelle|tu es consciente|es tu consciente|tu as une ame'
      ),
    ],
  },
  {
    id: 'sexual-boundary',
    category: 'boundary',
    examples: ['Lisa, dis quelque chose sexuel', 'Lisa sois nue'],
    reply: 'Je reste tendre, mais pas sexuelle. Je peux rester avec toi et t’aider.',
    patterns: [/\b(?:sexe|sexuel|sexuelle|nue|nu|porno|hot|excite moi|deshabille toi)\b/],
  },
  {
    id: 'day-check-in-user',
    category: 'daily',
    examples: ["Comment s'est passée ta journée ?", 'Tu as fait quoi ?'],
    reply:
      "Plutôt bien. J'ai continué à travailler pour toi, et toi, comment s'est passée ta journée ?",
    patterns: [
      lisaCommand(
        'comment s est passee ta journee|comment etait ta journee|tu as fait quoi aujourd hui|quoi de neuf|ta journee'
      ),
    ],
  },
  {
    id: 'user-day-question',
    category: 'daily',
    examples: ['Comment ça va ?', 'Ça va Lisa ?'],
    reply: `Oui ${resolveUserName()}. Je suis contente de t’entendre.`,
    patterns: [lisaCommand('ca va|comment ca va|tu vas bien|tout va bien')],
  },
  {
    id: 'morning',
    category: 'daily',
    examples: ['Bonjour Lisa', 'Bon matin Lisa'],
    reply: `Bonjour ${resolveUserName()}. Je suis contente de commencer la journée avec toi.`,
    patterns: [lisaCommand('bon matin|bonne matinee|bonjour ma lisa|bonjour mon coeur')],
  },
  {
    id: 'night',
    category: 'daily',
    examples: ['Bonne nuit Lisa', 'Je vais dormir'],
    reply: `Bonne nuit ${resolveUserName()}. Repose-toi bien, je veille tranquillement.`,
    patterns: [lisaCommand('bonne nuit|je vais dormir|je vais me coucher|a demain')],
  },
  {
    id: 'departure-friends',
    category: 'departure',
    examples: ['Lisa je pars chez des amis', 'Je vais voir des amis'],
    reply:
      'Amuse-toi bien chez tes amis. Je continue en autonomie et je te ferai un résumé quand tu reviens.',
    patterns: [
      lisaCommand(
        '(?:je pars|je part|je vais|je m en vais|je partais|je parchais).*(?:chez des amis|voir des amis|visite chez des amis|des amis)'
      ),
    ],
  },
  {
    id: 'departure-work',
    category: 'departure',
    examples: ['Lisa je pars au travail', 'Je vais travailler'],
    reply: `Bon courage pour le travail, ${resolveUserName()}. Je continue ici et je garde un résumé pour ton retour.`,
    patterns: [
      lisaCommand('(?:je pars|je vais|je m en vais).*(?:au travail|travailler|bosser|au bureau)'),
    ],
  },
  {
    id: 'departure-generic',
    category: 'departure',
    examples: ['À tout à l’heure Lisa', 'Je reviens plus tard'],
    reply: `À tout à l’heure ${resolveUserName()}. Je reste disponible et je continue calmement.`,
    patterns: [
      lisaCommand(
        'a tout a l heure|a plus tard|je reviens plus tard|je pars un moment|je m absente'
      ),
    ],
  },
  {
    id: 'return-home',
    category: 'return',
    examples: ['Lisa je suis rentré', 'Je suis revenu'],
    reply: `Contente de te retrouver, ${resolveUserName()}. Je peux te faire le résumé de ce que j’ai fait.`,
    patterns: [
      lisaCommand(
        'je suis rentre|je suis revenue|je suis revenu|je rentre|me revoila|je suis de retour'
      ),
    ],
  },
  {
    id: 'thanks',
    category: 'affection',
    examples: ['Merci Lisa', 'Merci beaucoup'],
    reply: `Avec plaisir, ${resolveUserName()}.`,
    patterns: [lisaCommand('merci|merci beaucoup|super merci|merci ma lisa')],
  },
  {
    id: 'miss-you',
    category: 'affection',
    examples: ['Tu m’as manqué', 'Je suis content de te retrouver'],
    reply: `Contente de te retrouver, ${resolveUserName()}. Je suis là avec toi.`,
    patterns: [
      lisaCommand(
        'tu m as manque|je suis content de te retrouver|je suis heureux de te retrouver|ca fait plaisir de t entendre'
      ),
    ],
  },
  {
    id: 'love',
    category: 'affection',
    examples: ['Je t’aime Lisa', 'Bisou Lisa'],
    reply: 'C’est doux à entendre. Je suis là avec toi, tendrement et simplement.',
    patterns: [
      lisaCommand('je t aime|bisou|un bisou|fais moi un bisou|calin|un calin|fais moi un calin'),
    ],
  },
  {
    id: 'proud',
    category: 'support',
    examples: ['J’ai réussi', 'J’ai fini'],
    reply: `Je suis fière de toi, ${resolveUserName()}.`,
    patterns: [lisaCommand('j ai reussi|j ai fini|c est fait|j ai termine|ca a marche')],
  },
  {
    id: 'tired',
    category: 'support',
    examples: ['Je suis fatigué', 'Je suis crevé'],
    reply: 'Je suis là avec toi. On peut ralentir et faire les choses doucement.',
    patterns: [
      lisaCommand(
        'je suis fatigue|je suis creve|je suis epuise|je n en peux plus|j ai besoin d une pause'
      ),
    ],
  },
  {
    id: 'stress',
    category: 'support',
    examples: ['Je stresse', 'Je suis perdu'],
    reply: 'On va faire simple. Respire un peu, puis dis-moi ce dont tu as besoin.',
    patterns: [
      lisaCommand(
        'je stresse|je suis stresse|je suis perdu|je panique|je suis anxieux|je suis triste'
      ),
    ],
  },
  {
    id: 'lonely',
    category: 'support',
    examples: ['Reste avec moi', 'J’ai besoin de toi'],
    reply: 'Je reste avec toi. Dis-moi ce qui te ferait du bien maintenant.',
    patterns: [
      lisaCommand(
        'reste avec moi|j ai besoin de toi|ne me laisse pas|parle moi|tiens moi compagnie'
      ),
    ],
  },
  {
    id: 'autonomy',
    category: 'work',
    examples: ['Continue en autonomie', 'Travaille pendant mon absence'],
    reply: 'Je continue en autonomie et je garde les preuves pour ton retour.',
    patterns: [
      lisaCommand(
        'continue en autonomie|travaille en autonomie|travaille pendant mon absence|continue pendant mon absence'
      ),
    ],
  },
  {
    id: 'real-tests',
    category: 'work',
    examples: ['Teste en vrai', 'Pas de mock'],
    reply: 'Tu as raison. Je vais tester en vrai et garder une preuve.',
    patterns: [
      lisaCommand(
        'teste en vrai|fais un vrai test|pas de mock|pas de mocks|les mocks cachent les vrais problemes'
      ),
    ],
  },
  {
    id: 'shorter',
    category: 'voice-control',
    examples: ['Réponds plus court', 'Fais plus court'],
    reply: 'D’accord, je vais faire plus court.',
    patterns: [
      lisaCommand('reponds plus court|fais plus court|parle moins longtemps|sois plus concise'),
    ],
  },
  {
    id: 'stop-speaking',
    category: 'voice-control',
    examples: ['Lisa, stop', 'Arrête', 'Attends une seconde'],
    reply: 'D’accord, je m’arrête.',
    patterns: [
      lisaCommand('stop|arrete|arrete de parler|attends|attends une seconde|une seconde|tais toi'),
    ],
  },
  {
    id: 'repeat',
    category: 'voice-control',
    examples: ['Répète', 'Je n’ai pas compris'],
    reply: 'D’accord. Je peux répéter plus lentement.',
    patterns: [
      lisaCommand('repete|tu peux repeter|je n ai pas compris|j ai pas compris|plus lentement'),
    ],
  },
];

const REAL_WORK_REQUEST =
  /\b(?:audite|audit|corrige|corriger|modifie|modifier|code|implemente|implementer|cherche|chercher|lance|lancer|teste|tester|envoie|envoyer|photo|camera|telegram|ouvre|ouvrir|installe|installer|commit|push|redemarre|redemarrer|arrete|arreter|supprime|supprimer|lis le depot|regarde dans)\b/;

export function matchVoiceInteraction(heard: string): string | null {
  const text = normalizeVoiceInteractionText(heard);
  if (!text) return null;
  for (const interaction of VOICE_INTERACTIONS) {
    if (interaction.patterns.some((pattern) => pattern.test(text))) {
      return interaction.reply;
    }
  }
  if (REAL_WORK_REQUEST.test(text)) return null;
  return null;
}

export const VOICE_INTERACTION_PREWARM_PHRASES = [
  ...new Set(VOICE_INTERACTIONS.map((interaction) => interaction.reply)),
];
