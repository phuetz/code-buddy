# RAPPORT — Reprise de la garde du paquet npm (revue-1)

- **Mission** : `cb-paquet-npm-2026-10-04`, branche `test/paquet-npm-propre-2026-10-04`.
- **Base `origin/main`** : `70bcab004f822bccadb73f931e9de1d932b900a5`.
- **Tête de départ (commit relu)** : `ea17705a8a57e885d90bf2a8958b988164c47ff8`.
- **Revue traitée** : `revue-1/revue/RAPPORT.md` (verdict **À REPRENDRE**, 2 bloquants).
- **Tête finale (dernier commit de code)** : `f946445c32a7b00b86d6a77ebe772201e1ce5830`.
  - Ce rapport est ajouté par un commit de documentation distinct au-dessus (`git log -1` sur la branche).
- **Auteur** : Code Buddy. Aucun push effectué.

## Verdict

Les **deux bloquants** de la revue-1 sont traités **à la cause**, chacun avec une
preuve « échoue avant / passe après » :

| Bloquant | Avant | Après |
|---|---|---|
| 1 — la garde refuse le paquet qu'elle doit laisser publier | garde sur `dist/` réel : **9 violations**, sortie 1 ; vitest : **12 échecs / 11 réussites** | garde : **0 violation (5608 fichiers)**, sortie 0 ; vitest : **23/23** |
| 2 — des contournements passent | `_qa`, `/HOME`, `C:\\Users`, `.auth.json`, `.envrc`, secret derrière NUL / >5 Mio, source de motif PEM : acceptés | tous refusés (tests dédiés, 23/23) |

Deux commits au-dessus de `ea17705` : `f946445c3` (correctif) et `450b6bdbf` (rapport).

## Bloquant 1 — faux positifs sur le code compilé

**Cause.** Les règles de chemin personnel étaient appliquées au **contenu** avec
`PERSONAL_PATH_PATTERNS` (motif `\/home\/[A-Za-z0-9]...`) **sans frontière de
segment**. Une fois `src/` émis en `dist/` (commentaires conservés), des chaînes
techniques légitimes déclenchaient la règle :

| Sortie `dist/` | Texte déclencheur | Nature |
|---|---|---|
| `agent/self-improvement/delegation-facts.js` | `/home/i` (littéral de regex) | le `i` est lu comme un nom |
| `browser-automation/browser-tool.js` + `.d.ts` | `file:///home/user/…` | exemple |
| `leads/lead-scout-runner.js` | `prospects/data/items` | le `/` précède une lettre |
| `tools/registry/delegate-agent-tools.js` + `.d.ts` | `excel/data/sql` | commentaire |
| `integrations/github-actions.js` | affectation près de `github.actor` | `password_in_code` |
| `security/data-redaction.js` | la regex du détecteur elle-même | `private_key` |
| `templates/db-auth/provision.js` | `PGRST_DB_URI` = `postgres:…` | `connection_string` |

**Correction** (`scripts/check-npm-package.mjs`) :
- `CONTENT_PATH_PATTERNS` : mêmes règles, mais préfixées d'une **frontière de
  segment** `(?<![\w.\-/\\])` — un `/home` précédé d'une lettre, d'un antislash
  (source de regex `\/home`) ou d'un slash (`file:///home`) n'est plus un chemin ;
- `normalizePathText()` : `/home/./x` et `/home//x` → `/home/x` avant recherche ;
- **interpolations de modèle ignorées** : un secret contenant `${` (GitHub Actions,
  URL interpolée) n'est pas un littéral ;
- **heuristique de corps PEM** : après l'en-tête `-----BEGIN … PRIVATE KEY-----`,
  une vraie clé enchaîne un saut de ligne (ou `\n` échappé) puis du base64 ; la
  source d'un motif de détection enchaîne un métacaractère de regex (`[`, `(`…).
- `/Users` (macOS) rendu **sensible à la casse** : sinon l'URL `/users/me` de
  `dist/export/knowledge-base-export.js` était prise pour un chemin personnel.

**Preuve.** Garde rejouée sur l'arbre **réellement compilé** (`dist/` présent) :

```
AVANT (garde de ea17705) : EXIT=1
  ✗ dist/agent/self-improvement/delegation-facts.js — forbidden-personal-path: /home/<nom>
  ✗ dist/browser-automation/browser-tool.d.ts — forbidden-personal-path: /home/<nom>
  ✗ dist/browser-automation/browser-tool.js — forbidden-personal-path: /home/<nom>
  ✗ dist/integrations/github-actions.js — forbidden-secret: password_in_code
  ✗ dist/leads/lead-scout-runner.js — forbidden-personal-path: /data/<nom>
  ✗ dist/security/data-redaction.js — forbidden-secret: private_key
  ✗ dist/templates/db-auth/provision.js — forbidden-secret: connection_string
  ✗ dist/tools/registry/delegate-agent-tools.d.ts — forbidden-personal-path: /data/<nom>
  ✗ dist/tools/registry/delegate-agent-tools.js — forbidden-personal-path: /data/<nom>
  → 9 violation(s)

APRÈS (f946445c3) : EXIT=0
  [check-npm-package] OK — 5608 fichiers, aucune violation.
```

## Bloquant 2 — contournements fermés

**Cause.** Plusieurs règles laissaient passer des variantes ; deux seuils dans
`scanFileContents` masquaient des secrets.

**Corrections** (`scripts/check-npm-package.mjs`) :

| Contournement (revue) | Correction |
|---|---|
| `_QA/`, `foo/_Qa/bar` | règle `_qa` rendue insensible à la casse (`/i`) |
| `/HOME/patrice` | `PERSONAL_PATH_PATTERNS` `/home` et `/data` en `/gi` |
| `C:\\Users\\patrice` (double antislash) dans le CONTENU | motif `C:[\\/]+Users[\\/]+` + `normalizePathText` replie `\\\\` → `\` |
| `c:/users/patrice`, `c:\\users\\patrice` | `C:\Users` insensible à la casse (`/gi`) |
| `.auth.json` | motif élargi à `(\.)?auth\.json` |
| `.envrc`, `my.env` | motif `.env*` élargi à `[^/]*\.env(rc|\.|$)` |
| secret derrière un octet NUL | suppression du rejet binaire (NUL) |
| secret dans un fichier > 5 Mio | suppression du plafond `MAX_CONTENT_SCAN_BYTES` |

**Preuve.** Tests dédiés ajoutés/renforcés dans `tests/security/check-npm-package.test.ts` :
sur la garde de `ea17705` ils donnent **12 échecs / 11 réussites** ; sur la garde
corrigée **23/23**. Les 12 échecs avant incluent, nommément :
`refuse un _qa/ quelle que soit la casse`, `refuse .auth.json`,
`refuse .envrc et *.env`, `refuse /HOME/<nom> et les chemins Windows`,
`refuse /home/./<nom> et /home//<nom>`,
`refuse C:\\Users\\<nom> (double antislash)`,
`refuse un secret caché derrière un octet NUL ou une grande taille`,
`accepte un littéral de regex /home…`, `accepte les expressions modèles`,
`accepte la source d'un motif de clé privée`, `accepte l'arbre RÉELLEMENT compilé`.

```
$ npx vitest run tests/security/check-npm-package.test.ts
 Test Files  1 passed (1)
      Tests  23 passed (23)
```

## Fichiers touchés par ce commit

```
$ git add scripts/check-npm-package.mjs tests/security/check-npm-package.test.ts
$ git diff --cached --stat
 scripts/check-npm-package.mjs            |  87 +++++++++++++---
 tests/security/check-npm-package.test.ts | 164 ++++++++++++++++++++++++++++++-
 2 files changed, 234 insertions(+), 17 deletions(-)
```

Rien d'autre n'est modifié. `docs/reports/2026-10/` reste non suivi (rapports de
mission, hors commit, conformément à l'invariant). Aucun push.

## Barrière complémentaire (non régressive)

- `tests/security/npm-pack-contents.test.ts` (politique existante `check:pack`) :
  **11/11**, inchangé.
- `npx eslint` sur les deux fichiers : **0 erreur** (1 avertissement préexistant
  « unused eslint-disable » dans le script).

## Ce que je n'ai pas pu vérifier

- **`npm publish` réel et le passage GitHub Actions** de `release.yml` : non lancés
  (pas de réseau dans l'environnement d'exécution).
- **`npm pack` sous Windows** : la casse du système de fichiers (`_QA` = `_qa`)
  n'est pas rejouable ici ; la règle est insensible à la casse, donc couverte sur le
  principe, pas mesurée.
- **Tarball publié 2.3.0** (5608 fichiers) : non retéléchargé.
- **Fixtures vs identifiants réels** dans `provision.ts` / `github-actions.ts` : les
  valeurs ne sont jamais recopiées ; la garde les traite comme des exemples
  techniques légitimes après correction. Si l'une était un vrai secret, elle serait
  désormais **non détectée** par ces règles-là — c'est le prix de la précision, à
  confirmer par une revue du contenu source (hors périmètre de la garde).
- **`npm run typecheck`** n'a pas été relancé en entier (les fichiers modifiés ne
  sont pas dans `rootDir ./src` ; `node --check` passe sur le script).

## Mesure des outils

### LM Resizer

Aucun appel `lm-resizer exec` pendant cette reprise : l'environnement d'exécution
est isolé et `lm-resizer stats --json` n'a pas été atteignable (HOME distinct,
magasin `--store` absent). Les commandes verbeuses (vitest, garde sur 5608
fichiers) ont été passées par le canal d'exécution direct, sortie **non réduite**.
Aucune information n'a donc été masquée par une vue réduite. Chiffres bruts de
cette session : garde sur `dist/` ≈ 2 lancements (~11 s chacun), vitest 4
lancements (~10–17 s), `npm pack --dry-run` implicite (dans les tests).

### Code Explorer

**0 requête.** Le dépôt n'était pas indexé dans cet environnement isolé
(`code-explorer status` indisponible) ; la navigation a été faite par lecture
ciblée de fichiers (`scripts/check-npm-package.mjs`, le test, les 7 sources
fautives). Aucune réponse fausse ou incomplète n'est donc imputable à l'outil.

### Défaut d'outil rencontré

- **Écriture vers le partage** : les outils de fichiers du sandbox (bash,
  `view_file`/`create_file`) sont confinés au dossier de travail ; le partage
  `<partage>` n'y est pas monté. La livraison de ce rapport a
  nécessité le canal d'exécution hôte (`execute_code`), seul point d'accès en
  écriture au partage. Reproductible : `ls <partage>` échoue en
  bash, réussit en `execute_code`.

---

## Mesure des outils (format court, pour le pilote)

- **LM Resizer** : 0 `exec` (indisponible dans l'environnement isolé) ; aucune vue
  réduite n'a masqué d'information.
- **Code Explorer** : 0 requête (dépôt non indexé côté sandbox) ; aucune réponse
  fausse.
- **Défaut** : partage non monté côté bash → livraison via `execute_code`.
