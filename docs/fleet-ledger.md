# Journal signé des lanes

Le journal de flotte relie chaque fin de délégation à la ligne précédente et signe chaque entrée avec une identité Ed25519 locale. Il est désactivé par défaut afin de préserver le comportement historique de `scripts/deleguer.sh`.

## Activer le journal

```bash
CODEBUDDY_LANE_LEDGER=1 scripts/deleguer.sh /workspace/lane mission.md luna
```

Par défaut, les données sont écrites dans `~/.codebuddy/delegations/` :

- `ledger.jsonl` contient une entrée JSON canonique par ligne ;
- `keys/<moteur>.key` et `keys/<moteur>.pub` forment l’identité Ed25519 du moteur ;
- `keys/approval.{key,pub}` signe les décisions de la porte d’approbation ;
- les deux fichiers de chaque paire et le journal ont le mode `0600`.

`CODEBUDDY_DELEGATIONS_DIR` permet de déplacer cet ensemble pour un test isolé. Les tests du dépôt l’emploient exclusivement sous le clone et ne lisent ni n’écrivent le vrai répertoire utilisateur.

À la fin d’une lane, l’entrée `delegation` contient l’horodatage UTC, le nom de mission, le chemin canonique du clone, la branche, les HEAD avant/après, le moteur, le code de sortie, le rapport livré et son SHA-256, ainsi que le SHA-256 de la mission. Le rapport est le fichier le plus récemment modifié dont le nom commence par `RAPPORT-`, `REPARATION-` ou `REVUE-`, hors `.git`, `node_modules` et répertoires de test temporaires. Une lane sans rapport reste journalisée, notamment pour conserver son échec, mais elle n’est pas fusionnable.

## Vérifier et lire

```bash
scripts/lane-ledger.sh verify
scripts/lane-ledger.sh list
scripts/lane-ledger.sh list --json
```

`verify` contrôle, pour chaque ligne : le JSON canonique, `prev_hash`, `entry_hash`, l’identité de la clé, la cohérence de la paire Ed25519, ses permissions et la signature. Il annonce soit `Chaîne intacte`, soit `Chaîne cassée à la ligne N`.

Pour la première entrée, `prev_hash` vaut `null`. Pour les suivantes, il vaut le SHA-256 des octets exacts de la ligne précédente, sans son saut de ligne. `entry_hash` est le SHA-256 du JSON canonique de l’entrée avant ajout de `entry_hash` et `signature`; la signature Ed25519 porte sur la représentation hexadécimale de `entry_hash`.

`list --json` écrit exclusivement un objet JSON sur stdout :

```json
{"ok":true,"count":1,"entries":[{"type":"delegation"}]}
```

Une erreur JSON est écrite exclusivement sur stderr. `list` parse les entrées ; utiliser `verify` pour établir leur intégrité cryptographique.

## Approuver puis fusionner

```bash
scripts/fusionner-lane.sh /workspace/lane feature/example /workspace/target \
  --approuve-par reviewer
```

La porte exige :

1. un clone source et une cible Git distincts et propres ;
2. la branche source extraite et immobile pendant la vérification ;
3. une chaîne entièrement valide ;
4. une entrée `delegation` réussie pour le chemin, la branche et le HEAD exacts ;
5. un rapport présent dont le contenu correspond toujours au SHA-256 signé ;
6. `npm run typecheck`, puis tous les fichiers `tests/**/*.test.*` ou `tests/**/*.spec.*` touchés depuis le HEAD initial de la lane.

Une commande de test explicite peut remplacer la détection automatique :

```bash
scripts/fusionner-lane.sh /workspace/lane feature/example /workspace/target \
  --approuve-par reviewer \
  --tests 'npm test -- tests/fleet/example.test.ts'
```

La valeur de `--tests` est une commande shell explicite : elle ne doit provenir que de l’opérateur. Le résultat du typecheck et des tests est écrit dans une entrée `approval`, y compris en cas d’échec. La fusion n’a lieu qu’après une réussite. Le mode par défaut est `git merge --ff-only`; `--merge` autorise explicitement un commit de fusion après un contrôle préalable des conflits. Le script importe la branche depuis le clone local et n’exécute jamais `git push`.

Avec `--json`, stdout contient seulement le résultat final et stderr seulement une erreur structurée. Les sorties de npm, des tests et de Git sont supprimées dans ce mode afin que chaque flux reste du JSON strict.

## Codes de sortie stables

| Code | `lane-ledger.sh` | `fusionner-lane.sh` |
|---:|---|---|
| 0 | Succès | Fusion réussie |
| 2 | Entrée ou usage invalide | Entrée, dépôt ou état de travail invalide |
| 3 | Chaîne/signature invalide ou entrée absente | Journal, rapport ou tête source non approuvable |
| 4 | Erreur interne, crypto, verrou ou écriture | Typecheck ou tests en échec |
| 5 | — | Import ou fusion Git refusé |

## Limite de confiance

La chaîne détecte une modification, une réorganisation ou une suppression interne des lignes restantes, et les signatures attribuent les entrées aux clés locales. Elle ne remplace pas une ancre externe : une personne capable de remplacer simultanément tout le journal et toutes les clés, ou de tronquer uniquement sa fin sans référence externe au dernier hash, peut reconstruire une autre histoire. Sauvegarder périodiquement le dernier `entry_hash` dans un emplacement de confiance ferme cette limite.
