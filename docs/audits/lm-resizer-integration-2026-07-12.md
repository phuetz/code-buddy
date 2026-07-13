# Audit et intégration de lm-resizer — 12 juillet 2026

## Résultat

`lm-resizer` est maintenant le moteur privilégié de réduction des observations
d'outils de Code Buddy. La commande réelle reste autorisée, validée et exécutée
par Code Buddy dans son sandbox ; seul son texte de sortie, devenu inerte, est
ensuite transmis au moteur. L'ancien wrapping RTK reste compatible mais est
désactivé par défaut.

Le contrat est réversible :

```text
résultat natif
  -> original exact privé, indexé par toolCallId
  -> vue complète pour l'interface
  -> TokenJuice lossless pour le Web si utile
  -> lm-resizer tool-output (budget dynamique)
  -> garde anti-croissance octets + tokens
  -> vue compacte pour le LLM
  -> restore_context(toolCallId) à la demande
```

## Écarts corrigés dans lm-resizer

- nouvelle opération `tool-output`, qui ne lance jamais la commande fournie ;
- requête JSON via stdin, HTTP ou MCP, sans commande ni requête utilisateur dans argv ;
- budget approximatif universel, déterministe et sensible à la requête ;
- conservation brute des échecs et récupération exacte vérifiée avant d'annoncer un hash ;
- garde anti-expansion avec seuil minimal en octets et en ratio ;
- priorité correcte de Vitest/Jest sur les filtres TOML génériques ;
- filtres `ps`, `du` et signaux critiques de logs (`ERROR`, `PANIC`, `FATAL`, échecs) ;
- pipelines/redirections shell laissés intacts par les réécritures ;
- commentaires et licences du code source préservés par défaut ;
- filtres de projet validés, dédoublonnés et soumis au trust du workspace ;
- secrets masqués dans historique, commandes, URL, headers, sorties `ps` et noms de tee ;
- répertoires `0700`, bases/fichiers `0600`, hooks et shims `0755` ;
- purge SQLite amortie et capacité maximale, même sans récupération ;
- serveur persistant avec limite de corps, bind distant refusé par défaut et token optionnel ;
- état/pipeline réutilisés par HTTP et MCP au lieu d'être reconstruits par requête.

Validation du workspace lm-resizer : **1 023 tests réussis**, 3 tests réseau
ignorés volontairement, aucun échec.

## Intégration Code Buddy

- `ToolObservationOptimizer` central avec seuils 1 Kio pour les sorties
  command-aware et 4 Kio pour les sorties génériques ; les lectures de source,
  sensibles à la fidélité, restent intactes jusqu'à 20 Kio hors forte pression ;
- budget dérivé de la fenêtre du modèle, des tokens déjà présents et de la
  réserve de réponse ;
- client sidecar HTTP persistant avec découverte de capacité, timeout, abort,
  circuit breaker et réponse bornée ;
- fallback CLI `tool-output --request-json` avec environnement minimal et cwd du workspace ;
- original capturé dans `ToolHandler` avant les sanitizers provider ; stdout et
  erreur partielle sont tous deux conservés ;
- `restore_context` toujours exposé, y compris dans les profils de modèles légers ;
- sortie restaurée explicitement exemptée de recompression ;
- RTK pré-exécution désactivé par défaut afin d'éviter la double compression et
  les erreurs de binaire absent dans le sandbox ;
- Cowork propose **Paramètres > Général > Optimisation du contexte** avec
  `Auto` ou `Désactivé` ; Auto est le défaut.

## Mesures après correction

Mesures sur le binaire release installé ; 25 itérations CLI et 60 requêtes HTTP
chaudes par fixture :

| Fixture | Réduction | CLI p50/p95 | HTTP p50/p95 |
|---|---:|---:|---:|
| Vitest | 29 786 -> 58 (99,81 %) | 12,08 / 13,83 ms | 1,46 / 2,61 ms |
| rg/search | 50 080 -> 5 991 (88,04 %) | 15,93 / 21,15 ms | 3,43 / 5,70 ms |
| listing | 58 800 -> 5 074 (91,37 %) | 13,67 / 15,65 ms | 2,76 / 3,60 ms |
| diff | 110 050 -> 21 669 (80,31 %) | 11,07 / 12,39 ms | 3,35 / 5,23 ms |
| logs | 103 708 -> 62 (99,94 %) | 11,85 / 13,83 ms | 4,09 / 5,98 ms |
| JSON budgété | 188 654 -> 1 020 (99,46 %) | 70,67 / 88,23 ms | 51,15 / 58,03 ms |
| erreur tardive | brut exact | 5,19 / 5,85 ms | 0,73 / 1,73 ms |

La récupération exacte réussit sur 7/7 familles via CLI et HTTP. Le JSON
budgété est l'exception CPU ; les sorties interactives usuelles restent dans la
zone de quelques millisecondes avec le sidecar.

## Déploiement local

- binaire : `~/.local/bin/lm-resizer` ;
- sidecar : `lm-resizer.service`, loopback `127.0.0.1:8787` ;
- CCR : `~/.codebuddy/lm-resizer/ccr.sqlite3` ;
- activation Cowork : automatique ;
- activation services autonomie/Lisa : `CODEBUDDY_LM_RESIZER=true` ;
- fallback : CLI local, puis troncature sémantique Code Buddy sans rupture.

Le serveur n'écoute que sur loopback. Pour un bind distant, lm-resizer exige à
la fois l'option explicite et un token ; Code Buddy sait lire ce token depuis un
fichier privé `0600` sans le placer dans argv.
