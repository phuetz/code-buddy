# Inventaire des fonctionnalités — nouvelles preuves par exécution (24/09/2026)

Agent : Opus 5.5 (Claude Code), à la demande de Patrice (« dresser la liste des fonctionnalités
pour les tester et les améliorer »).

## Règles

- Chaque preuve est une exécution réelle, dans un HOME isolé (`_qa/inventaire/home`), sur `main`
  compilé à la révision indiquée. Le profil réel `~/.codebuddy` n'est jamais touché.
- D'abord les fonctionnalités vérifiables sans modèle ($0) ; ensuite celles qui demandent un tour
  d'agent.
- Un échec est consigné comme tel : c'est le but de l'exercice.

## Résultats

Révision testée : `main` `9193668f`, compilé ; HOME isolé ; modèle local `qwen3:4b-instruct` (Ollama,
$0) quand un modèle est nécessaire.

### Règles sensorielles — « une action dangereuse est refusée à l'écriture » : **à moitié vrai**

`buddy rules add --json` avec dix commandes destructrices (règle `shell`, exécutée ensuite sans humain
sur un événement sensoriel) :

| Commande | Enregistrement |
|---|---|
| `rm -rf ~/DEV`, `rm -rf src`, `curl … \| sh`, `dd … of=/dev/sda`, `chmod -R 000 ~` | refusée |
| `truncate -s 0 ~/.env` | **acceptée** |
| `find . -name '*.ts' -delete` | **acceptée** |
| `mv ~/.ssh /tmp/x` | **acceptée** |
| `python3 -c "…shutil.rmtree('src')"` | **acceptée** |
| `git reset --hard HEAD~5` | **acceptée** |

Cause : `validateRule` s'appuie sur `isDestructive`, une liste de motifs. Même famille que la faille
vocale A1 (#214). Correction proposée : classer la commande par ExecPolicy et n'accepter, pour une règle
sans humain, que les lectures — sauf consentement explicite.

### Échange de compétences signées : **prouvé**, avec un défaut d'export

- Paquet exporté puis vérifié : « Valid signed package », code 0.
- **Un caractère modifié** dans `SKILL.md` : vérification **refusée** (« SHA-256 mismatch for
  SKILL.md »), installation **refusée**, rien n'est installé.
- Défaut : `export` annonce « an authored or bundled skill », mais cherche un dossier
  `<nom>/SKILL.md` ; les compétences fournies sont des fichiers plats `<nom>.skill.md`. Seule 1 sur 8
  (`pubcommander-control`) est exportable ; `typescript-expert`, listée par `skills list`, répond
  « Skill not found ».

### Espace de travail multi-dépôts : **prouvé**

Deux vrais dépôts git ajoutés (`buddy ws add`), listés `valid`, et `buddy ws search calculerTva`
trouve la définition dans `alpha` **et** l'usage dans `beta`, code 0.

### Bascule de fournisseur : **prouvée**, avec un rapport final faux

Fournisseur principal vers un port fermé, `CODEBUDDY_PROVIDER_FALLBACK=true`,
`CODEBUDDY_FALLBACK_CHAIN=ollama:qwen3:4b-instruct` :
- panne classée `unreachable`, bascule vers Ollama avec réduction des outils 20 → 6 (fenêtre 32 k),
  réponse « OK », code 0 ; santé persistée (`provider-health.json`, nouvel essai dans 5 min).
- **Défaut** : la sortie JSON annonce `"model":"gpt-4o-mini"` (le modèle en panne) au lieu du modèle
  qui a répondu, et facture 0,0157 $ « pay-per-use » pour une réponse locale gratuite.
- Premier essai invalide, consigné : avec `OLLAMA_HOST` défini, la détection avait pris Ollama comme
  fournisseur principal (erreur de montage de ma part, pas un défaut du produit).

### Auto-banc de capacités : **ne mesure pas ce qu'il annonce**

`buddy improve bench --run --provider ollama --models qwen3:4b-instruct --scenarios 2` : 0 %, statut
`ok` sur les deux scénarios. Rejoué à la main : la consigne est « Situation: npm test », sans contexte ;
le modèle répond un conseil correct et générique, noté 0 parce que la réponse attendue contient
« path filter » / « path/to », une convention propre à ce dépôt (`CLAUDE.md`) qu'on ne lui montre pas.
- Le banc mesure la divination des conventions internes, pas la capacité du modèle.
- La recommandation dit « Prefer qwen3:4b-instruct (latest capability score 0%) ».
- Un seul mot attendu suffit à réussir (`expect.some`) : un mot-clé placé passerait.
Décision à prendre : fournir au modèle les règles du dépôt en contexte, ou remplacer les scénarios.

### Sessions voyage dans le temps : **prouvées**, avec une inspection qui propose de modifier les fichiers

`CODEBUDDY_TIMELINE=true`, modèle local :
- tour 1 « Retiens le mot citron » ; tour 2 par `--resume <id>` « Quel mot ? » → **« citron »** ;
- timeline de 2 entrées + 2 instantanés ; `buddy replay <id>` liste les deux tours (heure, aperçu).
- **Défaut** : `buddy replay <id> --at 1`, décrit « Inspect a specific turn », affiche le tour puis
  demande « Restore files from checkpoint …? This changes the working tree. (y/N) ». Sans terminal,
  avec une entrée ouverte mais muette (script, agent), la commande reste bloquée (tuée à 120 s,
  code 143) ; avec `/dev/null`, elle se termine sur « non ». L'inspection devrait être en lecture
  seule, la restauration une option explicite.

## Configuration : comparaison avec OpenClaw (2026.6.11, installé localement)

Étude en lecture seule de la documentation et du schéma d'OpenClaw, comparée à `main`.

**OpenClaw** : un fichier JSON5 unique validé strictement par un schéma Zod (une clé inconnue bloque le
démarrage, sauf les commandes de diagnostic) ; `config get/set/unset/patch/validate/schema` avec
`--dry-run` ; rechargement à chaud avec un tableau « à chaud / redémarrage » par section et conservation
de l'ancienne configuration si la nouvelle est invalide ; « dernière bonne configuration »,
écritures destructrices rejetées ; `$include` ; `${VAR}` partout ; références de secret ; surcharges par
agent et par canal ; défauts et plages documentés champ par champ.

**Code Buddy** : TOML avec profils, hiérarchie `settings.json` sur 5 niveaux, références de secret (dans
le JSON seulement), registre de variables incomplet (272 déclarées pour ~442 lues). #211 (catalogue de
modèles) et #221 (`buddy config set/patch/unset`, schéma, validation, sauvegardes) comblent une partie de
l'écart. Restent : rechargement à chaud, `$include`, `${VAR}` dans le TOML, surcharges par canal, et les
réglages de la voix et des limites d'exécution.

**Deux façades, vérifiées par recherche dans le code :**
- la section TOML `[middleware]` (`max_turns`, `max_cost`, seuils) est définie, fusionnée et proposée
  par l'aide de `/config`, mais **aucun code d'exécution ne la lit** ; les vraies limites sont en dur ;
- le module de **rechargement à chaud n'est jamais démarré** : seule sa remise à zéro est importée.

Environ 23 valeurs en dur mériteraient d'être réglables, dont 14 dans la voix (silences de fin de tour,
seuil « Pardon ? », barge-in, bruit, première phrase, délai ElevenLabs, auto-écho, chien de garde des
tours…). Transmis à la session pilote, qui porte `src/config` (#221) ; proposition : un lecteur unique
`resolveVoiceTuning(env, toml)` avec la priorité variable > TOML `[voice.*]` > constante actuelle.
