# Campagne P9 : catalogue complet et preuves réelles

Le mécanisme de preuve existant est conservé : manifestes d’intégration, traces réelles et `sourceDigest` calculé par `currentCatalogSourceDigest`.

| Périmètre | Avant : prouvées / échecs / inconnues | Après |
|---|---|---|
| 91 capacités historiques | 71 / 2 / 18 | 85 / 1 / 5 |
| Catalogue complet, 338 entrées | 71 / 2 / 265 | 250 / 3 / 85 |

Les 247 entrées découvertes supplémentaires ont désormais une déclaration : domaine, bénéfice et portée ou limite. Les 11 domaines ont des preuves positives. Les 182 nouveaux manifestes correspondent à 179 réussites et trois échecs ; 71 preuves valides sont héritées et non rejouées. La présence d’une entrée dans l’inventaire ne la rend pas prouvée.

Les preuves ont été exécutées avec HOME et projet temporaires, modèles locaux sauf un appel Gemini minimal, fichiers et processus réels. Aucun mock de runtime. Les fichiers produits, contenus relus, DOM, appels d’outils et réponses sont contrôlés selon les scénarios. Chaque trace `p9-*.log` contient commande, attendu, observé et portée.

## Corrections

- `db4c6e4b6` : registre de recettes par défaut absent, liste vide dans un profil neuf ; test rouge puis vert.
- `4ece5943c` : attente des diagnostics LSP et fermeture du serveur CLI ; trois rejouages TypeScript réels.
- `98c5f0fb0` : initialisation et fermeture du MCP Code Explorer dans la CLI ; deux requêtes froides réussies.
- `b72202254` : application du renommage LSP aux chemins absolus avec espaces ; fichier réellement relu.

## Échecs conservés

- [Vidéo ComfyUI](p9-tool-video-generate-2026-09-30.log) : HTTP 400 `missing_node_type`, `Node 'MiniMaxH3SigmaShift' not found. The custom node may not be installed.`
- [Graphe de code](p9-tool-code_graph-2026-09-30.log) : appels à soi-même fabriqués pour les déclarations de `add` et `answer` ; source de la fixture jointe à la trace.
- [Presse-papiers X11](p9-tool-clipboard-2026-09-30.log) : écriture bloquée, délais de 60 puis 35 secondes ; processus arrêtés.

## Limites

85 entrées gardent un état inconnu ; `verificationLimit` donne la raison et le prérequis. Certaines demandent un compte, un appareil ou un raccordement ; d’autres restent non couvertes et pourraient être prouvées avec un scénario QA et un oracle supplémentaires. Les cinq historiques restantes sont hub, approvals, OAuth ChatGPT, AGY et boucle vocale.

Un parcours positif vaut pour son sous-parcours : inspection de listes ou réglages, storyboard affiché, transport local, création/suppression de rappel ou cron. Aucune exécution cloud, conversation micro, notification à échéance ou vidéo générée n’est déduite de ces inspections. LSP est prouvé sur TypeScript, pas sur Rust. Cowork et X11 sont exécutés sous Linux ; Windows et macOS restent non vérifiés. La VM existante répond à ses routes de santé/version mais ne fournit pas de route documentée d’exécution générale. DGM propose un plan relié à une publication réelle ; son gain est hypothétique, aucune variante n’est mesurée.

## Vérifications

Build CLI et Cowork réussis, lint sans erreur, typecheck réussi, 118 tests ciblés sur 10 fichiers dont catalogue et paquet npm. Loader Vitest `runner` utilisé pour éviter une écriture dans les dépendances partagées en lecture seule. Suite complète non exécutée. 40 tests supplémentaires de données personnelles réussis, balayage des 378 fichiers ajoutés ou modifiés sans donnée privée, diff sans erreur et audit de processus vide avant remise. Rappels QA supprimés, cron retiré, serveurs et processus de test arrêtés ; aucune tâche laissée en arrière-plan. Aucun service réel modifié, aucune session OAuth copiée, aucun push.
