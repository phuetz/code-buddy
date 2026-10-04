# Reprise B9 — PR #299

Mission du 03/10/2026, terminée le 04/10/2026, Codex GPT-6. Branche `fix/audit-dependances-2026-10-03`, départ `9ff42666eae79585a09670b0089e4c0cfdbb0b1b`. Rapport de mission créé avant les corrections. Plan de sortie, mission et relecture lus intégralement ; B9 conserve sa place de première fusion. Les autres chantiers restent gelés.

La relecture fournie conclut en réalité **PRÊT À FUSIONNER**, « Aucun bloquant ». Le pilote a ensuite identifié un vrai échec Ubuntu : la politique des scripts d’installation ne correspondait plus au lock. Ce défaut et les réserves réelles sont corrigés. Les suites Ubuntu complètes passent localement sur Node 20 et 22 ; aucune nouvelle exécution GitHub n’est revendiquée.

## Bloquants et réserves : traitement et preuves

Les journaux et scripts de reproduction sont conservés dans `Partage/20261003-cb-audit-deps/reprise-1/sol61/preuves/` ; rapport transmis dans le répertoire parent. Les noms ci-dessous désignent ces preuves, hors dépôt.

| Bloquant ou réserve | Traitement | Preuve |
|---|---|---|
| **Pilote : test install-script rouge sur Ubuntu 20 et 22** | Relecture des scripts, 16 approbations conservées ou actualisées, deux versions fsevents explicitement refusées, autorisations périmées supprimées. Le test vérifie aussi l’ensemble indépendant des versions `hasInstallScript` du lock. Aucun test désactivé. | `politique-avant.log` reproduit l’échec ; `node20-cibles.log` : 30/30 ; douze shards verts, bilans Node 20/22. Décisions détaillées ci-dessous. |
| Allowlist sans `nodes` autorisant tous les chemins | Périmètre obligatoire, non vide, chaque chemin déclaré et chaque copie auditée contrôlés. Exceptions sans périmètre refusées. | 15 tests de porte ; mutation rétablissant l’ancien comportement : 1 échec, 14 succès (`mutant-scope-optionnel.log`). |
| `security.yml` reste rouge alors que `ci.yml` passe | Les deux workflows utilisent exactement la même porte documentée, sans condition ni tolérance d’échec sur l’audit. Le scan de secrets est conservé. | Deux tests YAML dédiés, intégrés aux deux suites complètes ; portes réelles `node20-audit-gate-final.log` et `node22-audit-gate.log`, exit 0. |
| Motifs faux dans sept exceptions semantic-release | Retrait du paragraphe concernant http-cache-semantics et le bundle npm : ces sept entrées n’héritent que des deux avis braces. Motif propre, chemin, avis et dates conservés individuellement. | `allowlist-couverture.json` : 47 entrées / 47 highs, URL héritées et nodes exacts, motifs présents, revue 03/10 et échéance 14/10. |
| Plancher Undici autorise encore 6.28.0 | Dépendance directe `^6.29.0`, override `$undici`. Aucun changement de version résolue : le lock avait déjà 6.29.0. La copie du bundle npm reste une exception distincte. | Changelog officiel lu, `inventaire-node20.json` et `inventaire-node22.json` ; deux suites complètes et tests glob/porte verts. |
| ONNX legacy omis du rapport ; autorisations ONNX/sharp obsolètes | Rapport initial corrigé : ONNX Hugging Face 1.30.0 et copie Xenova 1.14.0. Les archives 1.14.0 et sharp 0.35.5 n’ont pas de script lifecycle. | `archives-scripts-revus.json`, `integrite-archives-lock.json` : cinq archives officielles SHA-512 identiques au lock ; inventaires après `npm ci`. |
| Arbre installé dérivé (`npm` 11.21.0 au lieu de 11.19.1) | Deux installations propres `npm ci`, sous npm 10.8.2 puis 10.9.8 ; modules SQLite reconstruits pour chaque ABI. Aucun `npm install --no-save` dans le workspace. | `node20-npm-ci.log`, `node22-npm-ci.log`, inventaires : bundle npm 11.19.1 ; son Undici 6.28.0 reste recensé ; `node22-sqlite-reel.json` : SELECT 1 réel. |
| Installation globale, pack et commandes non reproduits par la revue | Nouveau pack depuis une révision propre, installation réelle hors dépôt et HOME vierge, aide et diagnostic capturés sans clé fournisseur. | `pack-receipts.json`, `pack.log`, `pack-install.log`, `buddy-help.log`, `buddy-doctor.log`, `paquet-installe-inventaire.json`. Limite des overrides confirmée, voir ci-dessous. |
| Suite complète absente de la revue | Tous les fichiers exécutés, six shards successifs par version, sans filtre d’exclusion ni modification des délais/tests. | `node20-bilan.json`, `node22-bilan.json` et douze reçus/logs : mêmes 2414 fichiers uniques, aucun doublon, zéro échec. |

## Politique de scripts revue le 03/10/2026


`npm-allow-scripts.test.ts` vérifie le manifeste ET l’ensemble des versions marquées `hasInstallScript` par le lock. Une nouvelle version doit être relue, même si un ancien paquet de même nom était approuvé. Les preuves d’archives et d’installation sont conservées dans le dossier externe `preuves/`. Cette politique déclare les approbations npm 11 ; npm 10 de la CI exécute les scripts et n’applique pas cette liste comme une barrière.

| Paquet/version | Décision | Motif et code relu |
|---|---|---|
| @google/genai 1.52.0 | Autoriser, conservé | `preinstall` fait seulement un echo no-op. |
| @vscode/ripgrep 1.17.0 | Autoriser, conservé | Télécharge le binaire ripgrep de recherche depuis les releases officielles ; nécessaire au moteur de recherche. |
| @whiskeysockets/baileys 6.7.23 | Autoriser, conservé | `engine-requirements.js` vérifie la version Node pour le canal WhatsApp. |
| better-sqlite3 11.10.0 | Autoriser, conservé | `prebuild-install || node-gyp rebuild --release` installe le binding SQLite ; compilation pour chaque ABI réellement vérifiée. |
| bufferutil 4.1.0 | Autoriser, conservé | `node-gyp-build` charge/compile l’accélérateur WebSocket. |
| esbuild 0.27.1 | Autoriser, conservé | `install.js` choisit et vérifie le binaire de build de la plateforme. |
| node-llama-cpp 3.16.2 | Autoriser, conservé | CLI `postinstall` sélectionne les binaires locaux llama.cpp et leur éventuelle compilation ; inférence locale optionnelle. |
| node-pty 1.1.0 | Autoriser, conservé | `prebuild.js || node-gyp rebuild`, puis `post-install.js`, préparent le pseudo-terminal natif. |
| **onnxruntime-node 1.30.0** | **Autoriser, nouvelle version** | `script/install.js` importe `install-utils.js` et télécharge les binaires supplémentaires décrits par `install-metadata.js` depuis NuGet ; CPU déjà livré. Relecture du tarball officiel et empreinte conservées. `ONNXRUNTIME_NODE_INSTALL=skip` est interprété par `parseInstallFlag()` et sort avant tout téléchargement ; réglage identique à la CI, GPU supplémentaire non nécessaire aux tests. |
| protobufjs 7.6.5 | Autoriser, conservé | `scripts/postinstall.js` vérifie le schéma de version déclaré par les dépendants et affiche un avertissement si nécessaire ; utilisé par OTLP et WhatsApp. |
| tesseract.js 7.0.0 | Autoriser, conservé | `opencollective-postinstall || true` affiche un message de financement ; OCR optionnel. |
| tree-sitter 0.21.1 | Autoriser, conservé | `node-gyp-build`, binding du parseur. |
| tree-sitter-bash 0.23.3 | Autoriser, conservé | `node-gyp-build`, grammaire Bash de l’analyse de commandes. |
| tree-sitter-javascript 0.23.1 | Autoriser, conservé | `node-gyp-build`, grammaire JavaScript de l’analyse de code. |
| tree-sitter-typescript 0.23.2 | Autoriser, conservé | `node-gyp-build`, grammaires TypeScript/TSX de l’analyse de code. |
| usearch 2.21.4 | Autoriser, conservé | `node-gyp-build`, index vectoriel natif optionnel. |
| **fsevents 2.3.2 et 2.3.3** | **Bloquer explicitement** | Marqueur `hasInstallScript` hérité dans le lock. Les deux archives officielles contiennent `fsevents.node`, ni script lifecycle ni `binding.gyp`. `fsevents.js` charge directement le binaire sur macOS. Aucune exécution à approuver ; pas de recette macOS prétendue. |
| sharp 0.35.5 / ONNX 1.14.0 | Aucune entrée | Archives sans script lifecycle : aucune approbation requise. ONNX 1.14.0 est la copie legacy optionnelle de Xenova, distincte de 1.30.0 de Hugging Face. |
| sharp 0.32.6 / 0.33.5 / 0.34.5 et ONNX 1.24.3 | Retirer | Versions absentes du lock final ; ne pas conserver une autorisation dormant sur une ancienne version vulnérable. |

Undici : seul le plancher déclaré change de `^6.28.0` à `^6.29.0`, override `$undici`. Le lock installait déjà 6.29.0. [Notes officielles 6.29.0](https://github.com/nodejs/undici/releases/tag/v6.29.0) lues : traitement du body en erreur terminale dans RetryAgent et cycle de diagnostics lors d’upgrade. La copie embarquée dans npm 11.19.1 reste distincte et bornée par l’audit.

## Validation Ubuntu complète

Machine Ubuntu 24.04.5 LTS. Node 20.20.2 / npm 10.8.2 et Node 22.23.2 / npm 10.9.8. Préparation de `ci.yml` reproduite : `npm ci`, vérification des dépendances optionnelles, Chromium réellement lancé, reconstruction de better-sqlite3, garde des noms personnels, typecheck, lint et build. Chromium et ses bibliothèques système étaient déjà disponibles : pas de réinstallation apt `--with-deps` revendiquée.

| Vérification | Node 20 | Node 22 |
|---|---|---|
| Installation propre et préparation | Exit 0 | Exit 0 |
| `npm run typecheck` (trois contrôles) | Exit 0 | Exit 0 |
| `npm run lint` | 0 erreur, 2601 avertissements existants | 0 erreur, 2601 avertissements existants |
| `npm run build` | Exit 0 | Exit 0 |
| `npm test -- --shard=N/6`, N=1…6 successifs | Six exits 0 | Six exits 0 |
| Bilan Vitest | 2407 fichiers passés, 7 ignorés ; 40879 tests passés, 38 ignorés, 1 TODO | Identique |
| `node scripts/ci-audit-gate.mjs` | Exit 0, 0 critical, 47 high documentés | Identique |

Les 2414 fichiers uniques sont identiques entre versions, y compris les tests que la CI Windows exclut de ses shards. Les ignorés/TODO sont ceux des sources ; aucune exclusion supplémentaire n’a été introduite. Le lock reste inchangé pendant les recettes : SHA-256 `0b61955ba46df84b0d689866e6647cc90ca58706847b27c186832cdac48a49f1`.

Le premier `npm test` intégral a échoué sur neuf assertions, dans six fichiers. Les journaux sont conservés : deux assertions exigeaient un Git propre pendant nos modifications ; deux fixtures TypeScript étaient contaminées par un `node_modules` déjà présent à la racine temporaire ; trois captures détectaient la session Wayland de ce poste ; une assertion dépendait de la sortie du reporter Vitest, devenu « agent » avec le marqueur Codex local ; un probe à 100 ms avait expiré. Les replays utilisent un Git propre, un TMPDIR propre hors projet Node, l’environnement headless GitHub, et retirent les marqueurs Codex absents du runner. Aucun fichier tiers temporaire n’a été supprimé. Les cas concernés ont repassé ciblés, puis dans les deux suites complètes ; le délai de 100 ms est conservé.

Un deuxième essai intégral a détecté un chemin personnel absolu dans ce nouveau rapport versionné. Le chemin a été retiré par commit normal, la garde a repassé 40/40, et l’essai déjà connu rouge a été interrompu. Cet essai n’est pas présenté comme une suite réussie. Les douze shards complets sont tous postérieurs à cette correction. Aucun test n’a été affaibli pour obtenir le vert.

Après les deux suites, le binding SQLite du workspace a été reconstruit pour le Node 24 par défaut du poste : `SELECT 1` réel réussi (ABI 137), lock inchangé. Cela remet le workspace dans un état utilisable avec son interpréteur habituel ; aucune suite complète Node 24 n’est revendiquée. La garde des données personnelles a repassé 40/40 sur le rapport final. Preuves : `node24-restauration-native.json`, `garde-passation.log`.

## Paquet réellement installé

`npm pack` et installation globale du tarball : exits 0. Manifeste runtime du tarball : source `5263e52d433b6f4e18e532f1370fb981ca965f77`, `sourceDirty: false`. SHA-256 du tarball : `cfc5574d322483c98f77b5efd9b0276a679b23696a3909694d83d26a44d90593`.

Sous Node 20, HOME neuf hors workspace : `buddy --help` exit 0 ; `buddy doctor` exit 1, **20 contrôles réussis, 5 avertissements, 0 erreur**. La cause de sortie est Ollama disponible mais aucun modèle sélectionné dans ce profil vierge. Aucun modèle ni clé n’a été injecté pour masquer ce diagnostic. Aucun appel LLM effectué.

L’installation consommateur confirme une limite déjà annoncée : les overrides du projet racine ne se transmettent pas au paquet installé globalement. Xenova retrouve **sharp 0.32.6**, pptxgenjs **image-size 1.2.1**. Cette reprise valide le contrôle B9 du workspace et l’exécution de l’aide/diagnostic ; elle ne prouve pas un paquet distribué sans vulnérabilité. Voir inventaire du paquet installé. Un traitement du graphe distribué doit précéder une affirmation de sécurité de ce graphe.

## Commits et passation

Deux commits publics antérieurs conservés, sans réécriture : `a8ae47d00` et `9ff42666e`. Commits ajoutés : `7ad7a0a37` (correctifs), `5263e52d4` (garde du rapport), puis documentation finale à `HEAD`. Aucun push, aucun amend/rebase, aucun processus laissé en tâche de fond. Le pilote pousse et vérifie les contrôles GitHub ; B9 reste premier dans l’ordre de fusion. Le rapport externe donne l’identifiant final et le statut Git.

## Ce que je n'ai pas pu vérifier

- Les nouveaux checks de la PR #299 et les protections de branche : aucun push ni lancement de CI distante. Les résultats ci-dessus sont des exécutions locales Ubuntu.
- Windows, macOS, Electron et Cowork ; le blocage explicite fsevents repose sur les archives officielles, sans recette macOS.
- GPU ONNX, téléchargement NuGet et inférence de modèles : le mode `ONNXRUNTIME_NODE_INSTALL=skip` de la CI est conservé. L’aide et le diagnostic ne prouvent pas une conversation ou un workflow LLM.
- Une distribution sans vulnérabilité : les deux dépendances réintroduites en installation globale restent une limite réelle, pas une disparition des avis démontrée par l’audit du workspace.
- Les 47 highs restants sont des exceptions documentées, pas des correctifs upstream. Réexamen obligatoire avant le **14/10/2026** ; 4 low et 13 moderate restent non bloquants. Aucun critique n’est autorisé.
- La disparition future des copies vulnérables embarquées dans npm, ni l’arrivée d’un correctif braces/http-cache-semantics ; l’échéance ne garantit pas une release upstream.
