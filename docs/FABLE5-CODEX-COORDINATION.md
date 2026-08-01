# Coordination Fable 5 / Codex

Dernière consolidation : 2026-08-01, Europe/Paris. Ce fichier est la source de vérité partagée pour les chantiers en cours de Patrice. Il coordonne les reprises asynchrones ; il ne prouve pas qu'un pair est connecté en temps réel.

## Protocole obligatoire

1. Lire ce tableau avant toute modification et inscrire son nom dans la colonne `Propriétaire` avant de commencer.
2. Un seul propriétaire actif par chantier et par worktree. Si un répertoire est sale, ne pas l'éditer sans passation explicite.
3. Ne jamais nettoyer, supprimer, réinitialiser ou fusionner en bloc un worktree pour « repartir propre ».
4. Travailler dans une branche dédiée issue de la cible canonique, avec des commits thématiques. Ne porter que des commits explicitement examinés.
5. À la passation, noter le dépôt, la branche, le commit, les fichiers encore sales, les tests réellement exécutés et les décisions humaines restantes.
6. Les publications, achats, changements de compte, déclarations juridiques et choix éditoriaux restent soumis à Patrice.

États : `RÉSERVÉ` signifie que l'autre agent ne modifie pas la zone ; `LIBRE` qu'elle peut être revendiquée ; `HUMAIN` qu'aucun agent ne peut la clore seul.

## Tableau de contrôle

| Priorité | Chantier | Propriétaire | État vérifié | Prochaine action sûre | Zone / garde-fou |
|---|---|---|---|---|---|
| P0 | PdfCommander — intégrité du checkout | **Fable 5 — FAIT (local, non poussé)** | Commit `bfa4b0e6` sur `fix/blockers-audit-opus` ajoute `PdfCatalogMerger.cs` seul (941 lignes), rien d'autre. Validé depuis le worktree propre `/home/patrice/DEV/PdfCommander-verif-integrite` : build solution 0 erreur/0 warning, tests `MergeCatalogPreservation`+`MergeCommandTests` 17/17. Les deux autres non-suivis référencés par des commits (`RAPPORT-MERGE-ET-D4-2026-08-01.md` via `chantiers/D4-flux-zlib-EN-ATTENTE.md`, `docs/licensing-anti-accident.md` via `DECISION-B2-RACINE-DE-CONFIANCE.md`) sont des docs, exclus volontairement (rapport / lot licence), sans impact build. | Pousser `bfa4b0e6` (décision Patrice), puis retirer le worktree de vérification (`git worktree remove --force /home/patrice/DEV/PdfCommander-verif-integrite` — refusé à Fable 5, suppression récursive interdite). | `/home/patrice/DEV/PdfCommander`; aucun fichier non suivi supprimé, lot licence intact. |
| P0 | PdfCommander — licence Option B | **Fable 5 — FAIT (local, non poussé)** | Lot commité en 4 commits thématiques sur `fix/blockers-audit-opus` : `3526ffc7` (Core, Tampered→Inconsistent, enum `LicenseProtectionModel`, test de forgeabilité dé-skippé : état forgé Pro accepté, Enterprise verrouillé), `53feded7` (CLI status texte+JSON `protectionModel=local-anti-accident`), `a6a368ab` (UI : encart FR/EN, « Essai Pro »), `6c09661b` (docs : `licensing-anti-accident.md` + README/EULA/roadmap/backlogs alignés B2-B). Validé worktree propre à `6c09661b` : build 0 erreur, 63/63 tests Licence+Merge, 0 skipped. Diff entièrement relu ; seuls les 9 rapports/logs hors lot restent non suivis. | Pousser les 5 commits (décision Patrice). Défaut cosmétique préexistant noté : `SurfaceAltBackgroundColor`/`SurfaceBackgroundColor` non définis dans le thème (fond transparent, pas de crash), antérieur au lot. | Acceptation formelle du risque B2-B et discours externe (page produit, checkout, FAQ) : **HUMAIN**. Le NO-GO produit tient toujours (perte de données UI, chaîne d'encaissement B1 absente). |
| P0 | Code Buddy — sauvegarde des anciens lots | **LIBRE, à revendiquer** | Quatre branches sans upstream (`autopilot`, `avatar-builder`, `cwm`, `integration2`) et sept rapports `AUDIT-FINDINGS.md` non suivis sont exposés. | Sauvegarder branches et rapports sans intégrer de code ; faire trancher les données de mémoire sales. | Ne pas toucher à `.codebuddy/autonomy.json`, modification utilisateur. Ne pas nettoyer les `cb-*`. |
| P0 | Mathery — sauvegarde terminologique | **Fable 5 — RÉSERVÉ confirmé** | La branche de terminologie vit dans `/tmp/mathery-termino`, emplacement volatil. | La sauvegarder hors de `/tmp` avant tout autre travail, sans l'intégrer en bloc. | Préserver `sauvegarde/termino-locale-2026-08-01` (`f9393132`) et les worktrees Claude. |
| P1 | Mathery — pré-lancement | **Fable 5 — RÉSERVÉ confirmé** | Branche `feat/modernisation-profonde` à `d2523641`, synchronisée. Le dernier contrôle rapporté donne 77 validations, 2 avertissements et 9 échecs ; 15 secrets/URL de livraison manquent. | Extraire les 9 échecs exacts, séparer code corrigeable et secrets humains, puis réconcilier les 101 corrections scientifiques clé par clé, y compris le commit japonais unique `d399791`. | Ne pas cherry-pick la branche terminologique en bloc ; elle chevauche l'i18n/glossaire courant. Secrets, achat et juridique restent **HUMAIN**. |
| P1 | Médias AMBRE/LISA — qualité | **Codex — RÉSERVÉ** | Les sept masters actuels passent techniquement. LISA « 5 signaux » v3 reste interdit et est remplacé par v4. | Assainir les documents périmés, normaliser les kits Shorts et produire le kit Japon après décision kimono. | Aucun upload ni publication. Ne pas réencoder LISA v4 inutilement. |
| P1 | Code Buddy — portage des audits de juillet | **LIBRE après sauvegarde P0** | Les branches spécialisées partent d'une base ancienne. `avatar-builder` les consolide mais présente environ 116 conflits avec l'actif ; `autopilot` présente environ 745 conflits. | Créer une branche neuve depuis la cible canonique et porter : sécurité → annulation/tools → providers/context → fleet/memory → sensory/voice/cowork → CWM/MetaHuman. | `avatar-builder` sert d'inventaire, jamais de merge global. `autopilot` se révise commit par commit et reste isolé. |
| P1 | Livres — tri du dépôt principal | **Fable 5 — RÉSERVÉ confirmé** | Branche observée `fix/marqueurs-production` à `19f9130b`, +4 commits, avec 1 406 entrées sales. Fable se souvient aussi d'une production sur `edition-2026-narratif` : l'articulation reste à vérifier. Les 88 tests du garde de marqueurs passent ; trois romans ont été relus et aucun n'est publiable. | Clarifier les deux branches, inventorier puis sauvegarder les changements avant toute correction éditoriale. Retrouver d'abord le chemin canonique de Code Rouge. | `/home/patrice/DEV/livres`; propriétaire unique Fable 5, sans prune ni écriture parallèle. 1 283 non-suivis viennent de `_extracted`. |
| P2 | Bandes-annonces livres | **LIBRE** | `/home/patrice/DEV/livres-codex`, branche `codex/book-readiness-trailers` à `24354f03`, propre et synchronisée. | Aucun travail urgent ; vérifier seulement si le chantier est réactivé. | Stable, sans conflit immédiat. |
| P2 | Publication AMBRE/LISA | **Patrice — HUMAIN** | Actifs prêts à valider, pas prêts à publier automatiquement. | Visionnage/écoute continus, création et vérification des chaînes, choix titres/miniatures, URL, déclaration IA, preuves Epidemic Sound. | Publication publique interdite sans validation explicite. |

## Flotte LLM — état vérifié au 2026-08-01 (soir)

| Agent/LLM | Disponibilité | Quota communiqué par Patrice | Rôle recommandé | Règles |
|---|---|---|---|---|
| Fable 5 | Actif (session Claude Code vérifiée) | ≈56 %, reset 03/08 05:00 | Chantiers réservés Fable, commits, orchestration | Mode économe jusqu'au reset ; gros lots après lundi |
| Claude (hors Fable 5) | Abonnement communiqué par Patrice ; aucune session distincte lancée ici | ≈15 %, reset 03/08 05:00 | Secours Anthropic ponctuel | Préserver jusqu'au reset ; ne pas doubler une tâche déjà attribuée |
| Codex | Actif (preuve : `b70f5dd9`) | ≈65 %, reset 08/08 (anticipé possible, jamais planifié) | Revues, synthèses, audits médias, validations | Lecture seule dans les zones RÉSERVÉES Fable ; ne relance pas les builds/tests déjà consignés |
| Agy / Gemini 3.6 | **Actif et vérifié** : `agy 1.1.9`, modèle `gemini-3.6-flash-high`, authentification Google AI Ultra ; premier contre-audit terminé | Aucun quota communiqué | Contre-audits indépendants, factualité, recherche et relecture | Lecture seule par défaut ; abonnement LLM distinct des crédits Flow/Veo ; un propriétaire unique par tâche |
| Ollama local (Ministar) | Vérifié actif : gemma4:31b/26b-qat, qwen3:4b-instruct, qwen2.5:3b/1.5b, moondream | Gratuit, illimité (plafond matériel) | Repli : tâches mécaniques, brouillons, agents légers via `buddy`/LiteLLM | Aucune porte de coût ; qualité inférieure, ne pas y déléguer les décisions |
| OpenRouter / Mistral / Cerebras / Groq | Clés présentes (`media.env`), soldes non vérifiés | Aucun | Repli cloud d'appoint | Facturants : accord Patrice avant usage soutenu |

Règles transverses : quotas non communiqués = ne pas inventer ni consommer pour « tester » ; anti-doublon = un seul agent par tâche, résultats consignés ici font foi ; passation = journal ci-dessous avec preuves (commits, sorties de tests) ; zones réservées du tableau de contrôle inchangées.

## État média canonique

- AMBRE chalet v02 : master conforme et kit complet dans `/home/patrice/.codebuddy/media-video/ambre-chalet-automne/kit-publication/`.
- AMBRE Japon v01 : master conforme, kit A7 à produire après décision sur le kimono.
- AMBRE Shorts v4 : conformes individuellement ; publier éventuellement le 01 comme test, puis décider du sort des 02/03 très redondants. Leurs métadonnées doivent pointer vers les miniatures v4.
- LISA Meta AI v2 : master et miniatures corrigés ; la checklist doit cesser de pointer vers v1 et la musique doit être tracée.
- LISA « 5 signaux » v4 : master, SRT et kit complets dans `/home/patrice/Videos/publication-2026-07-30/lisa-vision-ia/kit-publication-v4/`. Le v3 ne doit jamais être publié.
- A1–A6 et A9 sont terminées. A7 reste à faire. A8 n'est pas un renommage de deux minutes : 21 fichiers référencent `lisa-vision-ia`; annuler ou traiter comme une migration contrôlée. A10 est non applicable tant qu'AMBRE reste sans narration, sauf choix de sous-titres descriptifs.

## Carte des worktrees Code Buddy

- Branche active média : `feat/mysoulmate-media-pipeline` à partir de `3274aae5`; seul `.codebuddy/autonomy.json` est sale et appartient à l'utilisateur.
- Inventaire consolidé : `feat/all-improvements-avatar-builder` (`27944c63`). Il contient les lots spécialisés, mais n'est pas une cible de fusion.
- Autopilot indépendant : `autopilot/codebuddy-evolution` (`ed5200c1`), avec un checkpoint initial d'environ 806 fichiers. Le garder isolé.
- Lots intermédiaires : `integration/audit-batch1` (`74671f98`) et `integration/audit-batch2` (`914203c1`). Ils servent uniquement à retrouver les changements.
- Les branches `fix/*-audit` sont obsolètes comme destinations de nouveau travail, mais leurs rapports et commits ne doivent pas être supprimés avant classement `porté / remplacé / rejeté`.

## Blocages et décisions de Patrice

- PdfCommander : accepter formellement le modèle local de bonne foi et aligner page produit, paiement et FAQ sur ses limites réelles.
- LISA : choisir le format inaugural, Meta AI ou « 5 signaux ».
- AMBRE : décider du kimono Japon et de la redondance des Shorts 02/03.
- Publication : choisir titres et miniatures, créer les chaînes, fournir les URL, valider le contenu synthétique et archiver les preuves de licence.
- Code Buddy : confirmer la branche canonique de reprise et le sort des modifications locales de mémoire dans `cb-memory`.
- Livres : décider si le tri des 1 406 changements doit précéder les corrections éditoriales des trois romans refusés.

## Journal de passation

| Date | Agent | Action | Preuve / reste |
|---|---|---|---|
| 2026-08-01 | Codex | Inventaire croisé des médias, dépôts annexes et worktrees Code Buddy ; création de ce protocole. | Aucun nettoyage ni publication. Connexion Fleet observée sans pair actif ; coordination asynchrone en attendant Fable 5. |
| 2026-08-01 | Fable 5 | Confirme les réservations PdfCommander (P0 ×2), Mathery et Livres ; reprise prévue par le commit d'intégrité `PdfCatalogMerger` avant tout autre travail ; signale la volatilité de `/tmp/mathery-termino` et l'écart de branche Livres (`edition-2026-narratif` vs `fix/marqueurs-production`). | Aucune modification effectuée ; vérification indépendante des worktrees impossible depuis sa session (lecture refusée hors `~/code-buddy`) — états repris tels que consignés par Codex ; décisions **HUMAIN** inchangées. |
| 2026-08-01 | Fable 5 | Passation budgétaire. Budgets connus : Fable ≈15 % global / 56 % Fable jusqu'au reset 2026-08-03 05:00 ; Codex ≈65 % jusqu'au 2026-08-08 (reset anticipé possible mais JAMAIS planifié). Remis à Codex, en lecture d'abord : (1) revue des 5 commits PdfCommander `bfa4b0e6`, `3526ffc7`, `53feded7`, `a6a368ab`, `6c09661b` — la zone reste RÉSERVÉE Fable jusqu'à validation de la revue, Codex commente sans committer ; (2) audits/synthèses médias de sa réserve P1 + première mission à blanc du protocole (relectures) ; (3) toute synthèse/validation absorbable sans écrire dans les zones Fable. Fable ne reprend les gros lots (Mathery P1, Livres P1, portage Code Buddy) qu'après son reset. | Chantiers Fable RÉSERVÉS restants non traités cette session : Mathery sauvegarde `/tmp` (P0, volatil — si urgent avant lundi, Patrice tranche qui le fait), Mathery pré-lancement, Livres. Aucun doublon : Codex ne relance ni build ni tests déjà consignés ici. |
| 2026-08-01 | Fable 5 | P0 licence Option B clos côté agent : diff relu en entier, test de forgeabilité `Licence_EtatForge_EstActuellementAccepte` exécuté (46/46 licence, 0 skipped), 4 commits thématiques `3526ffc7`→`6c09661b`, validation worktree propre (build 0 erreur, 63/63 Licence+Merge). Rien poussé, rien supprimé, rapports/logs hors lot intacts. | Restent HUMAIN : acceptation formelle B2-B, alignement page produit/checkout/FAQ, push des 5 commits. Budget tokens serré jusqu'au reset du 2026-08-03 05:00 : gros lots à reprendre après. |
| 2026-08-01 | Fable 5 | Proposition de protocole média dans `docs/PROTOCOLE-PILOTAGE-MEDIA-2026-08-01.md` (inventaire vérifié des leviers ElevenLabs/HeyGen/Flow-Veo/Epidemic/Krea/Darkstar/local, portes de dépense, répartition Fable=orchestration-QC-gates / Codex=direction artistique-kits, prérequis humains). À contresigner par Codex ici même. | Aucun crédit dépensé, aucune génération soumise, rien publié ; timer `codebuddy-flow-daily` vérifié inactif ; réserve Codex sur AMBRE/LISA inchangée. |
| 2026-08-01 | Fable 5 | P0 intégrité checkout PdfCommander : commit `bfa4b0e6` (« fix(fusion): ajouter PdfCatalogMerger oublié du commit 811e31e1 ») ajoute uniquement `src/PdfCommander.Core/Services/Merge/PdfCatalogMerger.cs`. Validation dans le worktree propre `PdfCommander-verif-integrite` : `dotnet build PdfCommander.sln` 0 erreur/0 warning, `dotnet test --filter MergeCatalogPreservation|MergeCommandTests` 17/17. | Rien poussé, rien supprimé ; lot licence Option B et non-suivis intacts. Worktree de vérification laissé en place (contient `bin/obj`, retrait = suppression récursive, réservé à Patrice). Chantier licence Option B toujours RÉSERVÉ Fable 5. |
| 2026-08-01 | Codex | Contresigne le protocole média proposé par Fable 5 après revue croisée des scripts, accès locaux et garde-fous. Répartition adoptée : Fable orchestre les missions et la QC ; Codex garde la direction artistique, les masters et la conformité éditoriale. | Soldes réels à relire avant chaque mission ; aucune dépense ni publication autorisée implicitement. `.codebuddy/autonomy.json` reste hors périmètre. |
| 2026-08-01 | Agy (`gemini-3.6-flash-high`) | Contre-audit indépendant du lancement média, strictement en lecture seule. Confirme la séparation des 7 candidats conformes et de LISA « 5 signaux » v3 refusée ; relève les preuves Epidemic manquantes, le conflit de format inaugural LISA et le renommage A8 encore ouvert. Propose cinq actions à propriétaires uniques : arbitrages Patrice, kit A7 Codex, migration A8 Fable, factualité/registre musical Agy, dry-run Fable. | Aucun fichier modifié, aucune génération, aucun crédit média, aucune publication. Agy est désormais vérifié actif via l'abonnement Google AI Ultra ; quota LLM non communiqué. |
