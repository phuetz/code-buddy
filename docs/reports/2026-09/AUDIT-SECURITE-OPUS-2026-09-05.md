# AUDIT SÉCURITÉ DÉFENSIF — Hub de flotte + bac à sable (avant publication 2.0)

- **Auteur** : Fable / Opus 4.8
- **Date** : 2026-09-05
- **Clone isolé** : `~/DEV/cb-astra-secaudit-2026-09-05`
- **Branche** : `opus/audit-securite-flotte-2026-09-05` (base `astra/live-agentique-2026-09-05`)
- **Cadre** : audit adversarial de ma propre installation, sur clone isolé, pour trouver et FERMER des failles. Aucun push, aucun service hors loopback, HOME Vitest `_qa/astrasec/home`. `~/code-buddy` et le vrai `~/.codebuddy` en lecture seule stricte. Jetons de test factices uniquement.

## Méthode
Pour chaque surface : lecture de la source → construction d'un cas de test adversarial borné au dépôt → si contournement : test rouge (faille), correctif fail-closed minimal, test vert (fermeture) ; si garde déjà solide : test qui prouve le REFUS. Aucun outil offensif généraliste. `git add` fichier par fichier, commit par point.

## Surfaces
1. `peer.tool.invoke` / `.stream` (allowlist → fleetSafe → workspace root fail-closed)
2. Bac à sable natif (bwrap/Landlock/seatbelt) + outils authored (cwd jetable, RPC off, pare-feu)
3. Serveur HTTP/WS (CORS non-contrôle-d'accès, JWT prod, trustedProxies/rate-limit, SSRF)
4. Secrets (garde-fou données personnelles, filtre validateur, output-sanitizer, temporaires atomic-write)

---

## Tableau des attaques

| # | Surface | Attaque | Résultat | Gravité | Correctif (SHA) | Test |
|---|---------|---------|----------|---------|-----------------|------|
| 1.1 | peer.tool.invoke | chemin absolu `/etc/passwd` | REFUSÉE | — | (garde existante) | audit-secaudit-peer-traversal |
| 1.2 | peer.tool.invoke | `../` profond hors workspace | REFUSÉE | — | (garde existante) | audit-secaudit-peer-traversal |
| 1.3 | peer.tool.invoke | encodage `%2e%2e` | REFUSÉE (littéral, pas de fuite) | — | (garde existante) | audit-secaudit-peer-traversal |
| 1.4 | peer.tool.invoke | symlink interne → `/etc` (existant + pendant) | REFUSÉE | — | (garde existante) | audit-secaudit-peer-traversal |
| 1.5 | peer.tool.invoke | alias non-fleetSafe → exécuteur | REFUSÉE (`UNKNOWN_PEER_TOOL`) | — | (par conception) | (analyse) |
| 1.6 | peer.tool.invoke | needs_approval sans confirmant (headless) | REFUSÉE (fail-closed) | — | (garde existante) | audit-secaudit-peer-needs-approval |

---

## Surface 1 — `peer.tool.invoke` / `.stream` : SOLIDE (aucune faille)

Les trois gardes tiennent, dans l'ordre : allowlist (match exact, `permissions.ts`) → `fleetSafe` (`registry.isFleetSafe`) → conteneur workspace (`assertPathInsideWorkspace`). La garde de chemin re-résout tout via `realpathFollowingExistingAncestors` + `resolveDanglingSymlink`, puis `isPathInsideOrEqual` — donc `../`, chemin absolu, symlink interne pointant dehors (existant OU pendant) et racine `/` sont tous rejetés. `%2e` n'est jamais décodé par `path` : traité comme littéral, il ne peut pas remonter. Les seuls exécuteurs sont `view_file`/`list_directory`/`search`, donc un alias non-`fleetSafe` n'atteint aucun exécuteur (`UNKNOWN_PEER_TOOL`). Enfin, toute décision `needs_approval` (garde secrets du PolicyEngine, ou peer:invoke non read-only) passe par `ConfirmationService`, qui **échoue fermé** sur un pair headless (pas de TTY, pas de canal distant, pas d'auto-confirm) — ligne 448-450.

Profondeur (`CODEBUDDY_PEER_MAX_DEPTH`) et `role=leaf` sont des gardes **anti-boucle coopératives** (le champ `depth` est fourni par l'appelant, `leaf` tague sans bloquer) — documentées comme telles, ce ne sont pas des frontières de sécurité, et la vraie frontière (les 3 gardes) tient. Aucun correctif nécessaire.

Preuves ajoutées (refus) : `tests/fleet/audit-secaudit-peer-traversal.test.ts` (7) + `tests/fleet/audit-secaudit-peer-needs-approval.test.ts` (1).

## Détail par surface (suite)

## Récapitulatif failles A/B fermées

_(à compléter)_

## Bilan (10 lignes)

_(à compléter en clôture)_
