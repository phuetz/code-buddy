# Rapport de fusion — 26 août 2026

## État de la fusion

- Worktree vérifié avant toute opération : `/home/patrice/code-buddy-fusion-2026-08-26`.
- Aucun accès ni aucune écriture dans `/home/patrice/code-buddy` ou un autre worktree.
- HEAD initial : `279b36c6edee9e59fe8469f3f380beba00a99aa1`.
- Branche créée depuis ce HEAD : `merge/f1-reconcile-origin-main-2026-08-26`.
- Réservation Fable 5 commitée avant fusion : `6b43173419f84ece2965afdaf9ec8d45a7cbffd6` (`docs(coordination): reserve F1 reconciliation`).
- Base commune vérifiée : `f9a31a7eeb2328418107ee5efc6ce93606d45b02`.
- Pointe fusionnée : `origin/main` = `63278824cbf1c7ecf87711692a8ef0f40e349d64`.
- Commande de fusion : `git merge --no-ff --no-commit origin/main`.
- La plage amont contient 136 commits. Correctifs attendus présents : `092fed08` (#140, profils core/all), `c2ae11f2` (#143, reprise/aide CLI), `70da8140` (#144, matrix-js-sdk) et `77213098` (#146, binding SQLite Electron).
- Mesure de divergence au départ : 418 commits côté local et 136 côté amont. Le 418, au lieu des 417 annoncés, vient du commit de benchmark `279b36c6` ajouté après le point de mesure communiqué. Après le commit de réservation, la branche compte logiquement 419 commits propres.
- La fusion n'est volontairement **pas commitée** : deux fichiers demandent un arbitrage humain et restent `UU`. Aucun push, rebase, reset, prune ou suppression de branche n'a été effectué.

## Analyse et résolution des 51 conflits textuels

Chaque ligne décrit d'abord l'intention locale et l'intention amont, puis la décision prise.

| # | Fichier | Intention locale | Intention `origin/main` | Décision et raison |
|---:|---|---|---|---|
| 1 | `CLAUDE.md` | Garder la coordination Fable 5 et le statut historique 1.1.0. | Actualiser le statut 1.7.0 / package 1.8.0 et les consignes CI. | Combinaison évidente : coordination locale conservée, statut et documentation amont retenus. |
| 2 | `README.md` | Conserver l'ancienne table de fonctions, la section MCP et l'ancienne table documentaire. | Présenter les preuves App Studio/Video Studio, puis la section MCP et la documentation à jour. | Hunes amont retenues : la matière MCP locale existe déjà plus bas et les anciennes tables sont supersédées. |
| 3 | `buddy-memory/src/store.rs` | Écrire une ligne JSONL et son saut de ligne en un seul `write_all` atomique. | Formater `OpenOptions` selon rustfmt mais garder `writeln!`. | Combinaison : formatage amont + écriture atomique locale, qui évite l'entrelacement concurrent. |
| 4 | `cowork/src/renderer/components/Titlebar.tsx` | Masquer l'indicateur de présence avant `lg` et lui donner l'espacement final. | Ajouter le nouveau `HealthBadge` permanent avant la présence. | Deux ajouts indépendants combinés : badge avec `ml-auto`, présence toujours responsive. |
| 5 | `docs/FABLE5-CODEX-COORDINATION.md` | Continuer le journal jusqu'aux chantiers des 25–26 août, dont F1. | Reformatter et conserver le journal amont arrêté plus tôt. | Version locale retenue : elle contient les entrées amont et leur continuation plus récente. |
| 6 | `docs/providers/omniroute-free-catalog.md` | Documenter le catalogue importé initial. | Ajouter `freeTier` et les corrections de suivi de revue. | Amont retenu, surensemble fonctionnel de l'import initial. |
| 7 | `docs/studies/2026-07-21-living-voice-sota.md` | Conserver l'étude et les pistes détaillées avant portage. | Reformuler le document selon l'implémentation réellement livrée par #145. | Amont retenu : mise à jour d'état, pas changement de comportement. |
| 8 | `docs/studies/2026-07-21-mysoulmate-voice-convergence.md` | Conserver l'étude de convergence initiale. | Décrire la convergence effectivement portée dans le produit. | Amont retenu pour la même raison. |
| 9 | `scripts/providers/import-omniroute-free-catalog.py` | Import initial du catalogue OmniRoute. | Ajouter l'échec explicite si registre absent, un parseur de commentaires plus sûr, `--refresh` et `freeTier`. | Amont retenu, suivi direct et plus robuste. |
| 10 | `src/agent/execution/agent-executor.ts` | Garder le type `PreprocessedUserMessage` et transporter `jitContextBlocks` après la prise en charge des mentions. | Porter les mentions de fichiers avec un type de retour inline, sans le correctif JIT local ultérieur. | Hunes locales retenues : elles incluent le portage amont et le correctif JIT postérieur. |
| 11 | `src/agent/self-improvement/skill-mutator.ts` | Repasser toute skill restaurée dans le garde de sécurité. | Utiliser `renameDirWithRetry` pour Windows. | Combinaison évidente : garde local puis renommage amont tolérant Windows. |
| 12 | `src/analytics/repo-explainer-collector.ts` | Utiliser les API courantes `generateDiagram`, `getFreshness(..., autoIndex:false)` et `RepoProfiler.inspect`. | Ajouter des contournements CLI/dynamiques parce que ces API manquaient sur l'ancien main. | Local retenu : les API existent maintenant dans l'arbre fusionné; les contournements sont devenus obsolètes. |
| 13 | `src/cli/first-run.ts` | Message de premier démarrage initial. | Ajouter l'indication `buddy doctor`. | Amont retenu, ajout indépendant. |
| 14 | `src/commands/try.ts` | Masquer la télémétrie par défaut avec restauration atomique du logger et option `--verbose`. | Angliciser la démo, améliorer l'onboarding et ajouter `ollama serve`. | Combinaison : texte/onboarding amont + contrôle de télémétrie local. |
| 15 | `src/companion/reply-augment.ts` | Même phrase avec guillemets doubles. | Normaliser les guillemets simples. | Amont retenu, style uniquement. |
| 16 | `src/context/file-mentions.ts` | Résolution initiale des mentions. | Neutraliser aussi les balises injectables `<context>` et `<file_contents>`. | Amont retenu, durcissement de sécurité évident. |
| 17 | `src/index.ts` | Parser `--profile` avec diagnostic de valeur manquante et conserver l'aide aux options inconnues. | Détecter l'aide racine et appeler `outputHelp()` pour laisser stdout se vider sur macOS. | Combinaison des deux correctifs; deux `catch` ont ensuite reçu un paramètre nommé pour satisfaire l'audit amont sans changer le comportement. |
| 18 | `src/memory/collective-knowledge-graph.ts` | Index token/type/nom/BM25 en mémoire, relecture complète conditionnée par un stamp, `DiskEmbeddingCache` par empreinte modèle/nom/contenu. | Relecture JSONL incrémentale par offset/inode avec gestion des lignes partielles, cache embeddings append-only par hash de contenu et `withTimeout`. | **Non résolu** : deux architectures concurrentes avec invariants de reprise et de cache différents; arbitrage humain requis. |
| 19 | `src/providers/provider-catalog.ts` | Catalogue OmniRoute initial commenté et liste NVIDIA affinée localement. | Exposer `freeTier`, retirer le doublon DeepSeek et appliquer la sonde NVIDIA live la plus récente. | Amont retenu : suivi vérifié et surensemble fonctionnel; les commentaires de provenance restent dans les docs/scripts. |
| 20 | `src/sensory/hybrid-reply.ts` | Ajouter le raccourci selfie Lisa avant la réponse agent. | Porter le reste de la voix contextuelle sans ce bloc local. | Bloc selfie local conservé, ajout indépendant. |
| 21 | `src/sensory/speech-sanitizer.ts` | Normalisation française et commentaires détaillés avec formatage local. | Même logique reformattée et commentaires alignés sur tous les renderers. | Amont retenu, reformulation/formatage seulement. |
| 22 | `src/sensory/voice-entrainment.ts` | Conditions émotionnelles sans parenthèses redondantes. | Parenthèses explicites autour des conditions neutres. | Amont retenu, formatage sans changement sémantique. |
| 23 | `src/sensory/voice-loop.ts` | Importer les callbacks avant l'état relationnel et appeler `prepareSpeech` après une recherche de backchannel brut. | Réordonner les imports et appeler `prepareSpeech` avant la recherche de cache. | **Non résolu** : le conflit textuel d'import était trivial, mais la fusion automatique a révélé deux emplacements concurrents de `prepareSpeech`; choisir modifie la clé de cache et les hits. Le fichier a été remis `UU`. |
| 24 | `src/tools/lsp-navigation-tools.ts` | Implémentation LSP initiale. | Ajouter confinement du workspace et validation `realpath` contre les symlinks. | Amont retenu, durcissement de sécurité évident. |
| 25 | `src/tools/video/character-in-location.ts` | Réutiliser le registre canonique `SIGNATURE_LOCATIONS` et les protections de visage ultérieures. | Redéclarer localement les identifiants/types dans le portage initial. | Local retenu : évite une deuxième source de vérité et contient les protections postérieures. |
| 26 | `src/tools/video/cinematic-trailer-plan.ts` | Importer `ContentTier` depuis le module média canonique. | L'importer depuis le routeur vidéo. | Local retenu, source canonique unique. |
| 27 | `src/tools/video/google-flow-driver.ts` | Import Playwright statique et budget externe initial. | Import Playwright dynamique, `FlowDownload` injectable et nouvelles fonctions de budget crédit. | Amont retenu, surensemble plus testable et moins eager. |
| 28 | `src/tools/video/google-flow-handoff.ts` | Détecter un chemin absolu par préfixe `/`. | Utiliser `path.isAbsolute`, portable Windows. | Amont retenu, correction multiplateforme évidente. |
| 29 | `src/tools/video/hybrid-video-router.ts` | Utiliser le `ContentTier` média canonique et le réexporter comme type. | Redéclarer `CONTENT_TIERS` localement, valeur consommée par les nouveaux adaptateurs. | Combinaison : source canonique locale, réexport du type **et de la valeur** pour l'adaptateur amont. Validé par 4/4 tests `video-route-tool`. |
| 30 | `src/tools/video/long-form-production.ts` | Forcer `fit: 'cover'` pour le cadrage. | Laisser le fit implicite. | Local retenu : paramètre explicite ajouté indépendamment. |
| 31 | `src/tools/video/voice-rights-registry.ts` | Importer `ResolvedVoiceProfile` depuis le module narration partagé. | Redéclarer le type dans le registre. | Local retenu, type canonique unique. |
| 32 | `src/ui/components/ChatInterface.tsx` | Import en guillemets simples. | Import en guillemets doubles, cohérent avec ce fichier. | Amont retenu, style uniquement. |
| 33 | `tests/cli/help-output.test.ts` | Tester cwd/env isolés et l'absence de télémétrie des tools/profils. | Ajouter timeout centralisé et preuve de vidage complet du bloc de commandes macOS. | Suites combinées et helper commun conservé. |
| 34 | `tests/commands/changelog.test.ts` | Chemin POSIX littéral pour le faux dépôt. | Construire le chemin avec `path.resolve` sous Windows. | Amont retenu, portabilité évidente. |
| 35 | `tests/commands/try.test.ts` | Tester le silence/restauration du logger et les sorties françaises. | Tester les sorties anglaises et le conseil `ollama serve`. | Tests de télémétrie locaux conservés, assertions de contenu alignées sur l'anglais amont. |
| 36 | `tests/mcp/mcp-server.test.ts` | Tester l'opt-in par environnement et le glob. | Isoler aussi l'env desktop-control et vérifier les 11 tools MCP historiques. | Amont retenu comme surensemble; le test environnement local y est déjà présent. |
| 37 | `tests/sensory/voice-streaming.test.ts` | Ajouter une seconde copie du test de ponctuation douce. | Ne pas dupliquer le test déjà présent juste au-dessus. | Amont retenu; doublon exact supprimé, aucun test désactivé. |
| 38 | `tests/tools/lsp-navigation-tools.test.ts` | Tests LSP initiaux. | Passer explicitement le workspace et couvrir le confinement. | Amont retenu, aligné sur le durcissement source. |
| 39 | `tests/tools/video/approved-media-source.test.ts` | Nettoyage temporaire initial. | Canonicaliser `mkdtemp` par `realpath` pour macOS. | Amont retenu, correctif de CI. |
| 40 | `tests/tools/video/book-manuscript-source.test.ts` | Même intention de test initial. | Même correction `realpath` macOS. | Amont retenu. |
| 41 | `tests/tools/video/character-in-location.test.ts` | Tester le registre canonique partagé. | Tester une liste littérale redéclarée. | Local retenu, cohérent avec la source canonique. |
| 42 | `tests/tools/video/comfy-client.test.ts` | Nettoyage initial. | `realpath` et teardown robuste multiplateforme. | Amont retenu. |
| 43 | `tests/tools/video/google-flow-driver.test.ts` | Utiliser le script/budget et les types Playwright initiaux. | Tester les budgets et `FlowDownload` exportés par la source de production. | Amont retenu, aligné sur le driver choisi. |
| 44 | `tests/tools/video/google-flow-plan-export.test.ts` | Nettoyage initial. | `realpath`/teardown robuste. | Amont retenu. |
| 45 | `tests/tools/video/google-flow-result-import.test.ts` | Nettoyage initial. | `realpath`/teardown robuste. | Amont retenu. |
| 46 | `tests/tools/video/long-form-production.test.ts` | Nettoyage initial. | `realpath` et retries de suppression Windows. | Amont retenu. |
| 47 | `tests/tools/video/native-fashion-defects.test.ts` | Nettoyage initial. | `realpath`/teardown robuste. | Amont retenu. |
| 48 | `tests/tools/video/video-understanding-ckg.test.ts` | Nettoyer `outDir` **et** le home CKG isolé. | Ajouter `maxRetries`/`retryDelay` au nettoyage de `outDir`. | Combinaison : les deux répertoires sont nettoyés avec retries. |
| 49 | `tests/tools/video/visual-gate-report.test.ts` | Nettoyage initial. | `realpath`/teardown robuste. | Amont retenu. |
| 50 | `tests/tools/video/voice-rights-registry.test.ts` | Nettoyage initial. | `realpath`/teardown robuste. | Amont retenu. |
| 51 | `tests/tools/video/youtube-master-quality.test.ts` | Nettoyage initial. | `realpath`/teardown robuste. | Amont retenu. |

## Arbitrages humains encore ouverts

1. `src/memory/collective-knowledge-graph.ts` : choisir l'architecture de reprise du ledger et de cache embeddings, ou concevoir explicitement une combinaison avec un seul propriétaire pour chaque invariant. Le fichier contient six groupes de marqueurs et reste `UU`.
2. `src/sensory/voice-loop.ts` : décider si `prepareSpeech` doit précéder la recherche du backchannel (comportement amont, clé normalisée) ou la suivre (comportement local, lookup brut). La fusion automatique avait gardé les deux déclarations; le fichier a été remis `UU` pour empêcher un commit accidentel.

Tant que ces choix ne sont pas faits, aucun commit de merge ne doit être créé.

## Vérifications

Les dépendances exactes du lockfile ont été installées dans le worktree (`npm ci`, puis `npm rebuild` pour le ripgrep embarqué et SQLite). Aucun manifeste ni version de dépendance n'a été édité pour les tests. Les caches temporaires `.npm-cache/` et `.npm-tmp/`, créés uniquement pour ne rien écrire hors du worktree, ont ensuite été supprimés.

### TypeScript

Commande :

```text
npx tsc --noEmit -p tsconfig.json
```

Résultat : **échec, code 2**. TypeScript rapporte 17 `TS1185: Merge conflict marker encountered` dans `src/memory/collective-knowledge-graph.ts`. Le transform Vitest/esbuild signale en plus la double déclaration `prepared` dans `src/sensory/voice-loop.ts`. Aucun contournement ou exclusion n'a été ajouté.

### Les 9 fichiers demandés

Commande : `npx vitest run` suivie des neuf chemins explicites.

| Fichier | État final |
|---|---|
| `tests/unit/agent-core.test.ts` | PASS |
| `tests/unit/tool-executor.test.ts` | PASS |
| `tests/unit/web-search.test.ts` | PASS |
| `tests/unit/error-handling-audit.test.ts` | PASS |
| `tests/tools/self-describe.test.ts` | PASS |
| `tests/server/peer-chat-bridge.test.ts` | PASS |
| `tests/protocols/acp/acp-agentic-turn.test.ts` | PASS |
| `tests/sensory/sherpa-rs-stt.test.ts` | PASS |
| `tests/docs/public-screenshots.test.ts` | PASS |

Résultat agrégé final : **9 fichiers passés sur 9; 213 tests passés, 1 ignoré, 0 échec**. Le premier passage avait révélé deux `catch {}` locaux dans `src/index.ts`; ils ont reçu un paramètre `_error`, sans changement de comportement, puis la sélection est devenue entièrement verte.

Validation ciblée supplémentaire de la résolution du routeur vidéo : `npx vitest run tests/tools/video-route-tool.test.ts` → **4/4 passés**.

### Suite complète avant/après

| Mesure | Fichiers | Tests |
|---|---:|---:|
| Point de départ communiqué | 9 fichiers concernés par les correctifs amont | 75 échecs sur 35 222 |
| Après fusion, mesure finale | 45 fichiers en échec, 1 668 passés, 1 ignoré (1 714) | **54 échecs**, 34 971 passés, 39 ignorés (35 064 collectés) |

La baisse numérique est de 21 échecs (75 → 54), mais elle n'est **pas directement comparable** : 29 suites ne se chargent pas à cause des deux arbitrages laissés ouverts, ce qui explique les 158 tests de moins collectés. Les échecs CLI/server/mémoire/voix sont largement en cascade des erreurs de transform CKG/voice-loop. Le chiffre final est donc un état honnête de la fusion non arbitrée, pas une preuve que les 54 tests représentent 54 régressions indépendantes.

## Passation

- Branche : `merge/f1-reconcile-origin-main-2026-08-26`.
- Commit disponible : `6b431734` (réservation); aucun commit de merge tant que les deux `UU` restent ouverts.
- `origin/main` intégré dans l'index/worktree jusqu'à `63278824`; 49 conflits résolus, 2 laissés à l'humain.
- Les neuf fichiers bloquants historiques sont tous verts.
- Après arbitrage CKG et placement de `prepareSpeech`, relancer d'abord le typecheck, les neuf fichiers, puis `npx vitest run` pour obtenir un total comparable à 35 222.
