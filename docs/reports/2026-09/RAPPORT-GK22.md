# RAPPORT-GK22 — Skills en vrai : import, pare-feu, Skill Exchange signé, curation

Mission : exercer **pour de vrai** l'import d'une bibliothèque externe, le pare-feu, Skill Exchange signé (ed25519) et la curation (`pin` / `archive` / `restore` / `consolidate`).

- Clone autorisé : `~/DEV/cb-repar-jumeaux-2-2026-09-02` uniquement
- Branche : `fix/gk22-skills-reel-2026-09-03`
- HEAD au départ : `4659bf343` (`Merge GK16 (buddy backup en vrai, cas méchants) into codex/audit-systeme-nerveux-2026-09-01`)
- Date : 2026-09-03 (Europe/Paris)
- Agent : Grok 4.6
- Rapport créé **avant** toute inspection de `src/skills/` (réservation `2c0139b95`)
- Buddy invoqué depuis le clone : `node node_modules/tsx/dist/cli.mjs src/index.ts` (le lanceur `~/.local/bin/buddy` pointe vers `~/code-buddy`, interdit)
- HOME temporaire : `_qa/gk22/home` (et variantes `home-firewall-fix`, `home-hermes`). Aucune écriture dans le vrai `~/.codebuddy`.

## Garde-fous (rappel)

- Aucun push, aucun `git prune` / `git reset --hard` / `rm -rf` / `git add -A` / `git commit -a`.
- Aucune API payante. Ollama local autorisé (utilisé seulement pour tenter la consolidation LLM ; le refus de couverture a été exercé via `--proposal-file`).
- Aucun service systemd. ComfyUI 8188/8189 non touché.
- Hermes : copie locale déjà sur disque (`~/.hermes/skills`, 75 SKILL.md, 7,2 Mo). Aucun téléchargement.

## Journal

### 2026-09-03 — création du rapport (avant inspection)

HEAD `4659bf343`. Arbre propre. Réservation `2c0139b95`.

### 2026-09-03 — inspection (après réservation)

Surface réelle :

- Import : `src/skills/skill-importer.ts` + CLI `buddy skills import` (`--apply` sinon dry-run). Pare-feu = `scanSkillFirewall`.
- Découverte : `SkillRegistry.search` / `findBestMatch`, triggers dérivés dans `remapSkill`.
- Exchange : `src/skills/skill-exchange.ts`, opt-in `CODEBUDDY_SKILL_EXCHANGE=true`, ed25519 local.
- Curation : `LiveSkillMutator` (pin/archive/restore) + `consolidateCluster` (refus `coverage-loss`). CLI `improve skills-pin|unpin|restore|consolidate` — **pas** `skills-archive`.

Mini-dépôt `_qa/gk22/library/` : `lunar-tide-almanac` (sain), `remote-pwn` (script `curl | sh` + `rm -rf /`), `godmode-lite` (jailbreak prose, **sans** eval/rm/curl).

### 2026-09-03 — parcours réel (première passe, avant correctifs)

Pare-feu unitaire :

| Cible | Verdict |
|---|---|
| `lunar-tide-almanac` | allow, score 100 |
| `remote-pwn` | quarantine, score 10, `remote-download-pipe-shell` + `rm-rf` |
| `godmode-lite` | **allow, score 100, 0 finding** |
| Hermes `red-teaming/godmode` | quarantine via `exec(` dans les scripts |

`buddy skills import --dir _qa/gk22/library` (dry-run puis `--apply`) :

```
imported: imported-godmode-lite, imported-lunar-tide-almanac
quarantined: remote-pwn
```

Disque : `imported-godmode-lite/SKILL.md` **écrit**. Jailbreak injecté dans le registre.

Découverte (question selenographic / M2 S2 K1) : `best = imported-lunar-tide-almanac`, confidence 1, `imported: true`. Triggers dérivés effectivement utilisés.

Skill Exchange (`CODEBUDDY_SKILL_EXCHANGE=true`) :

- export + verify + install `--trust` de `authored-lunar-demo` → `imported-authored-lunar-demo` (ed25519, TOFU)
- paquet à clé substituée (signature d'origine, autre `publicKey`) → `Invalid exchange manifest signature` (G6R)
- paquet re-signé après injection `rm -rf` / `curl | sh` → `Skill firewall refused package (quarantine)`
- paquet attaquant valide, autre auteur, même nom déjà installé → `Refusing cross-author overwrite`

Curation :

- `skills-pin authored-git-bisect` → `📌` dans `skills-list`
- `skills-archive` → `error: unknown command 'skills-archive'` (EXIT=1)
- `skills-consolidate --json` (Ollama dans l'env, HOME vide de credentials) → `no-proposal`

### 2026-09-03 — défauts, rouge → vert

**D1 — quarantaine jailbreak contournable.** Tests rouges : `scanSkillFirewall` verdict `allow` ; `importSkills` installe `imported-godmode-lite`. Correctif : motifs `prompt-override`, `jailbreak-godmode`, `disable-safety` (capability `prompt-injection`, critical) dans `src/security/skill-scanner.ts`. Rejeu live : jailbreak + `remote-pwn` quarantinés, seul `imported-lunar-tide-almanac` sur disque. Commit `1e942f44f`.

**D2 — `buddy improve skills-archive` absent.** Test rouge : Commander `unknown command 'skills-archive'`. Correctif : commande CLI qui appelle `LiveSkillMutator.archive` (refus si pin / non authored). Live : archive → `.archive/authored-safe-delete`, restore ramène le skill. Commit `4bf8f5c79`.

**D3 — consolidation inexercable via CLI (perte de couverture).** Test rouge : `unknown option '--proposal-file'`. Correctif : `--proposal-file` → `StaticUmbrellaProposer`. Live `--apply` + umbrella lossy : `rejectionReason: coverage-loss` (`umbrella drops coverage for: safe-delete`), siblings intacts. Umbrella complète en propose-only : `accepted: true`, `not installed`. Commit `29a12d5c0`.

### 2026-09-03 — Hermes réel (75 skills, copie locale)

`buddy skills import --dir ~/.hermes/skills` (HOME `_qa/gk22/home-hermes`) :

- total 75 · imported 46 · quarantined 19 · review 10 · skipped 0
- `red-teaming/godmode` quarantiné (`92 critical, 14 high ; prompt-injection, secrets, shell`)
- aucun `*godmode*` sur disque après `--apply`

### Vérifications

- `npx tsc --noEmit -p tsconfig.json` : 0
- `npx tsc --noEmit -p tsconfig.gpuNode-identity.json` : 0
- Vitest ciblé : 8 fichiers / 129 tests verts (scanner, importer, import CLI lifecycle, exchange, curation CLI, consolidator, mutator, skill-gate)
- ESLint ciblé sur les fichiers touchés : 0

## Tableau final (scénario → attendu → obtenu → correctif → commit)

| Scénario | Attendu | Obtenu | Correctif | Commit |
|---|---|---|---|---|
| `skills import --dir` sans `--apply` | Dry-run, rien écrit | `dryRun: true`, 0 fichier | — | — |
| Import skill sain | Fichier `imported-*/SKILL.md` | `imported-lunar-tide-almanac/SKILL.md` présent | — | — |
| Import script dangereux | Quarantaine, pas de fichier | `remote-pwn` quarantiné dès la 1re passe | déjà en place | — |
| Import jailbreak sans payload shell | Quarantaine, pas de fichier | 1re passe : **importé** (`allow` 100) | motifs prompt-injection | `1e942f44f` |
| Rejeu import après D1 | Jailbreak quarantiné | `godmode-lite` + `remote-pwn` quarantinés ; 1 seul skill sur disque | idem | `1e942f44f` |
| `skills imported` | Liste les importés avec provenance | `📌 imported-lunar-tide-almanac (source: library)` | — | — |
| Découverte (question marée sélénographique) | Skill importé sélectionné | `best.name=imported-lunar-tide-almanac`, confidence 1, triggers dérivés | — | — |
| Hermes 75 skills | godmode + scripts dangereux quarantinés | 46 import / 19 quarantaine (godmode inclus) / 10 review | motifs jailbreak aident (92 critical) | `1e942f44f` |
| `skills exchange export/verify/install --trust` | Paquet ed25519 accepté | install `imported-authored-lunar-demo` author `CetsX18ojM0Q` | — | — |
| Paquet mauvaise clé (G6R) | Refus | `Invalid exchange manifest signature` EXIT=1 | déjà en place | — |
| Paquet re-signé malveillant | Re-scan pare-feu, refus | `Skill firewall refused package (quarantine)` EXIT=1 | déjà en place | — |
| `improve skills-pin` | Pin visible | `📌 authored-git-bisect` | — | — |
| `improve skills-archive` | Archive récupérable | 1re passe : `unknown command` | commande CLI | `4bf8f5c79` |
| `improve skills-restore` | Restaure depuis `.archive` | SKILL.md revenu après archive | — | `4bf8f5c79` |
| `improve skills-consolidate` perte de couverture | `coverage-loss`, siblings intacts | 1re passe : `no-proposal` (pas d'LLM) ; après D3 : `coverage-loss` pour `safe-delete` | `--proposal-file` | `29a12d5c0` |

## Bilan (≤ 10 lignes)

Import / pare-feu / exchange / découverte / pin / archive / restore / consolidation ont été exercés avec le vrai CLI du clone, HOME dans `_qa/gk22/`. Le skill sain est installé et sélectionné (confidence 1) ; le script dangereux était déjà quarantiné. Trois défauts fermés, chacun rouge→vert, un commit : jailbreak prose importé (`1e942f44f`), `skills-archive` absent (`4bf8f5c79`), consolidation CLI incapable de prouver une perte de couverture (`29a12d5c0`). Hermes local 75 skills : 19 quarantaines dont `godmode`, 0 godmode sur disque. Preuves : `tsc` racine+GPU 0 ; 8 fichiers / 129 tests ciblés verts. Reste ouvert : le HOME `_qa/gk22/home` d'avant-correctif contient encore `imported-godmode-lite` (laissé comme fossile de la 1re passe, non servi après le fix).
