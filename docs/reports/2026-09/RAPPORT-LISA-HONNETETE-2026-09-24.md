# Rapport de mission — Lisa, honnêteté d'abord (étape 1 du plan d'autonomie)

> Ouvert le 24/09/2026 avant toute inspection, selon la règle du dépôt.
> Branche `fix/lisa-honnetete-2026-09-24`, base `origin/main`.

## Principe

Premier principe de la charte : **ne jamais dire avoir fait ce qui n'a pas été fait.** C'est un
préalable à toute autonomie, car un robot qui s'attribue des actes imaginaires rend faux le compte
rendu de ce qu'il fait vraiment.

## Cibles (relevées lors de l'audit du 24/09, à re-vérifier)

1. `src/companion/inner-life.ts` : des « moments » de vie intérieure décrivent des activités non
   faites (« j'ai gardé un œil sur le build »), injectés dans le contexte par
   `relational-context.ts`.
2. `src/sensory/voice-interactions.ts` : « je continue en autonomie et je te ferai un résumé »
   sans aucun mécanisme derrière.
3. Aucun tour vocal n'est tracé dans l'audit ni dans le RunStore.

## Déroulé

1. **Vie intérieure** : active sur le robot (`CODEBUDDY_COMPANION_INNER_LIFE=true`, un tic toutes les
   50 pulsations) ; **5 180 « moments » inventés en trois jours**, et le journal du service écrivait
   « Lisa spent a moment: wander-repo » alors que rien n'avait été parcouru. Refonte : activité
   réellement accomplie avec ce qu'elle a trouvé, ou pensée sans « j'ai ». Mesure sur 30 tics sans
   rien à lire : ancien module 30 actes affirmés, nouveau 0.
2. **Réponses vocales toutes faites** : cinq phrases prononcées promettaient un travail ou un
   résumé que rien ne produit ; réécrites ; test de garde sur toutes les phrases prononçables et le
   cache vocal (3 tests rouges sur l'ancien code).
3. **Journal des tours** : chaque tour achevé de la voix hybride → `~/.codebuddy/lisa/voice-turns.jsonl`
   (0600, rotation à 5 Mo) avec son chemin (raccourci, photo, conversation, agent) + entrée d'audit
   sans les mots. Vérifié : les tests n'écrivent pas dans le vrai HOME.
4. **Contre-revue indépendante par DeepSeek 4.1 Flash** (diff brut, révision exacte, consigne de
   contester). Quinze constats, chacun vérifié dans le code. Retenus et corrigés :
   - **bug réel** : les heures de rappel étaient comparées comme des chaînes, or le magasin accepte
     « 9:00 » (`isValidTime`) → un rappel de 9 h comptait comme « à venir » à 14 h 30 ;
   - rotation du journal qui échouait en silence sous Windows si `.1` existait ;
   - fichier préexistant trop ouvert qui recevait une écriture avant d'être restreint ;
   - test d'audit « sans les mots » trop faible ; lignes vérifiées non contrôlées contre la liste
     des activités humaines ; « depuis hier » pour une fenêtre de 24 h ; humeur modifiée avant que
     le moment soit enregistré ; texte d'une réponse jamais prononcée qui promettait un compte rendu.
   Écartés après vérification : convention des jours (0 = dimanche, conforme à `getDay()`), syntaxe
   `--since=24.hours` (identique à `24 hours ago`, 195 = 195).
   Limites connues : la garde des phrases est une liste noire (une nouvelle formulation peut
   échapper) ; un tour interrompu avant la fin n'est pas journalisé ; l'heure du prochain rappel
   figure dans la vignette.
