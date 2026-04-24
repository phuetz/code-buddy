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
