# Rejeu sémantique des actions d’interface

`browser` et `computer_control` proposent `action: "act"`. Une consigne est résolue en actions successives par le modèle, puis la séquence est conservée uniquement lorsque le texte final demandé est réellement observé. Un appel identique tente ensuite la trace sans modèle. Cette entrée complète les actions déterministes existantes ; elle ne remplace pas le moteur externe `browser-use`, Stagehand ou leurs propres caches.

```json
{
  "action": "act",
  "instruction": "Renseigner Name avec le paramètre visitor, puis cliquer sur Greet",
  "expectedText": "Welcome Alice",
  "values": { "visitor": "Alice" }
}
```

Dans le navigateur, lancer puis naviguer avant `act`. Sur le bureau, placer l’application cible au premier plan avant l’appel. `expectedText` est obligatoire : le jugement du modèle seul ne prouve jamais qu’une séquence a réussi. Le parcours peut comporter au maximum 20 actions : clic, saisie par paramètre, Entrée ou Tabulation. Les sélections, glissements, téléchargements et navigations explicites restent sur les outils existants.

Le modèle auxiliaire est une configuration de l’hôte : `CODEBUDDY_UI_MODEL` est obligatoire, `CODEBUDDY_UI_BASE_URL` vaut par défaut `http://127.0.0.1:11434/v1`. `CODEBUDDY_UI_API_KEY` permet de fournir les identifiants ; les clés OpenAI/Grok générales ne sont jamais réutilisées. Les variables `CODEBUDDY_UI_*` présentes dans un `.env` du dossier de lancement ou du projet sont refusées, même si une variable hôte homonyme existe. Configurer ces valeurs dans l’environnement de l’hôte et les retirer du `.env` du projet. Cette restriction reste mémorisée après le chargement CLI, même si le fichier est ensuite supprimé. Aucun fournisseur de secours n’est sélectionné automatiquement. Exemple local : `CODEBUDDY_UI_MODEL=qwen2.5:7b-instruct`. La configuration ne se lit pas dans la trace. Une trace valide se rejoue même si aucun modèle n’est configuré ; un écart nécessite à nouveau ce modèle.

## Contrat de rejeu

- Clé : version, type d’interface, consigne normalisée, oracle final, noms des paramètres et contexte courant (URL complète ou plateforme/application/fenêtre), sous forme d’empreintes.
- Chaque étape conserve rôle/nom, opération, nom de paramètre éventuel, empreintes avant/après. Références temporaires, coordonnées, captures, consigne et valeurs saisies ne sont pas enregistrées.
- À chaque étape, une observation fraîche doit correspondre à l’état enregistré. La cible doit être unique, visible, activable et non protégée. Playwright emploie un locator rôle/nom exact et ne se rabat jamais sur des coordonnées.
- Après la confirmation navigateur, l’URL et la cible sont revérifiées, puis l’URL est encore contrôlée à la frontière du locator. Les empreintes ne contiennent aucune valeur de champ, même hachée ; les attributs ARIA de valeur et le texte des zones éditables sont exclus.
- Au premier écart constaté, le modèle reçoit l’état présent et les actions déjà exécutées ; il ne repart pas aveuglément du début. Une séquence réapprise et vérifiée remplace la trace. Un échec d’action potentiellement déjà exécutée ou un refus humain arrête le parcours : aucun retry implicite de cet effet.
- Le bureau exige des éléments provenant réellement d’AT-SPI/UIA, rattachés à la fenêtre active. OCR, captures simulées, provenance inconnue et coordonnées enregistrées sont refusés. Les positions nécessaires au clic natif proviennent de l’arbre fraîchement observé. La fenêtre est liée au PID, au handle actif et à son identité native ; plusieurs fenêtres homonymes non distinguables sont refusées. Un arbre tronqué ou incomplet est refusé. La frappe exige en plus une preuve de focus.
- Chaque activation bureau repasse par `ComputerControlTool.execute` et sa garde humaine `forcePrompt`, comme l’action initiale. Le conteneur `act` est lui-même classé mutation. La question nomme le rôle et le nom de la cible. Après la dernière confirmation, les primitives relisent l’arbre natif, la fenêtre, l’unicité, la géométrie et le focus juste avant l’activation ; tout changement annule l’action. Une signature valide ne donne aucune autorisation.
- Les champs mot de passe et les champs natifs dont la protection est inconnue ne passent pas par `act`. Utiliser l’action habituelle, gardée, avec une valeur fraîche. Les autres valeurs sont uniquement fournies dans `values` à chaque appel ; seuls leurs noms de paramètres figurent dans la trace.

Les contrôles sont volontairement conservateurs : un changement de texte, de libellé ou de contexte peut provoquer un nouveau raisonnement. Ils ne prouvent pas tous les effets métier d’une interface. Une courte démonstration locale ne garantit pas la compatibilité avec un site arbitraire ni avec toutes les applications natives.

## Stockage et confiance

Les fichiers JSON lisibles sont dans `.codebuddy/action-recordings/`. Ils utilisent `writeJsonAtomic`, des fichiers temporaires dans le même répertoire et un renommage atomique, avec permissions 0600. Pour effacer un enregistrement, supprimer son fichier ; pour tout oublier, supprimer ce répertoire.

Chaque fichier est signé par HMAC avec une clé du profil utilisateur (`~/.codebuddy/replay-trust/key`) et lié au chemin canonique du projet, lui-même représenté par une empreinte. Une copie dans un autre clone ou sous un autre profil, une modification du JSON ou une signature absente entraîne un apprentissage frais. Les répertoires de contrôle symlinkés sont refusés. La clé doit rester hors du dépôt. Ce mécanisme protège des traces importées, pas d’un programme disposant déjà des droits de l’utilisateur sur sa clé.

## Assertions naturelles

`web_test.assertions` accepte aussi :

```json
{ "type": "assert", "value": "Un contrôle permet d’afficher les informations" }
```

L’action équivalente est `browser { action: "assert", instruction: "…" }`. Un appel modèle frais juge l’observation et fournit une citation exacte du texte visible. Une preuve absente, inventée, paraphrasée ou une erreur du modèle fait échouer l’assertion. Le modèle reste un juge imparfait : combiner ces assertions avec les oracles déterministes `text`, `selector`, `title`, réseau et console. Les jugements ne sont jamais mis en cache.

## Mesure reproductible

`scripts/qa/rejeu-live.ts` lance une page HTTP locale enregistrée comme origine de développement, Chromium et le vrai `BrowserExecuteTool`. Il exécute trois parcours deux fois, modifie une page à URL constante, rejoue la trace corrigée et appelle une assertion naturelle via `web_test`. Les autorisations automatiques de ce harnais sont limitées aux effets du navigateur sur son origine de démonstration ; aucun bureau n’est autorisé par ce script.

Exécuter avec un HOME jetable, par exemple `_qa/rejeu/home`, et `CODEBUDDY_UI_MODEL` configuré. `QA_ARTIFACTS` choisit le répertoire des traces. `PLAYWRIGHT_BROWSERS_PATH` peut désigner un cache Chromium existant en lecture seule. Chaque trace contient les entrées/sorties d’outils, les appels/réponses modèle, les durées et l’usage fournisseur. `tokenUsageKnown=false` indique un compteur absent, pas une consommation nulle. Le cache chaud doit avoir `modelCalls=0`, `tokens=0` et `tokenUsageKnown=true`.

## Étude d’e2e

Étude du dépôt [tester-army/e2e](https://github.com/tester-army/e2e), commit `490e965c2efbe16f5a8ba9bf2f194cb0861fe2cf`, paquet `e2e` 0.15.2, Apache-2.0. Implémentation Code Buddy indépendante, sans reprise de code.

- `cache/identity.ts` : clé avec projet/test/cible/plateforme/moteur, versions compatibles, occurrence de la signature, empreintes de consigne/paramètres, identité de l’application et politique. Ce n’est pas simplement « intention + HTML ».
- `cache/trace.ts` : format `trace-1`, grammaire d’actions typées, descripteurs sémantiques durables, entrées paramétrées, provenance et ancres finales. Les références d’observation sont éphémères ; certains cas de position existent chez e2e et ne sont pas repris ici.
- `cache/decide.ts`, `cache/relocate.ts`, `agent/replay.ts` : précondition de route, relocalisation dans des observations fraîches, contrôles d’ambiguïté et d’état final, puis retour à l’exécuteur avec le préfixe effectivement exécuté. Les effets d’état incertain ne sont pas rejoués aveuglément.
- `agent/step-cache.ts` et le recorder : admission après vérification de l’essai, traitement des traces tronquées et écarts. Les jugements d’assertion sont frais, pas des résultats mémorisés.

Code Buddy reprend la séparation entre actions rejouables, vérification et jugement. Il ajoute une confiance locale liée au projet, conserve les confirmations bureau à chaque activation, et refuse entièrement le rejeu de champs protégés.
