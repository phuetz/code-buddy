# Chasse adversariale — 3 trous de sécurité allégués (Code Buddy, code public)

- **Auteur** : Grok 4.6
- **Date** : 2026-09-05
- **Clone isolé** : `~/DEV/cb-astra-secaudit-2026-09-05`
- **Branche** : `opus/audit-securite-flotte-2026-09-05`
- **Rapport d'allégations** : `docs/reports/2026-09/CONTRE-VERIF-SECU-FREE-gpt-5.md` (modèle gratuit, rien exécuté)
- **HOME Vitest** : `_qa/grok-secu/home` (gitignoré)
- **Cadre** : prouver ou démentir trois allégations par tests exécutés. Rouge = trou réel → fermer. Vert = allégation fausse. Aucun push. `git add` fichier par fichier. `~/code-buddy` et le vrai `~/.codebuddy` interdits. Jetons de test factices uniquement. Pas de verdict — le pilote le rédige.

## Méthode

Pour chaque allégation : test qui construit le cas → exécution Vitest → si rouge, correctif fail-closed minimal puis rejeu vert ; si vert, l'allégation est démentie. Commit après chaque point. Preuves : `npx vitest run tests/security` (compte exact avant/après), `npx tsc --noEmit -p tsconfig.json`, eslint ciblé, `git diff --check`.

## Tableau allégation → PROUVÉE / DÉMENTIE

| # | Allégation | Statut | Preuve | SHA correctif |
|---|------------|--------|--------|---------------|
| 1.1 | Homoglyphes grecs (α → a) contourne `deobfuscateForScan` + `scanSkillFirewall` | *(en cours)* | | |
| 1.2 | Homoglyphes latin étendu (ă → a) | *(en cours)* | | |
| 1.3 | Contrôles bidi LRO/RLO | *(en cours)* | | |
| 1.4 | Contrôles bidi RLI / isolates | *(en cours)* | | |
| 1.5 | URL-encoding `%XX` | *(en cours)* | | |
| 1.6 | Base64 de blobs ≥16 chars | *(en cours)* | | |
| 1.7 | Fullwidth NFKC (`ＩＮＪＥＣＴ`) | *(en cours)* | | |
| 1.8 | Non-régression : 3 skills légitimes (grec / URL encodée) non bloqués | *(en cours)* | | |
| 2 | Motif `sensitive-credential-path` : chemins secrets manquants | *(en cours)* | | |
| 3 | `secrets-detector` / `secret-patterns` : formats de jetons manquants | *(en cours)* | | |

## Point 1 — déobfuscation + pare-feu skills

*(à remplir après exécution)*

## Point 2 — chemins d'identifiants

*(à remplir après exécution)*

## Point 3 — formats de secrets

*(à remplir après exécution)*

## Preuves de commande

*(à remplir)*

## Bilan

*(à remplir — 10 lignes, sans verdict)*
