# REPARATION-PRIV2 — plus aucune donnée privée dans le dépôt public

**Mission** : PRIV2. Retirer du dépôt PUBLIC toute IP privée, tout nom de machine de
l'auteur, tout identifiant de projet tiers, tout solde de crédits / niveau d'abonnement
et tout sujet médical.

**Date** : 2026-09-04 · **Agent** : Fable 5.1 (Opus 5)
**Clone** : `~/DEV/cb-priv2-2026-09-04` · **Branche** : `fix/priv2-ip-machine-uuid-2026-09-04`
**Base** : branche `codex/audit-systeme-nerveux-2026-09-01`, HEAD de départ `7bfc3a85d`.

> Ce rapport est créé AVANT toute inspection. Il ne contient AUCUNE valeur sensible :
> les IP, noms de machine et UUID y sont tronqués ou décrits, jamais cités en clair.

## Plan

1. Réservation dans `docs/FABLE5-CODEX-COORDINATION.md` + copie assainie du rapport de revue.
2. Mesure : `git grep -n` par famille (a) IP privées, (b) nom de machine, (c) UUID Flow,
   (d) soldes/abonnement, (e) sujet médical, (f) chemins home encodés.
3. Remplacement avec discernement, famille par famille.
4. Extension du garde-fou `tests/security/donnees-personnelles.test.ts` + preuve des deux sens.
5. Vérifications et bilan.

## 1. Mesure avant nettoyage

Toutes les valeurs sont **tronquées** ci-dessous : ce rapport vit dans le dépôt public.

### (a) IP privées (hors `127.0.0.1`)

```
$ git grep -nE '192\.168\.[0-9]{1,3}\.[0-9]{1,3}'                 → 46 occurrences / 32 fichiers
$ git grep -nE '(^|[^0-9.])10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}' → 21 occurrences / 15 fichiers
$ git grep -nE '100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\.…'   → 67 occurrences / 28 fichiers
```

Valeurs distinctes, désignées par un libellé (le rapport vit dans le dépôt public,
aucune adresse n'y est reproduite, même tronquée) :

| Libellé | Plage | Occ. | Nature |
| :--- | :--- | ---: | :--- |
| maillée-A | RFC 6598 | 46 | **adresse réelle du hub de l'auteur** — 21 fichiers |
| lan-B | RFC 1918 /16 | 11 | fixture générique de LAN (tests de refus d'origine) |
| maillée-C | RFC 6598 | 8 | borne canonique basse de la plage (tests) |
| lan-D | RFC 1918 /16 | 8 | exemple d'endpoint vLLM (commentaire + tests) |
| lan-E, lan-F | RFC 1918 /16 | 12 | fixtures génériques |
| maillée-G | RFC 6598 | 5 | pair de flotte Cowork (valeur par défaut + fixture) |
| lan-H | RFC 1918 /16 | 4 | fixture worker GPU |
| maillée-I | RFC 6598 | 3 | **second pair réel** (guide de flotte + test A2A) |
| lan-J | RFC 1918 /24 | 2 | **partage de fichiers réel** (table de coordination) |
| maillée-K | RFC 6598 | 1 | **pair réel** (découverte de flotte Cowork) |
| — | — | 2 | *faux positif* : numéro de version d'un moteur JS, pas une adresse |

Fichiers de la famille « fuite réelle » : `cowork/src/main/fleet/discovery.ts`,
`cowork/src/main/fleet/fleet-bridge.ts`, `cowork/src/renderer/components/FleetPanel.tsx`,
`cowork/tests/fleet-bridge.test.ts`, `cowork/tests/fleet-discovery.test.ts`,
`docs/fleet-guide.md`, `docs/launch/TAILSCALE-REMOTE-PLAN.md`,
`docs/audits/2026-07-10-application-audit.md`, `docs/FABLE5-CODEX-COORDINATION.md`,
`docs/avatar-metahuman-protocol.md`, `docs/archive/internal/PR-42-AMELIORATIONS.md`,
`docs/reports/2026-09/RAPPORT-GK17.md`, `docs/research/ETUDE-PERCEPTION-MONDE-PHYSIQUE.md`,
`integrations/unreal/CodeBuddyAvatar/README.md`, `scripts/ollama_a2a_spoke.py`,
`src/commands/handlers/fleet-handler.ts`, `src/fleet/fleet-listener.ts`, `CHANGELOG.md`,
et 5 tests (`tests/agent/model-tier`, `tests/agent/autonomous/fleet-llm-routing`,
`tests/protocols/a2a-remote-agents`, `tests/protocols/a2a-skill-selection`,
`tests/protocols/a2a-skill-routing`, `tests/server/exposure-diagnostic`).

**Distinction faite dès la mesure** : la majorité des IP privées de `tests/` et de
`src/security/ssrf-guard.ts` sont **fonctionnelles** — elles servent à prouver qu'une
adresse privée est refusée (SSRF, origines de développement, boucle locale, proxys de
confiance). Les remplacer par des adresses de documentation RFC 5737 (qui sont
**publiques**) détruirait le pouvoir de détection de ces tests. Elles sont donc
conservées et couvertes par une liste d'exemptions **nommée** dans le garde-fou.

### (b) Nom de machine de l'auteur

```
$ git grep -licF "<nom>"  → 95 fichiers
$ total occurrences        → 342
```

Formes rencontrées : le nom seul (202), suffixé `-linux` (122), `-linux-1` (10),
`-ubuntu` (6), `-ollama` / `-comfyui` / `-windows` / `-secrets`, préfixé `ollama-` (5),
et **trois identifiants de code** : `…Available` (6), `…_available` (5), `--no-…` (1).
Familles : `CLAUDE.md`, `.env.example`, 2 fichiers Rust (`buddy-memory/src/store.rs`,
`buddy-sense/src/senses/live_audio.rs`), 8 fichiers Cowork, 25 documents, 8 scripts,
18 fichiers `src/`, 31 tests.

### (c) Identifiant de projet du service vidéo tiers

```
scripts/influencer/flow-crame.py:52   FLOW_PROJECT_ID = '266d…'          (en dur)
scripts/influencer/flow-crame.py:54   URL projet = base + FLOW_PROJECT_ID
scripts/influencer/flow-crame.py:104  if FLOW_PROJECT_ID in url
scripts/influencer/flow-crame.py:106  message d'avertissement citant l'UUID
scripts/influencer/flow-crame.py:252  garde de dérive d'onglet
scripts/influencer/systemd/codebuddy-flow-daily.service:10  --project-url …/0c26…
docs/reports/2026-09/RAPPORT-FLOWFIX1.md                    266d… et 0c26…
```

### (d) Soldes, crédits, niveau d'abonnement

`docs/reports/2026-09/RAPPORT-FLOWFIX1.md` (solde chiffré, consommation par prise,
palier d'abonnement), `docs/FABLE5-CODEX-COORDINATION.md` lignes 35, 42 et 113
(solde chiffré ×2, palier d'un second fournisseur), `CHANGELOG.md` (coût par prise).

### (e) Sujet médical

`scripts/fix-research.sh` : le prompt de mission nomme une maladie
neurodégénérative, le **lien de parenté** de l'auteur avec la personne atteinte, un
fichier de diagnostic dans un dépôt privé, et un volume de corpus lié à cette maladie.
*(Les autres occurrences du nom de la maladie — un classifieur de veille scientifique
et deux fixtures de test — sont du vocabulaire scientifique générique, sans lien
personnel : conservées, cf. §5.)*

### (f) Chemins de profil de session encodés

```
$ git grep -l -e "-home-<utilisateur>"  → 14 fichiers
docs/reports/2026-09/REPARATION-CONV2.md:14
scripts/flow-fix.sh:3 + 12 autres scripts/run-*.sh:3
```
Chacun de la forme `/tmp/claude-1000/-home-<utilisateur>-code-buddy/<uuid-session>/…`
— l'identifiant système de l'auteur **et** un identifiant de session.

## 2. Remplacements

Aucun `sed` aveugle : chaque famille a été relue après passage, et trois cas ont été
**rendus** à leur valeur d'origine ou reformulés parce que le remplacement mécanique
cassait le sens (cf. §5).

| Famille | Geste | Fichiers | Commit |
| :--- | :--- | ---: | :--- |
| Cowork | adresses → RFC 5737 (`203.0.113.x`), identifiants de pair et libellés impersonnels | 13 | `dc64913d1` |
| Code (`src/`, `tests/`, Rust, scripts d'appoint) | nom de machine → `hub` (domaine flotte/hôte) ou `localGpu` (domaine média) ; adresses réelles → RFC 5737 | 63 | `944798002` |
| Scripts | `FLOW_PROJECT_ID` lu dans l'environnement, `FLOW_PROJECT_URL` pour l'unité systemd, `DIAGNOSTIC_FILE` et `MISSION_FILE` pour les briefs hors dépôt, sujet de recherche neutre | 17 | `a496207b0` |
| Documentation | adresses → RFC 5737 ou `<ip-du-hub>` ; identifiant système → `<utilisateur>` ; soldes et paliers d'abonnement retirés ou reformulés sans chiffre | 33 | `41e981709` |
| Garde-fou | cinq motifs, cinq fixtures isolées, six contre-épreuves | 4 | `1d6e4e607` |

**Choix de nommage.** Le nom de machine occupait aussi des *identifiants de code* —
un champ de schéma d'outil, deux clés d'entrée, un drapeau CLI — et une heuristique
« pair toujours allumé ». Deux domaines, donc deux noms : `hub` là où il s'agit de
l'hôte de flotte (`hub/grok-cli`, `hub-linux`, `CODEBUDDY_FLEET_HOSTNAME`), `localGpu`
là où il s'agit du moteur GPU local des outils média (`video_route`,
`video_flow_handoff`, `hybrid-video-router`). Le renommage change la surface publique
de ces deux schémas d'outils : c'est assumé et prouvé par 427 tests verts + typecheck.

**Identifiant de projet.** Plus aucun UUID en dur : `flow-crame.py` lit
`FLOW_PROJECT_ID`, s'arrête avec un message qui dit où trouver la valeur, et ne le
journalise plus. L'unité systemd prend `FLOW_PROJECT_URL`. Les deux UUID cités dans
`RAPPORT-FLOWFIX1.md` ont disparu, la mesure qu'ils portaient est conservée.

**Soldes.** Reformulés sans chiffre : « le compteur a baissé de 100 par prise »,
« crédits expirant en fin de mois ». Le palier d'abonnement d'un second fournisseur
a été retiré du titre de mission.

**Sujet médical.** Le prompt de `fix-research.sh` parle désormais de « revue de
littérature scientifique sur un grand corpus d'articles en accès libre ». La maladie,
le lien de parenté et le volume de corpus associé ont disparu ; le diagnostic est
référencé par `DIAGNOSTIC_FILE` (fail-closed, `exit 2`, vérifié en exécution).

## 3. Garde-fou — `tests/security/donnees-personnelles.test.ts`

Cinq motifs de plus, **tous assemblés par concaténation** pour que le fichier ne se
détecte pas lui-même. Aucune fixture ne reconstitue une valeur réelle : les adresses
et l'UUID des témoins sont inventés dans les bonnes plages / la bonne forme.

| Motif | Forme | Portée |
| :--- | :--- | :--- |
| nom de la machine de l'auteur | sous-chaîne (contenu **et** chemin) | tout le dépôt |
| `ip-lan-16` | RFC 1918 /16, octets 0-255 | hors liste d'exemptions |
| `ip-lan-8` | RFC 1918 /8, **quatre** octets exigés | hors liste d'exemptions |
| `ip-maillee` | RFC 6598 — espace partagé, second octet 64 à 127 | hors liste d'exemptions |
| `uuid-projet-video` | UUID **dans** une URL de projet ou une affectation de constante | tout le dépôt |

Trois décisions de conception valent d'être dites :

1. **`127.0.0.1` et les adresses de documentation ne sont pas des cas particuliers.**
   La boucle locale n'appartient à aucune des trois plages privées, et RFC 5737 est
   publique : aucune exception à écrire, donc aucune à oublier. Trois contre-épreuves
   le prouvent.
2. **Quatre octets exigés pour le /8.** Un numéro de version à trois segments
   (`^10.5.4`) ne matche pas — sans quoi le garde-fou hurlerait sur chaque
   `package-lock.json` et finirait désarmé. Une contre-épreuve le fige.
3. **`FICHIERS_PLAGES_PRIVEES` est une liste CLOSE et nommée** (33 fichiers) : ceux
   dont l'adresse privée est le SUJET — le garde SSRF, les définitions de plages, et
   les tests qui prouvent qu'une adresse privée est refusée, classée `lan`, ou
   reconnue comme non-loopback. Y substituer une adresse RFC 5737 **inverserait**
   l'assertion. Le motif « nom de machine » et le motif « UUID de projet », eux, ne
   connaissent aucune exemption. Un fichier neuf portant une adresse privée rougit et
   impose une décision consciente : c'est la limite exacte de ce garde-fou, et elle
   est visible.

### Preuve des deux sens

**ROUGE avant.** Le garde-fou étendu, appliqué tel quel au dépôt à son commit de
départ (`7bfc3a85d`, worktree jetable) :

```
FAIL tests/security/donnees-personnelles.test.ts
  → aucun fichier suivi ne nomme la situation ou l'infrastructure privée de l'auteur
AssertionError: expected [ '.env.example → <motif>', …(104) ] to deeply equal []
  Test Files  1 failed (1)
       Tests  1 failed | 17 passed (18)
```

**105 fichiers fautifs**, répartis sur les cinq motifs (nom de machine, très
majoritaire ; puis RFC 1918 /16, RFC 6598, RFC 1918 /8, et 2 fichiers portant
l'identifiant de projet).

**VERT après.** Sur la branche de réparation : **18/18** (11 fixtures isolées,
6 contre-épreuves, 1 balayage du dépôt).

**Chaque motif rougit sous mutation.** Motif désactivé un par un, sa fixture isolée
tombe, et elle seule (`Failed Tests 1`), puis le fichier est restauré :

```
MUTATION [nom de la machine] → Failed Tests 1
MUTATION [RFC 1918 /16]      → Failed Tests 1
MUTATION [RFC 1918 /8]       → Failed Tests 1
MUTATION [RFC 6598]          → Failed Tests 1
MUTATION [projet vidéo]      → Failed Tests 1
--- restauré ---  Tests  18 passed (18)
```

Deux tests Python ajoutés côté script, prouvés rouges de la même façon en
réintroduisant un UUID en dur :
`FAILED …::test_no_hardcoded_project_uuid_in_the_script` +
`FAILED …::test_missing_env_var_aborts_with_a_clear_message`.

## 4. Vérifications

| Commande | Résultat |
| :--- | :--- |
| `npx vitest run tests/security tests/docs` | 945 verts / 961, **16 rouges pré-existants** (voir ci-dessous) |
| `npx vitest run tests/security/donnees-personnelles.test.ts` | **18/18** |
| `cd cowork && npx vitest run tests/fleet-bridge tests/fleet-discovery tests/session-intelligence tests/studio-loopback-url` | **4 fichiers / 22 tests verts** |
| `cd cowork && npx vitest run` (9 fichiers touchés) | **60/60** |
| `npx vitest run` (30 fichiers touchés par le renommage) | **427/427** |
| `npx vitest run tests/tools/video/ …` (36 fichiers du domaine média) | **371/371** |
| `python3 -m pytest tests/scripts/influencer/test_flow_crame_send.py` | **7/7** |
| `npx tsc --noEmit -p .` | **code 0** |
| `cargo check --tests` (`buddy-sense`, `buddy-memory`) | **code 0** sur les deux |
| `bash -n` sur les 15 scripts shell touchés | **OK** |
| `python3 -m py_compile` (`flow-crame.py`, `ollama_a2a_spoke.py`) | **OK** |
| `git diff --check` | **code 0** |
| `git status` | propre |

**Les 16 rouges de `tests/docs/revue-gemini-docs.test.ts` sont pré-existants et
étrangers à cette mission** : ce fichier lance le CLI compilé (`dist/index.js`), absent
d'un clone neuf. Témoin exécuté sur le **commit de départ non modifié** (worktree
jetable) : `Tests 16 failed | 7 passed (23)` — chiffres identiques avant et après.

## 5. Ce qui reste — et pourquoi

**Conservé volontairement, avec justification écrite dans le code :**

1. **Une adresse RFC 1918 canonique dans `cowork/tests/session-intelligence.test.ts`.**
   Le test prouve qu'un endpoint de plage privée est classé `lan`. Une adresse de
   documentation RFC 5737 est publique : le remplacement l'a fait passer au ROUGE
   (`expected 'cloud' to be 'lan'`). Rendue à une valeur canonique et impersonnelle,
   commentaire à l'appui, fichier nommé dans la liste d'exemptions.
2. **Les adresses privées de 32 autres fichiers** (garde SSRF, définitions de plages,
   tests d'origines de développement / boucle locale / proxys de confiance). Même
   raison. La liste est close et nommée — pas un répertoire entier exempté.
3. **Un faux positif assumé** : un numéro de version à quatre segments d'un moteur JS,
   dans `tests/unit/performance-benchmarks.test.ts`.

**Hors périmètre de cette mission, mesuré et à traiter ensuite** (la revue AGYSEC2 les
classait « à nettoyer », pas « bloquant ») :

- Le **prénom de l'auteur** hors chemin `/home/` : **285 fichiers**. C'est une famille à
  part entière, qui demande un arbitrage humain (une partie relève de la signature
  légitime d'un auteur de dépôt public, pas d'une fuite).
- Des **noms de dossiers de travail privés** : dépôt de passation **19 fichiers**,
  brouillons de vitrine **7**, formation interne **2**.
- Le nom d'une **maladie comme vocabulaire scientifique** dans 3 fichiers (un
  classifieur de veille, deux fixtures de corpus). Sans le lien de parenté ni le
  fichier de diagnostic, ce n'est plus une donnée personnelle mais un mot du domaine :
  je ne l'ai **pas** ajouté au garde-fou, qui rougirait sur toute revue de littérature.
- Un **sélecteur DOM** de `flow-crame.py` qui teste le libellé d'un bouton nommé d'après
  le palier d'abonnement (3 occurrences). C'est du code fonctionnel de pilotage
  navigateur ; le changer sans un pilote Flow ouvert serait modifier sans preuve.
- Le nom de fichier `scripts/run-dossier-medecin.sh` : la consigne interdit de renommer
  un fichier. Son contenu, lui, ne cite plus aucun chemin privé.

**Ce qui n'a PAS été fait, par consigne** : aucun `push`, aucun `prune`, aucun
`reset --hard`, aucune écriture hors du clone, aucune API payante, aucun processus tué.
Le dépôt d'origine `~/code-buddy` et le vrai `~/.codebuddy` n'ont jamais été écrits.

**Rappel qui vaut avertissement** : la branche de départ est **déjà poussée**. Ces
commits retirent les valeurs du contenu *courant* ; ils ne réécrivent pas l'historique.
Les valeurs restent lisibles dans les commits antérieurs de GitHub. Décider d'une
réécriture d'historique (ou d'un dépôt neuf) est un choix humain, hors de ce périmètre.
