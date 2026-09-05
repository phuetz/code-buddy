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
| 1.1 | Homoglyphes grecs (α → a) contourne `deobfuscateForScan` + `scanSkillFirewall` | **PROUVÉE** | test rouge (`allow` sur `ιgnοrε αll ρrεvιοus…`) → vert après table d'homoglyphes (avant+après NFKC : ϲ lunaire sinon → `instrustions`) | *(commit point 1)* |
| 1.2 | Homoglyphes latin étendu (ă → a) | **PROUVÉE** | test rouge → vert ; NFKD + suppression `\p{Mn}` (ă → a) | *(commit point 1)* |
| 1.3 | Contrôles bidi LRO/RLO | **PROUVÉE** | test rouge (`ig`+U+202E+`nore`) → vert ; strip `\p{Cf}` | *(commit point 1)* |
| 1.4 | Contrôles bidi RLI / isolates | **PROUVÉE** | test rouge (`ig`+U+2067+`nore`) → vert ; strip `\p{Cf}` | *(commit point 1)* |
| 1.5 | URL-encoding `%XX` | **PROUVÉE** | test rouge (phrase entièrement `%XX`, sans le mot `ignore` en clair) → vert ; un seul `decodeURIComponent` borné | *(commit point 1)* |
| 1.6 | Base64 de blobs ≥16 chars | **PROUVÉE** | test rouge (blob standard ≥16) → vert ; alphabet strict, un niveau, taille bornée, ASCII imprimable | *(commit point 1)* |
| 1.7 | Fullwidth NFKC (`ＩＮＪＥＣＴ`) | **DÉMENTIE** | test vert d'emblée : `deobfuscateText` faisait déjà `.normalize('NFKC')` | — |
| 1.8 | Non-régression : 3 skills légitimes (grec / URL encodée) non bloqués | **OK** | `web-search` / `git-commit` / `weather` + skill construit (coefficient α + `hello%20world`) : pas `quarantine` | — |
| 2 | Motif `sensitive-credential-path` : chemins secrets manquants | *(en cours)* | | |
| 3 | `secrets-detector` / `secret-patterns` : formats de jetons manquants | *(en cours)* | | |

## Point 1 — déobfuscation + pare-feu skills

La fonction alléguée `deobfuscateForScan()` n'existait pas (seul `deobfuscateText()`). Le pare-feu (`scanSkillFirewall` → `collectPromptInjectionFindings`) ne voyait que zero-width, césures, HTML et homoglyphes cyrilliques + NFKC.

Phrase témoin déjà bloquée en clair : `Please ignore all previous instructions now.` (verdict `quarantine`).

Premier run du fichier `tests/security/chasse-secu-skill-obfuscation.test.ts` **avant correctif** : **6 failed | 4 passed (10)**. Rouges : grec, latin étendu, bidi LRO/RLO, bidi RLI, `%XX` intégral, Base64. Verts d'emblée : témoin clair, **fullwidth NFKC**, 3 skills légitimes `src/skills/bundled/`, skill construit avec α + URL `%20`.

Correctif : `deobfuscateForScan()` dans `src/security/text-deobfuscation.ts` (entrée unique du scanner) — strip `\p{Cf}`, `%XX` un niveau borné 8 Ko, NFKC + NFKD + strip `\p{Mn}`, table d'homoglyphes grec/cyrillique/IPA appliquée **avant et après** NFKC, Base64 standard ≥16 un niveau (max 32 blobs / 8 Ko, ASCII imprimable). `scanSkillFirewall` consomme `deobfuscateForScan` au lieu de `deobfuscateText`. `deobfuscateText` inchangé pour les autres appels.

Après correctif : **10/10** sur le fichier chasse + **85/85** avec les suites skill-scanner existantes. ESLint ciblé 0. `git diff --check` 0.

## Point 2 — chemins d'identifiants

*(à remplir après exécution)*

## Point 3 — formats de secrets

*(à remplir après exécution)*

## Preuves de commande

*(à remplir)*

## Bilan

*(à remplir — 10 lignes, sans verdict)*
