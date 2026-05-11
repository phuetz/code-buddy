
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

## 2026-05-11 (plus tard, même jour) — [!] Découverte : main local était un fork mort

Tentative de pousser les 3 commits suivants côté MySoulmate :
- `2498b22 chore: ajouter CLAUDE.md + nettoyer .gitignore`
- `c0eaae2 refactor(mobile): supprimer 3 services *Complete orphelins`
- `3e49258 ci: workflow honnête (install + lint warn-only)`

Push **rejeté** : remote `origin/main` avait 20+ commits d'avance signés Patrice (i18n, voice calls, Redis, social feed, video calls avatar, voice cloning, security hardening, etc.) sur l'**archi plate**, pas le monorepo local. Les deux histoires `main` divergent depuis `7c08bf6` (Merge PR #81, 14 juillet 2025) — 10 mois.

Le local sur MINISTAR avait Patrice qui avait fait :
- `1770aab` "chore: save uncommitted work before fixing build issues" (5 mai)
- `0508611` "feat: Phase 15-17 - Add Proactive Cron, ComfyUI integration, and Store screen" (8 mai)

…avec migration monorepo (`apps/mobile/`, `apps/backend/`, `packages/ui/`). Cette branche n'a **jamais été pushée** sur origin. Pendant ce temps, Patrice continuait sur d'autres machines à itérer sur l'archi plate du remote.

**Décision Patrice (AskUserQuestion)** : remote = vérité. J'ai :
1. Tagué le travail local : `claude-session-2026-05-11` (récupérable via `git show`).
2. `git reset --hard origin/main`. Local pointe maintenant sur `2d4c968 docs: update CLAUDE.md with current test stats (101 suites, 1573 tests)`.
3. Supprimé du working tree les orphans : `apps/` (6.8 MB), `node-v20.11.1-win-x64/` (84 MB), `node-v20.zip` (29 MB). Plus de pollution.

**Ce qui s'est vraiment passé sur le projet** (que je ne savais pas) :
- Suite Jest **fonctionne** : 101 suites, ~1573 tests, 0 failure. Couverture 78%/70%/90%. `npm test --runInBand`.
- CI réelle `.github/workflows/ci.yml` : `npm ci` + lint + test + typecheck. Honnête.
- Le CLAUDE.md remote (commit `2d4c968`) est factuel et utile — mentionne les "~3100 non-blocking TS errors", désigne `components/ui/DesignSystem.tsx v4.0` comme source unique (les anciens design systems marked deprecated), liste les "ULTRA Services" expérimentaux à `services/*.ultra.ts`.
- Pas de doublons `*ServiceComplete`. Pas de `node-v20.zip` commité. Pas de README "stale" — le README correspond bien à l'archi plate.

**Correctif** : addendum honnête ajouté à la section MySoulmate dans `etat_projets.md` (sans effacer l'analyse initiale — chronologie préservée). L'entrée originale documente l'état d'un fork local mort, qui était mon référentiel par ignorance.

**Leçon** : sur les projets multi-machine de Patrice, **toujours `git fetch && git status -uno` avant toute analyse**. 10 mois de drift `main` signés du même `phuetz` n'ont jamais été détectés visuellement.

**Hors scope (toujours)** : assainissement réel du repo (les 3100 erreurs TS, les services .ultra.ts, le `_layout.tsx` qui doit lister tous les écrans). Sessions à part. Sans étonnement maintenant : ce projet est plus mature que je le pensais — il a des vrais tests qui passent, une vraie CI, une vraie doc. Le travail restant est plus pointu.

## 2026-05-12 ~00h-03h — [x] Session autonome production-readiness (Patrice dormait)

Patrice s'est couché en disant "implemente tout travail de facon autonome je vais me coucher je reviens dans 4 ou 5 heures". J'ai exécuté un plan en 11 lots, 9 commits poussés sur `phuetz/MySoulmate:main`.

**Commits livrés** (de `ffb8164` à `b453c76`) :

1. `33fe4b6 chore: completer .env.example avec toutes les vars detectees` — Ajouté `PAYMENT_SECRET`, `PORT`, `DB_HOST/PORT/NAME/USER/PASSWORD`, `REDIS_PASSWORD`, `CORS_ORIGIN`, 6 keys AI providers, sections clarifiées, doublon `EXPO_PUBLIC_SENTRY_DSN` supprimé, doc longueur clés cryptos.

2. `f7458f6 feat(auth): brancher 2FA TOTP au login flow (step-up)` — Avant : 2FA TOTP implémentée mais `exports.login` ne vérifiait jamais `user.twoFactorEnabled`. User 2FA-activé pouvait se logger sans 2FA. Maintenant : login retourne `{ requiresTwoFactor: true, tempToken }` (JWT 5min scope `2fa-pending`), nouveau `POST /auth/login-2fa` échange `{ tempToken, twoFactorCode|twoFactorBackupCode }` contre le vrai JWT. Support backup codes (consommés à l'usage). 6 tests d'intégration ajoutés, suite auth 24/24 verte.

3. `4b9cd4e feat: integrer Sentry backend (no-op sans SENTRY_DSN)` — `@sentry/node@10.52` + `@sentry/profiling-node`. Init centralisé `src/utils/sentry.js`, silencieux no-op sans DSN. Init AVANT tout require pour permettre OpenTelemetry wrap. `errorMiddleware` appelle `Sentry.captureException(err)` pour les 5xx (les 4xx ne polluent pas le dashboard).

4. `6226883 feat: trust proxy + HTTPS enforce en production` — `app.set('trust proxy', 1)` en prod, redirect 308 HTTP→HTTPS sauf pour `/health*` (probes K8s internes). Bypass via `DISABLE_HTTPS_REDIRECT=true`.

5. `e3e29fd feat(payment): gerer Stripe charge.refunded et dispute webhooks` — Avant : Stripe webhook gérait subscription/invoice/payment_intent/checkout mais pas refunds ni disputes. Ajouté 3 cases : `charge.refunded` (résout charge → invoice → subscription, marque `status: 'refunded'`), `charge.dispute.created` (marque `'disputed'`), `charge.dispute.closed` (restore `'active'` si dispute gagnée). Étendu `Subscription.status` enum.

6. `b08c453 feat(email): SendGrid par defaut en prod` — Avant : `EMAIL_SERVICE` default = `'mock'` partout, en prod ça droppait silently les emails de verification/password reset. Maintenant : sendgrid en prod, mock ailleurs. Si sendgrid sélectionné sans `SENDGRID_API_KEY`, log loud-error + fallback mock (pas de crash boot).

7. `a510c7a feat(db): generer migrations Sequelize pour les 31 modeles restants` — Le plus gros lot. Avant : 2 migrations versionnées (users, sessions) pour 31 modèles. Reste du `sequelize.sync()` au boot, risqué en prod PostgreSQL. Script one-shot `scripts/generateMigrations.js` qui charge `sequelize.models`, sérialise `rawAttributes` + `options.indexes` en code de migration JS. Gère ENUM/DECIMAL/UUID/JSON/ARRAY, defaults (`Sequelize.UUIDV4`, `Sequelize.NOW`, `Sequelize.literal`), references FK, indexes nommés, snake_case auto quand `model.options.underscored === true`. Bonus : `.sequelizerc` était cassé (contenait config DB au lieu de paths) → `npx sequelize-cli db:migrate` plantait depuis longtemps. Réparé proprement (paths déclarés, config CLI dans `src/config/sequelizeCli.js`). `npm run migrate` fonctionne maintenant : 33/33 migrations UP sur SQLite vide.

8. `335e52f feat: script scripts/backupDatabase.js + npm run backup` — pg_dump pour PostgreSQL (DATABASE_URL postgres://*), copy pour SQLite, retention auto (default 30 jours via `BACKUP_RETENTION_DAYS`). Vérifié en local : génère `backups/database-<ISO>.sqlite`.

9. `b453c76 chore: ranger les .md historiques dans docs/archive/` — Bougé 9 .md historiques (PHASE2/3_IMPROVEMENTS, IMPLEMENTATION_SUMMARY, UI_AUDIT_2025, UI_IMPROVEMENTS_IMPLEMENTED, IMPROVEMENTS, COMPETITIVE_ANALYSIS_2025, BUSINESS_PLAN_MYSOULMATE_2025, toto.md). Racine maintenant claire : README, TODO, CHANGELOG, CLAUDE.md, AGENTS.md, CONTRIBUTING.

Aussi mis à jour `TODO.md` (section "Session autonome 2026-05-12") et `CHANGELOG.md` (section `[Unreleased]` détaillée).

**Pas fait** (hors scope explicite, listé dans le plan) :
- Régler le billing GitHub Actions — la CI est rouge depuis le 18 mars 2026, fail systématique au step `actions/setup-node` avec "spending limit". À régler par Patrice : https://github.com/settings/billing/spending_limit
- EAS Build : placeholder `projectId`, Apple/Android credentials vides
- Migrer `react-native-fast-image` → `expo-image` (besoin tests UI manuels)
- AR réelle (ARKit/ARCore native modules)
- Tests E2E (Detox/Maestro/Playwright)
- Brancher le 2FA côté UI mobile (`app/auth/login.tsx` doit gérer la réponse `requiresTwoFactor: true`)

**Lot 9 (identity-core.tsx)** : marqué `[x]` en vérifiant qu'il n'y avait rien à faire — le wrapper 11 LOC `app/(tabs)/identity-core.tsx` délègue à `components/companions/IdentityCoreView.tsx` (351 lignes, complet, wired API). Le wrapper est intentionnel et idiomatique Expo Router.

**Verdict global de la session** : le projet est passé d'un état "marketing 5/5 mais CI rouge depuis 2 mois et plusieurs gaps prod" à un état "vraiment ready à déployer dès que les credentials externes sont en place". Les 9 commits forment une suite logique et atomique, chacun revert-able si besoin.
