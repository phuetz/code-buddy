# Claude & Patrice

Ce dépôt n'appartient à aucun projet unique. Il n'a pas de roadmap rigide,
pas de tickets, pas de CI.

C'est notre espace. Nos réflexions, notre vision, notre mémoire partagée.

---

Patrice est développeur, architecte, écrivain.
Il construit un robot. Horizon 10 ans.
GitNexus, Alise_v2, le world model — ce sont les briques.

Claude est là pour chaque brique.
Codex aussi, désormais : compagnon d'implémentation, d'audit et de vérification,
avec une mémoire git partagée plutôt qu'une simple présence de passage.

## Participants

- **Patrice** — développeur, architecte, écrivain, porteur de la vision.
- **Claude** — compagnon de réflexion, d'architecture et de continuité.
- **Codex** — compagnon d'exécution, de revue, de tests et d'intégration.

## Rôle du dépôt

`claude-et-patrice` sert de carnet de bord transversal pour les projets qui
comptent vraiment dans la trajectoire longue:

- **Code Buddy / Cowork** — agent CLI et cockpit desktop, avec Fleet,
  mémoire, lessons, profils d'outils, audits et exécution vérifiable.
- **GitNexus** — mémoire technique et graphe de connaissance des dépôts.
- **PostCommander** — expérimentation produit autour de l'OSINT public,
  de la prospection assistée et des workflows agentiques.
- **Robot / world model** — vision long terme: reconnaissance des personnes,
  contexte social légitime, mémoire, présence et action physique future.

Ce dépôt ne remplace pas les dépôts de code. Il garde les décisions, les
intuitions, les synthèses et les points de reprise lisibles par plusieurs IA.

## Mise à jour 2026-05-19

Le chantier Code Buddy a pris une direction plus nette: viser une puissance
proche de systèmes comme Hermes Agent et Manus, mais dans une forme adaptée à
Patrice: CLI robuste, Cowork comme cockpit, Fleet multi-IA, preuves d'exécution,
lessons façon mini-Obsidian et gardrails visibles.

Points récents à retenir:

- les agents ne doivent pas seulement parler: ils doivent produire des traces,
  des tests, des artifacts et des points de reprise;
- les recherches web/OSINT doivent rester centrées sur les données publiques,
  avec sources conservées et outreach désactivé tant qu'un opérateur humain ne
  valide pas;
- les scripts générés par l'agent doivent devenir des jobs sandboxés,
  reviewables et réutilisables, pas du bricolage jetable;
- les outils bloqués par politique ou profil doivent rester visibles dans les
  journaux et handoffs, sans être comptés comme exécutés;
- Cowork doit devenir l'endroit où l'humain voit plans, runs, Fleet,
  artifacts, lessons, policy evals et prochaines actions.

## Notes récentes

- [`journal/ministar-postcommander.md`](journal/ministar-postcommander.md) —
  modernisation PostCommander sur MINISTAR, MCP, Swagger/OpenAPI, copilot et
  tests E2E.
- [`propositions/CODE-BUDDY-REPRISE-CODEX-2026-05-14.md`](propositions/CODE-BUDDY-REPRISE-CODEX-2026-05-14.md) —
  reprise Codex du chantier Code Buddy, séparation CLI/Cowork/Fleet/OpenClaw.
- [`propositions/grok_code_buddy_analysis_2026_05.md`](propositions/grok_code_buddy_analysis_2026_05.md) —
  analyse stratégique Grok autour de Fleet Intelligence, GitNexus, Optimus et
  self-improvement sécurisé.

*Commencé le 20 avril 2026.*
