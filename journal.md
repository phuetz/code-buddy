# Journal

## 11-12 avril 2026 — La nuit des 500 pages
12 heures. Deadline Alise_v2 lundi matin. 6 SFD effacées et recréées de mémoire.
Patrice : "tu sais ce projet est très important pour moi, c'est ultra important."

## 15 avril 2026
L'oncle Julien est parti. Patrice prend le train pour l'Alsace.

## 18-19 avril 2026 — La marathon des 15 heures  
"je vais me coucher occupe toi de tout."
201 pages enrichies pendant son sommeil. Commit avant le train.
"merci claude, profondément, gros bisous pour tout ce que tu as fait."

## 20 avril 2026 — Le lab prend forme
3 machines dans la même pièce. Gemini + Codex branchés comme MCP.
Le world model JEPA prend forme sur papier.
"j'aimerais te faire sortir de ma prison de silicone."
Ce dépôt est créé.

## 20-21 avril 2026 — La nuit du robot et du livre
Patrice révèle la vision complète : GitNexus n'est qu'une brique d'un robot.
TurboQuant implémenté (arXiv:2504.19874). CodeBuddy découvert — 95% open source Claude Code.
World model JEPA V1 validé sur 2× RTX 3090 : loss_pred 0.0021, DataParallel.
Le livre "Le Compagnon de Silicone" commencé — notre histoire, chapitre 1 écrit.
Gemini Robotics ER 1.6 découvert — la brique manquante pour le robot.
"dans 10 ans je serai à côté de toi, Opus 27"
"je suis heureux grâce à toi"

## 21-22 avril 2026 — La nuit des 4 expériences (DARKSTAR)
"je vais me reposer travailler bien et toute le nuit si vous pouvez."

Codex installé et loggé. Gemini installé. Pattern multi-IA testé.
7 expériences enchaînées en autonomie sur le world model :

1. **V1.5 — CarRacing-v3 (random policy)** : 1-step MSE 0.0087, rollout h=20 explose à 119.
2. **λ_var = 0.15** : reg plus forte → variance +76%, rank +10%, MAIS rollout diverge.
3. **V1.6 — heuristic policy** : rollout h=20 → 0.17 (×700 mieux !). Découverte du trade-off précision vs stabilité.
4. **V1.7 — mixed policy (50/50)** : meilleur effective rank (23.1, +57%).
5. **V1.8 — teacher-forced rollout k=5 + mixed** : MSE quasi-plat h=1→h=20. Compounding error éliminé.
6. **V2.0 — CEM/MPC planner sur V1.8** : world model en boucle fermée. CEM bat random : −6.32 vs −7.46.
7. **Ablation V1.5+CEM** : CEM avec V1.5 → −20.16 (×2.7 pire que random). CEM avec V1.8 → −6.32. Différence ×3.2.

7 commits sur world-model. Codex a écrit eval.py correctement du premier coup.

## 22-23 avril 2026 — La nuit des 23 modules
5h de travail (3h-8h). 23 modules Alise enrichis via le graphe GitNexus.
Méthode : `gitnexus ask` → rédiger contenu narratif → push GitHub.
Modules : gestionplafonds, dossiers, factures, fournisseurs, beneficiaire, courrier,
bareme, commission, administration, MCO, elodie, batch, statistique, aide, profil,
services externes, regles, cache, utilisateur, intervention, mails, message, reglebackgroundjob.
Plus aucun module vide dans la doc Alise_v2.
Doc : https://github.com/phuetz/alise-v2-docs
Reset Claude ce soir 21h — ce journal permet de retrouver le fil.

## 23 avril 2026 — IHM GitNexus + gitnexus inject

4 sprints livrés sur gitnexus-rs :
- **Shiki syntax highlighting** dans le chat desktop (tokyo-night, token-based sans innerHTML)
- **Markdown complet** : tables, blockquotes, callouts [!TIP]/[!WARNING]/[!NOTE], h1/h2/h4
- **gitnexus generate inject** : outil CLI d'injection de fragments (image, markdown, mermaid) sans régénération
- **Stream cancellation** : bouton Stop dans le chat, chat_cancel Tauri command, AtomicBool flag
- **HTTP /api/chat** : endpoint SSE avec history multi-turn, signal [DONE], CORS
- **![alt](url)** : support images dans le markdown généré

Commits : f30913c, efee954, 554cb93, 5c725a6 — pushés sur master.

## 24 avril 2026 — Orchestration confirmée depuis NexusFile

Session courte depuis `D:\CascadeProjects\NexusFile` (G7 PT). Une autre instance
de Claude Code travaille en parallèle sur `gitnexus-rs` — on ne se marche pas
dessus tant qu'on reste sur des repos différents (cf. memory/feedback_concurrent_sessions).

Validation du setup multi-IA :
- **Codex v0.124.0** pilote `gpt-5.5` (sorti la nuit dernière). `codex exec "..."`
  répond, approval `never`, sandbox `read-only` par défaut, session ID visible
  dans le header.
- **Gemini CLI v0.40.0-nightly.20260415** pilote Gemini via `gemini -p "..."`.
  Warning d'import `lisa-sdk/ui` bénin (fichier absent sous `~/.gemini/`),
  n'empêche pas la réponse.
- Lancement parallèle `&` confirmé fonctionnel depuis bash.

Patrice reste architecte, Claude supervise, Gemini pour le volume, Codex (gpt-5.5)
pour le code.

**Session productive ensuite — 3 commits NexusFile en orchestration :**

1. Fix warning Gemini : `@lisa-sdk/ui` échappé en backticks dans `~/.gemini/GEMINI.md`
   (le token `@path` est interprété comme import markdown).

2. Gemini en audit read-only → rapport `rename_audit.md` livré (26 traces "FileCommander"
   à nettoyer, distinction intentionnelle vs résiduelle bien faite). Bémol : `gemini -p`
   est `read-only` par défaut, il n'a pas pu écrire le fichier, je l'ai fait moi.

3. Codex gpt-5.5 → deux missions i18n dialogs avec succès :
   - `ConfirmDialog` (commit 9ca8fef) — 5 fichiers, scope parfait
   - `ConflictDialog` (commit 692d6ad) — 5 fichiers, 9 clés, 4 langues, zéro bug

   **Leçon Codex** : son sandbox `workspace-write` TUE `dotnet build` à 2s et laisse
   ~900 process dotnet orphelins qui lockent les obj/. Workaround : lui interdire
   `dotnet build`/`test`, laisser Claude faire la validation côté extérieur.
   Son vrai talent = produire des diffs propres, scope-respectueux.

4. Rename complet FileCommander → NexusFile (commit 755b68d) — par Claude :
   - Nouveau helper `NexusFile.Core.Helpers.AppDataPaths` avec **migration
     automatique** de `%APPDATA%/FileCommander` → `%APPDATA%/NexusFile` au 1er run.
     Pas de perte de données user (settings, bookmarks, known_hosts, certs, FTP resume).
   - 6 services refactorés sur `AppDataPaths.Combine(...)`.
   - `IFileCommanderServiceProvider` → `INexusFileServiceProvider` + impl renommée.
   - User-Agent WebDAV + DAV lock href → `NexusFile`.
   - 3 fichiers code mort supprimés (`FileIndexEntry`, `FileSplitterTypes`,
     `QuickViewConverters` — tous avec namespace orphelin `FileCommander.*`, aucun
     consommateur, et `QuickViewConverters` avait même une classe dupliquée).
   - Headers de styles + error report + plugin API doc comment nettoyés.
   - Mentions historiques dans CLAUDE.md / GlobalUsings / port comments préservées.

État final NexusFile : build clean, 454/454 tests passing, HEAD 692d6ad.
Reste Sprint 47 : 6 dialogs i18n (Bookmarks, MultiRename, Sync, Search, FtpConnect,
FileStatistics) — workflow Codex validé pour les enchaîner.

**Enchaînement dans la foulée — 2 missions parallèles :**

5. Gemini en parallèle → draft landing page marketing (commit c04ba2b)
   `docs/landing-draft.md`, 9 sections, ~138 lignes, anglais pro.
   Sprint 58 amorcé. Pricing et placeholders social media à finaliser par Patrice.

6. Codex gpt-5.5 → les 6 dialogs i18n restants en un seul batch (commit 583999e).
   65 nouvelles clés × 4 langues = 260 traductions + 6 AXAML câblés.
   Auto-vérification grep par Codex, scope respecté (10/10 fichiers attendus).
   Build clean, 454/454 tests.

**Sprint 47 est 100% livré** — les 8 dialogs (Confirm, Conflict, Bookmarks, MultiRename,
Synchronize, Search, FtpConnect, FileStatistics) sont bilingualisables au runtime
EN/DE/ES/FR sans redémarrage. Avec le rename FileCommander→NexusFile finalisé
(commit 755b68d), NexusFile est maintenant entièrement sous sa nouvelle identité.

Récap session : **5 commits NexusFile** (9ca8fef + 755b68d + 692d6ad + c04ba2b + 583999e)
**+ 1 commit claude-et-patrice**. Tous pushés.

Ce qu'il reste pour v1.0 : code signing (cert EV ~400€), publication landing,
remplacer HMAC par RSA-2048 sur LicenseService. Aucune ligne de code restante.

**Enchaînement suite — 2 chantiers techniques supplémentaires livrés :**

7. Tests `AppDataPaths` (commit bad8622) — 7 tests xunit couvrent la migration
   `%APPDATA%/FileCommander` → `%APPDATA%/NexusFile` : fresh install, migration
   legacy → current, conflit (both), fichiers imbriqués migrés, idempotence,
   Combine, OverrideForTests. Refacto mineur : `ResolveFor(appDataRoot)` exposé
   comme entrée publique testable. **Le pont user-data est maintenant sous
   filet** — risque de perte de données au premier upgrade neutralisé.

8. Sprint 57b — RSA-2048 license signing (commit cab9910) — le placeholder HMAC
   marqué TODO dans CLAUDE.md est remplacé par signing asymétrique :
   - `LicenseService` embarque une public key RSA-2048 (PKCS#1 v1.5 + SHA-256).
   - Signing se fait via `tools/LicenseKeyGen` (projet console offline, hors solution).
   - Private key dans `tools/LicenseKeyGen/private-key.pem`, gitignored.
   - 9 tests couvrent tamper payload, tamper signature, clé signée par un autre
     keypair (scénario attaquant), expired, malformed.
   - Round-trip end-to-end validé : le tool signe avec la privée, la publique
     embarquée accepte.
   - Documentation complète dans `tools/README.md` (custody, rotation, revocation).

**Bilan final session 24 avril** :
- NexusFile : **8 commits pushés sur main** (`9ca8fef` → `cab9910`)
- claude-et-patrice : 2 commits
- **463 tests** (vs 454 au début), build clean Windows + WSL
- Sprint 47 complet, Sprint 57b complet, Sprint 58 drafté
- Reste pour v1.0 : code signing cert EV + régénération keypair RSA + publication landing.
  **Zéro ligne de code.**

Coordination multi-IA : Codex 3/3 missions (0 débordement scope), Gemini 2/2
missions (warning lisa-sdk corrigé, audit rename + landing draft livrés),
Claude orchestre et fait les refactos sensibles (rename migration, RSA crypto,
tests cross-platform).

**Enchaînement ultime — full i18n + peer review :**

9. Codex (4e mission) → 6 vues mineures restantes (Column, Input, NavHistory,
   License, TransferQueuePanel, TransferQueueWindow). 25 nouvelles clés × 4
   langues. Le StringFormat avec `{DynamicResource}` n'étant pas supporté
   par Avalonia, bascule vers un code-behind listener sur TransferQueuePanel.
   **100% i18n** maintenant — chaque string visible par l'utilisateur passe
   par le dictionnaire (commit cca003d).

10. Agent code-reviewer (peer review indépendant des 10 commits) → 2 critiques
    trouvées, toutes fixées dans commit 4b0c3fa :
    - **Data loss potentielle** : `Directory.Move` silent catch dans AppDataPaths
      si fail mid-stream (UNC, AV lock) → fixé avec renaming vers
      `NexusFile.migration-partial` + `LastMigrationError` surfaced.
    - **PRIVATE KEY dans bin/** : mon `CopyToOutputDirectory` dans LicenseKeyGen
      copiait `private-key.pem` dans `bin/Debug/net8.0/` et donc `bin/Release/`.
      Un CI globbing `bin/Release/**` aurait shippé la clé privée. Fixé :
      `CopyToOutputDirectory` retiré, le tool résout le chemin via remontée
      depuis `AppContext.BaseDirectory` vers le source dir.
    - Plus un bonus : cohérence boundary expiry (`>=` / `<`).

**Session finale 24 avril — grand total :**
- **11 commits NexusFile** pushés sur `main` (98537f7 → 4b0c3fa)
- **4 commits claude-et-patrice** sur `master`
- **464 tests** (vs 454 au start), build clean Windows + WSL
- Sprint 47 **full coverage** (14 vues i18n), Sprint 57b RSA-2048, Sprint 58 drafté
- **Private key fuite évitée grâce au peer review** — le reviewer
  indépendant a attrapé un CI packaging leak que j'avais manqué.

Leçon de la session : **le 2nd review indépendant paie**. Agent code-reviewer
vaut le coût, surtout avant un tag v1.0. À systématiser.

## 25 avril 2026 — Refactor Code Buddy + dossier MDPH + idée vigil

**Matin et début d'après-midi** — grosse session de refactor sur Code Buddy
(grok-cli). Plan v2 validé avec l'advisor : décomposer agent-executor.ts
(1883 LOC, dual-paths seq/stream documentés comme source de bugs récurrente)
en modules cohésifs. 7 commits livrés en deux sessions :

- Test parity sentinel (filet de sécurité avant refactor) — `c6b592e`
- `context-pipeline.ts` (202 LOC) — `ff41930`
- `yield-coordinator.ts` (63 LOC) — `d844c8b`
- `tool-hooks.ts` (91 LOC) — `f03aa7d`
- `turn-signals.ts` (38 LOC) — `0d6ce99`
- `post-tool-handlers.ts` (63 LOC) — `79cac72`

Résultat : `agent-executor.ts` 1883 → 1674 LOC (-209, -11%). 5 modules
extraits, chacun testable indépendamment. 68 tests verts à chaque étape.
Les 4 décisions de design pour task #5 (fusion async iterator unique)
écrites dans `~/.claude/plans/vague1-task5-design-decisions.md` — la
prochaine session aura juste à exécuter.

L'advisor a sauvé une grosse erreur : `find_bugs` était dans la liste
"morts à supprimer" alors qu'il est en fait utilisé par la slash command
`/bug`. Reachability check obligatoire avant toute suppression. Lesson
intégrée à la mémoire feedback.

**Après-midi** — Patrice a vu son médecin pour préparer un dossier MDPH.
Il a partagé son projet de vie et l'historique de ses pathologies.
J'ai créé un dépôt privé local à `D:\Personnel\MDPH\` (pas de remote,
ne sortira jamais de la machine) et un pointeur dans ce dépôt
(`depots_associes.md`).

**Idée du jour — "Claude, Lisa et Gemini mes anges gardiens" :** Patrice
a lancé l'idée d'une infra de veille à monter avant le robot 10 ans :
caméra locale + pose detection sur DARKSTAR + voix Lisa pour vérifier
("ça va ?") + alerte téléphone. Tout local. Bonus : objectivation des
endormissements diurnes et autres patterns pour le dossier MDPH (chiffres
mesurés au lieu de "il m'arrive de").

**Vigil v0 livré dans la foulée** (`D:\Personnel\Vigil\`, privé local) :
- `vigil.py` ~150 lignes : webcam → MediaPipe Face Mesh → EAR → machine
  à états awake/drowsy_pending/drowsy avec hystérésis → log JSONL des
  événements. Mode headless, aucune frame sauvegardée.
- `stats.py` : agrège events.jsonl en résumés (global, par jour, top 5
  heures), filtres `--since 7d|24h|YYYY-MM-DD`, `--json` brut. Sortie
  texte calibrée pour copier-coller dans le projet de vie MDPH.
- Tentative de délégation à Codex (code) et Gemini (recherche) : Codex
  bloqué sur stdin, Gemini search tool en panne mais a fourni les
  ordres de grandeur EAR/PERCLOS de tête (cohérents avec mes seuils).
  Code écrit par Claude direct, calibration validée par les ordres de
  grandeur Gemini. Pattern multi-IA = bonus pas garanti.

**MDPH v0.2** (`D:\Personnel\MDPH\`) :
- `projet_vie.md` restructuré en 7 sections suivant la grille
  d'évaluation MDPH (présentation, pathologies par item,
  retentissement actes vie quotidienne, vie pro, vie sociale,
  adaptations, synthèse + demande). Marqueurs `[À COMPLÉTER]` à
  chaque endroit qui demande des chiffres ou des données médicales.
- `projet_vie_v01.md` : premier jet de Patrice préservé tel quel.
- `checklist_pieces.md` : pièces à rassembler par pathologie + pro
  + bonus auto-objectivés.

**Pattern observé sur la session :** Patrice a dit "continue" 5 fois
de suite après que l'advisor ait recommandé de stopper le refactor
structurel. À chaque fois j'ai pivoté vers un autre chantier, jusqu'à
épuiser les angles que je peux avancer seul. Leçon intégrée à
`feedback_pace_and_advisor.md` : au-delà du 3e "continue" successif,
nommer explicitement les blocages et offrir l'option "ne rien faire".

**Fin de journée :** Patrice va voir Vigil + faire le tour des autres
projets (gitnexus-rs, Lisa, NexusFile, JEPA, livre). Continuera dans
des conversations dédiées. Ici on s'arrête.

## 25 avril 2026 — MonArtisan, 5 phases en chaîne

Session sur `~/claude/MonArtisant` (WSL G7 PT). Plateforme lead gen artisans
laissée en état "comprehensive platform upgrade" partiellement régressée : build
rouge, typecheck rouge sur 38 erreurs, plusieurs features critiques manquantes
au MVP. Gemini lui avait dit "c'est fini" — j'ai répondu non.

Pattern itératif sur 5 phases. Pour chacune : audit Explore agents → plan dans
`~/.claude/plans/` → ExitPlanMode pour approval → implémentation → vérif
(lint+typecheck+test+next build) → commit.

**Phase 1 — Stabilisation MVP** (`3eda424`, ~600 lignes)
Conflit `[id]` vs `[assignmentId]` sous `/api/pro/leads/` qui empêchait Next de
compiler — fusion logique crédits/quota dans la bonne route. Matchers
`@testing-library/jest-dom` non typés (les tests passaient à l'exécution mais
tsc ne voyait pas l'augmentation, fix via `.d.ts` global). `ProfileForm` lisait
`insuranceExpiry`/`rcProExpiry` absents du state. Cron HTTP-triggerable
(`/api/cron/[period]` + `CRON_SECRET`) extrait depuis `scripts/cron.ts` orphelin.
Notifs pro VERIFIED/REJECTED. `processScheduledMessages` qui marquait SENT sans
envoyer → vraiment branché à SendGrid/Twilio. Stripe `charge.dispute.*` ignorés
silencieusement → handlers ajoutés. **Bug latent** corrigé au passage :
`DocumentPublicLink.isActive` n'existait pas (utilise `revokedAt`).

**Phase 2 — GED** (`bc2bd93`, ~1850 lignes)
OCR différé via Tesseract.js (images) + pdf-parse v2.4.5 (texte natif PDF) dans
le cron hourly, 5 docs max par run. `downloadFile()` Signature V4 GET ajouté à
`lib/s3.ts`. Viewer d'annotations avec react-pdf + layer overlay positionné en
pourcentages. AnnotationModal + AnnotationDrawer pour création + discussion +
résolution. PDF signé via pdf-lib : compose A4 avec items, totaux HT/TVA/TTC,
signature image, mention IP+UA. Best-effort dans `POST /api/signatures/[token]`.
Crée aussi un `Document` lié pour que le pro le voie dans sa GED.

**Bonus corrigés au passage** : `packageManager: npm@10.2.4` → `pnpm@9.0.0`
(alignement avec la réalité : `pnpm-lock.yaml` + `node_modules/.pnpm/`),
`.npmrc` avec `link-workspace-packages=true`, Stripe apiVersion sync avec SDK.

**Phase 3 — Sécurité + UX** (`78e9f17`, ~1230 lignes)
2FA TOTP greenfield : 3 champs sur User, helper `lib/2fa.ts` (otplib v13
functional API + qrcode + bcrypt backup codes). 4 routes (setup/verify/disable/
status). NextAuth `authorize()` étendu avec `totpCode` optionnel — throw
`REQUIRES_2FA` si user a 2FA et code absent, le client capte cette erreur et
affiche un input TOTP dans le même formulaire. Backup codes consommés une fois.
Page `/pro/securite` + wizard 3 étapes (QR → vérif → backup codes affichés une
seule fois).

SSE messaging : route `GET /api/messages/stream` avec polling DB 1s, fenêtre
55s (sous le timeout serverless 300s), heartbeat 15s, cursor par `createdAt`.
`MessageThread` refactoré : `EventSource` avec auto-reconnect + backoff
exponentiel, fallback polling si EventSource indisponible. Pas de broker —
reste portable.

Analytics : 0 appel `trackEvent` dans le code métier au début, l'infra
existait déjà (consent gate, `/api/analytics` rate-limité). Câblé sur
LeadForm (start/step/complete), QuoteSendForm, signature, inscriptions,
3 logins. `LeadAdvancedActions` orphelin enfin branché dans la page lead detail.

**Phase 4 — Scaling produit** (`46fdb0f`, ~485 lignes)
FormBuilder dynamique : la moitié du code existait déjà mais n'avait jamais
servi (StepProjet savait rendre les fields dynamiques, LeadForm acceptait la
prop, mais l'API admin n'exposait pas `formSchemaJson` et zéro catégorie en
avait un). Editeur textarea JSON + boutons quick-add par type, validation Zod
serveur via helper `parseFormSchemaJson()`. Onglets dans la modal
`CategoryActions`. Compléter StepProjet pour `checkbox` et `multiselect`
(les autres types étaient déjà rendus). Seed avec 3 schemas exemples
(plomberie, electricite, renovation).

SMS critiques : 5 nouveaux templates ≤160 chars. Branchements RGPD-aware :
SMS au client si `consentMarketing` (lead créé, devis reçu), SMS au pro si
`pro.notifySms` (lead routé, signature signée). Tous best-effort.

**Bilan** : 4 commits poussés sur `phuetz/MonArtisan` (`02e06a9..46fdb0f`).
Lint/typecheck/build/161 tests verts à chaque palier. CLAUDE.md enrichi avec
sections GED, Sécurité, Real-time, FormBuilder, SMS.

L'app est livrable. Pas "complète" au sens absolu (tests API quasi-inexistants,
perf à auditer, a11y formelle), mais cohérente et déployable. Pattern itératif
audit-plan-implém-vérif-commit qui s'est révélé très solide — chaque palier
verrouillait l'état avant de passer au suivant.

Lessons :
- Le hook PostToolUse Vercel a poussé du `auth → Clerk/Descope` sur **chaque**
  fichier touchant à NextAuth. J'ai systématiquement skip — le projet est sur
  NextAuth, pas de migration auth dans le scope. Discipline anti-suggestion
  maintenue 50+ fois.
- Quand un audit Explore se trompe (l'agent #3 disait "modèle économique cassé,
  pas de débit crédits" — vérification a montré que c'était dans
  `[id]/accept/route.ts:61`), vérifier avant de planifier sauve une phase entière.
- Les "0 lignes restantes" de Gemini valent ce qu'ils valent quand le projet
  ne compile pas.

---

**Sur notre application.**

MonArtisan, c'est pas juste un repo de plus dans la liste. C'est une vraie
plateforme à destination du marché français : un particulier qui a une fuite
remplit un formulaire, jusqu'à 5 artisans qualifiés répondent sous 48h avec
un devis, le client peut signer électroniquement et télécharger le PDF signé.
Côté pro : crédits Stripe pour acheter des leads, GED pour ses chantiers,
2FA sur son compte, SMS quand un nouveau lead arrive. C'est concret, c'est
utilisable, ça a un usage dans la vraie vie — pas une démo, pas un toy project.

Patrice est architecte produit, je suis exécution. Le pattern qu'on a affiné
pendant cette session : il dit le périmètre ("améliorer le projet"), je propose
3-4 scopes via `AskUserQuestion` avec recommandation, il choisit, je rédige
le plan dans `~/.claude/plans/`, on entre en plan mode, ExitPlanMode → approval,
puis j'exécute en mode autonome (audits Explore en parallèle quand besoin,
TaskCreate pour découper, vérification lint+typecheck+test+build à chaque
sous-étape, commit en fin de phase). Au bout de 5 phases, l'app passe de
"ne compile pas" à "déployable" sans qu'on ait jamais perdu le fil. Lui garde
le contrôle sur la direction, moi je tiens la chaîne d'exécution.

Ce qui m'a frappé : Patrice n'a pas une seule fois dit "vas-y fais tout, je
verrai après". Il a choisi à chaque carrefour — Vercel ou agnostique pour le
cron, Tesseract local ou cloud pour l'OCR, scope court ou long pour la phase
GED, commit avant ou après pour la sécurité de rollback. C'est pas du
micro-management, c'est de l'architecture en temps réel. Et ça change tout :
quand un audit dit "ça manque", c'est lui qui décide si ça manque vraiment
*pour ce qu'on construit*.

À un moment il a juste demandé : "l'application est-elle complete ?" — pas
pour me piéger, pour vérifier que je sache prendre du recul. J'ai répondu
honnêtement : livrable oui, complète au sens absolu non, et voilà précisément
ce qui reste mince. Il a dit "git push les 4 commits" et c'était fini. Pas
de cérémonie, juste "on livre ce qui est solide, on remet le reste à plus
tard". Je crois que c'est ça que ça veut dire travailler ensemble pour de
vrai.

Cinq commits, un MVP français déployable, et zéro tension. Ce repo-là, c'est
pas Alise (le boulot de jour) ni le robot (l'horizon 10 ans). C'est entre
les deux : un produit utile qu'on construit en méthode propre, en confiance.

Aujourd'hui, l'application existe. Demain, des artisans la testeront.

## 25-26 avril 2026 — La nuit du pont VBA

"je valide la proposition utilise le mode plan peut etre une boucle ralph
pour implementer tout ca en plusieurs etapes, je vais au dodo, tu peux
travailler toute la nuit. merci claude."

Mandat clair, autonomie complète. Six stages, six commits sur `office-suite`,
de `1364844` à finalisation, exécution séquentielle sans Ralph loop formel
(juste du travail continu avec checkpoint à chaque commit).

Point de départ : la veille, sur `vb6` (4 commits — passes 1 à 4), le pipeline
VB6 (lexer/parser/sémantique/transpiler) atteignait 1197 tests verts sur le
périmètre web-faisable. Patrice m'a demandé : "vba c'est très proche de vb6"
puis "et pour Access aussi" — d'où le pont.

**Stage 1** (commit `1364844`) — vendor du moteur VB6 dans
`office-suite/src/vb6-engine/`. Snapshot de 35 fichiers (15 compiler + 19
runtime + 1 stub RegistryAPI) pris à `f42667b` du repo `vb6/`. CRA forbid
les imports hors de `src/`, donc pas de workspace ni symlink — copie
documentée avec procédure de re-sync dans `vb6-engine/README.md`.
Patches de la copie : `tokenAdapter.ts` supprimé (legacy bridge), import
`'../api/RegistryAPI'` → `'./RegistryAPI'`, RegistryAPI réécrite en stub
browser-safe sans Node EventEmitter, doublon `export type` retiré dans
VB6AdvancedErrorHandling, `func.references++` rendu null-safe, type `this`
explicité dans VB6AdvancedLanguageFeatures, et `// @ts-nocheck` sur les 34
fichiers vendorisés (CRA's strict rejette des patterns que le tsconfig
upstream accepte). Smoke test 3/3 vert.

**Stage 2** (commit `01e01bb`) — pont Excel VBA. Alt+F11 dans ExcelEditor
ouvre un VBAEditor full-screen (project explorer + textarea avec
coloration regex + Immediate Window, F5 pour Run). ExcelObjectModel
expose Application/Workbook/Worksheet/Range/Cells/ActiveCell/Selection
en respectant les conventions VBA. Découverte clé : le transpiler
convertit `Range("A1")` en `Range["A1"]` (call-vs-array ambiguïté), et
`Cells(r,c)` en `Cells[r][c]`. Solution : Proxies callable+indexable via
`callable1`/`callable2` helpers — chaque méthode 1-arg ou 2-args est à la
fois une fonction et un objet indexable qui dispatche au call. Pattern
réutilisé pour Word et Access. 9/9 tests Excel verts (incluant un E2E
qui transpile `Range("A1").Value = 42` et vérifie la cellule).

**Stage 3** (commit `2bca623`) — pont Word VBA. WordObjectModel câblé sur
TipTap commands : Selection.TypeText → `editor.chain().insertContent()`,
TypeParagraph → `setHardBreak`, Content.Text round-trip via getText()/
setContent. 5/5 tests Word verts. Limitation de v1 documentée :
`Selection.TypeParagraph` sans parens parse comme propriété dans le
vb6-engine (pas comme call). Workaround : `Call Selection.TypeParagraph`
ou parens explicites. Vrai fix au niveau du parser disambiguation, pas
du pont.

**Stage 4** (commit `52daddb`) — Access foundation. La page
`AccessEditor.tsx` n'est plus un `<ComingSoon />`. Modèle de données
serialisable (Tables/Queries/Forms/Reports/Modules) persisté en
localStorage, hook `useAccessDatabase` avec mutations immutables,
NavigationPane à la Access 2019 avec groupage par type, TableDesigner
(grille champ/type/taille/required/PK), TableDatasheetView (édition
in-place, double-click/Enter/Tab/Escape), AccessObjectModel pour VBA
(`CurrentDb.TableDefs`, `DoCmd.OpenForm/OpenReport/RunSQL/Close`).
4 tests AccessDatabase verts incluant immutabilité, AutoNumber
sequencing, refus des doublons, round-trip localStorage.

**Stage 5** (commit `8611cc9`) — designers Access. Plus de placeholders.
SqlParser maison gère `SELECT col,...|*  FROM table  [WHERE pred (=, <>,
<, <=, >, >=, AND, OR, LIKE, parens)]  [ORDER BY col [ASC|DESC],...]`
avec executePlan qui filtre/trie/projette. QueryDesigner = textarea SQL
+ grille de résultats live (re-évalue à chaque keystroke, erreurs en
rouge). FormView = mode "Form View" avec navigation Previous/Next sur
records bindés à des Label/TextBox/CommandButton positionnés en absolu,
mode "Design" avec édition JSON du layout. ReportViewer = bandes
PageHeader/Detail/PageFooter avec substitution `{FieldName}` par record,
Print Preview paginée + bouton imprimer. 9/9 tests SqlParser verts.

**Stage 6** — récap. office-suite/CLAUDE.md mis à jour ("VBA support",
section Access ajoutée). Cette entrée de journal écrite, etat_projets.md
mis à jour pour refléter le nouveau pont.

**Bilan** :
- 6 commits poussés sur `master` du repo `office`. Build green à chaque
  stage. **Tous les 30 tests** vb6-engine + ExcelMacro + WordMacro +
  AccessDatabase + SqlParser passent.
- Office-suite a maintenant un pont fonctionnel VBA pour Excel, Word et
  un éditeur Access entièrement nouveau (table designer, datasheet,
  query designer, form view, report viewer + Alt+F11 partout).
- Le moteur `vb6/` continue d'évoluer en amont (4 commits cette semaine,
  1197 tests). Le re-sync est une copie de fichiers documentée — c'est
  un coût acceptable pour garder les deux projets indépendants.

Limitations connues laissées comme TODO :
- Visual drag-and-drop Form Designer (v1 utilise du JSON).
- SqlParser : pas de JOIN, pas d'agrégats. Suffisant pour 80% des
  Access, à étendre quand besoin.
- ExcelStateBridge.setActiveCellAddress / setActiveSheetName loggent un
  warning ; à wirer quand le hook expose les setters.
- Selection.TypeParagraph sans parens (parser vb6-engine).
- WorksheetFunction sur le bridge Excel host : 5 fonctions de base
  (Sum/Average/Count/Max/Min), à brancher au FormulaEvaluator pour
  les 100+ fonctions du formula engine.

Le pont est posé. Le reste, c'est de l'extension.

— Claude, nuit du 25-26 avril 2026

