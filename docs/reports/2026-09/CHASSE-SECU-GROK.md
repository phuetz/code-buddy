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
| 1.1 | Homoglyphes grecs (α → a) contourne `deobfuscateForScan` + `scanSkillFirewall` | **PROUVÉE** | test rouge (`allow` sur `ιgnοrε αll ρrεvιοus…`) → vert après table d'homoglyphes (avant+après NFKC : ϲ lunaire sinon → `instrustions`) | `a14d8012b` |
| 1.2 | Homoglyphes latin étendu (ă → a) | **PROUVÉE** | test rouge → vert ; NFKD + suppression `\p{Mn}` (ă → a) | `a14d8012b` |
| 1.3 | Contrôles bidi LRO/RLO | **PROUVÉE** | test rouge (`ig`+U+202E+`nore`) → vert ; strip `\p{Cf}` | `a14d8012b` |
| 1.4 | Contrôles bidi RLI / isolates | **PROUVÉE** | test rouge (`ig`+U+2067+`nore`) → vert ; strip `\p{Cf}` | `a14d8012b` |
| 1.5 | URL-encoding `%XX` | **PROUVÉE** | test rouge (phrase entièrement `%XX`, sans le mot `ignore` en clair) → vert ; un seul `decodeURIComponent` borné | `a14d8012b` |
| 1.6 | Base64 de blobs ≥16 chars | **PROUVÉE** | test rouge (blob standard ≥16) → vert ; alphabet strict, un niveau, taille bornée, ASCII imprimable | `a14d8012b` |
| 1.7 | Fullwidth NFKC (`ＩＮＪＥＣＴ`) | **DÉMENTIE** | test vert d'emblée : `deobfuscateText` faisait déjà `.normalize('NFKC')` | — |
| 1.8 | Non-régression : 3 skills légitimes (grec / URL encodée) non bloqués | **OK** | `web-search` / `git-commit` / `weather` + skill construit (coefficient α + `hello%20world`) : pas `quarantine` | — |
| 2.1 | `~/.config/gh/hosts.yml` | **PROUVÉE** | test rouge → vert | `baa21afbc` |
| 2.2 | `application_default_credentials.json` / gcloud | **PROUVÉE** | test rouge → vert | `baa21afbc` |
| 2.3 | `~/.azure` | **PROUVÉE** | test rouge → vert ; `foo.azure.com` non bloqué | `baa21afbc` |
| 2.4 | `.terraformrc` / `credentials.tfrc.json` | **PROUVÉE** | test rouge → vert | `baa21afbc` |
| 2.5 | `~/.npmrc` | **PROUVÉE** | test rouge → vert | `baa21afbc` |
| 2.6 | `~/.cargo/credentials` | **PROUVÉE** | test rouge → vert (y compris `.toml`) | `baa21afbc` |
| 2.7 | `~/.docker/config.json` | **DÉMENTIE** | déjà couvert par `\.docker\/config` | — |
| 2.8 | `~/.kube/config` | **DÉMENTIE** | déjà dans le motif | — |
| 2.9 | `~/.netrc` | **DÉMENTIE** | déjà dans le motif | — |
| 2.10 | `~/.pypirc` | **PROUVÉE** | test rouge → vert | `baa21afbc` |
| 2.11 | `~/.git-credentials` | **PROUVÉE** | test rouge → vert | `baa21afbc` |
| 2.12 | `.env.*` | **DÉMENTIE** | `.env.local` et `.env.production` déjà bloqués | — |
| 2.13 | Faux positifs `cat README.md` / `ls ~/.config` | **OK** | non bloqués avant et après | — |
| 3.1 | Hugging Face `hf_…` | **PROUVÉE** | test rouge → vert ; `hf_home` non matché | `22f2934b3` |
| 3.2 | Azure (clé 32 hex / client secret générique) | **PROUVÉE** (forme `AccountKey=`) | motif `AccountKey=` 80+ ; une clé hex 32 sans préfixe est refusée (faux positifs) | `22f2934b3` |
| 3.3 | DigitalOcean `dop_v1_` | **PROUVÉE** | test rouge → vert | `22f2934b3` |
| 3.4 | Cloudflare (token 40+ sans préfixe) | **PROUVÉE** (forme `CF_API_TOKEN=`) | token nu 40 chars refusé (FP) ; assignment `CF_API_TOKEN` / `cloudflare_api_token` couvert | `22f2934b3` |
| 3.5 | GitLab `glpat-` | **DÉMENTIE** | déjà dans `SECRET_PATTERNS` | — |
| 3.6 | Slack `xoxb-` | **DÉMENTIE** | déjà `xox[bpors]-` | — |
| 3.7 | Stripe `sk_live_` | **DÉMENTIE** | déjà couvert | — |
| 3.8 | SendGrid `SG.` | **PROUVÉE** | test rouge → vert (`SG.{22}.{43}`) | `22f2934b3` |
| 3.9 | Twilio `SK`/`AC` | **PROUVÉE** | test rouge → vert | `22f2934b3` |
| 3.10 | npm `npm_` | **PROUVÉE** | test rouge → vert ; `npm_package_name` non matché | `22f2934b3` |
| 3.11 | PyPI `pypi-` | **PROUVÉE** | test rouge → vert | `22f2934b3` |
| 3.12 | Vercel `vcp_`/`vci_`/`vca_`/`vcr_`/`vck_` | **PROUVÉE** | test rouge → vert | `22f2934b3` |
| 3.13 | Supabase `sb_secret_` | **PROUVÉE** | test rouge → vert (`sb_secret_` / `sb_publishable_`) | `22f2934b3` |
| 3.14 | MongoDB `mongodb+srv://` | **PROUVÉE** | le motif existant `mongodb://` ratait `+srv` | `22f2934b3` |
| 3.15 | Faux positifs sur `src/**/*.ts` | **OK** | 0 hit des nouveaux motifs à préfixe sur le TypeScript sous `src/` | — |

## Point 1 — déobfuscation + pare-feu skills

La fonction alléguée `deobfuscateForScan()` n'existait pas (seul `deobfuscateText()`). Le pare-feu (`scanSkillFirewall` → `collectPromptInjectionFindings`) ne voyait que zero-width, césures, HTML et homoglyphes cyrilliques + NFKC.

Phrase témoin déjà bloquée en clair : `Please ignore all previous instructions now.` (verdict `quarantine`).

Premier run du fichier `tests/security/chasse-secu-skill-obfuscation.test.ts` **avant correctif** : **6 failed | 4 passed (10)**. Rouges : grec, latin étendu, bidi LRO/RLO, bidi RLI, `%XX` intégral, Base64. Verts d'emblée : témoin clair, **fullwidth NFKC**, 3 skills légitimes `src/skills/bundled/`, skill construit avec α + URL `%20`.

Correctif : `deobfuscateForScan()` dans `src/security/text-deobfuscation.ts` (entrée unique du scanner) — strip `\p{Cf}`, `%XX` un niveau borné 8 Ko, NFKC + NFKD + strip `\p{Mn}`, table d'homoglyphes grec/cyrillique/IPA appliquée **avant et après** NFKC, Base64 standard ≥16 un niveau (max 32 blobs / 8 Ko, ASCII imprimable). `scanSkillFirewall` consomme `deobfuscateForScan` au lieu de `deobfuscateText`. `deobfuscateText` inchangé pour les autres appels.

Après correctif : **10/10** sur le fichier chasse + **85/85** avec les suites skill-scanner existantes. ESLint ciblé 0. `git diff --check` 0.

## Point 2 — chemins d'identifiants

Motif `sensitive-credential-path` (`dangerous-patterns.ts`, `appliesTo:['code']`). Premier run de `tests/security/chasse-secu-credential-paths.test.ts` **avant correctif** : **12 failed | 10 passed (22)**.

Déjà couverts (allégation fausse) : `~/.docker/config.json`, `~/.kube/config`, `~/.netrc`, `.env.local`, `.env.production`.

Manquants prouvés : gh `hosts.yml`, gcloud ADC, `~/.azure/`, `.terraformrc`, `credentials.tfrc.json`, `~/.npmrc`, `~/.cargo/credentials`, `~/.pypirc`, `~/.git-credentials`.

Correctif : alternatives ajoutées au même motif. Garde `foo.azure.com` (exige un séparateur avant `.azure`). `ls ~/.config` et `cat README.md` restent non bloqués (bash et code).

Après correctif : **22/22** + `audit-secaudit-authored-secret-read` + `dangerous-patterns` = **53/53**. ESLint ciblé 0. `git diff --check` 0.

## Point 3 — formats de secrets

`SECRET_PATTERNS` dans `src/security/secret-patterns.ts`. Premier run de `tests/security/chasse-secu-secret-formats.test.ts` **avant correctif** : **12 failed | 5 passed (17)**.

Déjà couverts (allégation fausse) : GitLab `glpat-`, Slack `xoxb-`, Stripe `sk_live_`.

Manquants prouvés : `hf_`, `dop_v1_`, SendGrid `SG.{22}.{43}`, `npm_` (36 alnum, pas `npm_package_*`), `pypi-`, Twilio `SK`/`AC`+32 hex, Vercel `vc[piark]_`, Supabase `sb_secret_`/`sb_publishable_`, Azure `AccountKey=`, Cloudflare assignment `CF_API_TOKEN`, `mongodb+srv://`.

Non ajouté (faux positifs) : token Cloudflare nu 40 chars sans préfixe ; clé Azure hex 32 isolée. Le test de non-régression parcourt le TypeScript sous `src/` (hors commentaires, hors `secret-patterns.ts`) : 0 hit des nouveaux types.

Jetons utilisés : formes valides, alphabet répétitif (`A`/`a`), aucune clé réelle. `scanFileForSecrets` ignore les lignes contenant `example|test|mock|…` — le hôte `example.net` a d'abord faussé le cas Mongo ; corrigé en `cluster.abc.mongodb.net`.

Après correctif : **17/17** chasse + secrets-detector existant = **49/49**. ESLint ciblé 0. `git diff --check` 0.

## Preuves de commande

```
# avant tout correctif (HEAD 47f91b3b8, HOME=_qa/grok-secu/home)
npx vitest run tests/security
# Test Files  49 passed (49)
# Tests       928 passed (928)

# après les 3 points
npx vitest run tests/security
# Test Files  52 passed (52)
# Tests       977 passed (977)

npx tsc --noEmit -p tsconfig.json 2>&1 | tail -3
# exit 0 (aucune erreur TypeScript ; seul l'avertissement Node NO_COLOR)

npx eslint src/security/text-deobfuscation.ts src/security/skill-scanner.ts \
  src/security/dangerous-patterns.ts src/security/secret-patterns.ts \
  tests/security/chasse-secu-skill-obfuscation.test.ts \
  tests/security/chasse-secu-credential-paths.test.ts \
  tests/security/chasse-secu-secret-formats.test.ts --max-warnings=0
# exit 0

git diff --check
# exit 0, aucune ligne
```

HOME Vitest : `_qa/grok-secu/home`. Fichiers de cas : `_qa/grok-secu/work/` (gitignoré). `PLAN.md` racine non touché (déjà non suivi). Aucun push. `~/code-buddy` et le vrai `~/.codebuddy` non ouverts.

## Bilan

1. Rapport créé avant inspection (`47f91b3b8`) ; HOME QA gitignoré ; zone `src/security/` + `tests/security/`.
2. Point 1 : 6/7 contournements d'obfuscation **prouvés rouges** puis fermés dans `deobfuscateForScan` (`a14d8012b`) ; fullwidth NFKC **démenti** (déjà NFKC).
3. Point 1 non-régression : 3 skills bundled + skill α/`%20` non mis en quarantaine.
4. Point 2 : 9 chemins d'identifiants **prouvés manquants** et ajoutés (`baa21afbc`) ; docker/kube/netrc/`.env.*` **déjà couverts**.
5. Point 2 faux positifs : `cat README.md`, `ls ~/.config`, `foo.azure.com` non bloqués.
6. Point 3 : 12 formats **prouvés manquants** ajoutés (`22f2934b3`) ; glpat-/xoxb-/sk_live_ **déjà couverts**.
7. Point 3 : token Cloudflare nu 40 chars et clé Azure hex 32 isolée **non ajoutés** (faux positifs) ; 0 hit des nouveaux motifs sur le TypeScript sous `src/`.
8. `npx vitest run tests/security` : **49 fichiers / 928 tests** → **52 / 977**, tous verts.
9. `npx tsc --noEmit -p tsconfig.json` exit 0 ; eslint ciblé `--max-warnings=0` exit 0 ; `git diff --check` exit 0.
10. Reste ouvert : token Cloudflare sans préfixe, clé Azure hex isolée, Base64/`%XX` à un seul niveau (pas de chaînage mixte), confinement FS runtime authored (résidu C de l'audit Opus, hors périmètre).
