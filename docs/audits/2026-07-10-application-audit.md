# Audit complet Code Buddy / Cowork — 10 juillet 2026

## Objectif reformulé

> Auditer intégralement Code Buddy et Cowork, de façon reproductible et fondée sur des preuves. Examiner l’architecture, la qualité du code, la sécurité, les dépendances, les performances, l’expérience utilisateur, le pipeline vocal temps réel, les modèles locaux et l’exploitation. Classer les constats par impact et probabilité, corriger immédiatement les problèmes à fort impact sans casser les fonctionnalités existantes, ajouter les tests de non-régression nécessaires, puis valider par lint, typage, tests, builds et parcours Electron réels. Mesurer les résultats avant/après, documenter les risques résiduels et proposer une feuille de route priorisée, notamment pour Pocket TTS, Gemma 4, DeepSpec et un serveur d’inférence à très faible latence.

## Verdict exécutif

L’application est fonctionnelle et les parcours demandés sont désormais couverts de bout en bout. Le principal gain perçu vient du démarrage de la synthèse vocale pendant le streaming du LLM, de Pocket TTS résident et du modèle vocal local `qwen3:4b-instruct`. La surface de dépendances vulnérables et le poids initial du renderer ont aussi fortement diminué.

Deux risques ne peuvent pas être supprimés dans cette session : deux services système root exposent encore les ports 3000 et 3001 sans authentification, et `@mariozechner/pi-coding-agent` conserve un avis high sans version corrective compatible publiée. Le premier nécessite un mot de passe administrateur ; le second doit être suivi en amont.

## Résultats mesurés

| Indicateur | Avant | Après | Évolution |
|---|---:|---:|---:|
| Vulnérabilités production, cœur | 72 (3 high, 48 moderate, 21 low) | 29 (0 critical/high, 8 moderate, 21 low) | -59,7 % |
| Vulnérabilités production, Cowork | 25 (1 critical, 12 high, 12 moderate) | 1 high | -96 % |
| Bundle renderer principal | 4 279,94 kB | 3 146,24 kB | -26,5 % |
| Bundle renderer principal gzip | 1 300,48 kB | 960,13 kB | -26,2 % |
| Tests Cowork | 2 548 au point de départ | 2 555, tous verts | +7 régressions couvertes |
| TTFT LLM vocal chaud retenu | non mesuré | ~166–172 ms | mesure locale réelle |
| Volume sortie par défaut | variable | 100 %, non muet | vérifié avec PipeWire |

## Corrections implémentées

### Voix temps réel

- Pocket TTS devient le moteur principal ; Piper reste le secours ancien.
- Le serveur Pocket reste résident sur `127.0.0.1:8766`, avec préchauffage des voix et cache audio.
- Le bouton « Écouter » passe désormais par le processus principal, synthétise puis lit réellement l’audio ; le test Electron clique le bouton et attend sa confirmation.
- Le texte du LLM est segmenté en phrases complètes pendant le streaming. La première phrase est lue sans attendre la réponse finale, puis la file reste séquentielle.
- L’interruption utilisateur invalide immédiatement la génération et vide les segments en attente (barge-in).
- Le débit vocal sauvegardé est enfin appliqué au bridge IPC et au fallback navigateur.
- Le volume de sortie est fixé à 100 % et démute le sink PipeWire au démarrage ; `wpctl get-volume` retourne `1.00`.
- Le chemin rapide utilise `qwen3:4b-instruct` pour la parole et les réponses factuelles afin d’éviter un changement de modèle. Le modèle occupe environ 3,87 Go de VRAM et reste chaud 30 minutes.

### Interface et React

- Le thème clair est la valeur par défaut et un sélecteur accessible propose sept thèmes dans le rail principal.
- Le thème sélectionné persiste après rechargement ; clair et sombre sont vérifiés en Electron.
- Le profil Cowork réellement lancé a également été basculé sur clair et contrôlé après un redémarrage complet.
- Les vues lourdes (Studio, Mission Control, Labs, créations, vidéo, Assistant, capacités, panneaux secondaires) sont chargées à la demande avec `React.lazy` et `Suspense`.
- Les références de callbacks et dépendances d’effets ont été stabilisées dans l’enrôlement et l’overlay vocal.
- Des fonctionnalités auparavant reliées à un état mais non montées (documentation, workflow pro, gestionnaire de skills) sont rendues accessibles.

### Sécurité et exploitation

- `ngrok@5 beta` a été remplacé par le SDK officiel `@ngrok/ngrok`; le binaire natif est externalisé et empaqueté correctement par Electron.
- Le double démarrage de tunnel public a été supprimé : `TunnelManager` est l’unique propriétaire du cycle de vie.
- La fermeture conserve l’URL avant le callback `closed`, garantissant la déconnexion du bon endpoint. Un test couvre ouverture, statut, webhook, fermeture synchrone et désactivation.
- L’arrêt Electron ne court-circuite plus son propre nettoyage. Le service local est relancé avec `KillMode=mixed`, afin que systemd laisse le processus principal fermer proprement ses enfants avant un éventuel `SIGKILL`; le cycle restart ne produit plus de core dump.
- Les dépendances critiques/high corrigibles ont été mises à jour ou contraintes par overrides sûrs.
- SheetJS utilise le tarball officiel 0.20.3 plutôt que l’ancien paquet npm 0.18.5. La documentation officielle précise que le registre npm est ancien et recommande le CDN officiel : [installation SheetJS](https://docs.sheetjs.com/docs/getting-started/installation/frameworks/).
- Le serveur du cerveau vocal est maintenant limité à `127.0.0.1:3055`; les percepts sensibles disposent d’une clé de chiffrement persistante.
- Electron conserve `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, une CSP et le durcissement des webviews.

### Qualité et architecture

- Le chargement checkpoint/persona et les préchauffages indépendants ont été parallélisés sur le chemin du moteur.
- Les paramètres et capacités des modèles locaux ont été complétés dans la configuration centrale.
- Les flux vocaux, réactions, mémoire relationnelle et réponses hybrides disposent de tests de non-régression supplémentaires.

## Validation exécutée

- `npm run build` à la racine : succès.
- `npm run typecheck` à la racine : succès.
- 18 fichiers / 206 tests ciblés du cœur : succès.
- Cowork `npm test -- --run` : **456 fichiers, 2 555 tests, tous réussis**.
- Cowork lint : succès, zéro avertissement.
- Cowork typecheck : succès.
- Cowork `npm run build:e2e` : succès (renderer, main Electron, preload).
- Playwright Electron : Assistant/Pocket, vrai clic « Écouter », sélecteur et persistance du thème : succès, aucune erreur console.
- `git diff --check` : succès.
- Santé runtime : cerveau `3055`, Pocket `8766` et Ollama GPU `11435` sains et liés à localhost.
- Cycle stop/start réel de Cowork : nettoyage exécuté, aucun core dump, service actif, thème clair conservé.

Le dépôt racine contient environ 27 000 tests ; la suite complète n’a pas été relancée, car elle est très longue. Les suites affectées, le typage et le build complet ont été exécutés. Cowork a en revanche été validé intégralement.

## Évaluation des modèles locaux

| Usage | Choix recommandé | Motif |
|---|---|---|
| Dialogue vocal temps réel | `qwen3:4b-instruct` | Meilleur compromis local observé : français correct, TTFT chaud ~172 ms |
| Commande ultra-courte tolérant une qualité moindre | Qwen 2.5 1.5B/3B | TTFT ~133–147 ms, mais erreurs factuelles et mélange de langues constatés |
| Raisonnement, code et vision non interactifs | Gemma 4 12B/26B | Plus capable, mais trop lent et trop porté sur le raisonnement caché pour le premier son |
| Réponses longues de qualité | Gemma 4 ou Qwen 3.5, route séparée | La latence est moins critique hors boucle vocale |

Les essais locaux ont montré que Gemma 4 12B/26B pouvait consommer la limite courte en raisonnement sans produire de texte visible et atteindre plusieurs secondes. Gemma 4 reste donc pertinent pour les fonctions locales de code, analyse, documents, vision et agents, pas pour le chemin vocal critique. La page officielle décrit ses capacités multimodales, de raisonnement et d’outils : [Gemma 4 dans Ollama](https://ollama.com/library/gemma4).

DeepSpec fournit une chaîne d’entraînement/évaluation de modèles draft spéculatifs et des checkpoints, dont Gemma 4 12B. Ce n’est pas un serveur d’inférence prêt à brancher. La configuration par défaut documentée suppose huit GPU et environ 38 To de cache pour Qwen3-4B : [dépôt DeepSpec](https://github.com/deepseek-ai/DeepSpec). Sur cette machine à mémoire unifiée, l’intégration immédiate ajouterait beaucoup de complexité sans garantir un gain par rapport au Qwen 4B chaud. À réévaluer lorsqu’un backend vLLM/ROCm stable accepte directement ces checkpoints.

## Risques résiduels et actions

### P0 — ports système sans authentification (administrateur requis)

`codebuddy-a2a.service` écoute `0.0.0.0:3000 --no-auth` et `codebuddy-fleet.service` écoute `0.0.0.0:3001 --no-auth`. Le commentaire du second affirme une liaison Tailscale, mais la configuration réelle expose toutes les interfaces. La session ne possède pas de sudo non interactif.

Correction immédiate recommandée :

```ini
# sudo systemctl edit codebuddy-a2a.service
[Service]
ExecStart=
ExecStart=/home/patrice/.nvm/versions/node/v24.14.1/bin/node /home/patrice/code-buddy/dist/index.js server --port 3000 --host 127.0.0.1 --no-auth
```

```ini
# sudo systemctl edit codebuddy-fleet.service
[Service]
ExecStart=
ExecStart=/home/patrice/.nvm/versions/node/v24.14.1/bin/node /home/patrice/code-buddy/dist/index.js server --port 3001 --host 100.98.18.76 --no-auth
```

Le lancement direct est intentionnel : le shebang `env node` de `npx` peut
retomber sur le Node 18 système et rendre `better-sqlite3` incompatible avec
le runtime Node 24 du dépôt.

Puis :

```bash
sudo systemctl daemon-reload
sudo systemctl restart codebuddy-a2a.service codebuddy-fleet.service
```

La cible finale doit remplacer `--no-auth` par JWT et limiter les ACL Tailscale.

### P1 — dépendance Pi Agent

`@mariozechner/pi-coding-agent` 0.73.1 reste affecté par trois avis, dont un high local sur les chemins temporaires d’extension. La dernière version publiée est encore vulnérable ; `npm audit fix` propose une rétrogradation cassante vers 0.27.4. Éviter l’installation d’extensions Pi non fiables et mettre à jour dès publication du correctif.

### P2 — dépendances optionnelles du cœur

Le cœur conserve 8 moderate dans la chaîne optionnelle `nut-js`/Jimp et 21 low, principalement l’AI SDK transitif de Stagehand. Aucun high/critical ne subsiste. Les « corrections » proposées actuellement impliquent des régressions ou downgrades majeurs.

### P2 — taille des bundles

Le chunk principal reste à 3,15 Mo et App Studio à 969 ko. Prochaine étape : déplacer Mermaid/Cytoscape/Cynefin derrière des imports au niveau de la fonctionnalité et analyser le bundle avec un visualizer avant de créer des `manualChunks`.

### P3 — dette de lint du cœur

Le lint racine réussit mais signale environ 2 450 avertissements historiques. Traiter par domaine avec un budget d’avertissements décroissant dans la CI, sans lancer de réécriture mécanique globale.

## Feuille de route recommandée

1. Corriger les deux unités root et activer JWT/Tailscale ACL.
2. Instrumenter le pipeline vocal avec p50/p95 pour VAD → STT → TTFT → premier son → fin TTS.
3. Ajouter un routeur à deux voies : Qwen 4B pour la conversation, Gemma 4 pour les tâches complexes asynchrones.
4. Tester vLLM/ROCm dans un environnement isolé quand les page faults CWSR du noyau sont résolus ; conserver Ollama Vulkan comme chemin de production jusque-là.
5. Réévaluer DeepSpec uniquement avec un serveur supportant réellement les draft models publiés et comparer le gain end-to-end, pas seulement les tokens/s.
6. Continuer le découpage des gros modules UI et instaurer un budget de bundle.
