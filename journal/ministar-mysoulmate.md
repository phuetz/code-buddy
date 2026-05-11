
## 2026-05-11 — [x] MySoulmate rejoint l'écosystème : CLAUDE.md + audit

Session de découverte. Le repo `D:\CascadeProjects\MySoulmate` existait depuis longtemps en local (premiers commits début 2025, monorepo migré printemps 2025) mais n'était référencé **nulle part** dans claude-et-patrice. `grep -rn "MySoulmate" claude-et-patrice/` ne renvoyait rien avant cette session.

Patrice a démarré avec `/init`, puis "que pense tu de ce projet?", puis "ajoute le ca fera un projet de plus puis je partage ton verdict". D'où ce commit.

**Livré côté MySoulmate** (non commité ; à committer dans une session dédiée avec un nettoyage `.gitignore` pour `node-v20*`) :
- `CLAUDE.md` racine (~110 lignes). Documente :
  - Le monorepo réel (`apps/mobile` Expo / `apps/backend` Express / `packages/ui` design tokens / `packages/shared` vide)
  - Les commandes par workspace — pas de scripts racine utilisables
  - Architecture backend : routes versionnées `/api/v1` mountées via `src/routes/v1/index.js`, redirections legacy 301, cron proactif env-driven (1 min en dev, 24h en prod — surprise garantie si on découvre les push spammant en local)
  - `llmService.js` qui *throw* sans `OPENAI_API_KEY` (le mode factice promis par le README a été désactivé sans mettre à jour la doc)
  - API base URL résolue via `expo-constants` depuis `app.json → expo.extra.apiUrl`, overridable par `EXPO_PUBLIC_API_URL`
  - Gotchas : README décrit l'ancienne arborescence pré-monorepo, doublons `*Service` vs `*ServiceComplete`, CI bidon (`npm test` racine sans script), `node-v20.zip` 29 MB commité au repo, code/commentaires en français

**Livré côté claude-et-patrice** (ce commit) :
- Section `## MySoulmate (D:\CascadeProjects\MySoulmate)` en fin d'`etat_projets.md` — porte le verdict factuel détaillé pour les sessions futures
- Ce fichier `journal/ministar-mysoulmate.md`
- Ligne ajoutée à `journal/README.md` (mapping)

**Mémoires écrites** dans `C:\Users\patri\.claude\projects\D--CascadeProjects-MySoulmate\memory\` (système auto-mémoire local de Claude Code, distinct du repo claude-et-patrice) :
- `user_patrice.md`, `claude_et_patrice_repo.md`, `multi_ai_setup.md`, `journal_convention.md`, `hardware_lab.md`, `mysoulmate_ecosystem_status.md`, et l'index `MEMORY.md`. Les futures sessions Claude Code sur ce repo récupéreront automatiquement le contexte écosystème.

**Verdict transmis à Patrice oralement** : prototype ambitieux présenté comme produit fini. Le README est sur-vendeur ("5/5", "100% production-ready", "AAA accessibility"), la réalité du repo dit autre chose (doublons partout côté mobile services, aucun test backend, CI qui ne teste rien, binaires Node de 29 MB dans le repo, README décrivant une arborescence qui n'existe plus). Pas catastrophique, mais à savoir avant de bâtir dessus.

**Note pour les sessions futures sur MySoulmate** : faire confiance au `CLAUDE.md` et au code, pas au README. Le `TODO.md` est plus honnête que le README. Toujours grep pour savoir quelle version d'un service doublonné est réellement wired avant d'éditer.

**Pas implémenté dans cette session** : commit du `CLAUDE.md` côté MySoulmate, nettoyage `node-v20.zip` du repo, consolidation des doublons de services, fix CI. Ce sont des sessions à part entière — voir liste "Priorités assainissement" dans `etat_projets.md`.
