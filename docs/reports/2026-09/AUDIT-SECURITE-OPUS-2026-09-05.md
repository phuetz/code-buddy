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
| _(en cours)_ | | | | | | |

---

## Détail par surface

_(rempli au fil de l'inspection)_

## Récapitulatif failles A/B fermées

_(à compléter)_

## Bilan (10 lignes)

_(à compléter en clôture)_
