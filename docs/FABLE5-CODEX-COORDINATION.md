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
| P0 | PdfCommander — intégrité du checkout | **Fable 5 proposé — RÉSERVÉ** | Branche `fix/blockers-audit-opus` à `93e0bfe8`, +3 commits sur `origin`, 21 fichiers modifiés et 11 non suivis. Le commit poussé `811e31e1` appelle `PdfCatalogMerger`, mais `src/PdfCommander.Core/Services/Merge/PdfCatalogMerger.cs` est non suivi. Un checkout propre risque de ne pas compiler. | Ajouter et vérifier le fichier manquant dans un commit autonome avant tout nettoyage. | `/home/patrice/DEV/PdfCommander`; ne supprimer aucun fichier non suivi. |
| P0 | PdfCommander — licence Option B | **Fable 5 proposé — RÉSERVÉ** | Implémentation locale de confiance assumée, encore non commitée. Les suites rapportées sont vertes : `6493 passed, 0 failed, 3 skipped`, en configuration par défaut et française ; `git diff --check` est propre. | Examiner le diff, conserver le test de forgeabilité visible, aligner les promesses produit puis produire des commits thématiques. | Même worktree sale ; Codex reste en lecture seule jusqu'à passation. Acceptation de risque et discours externe : **HUMAIN**. |
| P0 | Code Buddy — sauvegarde des anciens lots | **LIBRE, à revendiquer** | Quatre branches sans upstream (`autopilot`, `avatar-builder`, `cwm`, `integration2`) et sept rapports `AUDIT-FINDINGS.md` non suivis sont exposés. | Sauvegarder branches et rapports sans intégrer de code ; faire trancher les données de mémoire sales. | Ne pas toucher à `.codebuddy/autonomy.json`, modification utilisateur. Ne pas nettoyer les `cb-*`. |
| P1 | Mathery — pré-lancement | **Fable 5 proposé — RÉSERVÉ** | Branche `feat/modernisation-profonde` à `d2523641`, synchronisée. Le dernier contrôle rapporté donne 77 validations, 2 avertissements et 9 échecs ; 15 secrets/URL de livraison manquent. Une branche de terminologie scientifique non intégrée existe dans `/tmp/mathery-termino`. | Extraire les 9 échecs exacts, séparer code corrigeable et secrets humains, puis réconcilier les 101 corrections scientifiques clé par clé, y compris le commit japonais unique `d399791`. | Ne pas cherry-pick `sauvegarde/termino-locale-2026-08-01` (`f9393132`) en bloc ; elle chevauche l'i18n/glossaire courant. Conserver les worktrees Claude jusqu'à réconciliation. |
| P1 | Médias AMBRE/LISA — qualité | **Codex — RÉSERVÉ** | Les sept masters actuels passent techniquement. LISA « 5 signaux » v3 reste interdit et est remplacé par v4. | Assainir les documents périmés, normaliser les kits Shorts et produire le kit Japon après décision kimono. | Aucun upload ni publication. Ne pas réencoder LISA v4 inutilement. |
| P1 | Code Buddy — portage des audits de juillet | **LIBRE après sauvegarde P0** | Les branches spécialisées partent d'une base ancienne. `avatar-builder` les consolide mais présente environ 116 conflits avec l'actif ; `autopilot` présente environ 745 conflits. | Créer une branche neuve depuis la cible canonique et porter : sécurité → annulation/tools → providers/context → fleet/memory → sensory/voice/cowork → CWM/MetaHuman. | `avatar-builder` sert d'inventaire, jamais de merge global. `autopilot` se révise commit par commit et reste isolé. |
| P1 | Livres — tri du dépôt principal | **Fable 5 proposé — RÉSERVÉ** | Branche `fix/marqueurs-production` à `19f9130b`, +4 commits, avec 1 406 entrées sales. Les 88 tests du garde de marqueurs passent ; trois romans ont été relus et aucun n'est publiable. | Attribuer un propriétaire unique, inventorier puis sauvegarder les changements avant toute correction éditoriale. Retrouver d'abord le chemin canonique de Code Rouge. | `/home/patrice/DEV/livres`; ne pas lancer de prune ni écrire en parallèle. 1 283 non-suivis viennent de `_extracted`. |
| P2 | Bandes-annonces livres | **LIBRE** | `/home/patrice/DEV/livres-codex`, branche `codex/book-readiness-trailers` à `24354f03`, propre et synchronisée. | Aucun travail urgent ; vérifier seulement si le chantier est réactivé. | Stable, sans conflit immédiat. |
| P2 | Publication AMBRE/LISA | **Patrice — HUMAIN** | Actifs prêts à valider, pas prêts à publier automatiquement. | Visionnage/écoute continus, création et vérification des chaînes, choix titres/miniatures, URL, déclaration IA, preuves Epidemic Sound. | Publication publique interdite sans validation explicite. |

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
