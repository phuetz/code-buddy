# Corrections de reprise et utilisation du harnais de flotte

Branche `codex/audit-ameliorations-2026-09-13`, base `85a08248a`. Travail demandé par Patrice, délégation à agy/Grok/Mistral autorisée pour préserver les quotas du coordinateur. Chaque moteur dispose d'un worktree séparé ; aucune publication ni fusion dans la branche principale.

## Première tranche : propositions, recherche et processus

- **Propositions** : noms suffixés par le hash de l'identifiant exact, segment lisible borné ; lecture compatible des anciens noms uniquement pour le scénario exact. Les identités de proposition et de gate sont vérifiées ; une suppression ne retire pas une ancienne proposition d'un scénario en collision. Les identités existaient déjà dans les anciens types et producteurs : la compatibilité n'accepte pas les fixtures tronquées inventées pendant la revue.
- **Recherche** : ajout ciblé d'équivalences françaises, notamment `voir` et `contenu`. Le catalogue avec schémas, la normalisation Unicode/camelCase, la déduplication et le calcul de fréquence existants sont conservés. Benchmark protégé rejoué sur le build : **17/17**, contre 16/17 auparavant. Cela ne mesure pas tout le catalogue réel.
- **Processus d'évaluation** : groupe distinct sur POSIX, SIGTERM puis SIGKILL après 250 ms, résultat borné même si les pipes restent ouverts ; la sortie du parent pendant un timeout n'annule plus l'escalade. Sorties plafonnées à un million de caractères par flux, erreurs de spawn collectées. Windows utilise `taskkill /F /T` avec un délai de 2 secondes, mais aucun test natif Windows n'a été réalisé ici. Ce mécanisme ne confine pas un programme hostile qui crée une nouvelle session OS.

Répartition réelle : agy a implémenté propositions/recherche, puis réduit une réécriture excessive après revue. Codex a resserré les validations d'identité et les noms longs. Le premier correctif Mistral de processus a été rejeté en revue ; sa deuxième version avait des régressions de cycle de vie et des fixtures laissées actives. Codex a arrêté ces seuls processus de test identifiés par leur cwd/commande, puis remplacé le correctif par une version plus petite et six tests réels, avec descendants finis. Les tests d'auteur seuls n'ont pas été considérés comme une preuve suffisante.

Vérifications : 28 tests ciblés distincts ; build réussi ; benchmark 17/17. Validation finale lint/typecheck/pack/tests consignée avec le commit de tranche. Les logs sont sous `_qa/audit/suite-first-*`. La suite globale n'est pas revendiquée.

## Première utilisation réelle de Code Buddy comme harnais

Le superviseur local `_qa/audit/fleet-harness.mjs` utilise **ToolHarness de Code Buddy compilé**, avec des opérations hôtes prédéfinies : contexte Code Explorer, impact, vérification via lm-resizer et lecture du statut des trois lanes. Les noms et arguments système sont fixés par le coordinateur ; aucune commande arbitraire issue d'un modèle n'est acceptée. Aucun modèle LLM n'est nécessaire pour ces opérations.

Trois appels réellement exécutés et journalisés dans `fleet-harness-events.jsonl` : contexte `runProc`, vérification (19 tests verts) et statut des lanes. Sur la vérification, lm-resizer rapporte 685 octets originaux, 316 compressés, soit 369 octets économisés. Ce n'est **pas** une mesure de quota facturé. Code Explorer : index initial construit ; un appel impact direct et un appel contexte par le harnais. L'index initial décrit la base de tranche et sera actualisé après commit ; ses numéros de ligne ne sont pas une preuve de fraîcheur du diff non commité.

Limite rencontrée : le premier essai via le dispatcher d'un CodeBuddyAgent a exécuté `bash` dans Docker ; `code-explorer` n'y était pas installé. Le superviseur utilise donc explicitement les adaptateurs hôtes prédéfinis du harnais, sans changer la politique générale de `bash`. La création de l'agent complet a aussi démarré une indexation en arrière-plan, inutile pour un simple superviseur. Les missions externes déjà lancées ne sont pas présentées rétroactivement comme des délégations initiées par ce harnais.

## Tranche skills : en cours de revue

Grok a produit un journal d'intention, une reprise d'application et un append idempotent. La revue Codex a demandé cinq corrections avant intégration : respecter propose-only à la reprise, vérifier les identités et empreintes sauvegardées, revalider la preuve même pour un fichier existant, lire le chemin réel du mutateur et préserver les journaux illisibles. **Ne pas considérer cette tranche comme livrée tant que la section de validation finale n'est pas ajoutée.**
