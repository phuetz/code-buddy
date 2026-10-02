# Intégration des cinq patchs Jules du 2 octobre 2026

Branche `jules/lot-cb-2026-10-02-matin-2`, base `70bcab004`. Les patchs ont été examinés dans l'ordre demandé. Aucun test préexistant n'a été supprimé, renommé ou assoupli.

| Patch | Décision | Correction de l'intégration |
| --- | --- | --- |
| Snapshot des modèles dans `dist` | Appliqué, `ee1706c97` | L'échec de copie arrête le build ; le test ne renomme plus le snapshot source partagé ; import du logger corrigé et vérification d'un fichier réel. |
| Limites de tours et de coût en headless | Appliqué, `6306be664` | Reconnaît aussi le préfixe `💸`. Le chemin CLI utilise l'état réel de coût et les résultats d'outils refusés, car certains messages de limite ne sont pas ajoutés à l'historique assistant. |
| Schéma de sortie | Rejeté | La branche valide déjà le JSON du dernier message assistant avec `validateOutputText`. Le patch valide l'enveloppe et ferait accepter une réponse non JSON ou rejeter un JSON conforme. Ses trois nouveaux tests passent mais vérifient le mauvais contrat ; les sept tests CLI existants gardent le contrat opposé. |
| `HOST` et `PORT` du serveur | Appliqué, `7653d0c5d` | Le `patch.diff` imbriqué a été écarté ; le repli `0.0.0.0` a été ramené à `127.0.0.1`, valeur du serveur et de l'aide CLI ; types et tests corrigés. |
| `buddy try` et sélection Ollama | Doublon fonctionnel, `HEAD` | Le routage et un test équivalent existent déjà sur la base. Seul le test du serveur Ollama injoignable a été ajouté ; aucun code produit dupliqué. |

## Preuves rouge → vert

- Snapshot : ancien script de copie remis temporairement, snapshot absent de `dist`, test d'empaquetage rouge 1/1 ; script restauré et suite ciblée verte 27/27.
- Limites : ancienne fonction de sortie remise temporairement, test rouge 1/1 (`0` au lieu de `3`) ; signal de coût hors texte rouge 1/1 avant le complément, puis suites CLI ciblées vertes 34/34.
- Serveur : ancienne fonction remise temporairement, six nouveaux cas rouges ; correctif restauré, 8/8 verts.
- Ollama : neutralisation temporaire de la priorité Ollama, deux cas rouges (`chatgpt` reçu) ; version existante restaurée, 17/17 verts.

## Vérifications

`npm run build` final, `npm run typecheck` complet, ESLint ciblé et vérification du manifeste de runtime : codes 0. Huit fichiers de tests ciblés et voisins : 86/86 verts. `git diff --check` vert. Binaire construit : `PORT=abc buddy server` rejette la valeur ; avec `--port 39171`, le contrôle du port est dépassé et l'écoute échoue sur `listen EPERM`, limite de ce bac à sable.

Les tests `runtime-manifest.test.ts` lancent Node en sous-processus : six cas échouent ici avec `spawnSync … EPERM`, sans assertion produit atteinte. Les sept tests existants de `headless-output-flags.test.ts` échouent sur `listen EPERM 127.0.0.1` avant leur scénario. Ces erreurs de confinement ne valident ni n'invalident les fonctions concernées.

## Ce que je n'ai pas pu vérifier

Écoute HTTP réelle, fournisseur Ollama réel, Windows, macOS, réseau et Docker. Aucun test GUI ou .NET n'était requis par les fichiers touchés ; aucune tâche de fond n'a été laissée.

**Verdict du lot : À REPRENDRE.** Les correctifs 1, 2 et 4 et le test complémentaire du 5 sont intégrables localement ; le troisième patch doit rester écarté et les parcours nécessitant sockets et sous-processus sont à rejouer hors de ce bac à sable.
