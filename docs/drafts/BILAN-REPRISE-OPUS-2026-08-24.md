# Bilan de reprise Opus — 24 août 2026

Pilote : Codex + flotte disponible, Claude exclu à la demande de Patrice. Aucun push, achat, déploiement, publication, changement de compte ni consommation de crédit média.

## Livraisons terminées

### Formation LISA IA

Dépôt : `/home/patrice/DEV/formation-lisa-ia`, branche `master` locale.

- PDF rendus reproductibles et métadonnées normalisées ;
- 24 ancres internes cassées corrigées ;
- QCM P7 corrigé ;
- sept exercices supplémentaires réellement différenciés des leçons ;
- 15 PDF, 365 pages, 192 liens internes, 0 lien non résolu ;
- reconstruction byte-identique, `qpdf` 15/15, tests Python 2/2.

Commits : `7c92cc5`, `b2d4ede`, `69b11ef`, `efdf55c`, `349220b`, `e8e2dba`, `fb15792`, `2f5f719`.

### Livre « Automatisez vos chaînes YouTube »

Dépôt : `/home/patrice/DEV/livre-automatisez-youtube`, branche `master` locale.

- chapitre 9 aligné avec la grille 0–3–10–50–60 ;
- note `[H]` redondante retirée ;
- rapport transversal remis en cohérence avec le texte courant ;
- manuscrit déterministe : 16 chapitres, 58 093 mots, 133 notes, 0 orpheline.

Commit : `cb72266`. Deux choix de casse LISA/Lisa au chapitre 2 restent éditoriaux et donc humains.

### Chaîne LISA IA

- 29 masters contrôlés à partir de leurs sidecars `delivery-qc.json` ;
- 29/29 `OK`, loudness intégré de −14,12 à −13,96 LUFS ;
- correctifs média déjà présents sur la branche `fix/shorts-decimaux-karaoke` : `1f70d037` et `da409663` ;
- le port propre vers `origin/main` a été refusé : les scripts média ont été supprimés de cette lignée, donc aucun fichier historique n'a été réintroduit.

Reste humain : supprimer/remplacer les cinq uploads privés L1–L5 et décider après écoute finale.

### Chaîne Ambre

- 28 masters normalisés contrôlés avec `ffprobe` + `ebur128` ;
- 28/28 présents, H.264/AAC mono 48 kHz ;
- audio entre −14,5 et −14,1 LUFS, pics entre −1,5 et −1,4 dBFS ;
- pack corrigé pour viser `publiables-lancement-norm/` ;
- dry-run d'upload privé : 28/28 entrées parsées, aucune écriture YouTube ;
- contre-audit : `~/.codebuddy/personas/ambre/chaine/AUDIT-PACK-AMBRE-NORMALISE-2026-08-24.md`.

Reste humain : recouper les faits signalés, trancher Halong/Gizeh, choisir l'avatar et publier.

### Mathery

Branche isolée : `fix/mathery-release-gates-2026-08-24`, worktree `/home/patrice/mathery-release-gates-2026-08-24`.

- `006d64bb` : couverture réelle du rendu Markdown/KaTeX des fiches IA et restauration du contrat smoke ;
- `8d4ad54a` : smoke Lite adapté au mode « Naturel » et au menu d'actions courant ;
- `34d58f40` : imports Pro dirigés vers les sous-modules sûrs, sans réimporter le moteur complet ;
- `b885f455` : catalogue anglais chargé à la demande, français conservé statique et fallback ;
- test composant : 12/12 ; contrats IA : 10/10 + contrôle statique vert ; wiring smoke : 23/23 + contrôle statique vert ; typecheck Pro vert ;
- smoke navigateur ciblé vert : `math-field → 2*x+sqrt(16)+2*pi`, moteur HiPER, 0 erreur console/page.

Contre-revue des budgets : le seuil Lite est obsolète après l'embarquement volontaire de FR+EN, le contrôle des wrappers Standard/Scientific est un faux positif après consolidation du module canonique, et le seuil CLI décrit une architecture mutualisée déjà présente. La régression Pro est fermée sans relever le budget : entrée de ~451,9 à 146,1 KiB, anglais séparé à 41,1 KiB et Algebrite différé. Les 34 tests i18n, 22 tests de gate, le typecheck, le build et tous les budgets Pro sont verts. Les artefacts locaux du checkout source sont périmés ; checkout/signature/DNS/secrets restent humains.

### NexusSwitch

Branche isolée : `fix/nexusswitch-bundle-budget-2026-08-24`, worktree `/home/patrice/nexusswitch-bundle-budget-2026-08-24`.

- `03ec2f1` : `docx` isolé dans un chunk dédié ; entrée principale de 924 à 590,7 KiB ;
- `d90866f` : 149 chaînes UI remises sur des clés FR/EN existantes, autonyme documenté et statut licence rendu indépendant de la langue ;
- bundle, lint, build, typechecks et 621/621 tests verts ;
- `check:commercialisation` ne reste rouge que pour le checkout et le canal de mise à jour volontairement indisponibles ;
- dette i18n : 208 → 57 alertes. Les 57 restantes nécessitent une traduction/copie nouvelle et ne sont pas remplacées mécaniquement ; deux vulnérabilités `pptxgenjs → image-size` restent sans mise à jour non cassante.

Les 88 documents de lancement non suivis ont été audités sans modification : 0 doublon exact, mais 85 cases de préflight, plusieurs jetons (`{{SITE}}`, `{{LIEN_PH}}`, `{{LIEN_VIDEO}}`, etc.) et des promesses trop larges (« 100 % local », « toutes les fonctions », offre à 39 €) interdisent la publication. Les fichiers sont répartis en 16 lots de préservation ; le checkout source reste intact.

## Applications finalisées ou triées

- NexusFile : branche `fix/nexusfile-pro-signing-gates-2026-08-24`, commit `2e47c724`, contre-revue indépendante `GO`. La passe a prouvé que seule la gate Bash activait l'issuer RSA éphémère : PowerShell, checklist Windows/WSL, couverture, audit et CI laissaient cinq smokes Pro en skip. Les gates App activent maintenant cet opt-in strictement local puis restaurent l'environnement antérieur, sans toucher `src/` ni `external/`. Debug 6/6, Release 19/19 ; contre-rejeu contrats 13/13, smokes 5/5 et négatif 1/1. La RSA 2048 reste en mémoire et seule la clé publique passe au child. Réserve non bloquante : contrat de restauration textuel et absence locale de `pwsh`. Les vrais runners Windows/macOS et signatures/notarisation/store/feed restent humains.
- Assistante téléphonique : branche `test/local-barge-in-next-turn-2026-08-24`, commit `d073895d`, contre-revue indépendante `GO`. Le scénario injecte le vrai framing AudioSocket, traverse RMS/VAD et l'annulation du premier tour, reconstruit le WAV/STT puis prouve que seul le PCM TTS distinctif `0x5a` du second tour repart. Ciblé 1/1 puis 10/10, contre-rejeu 5/5, barge-in 12/12 et suite 29/29 verts ; l'ancien payload, l'absence de second tour ou un mauvais framing font échouer. `MemorySocket` remplace TCP/Asterisk/RTP, STT/RAG sont injectés et Piper simulé : l'appel bout-en-bout réel demeure une gate externe.
- ESN : branche `fix/esn-postgres-ci-gate-2026-08-24`, commit `1ed95860`, contre-revue indépendante `GO`. La CI ajoute un PostgreSQL 16 éphémère et un vrai test du schéma puis de toute la chaîne de migrations sur une base `esn_ci` fail-closed. Cette gate a révélé puis fermé deux incompatibilités masquées par SQLite (identifiants camelCase/CURRENT_TIMESTAMP du multi-tenant et identifiants CRA→facture non cités). PostgreSQL réel 2/2, contrôles SQLite/statiques 10/10, lint et typecheck complets verts ; garde locale et refus de `not_esn_ci` confirmés, aucun accès à une base distante. Réserve non bloquante : les branches legacy conditionnelles ne sont pas toutes automatisées, mais leurs SQL modifiés ont été rejoués sur fixtures legacy.
- MonArtisan : branche `codex/monartisan-e2e-recaptcha-2026-08-24`, sept commits `b7a4104`, `df17682`, `d291d13`, `9f923d0`, `83da525`, `b05aed7` et `19cf043`, contre-revue indépendante `GO`. Le happy-path Playwright intercepte uniquement en test la frontière `/api/leads`, vérifie le payload et conserve la politique reCAPTCHA production intacte. Le harness CI partage un port unique, refuse la réutilisation d'un serveur en CI et seed une base PostgreSQL jetable de façon idempotente. Le helper de succès partagé ferme le fallback NextAuth HTTP 200 `signin?csrf=true` sur les logins admin, public et Pro, sans modifier 2FA/email non vérifié. Dix-sept attentes/locators obsolètes ont été réalignés et les labels Contact associés à leurs contrôles. Gates : 20/20 Vitest reCAPTCHA/route, contrat+wiring auth 15/15, auth authorize 13/13, Chromium auth 48/48, typecheck et lint verts. **Run final Chromium sur PostgreSQL 16 frais : 93/93 verts** ; conteneur jetable supprimé ensuite. Réserve mineure : le wiring ne monte pas admin et n'asserte pas directement la redirection, inchangée dans le diff. L'acceptation CGU implicite reste un arbitrage métier/juridique humain.
- Isidore : branche `fix/isidore-deploy-e2e-gate-2026-08-24`, commit `6ffac24c`. Le déploiement dépend maintenant des E2E, la matrice est alignée sur Node 20/22 et les actions d'artefacts passent de v3 à v4. YAML valide, graphe de huit jobs acyclique, worktree propre ; aucun workflow lancé.

## Garde-fous respectés

- aucun secret lu ou affiché ;
- aucun push, merge, clean, reset ou suppression de worktree ;
- aucun appel facturé, upload, publication, déploiement, DNS, certificat, compte ou paiement ;
- checkouts sales et fichiers non suivis préexistants conservés.
