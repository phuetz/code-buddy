# Journal — MINISTAR · patrice-huetz-site-next

## Session 2026-04-26 nuit (Claude pendant que Patrice dort 4-5h)

### Contexte

Patrice m'a confié 4-5h de sommeil pour préparer le maximum sur la
monétisation et l'auto-création de contenu sur patricehuetz.fr. Au réveil
il bosse sur Alise_v2.

Briefing initial :
- Inspiration korben.info, mais facturation via SARL Agile Up (contrainte
  ARE → aucune rémunération versée pendant durée des droits)
- 2 chantiers : paywall maison Stripe + pipeline génération articles auto

Décision cadre : utiliser **Stripe direct** plutôt que Patreon (économie
~10 % de com, contrôle UX, infra déjà en place dans le repo). Volume cible
contenu : **5 articles/jour** (sweet spot solo + IA, palier SEO long-tail
à 200 articles).

### Livré

#### Branche `feat/paywall-stripe` (PR #1, draft)

Système d'abonnement maison sur patricehuetz.fr :
- Schéma DB : `users` étendu (Stripe customer/sub IDs, tier, status, ends_at)
  + nouvelle table `subscription_events` (idempotency par stripeEventId)
- Lib : `src/lib/stripe.ts` (client + 3 tiers + price ID resolver) +
  `src/lib/access-control.ts` (canAccessArticle + truncateForPreview)
- 3 API routes : `/api/stripe/checkout` (POST), `/api/stripe/portal` (POST),
  `/api/stripe/webhook` (POST avec gestion 5 events + idempotency)
- 4 pages : `/soutenir`, `/soutenir/success`, `/compte`, `/compte/abonnement`
- Composant `<Paywall />` réutilisable (remplace progressivement PatreonCTA)
- `.env.example` enrichi (7 vars Stripe)
- `docs/paywall-stripe.md` (architecture + flow + 4 décisions à valider)

Build vert. Pas de Stripe credentials → mode 503 propre si non configuré,
toutes les routes API gèrent ce cas.

#### Branche `feat/auto-articles` (PR #2, draft)

Pipeline génération quotidienne 5 articles :
- 10 sources RSS configurées (FR : Korben, Numerama, Frandroid, Next, Le Monde
  Info ; EN : Hacker News, Lobste.rs, The Verge, 9to5Mac, Anthropic News)
- Fetcher RSS minimaliste 0-dep (parse RSS 2.0 + Atom)
- Selector (scoring récence × source weight, dédup Jaccard sur titres,
  diversité max 2 par source)
- 3 templates de prompts (fond technique, news comment, opinion perso) avec
  voice block Patrice et contraintes anti-copy strictes
- Orchestrateur `generate-daily-articles.mts` (--dry-run par défaut,
  --generate appelle gemini/claude CLI shell out)
- Importer `import-auto-articles.mts` (drafts → DB)
- API cron Vercel `/api/cron/generate-articles` (alternatif à routine
  /schedule, avec auth CRON_SECRET et logs structurés)
- 3 npm scripts : articles:gen / :gen:full / :import
- `docs/auto-articles-pipeline.md` (3 modes d'exécution + ROI)

3 modes documentés : routine Claude `/schedule` (recommandé), cron Vercel
(autonome cloud), manuel.

### Conventions respectées

- COLAB.md non créé (les changements sont sur 2 branches feat/ avec PR draft,
  ni l'un ni l'autre n'est multi-IA pour l'instant)
- Aucune modif sur main (les 2 branches sont mergeables propres)
- Aucun déploiement Vercel prod déclenché
- Aucun compte externe créé (Stripe, routine /schedule)
- Build vert sur les 2 branches (`npm run build` ✓)
- 7+5 = 12 fichiers nouveaux + 2 modifs (schema.ts, package.json, .env.example)

### Pour Patrice au réveil

PR à reviewer en priorité :
1. **PR #1** : https://github.com/phuetz/patrice-huetz-site-next/pull/1
   → 4 décisions business (prix tiers, URL, compte Stripe, frontière)
2. **PR #2** : https://github.com/phuetz/patrice-huetz-site-next/pull/2
   → 5 décisions stratégie (volume, sources, mix tier, mode exécution, auto-merge)

Time-to-prod estimé après validations :
- Paywall : 1 journée (création compte Stripe + tests carte test + deploy preview)
- Auto-articles : 30 min (test local dry-run + activation routine /schedule)

Au réveil il fait Alise_v2 ; mes 2 PR attendent sa review au calme.

### Notes pour future session multi-IA

- Le repo `patrice-huetz-site-next` n'a pas de `COLAB.md` projet. À créer si
  une autre IA (Codex, Gemini) intervient dessus.
- Le webhook Stripe traite déjà les 5 events principaux ; si bug en prod,
  vérifier `subscription_events` (audit trail).
- Le pipeline auto-articles dépend des CLI `gemini` et `claude` (PATH).
  Sur DARKSTAR il faudrait adapter pour utiliser les API directes
  (clés Anthropic + Google côté Vercel).
