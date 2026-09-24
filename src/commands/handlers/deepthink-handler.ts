import { getExtendedThinking } from '../../agent/extended-thinking.js';
import type { CommandHandlerResult } from './branch-handlers.js';
import { handleChangeMode } from './missing-handlers.js';
import { failureFlag } from '../slash-failure.js';

const USAGE = `Usage: /deepthink <question>

Active le mode plan (lecture seule) et lance une réflexion profonde structurée.`;

export async function handleDeepthink(args: string[]): Promise<CommandHandlerResult> {
  const question = args.join(' ').trim();

  if (!question) {
    return {
      handled: true,
...failureFlag(USAGE),
      entry: {
        type: 'assistant',
        content: USAGE,
        timestamp: new Date(),
      },
    };
  }

  await handleChangeMode(['plan']);
  getExtendedThinking().applyThinkingLevel('xhigh');

  const prompt = `Mode plan actif : lecture seule, aucune écriture ni modification de fichiers.

Question à analyser : ${question}

Mène une réflexion profonde et structurée en français, avec ces sections :

1. Reformulation du problème
Clarifie l'objectif, le périmètre et les contraintes implicites.

2. Trois angles d'attaque indépendants et argumentés
Présente trois approches réellement distinctes, chacune avec son raisonnement, ses hypothèses et ses implications.

3. Confrontation croisée
Compare les forces, faiblesses, compromis et contradictions entre les trois angles.

4. Risques et inconnues
Liste les risques principaux, les zones d'incertitude et les informations à vérifier avant exécution.

5. Recommandation finale avec critères de décision
Choisis l'approche recommandée et explicite les critères qui justifient ce choix.

6. Plan d'exécution étape par étape
Propose un plan concret, ordonné et vérifiable, en rappelant que le mode plan reste actif : lecture seule, pas d'écriture.`;

  return {
    handled: true,
    passToAI: true,
    prompt,
  };
}
