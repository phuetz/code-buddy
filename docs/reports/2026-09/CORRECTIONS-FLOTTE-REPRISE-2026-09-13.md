# Corrections de reprise et utilisation du harnais de flotte

Branche `codex/audit-ameliorations-2026-09-13`, base `85a08248a`. Travail demandé par Patrice, délégation à agy/Grok/Mistral autorisée pour préserver les quotas du coordinateur. Chaque moteur dispose d'un worktree séparé ; aucune publication ni fusion dans la branche principale.

## Première tranche : propositions, recherche et processus

- **Propositions** : noms suffixés par le hash de l'identifiant exact, segment lisible borné ; lecture compatible des anciens noms uniquement pour le scénario exact. Les identités de proposition et de gate sont vérifiées ; une suppression ne retire pas une ancienne proposition d'un scénario en collision. Les identités existaient déjà dans les anciens types et producteurs : la compatibilité n'accepte pas les fixtures tronquées inventées pendant la revue.
- **Recherche** : ajout ciblé d'équivalences françaises, notamment `voir` et `contenu`. Le catalogue avec schémas, la normalisation Unicode/camelCase, la déduplication et le calcul de fréquence existants sont conservés. Benchmark protégé rejoué sur le build : **17/17**, contre 16/17 auparavant. Cela ne mesure pas tout le catalogue réel.
- **Processus d'évaluation** : groupe distinct sur POSIX, SIGTERM puis SIGKILL après 250 ms, résultat borné même si les pipes restent ouverts ; la sortie du parent pendant un timeout n'annule plus l'escalade. Sorties plafonnées à un million de caractères par flux, erreurs de spawn collectées. Windows utilise `taskkill /F /T` avec un délai de 2 secondes, mais aucun test natif Windows n'a été réalisé ici. Ce mécanisme ne confine pas un programme hostile qui crée une nouvelle session OS.

Répartition réelle : agy a implémenté propositions/recherche, puis réduit une réécriture excessive après revue. Codex a resserré les validations d'identité et les noms longs. Le premier correctif Mistral de processus a été rejeté en revue ; sa deuxième version avait des régressions de cycle de vie et des fixtures laissées actives. Codex a arrêté ces seuls processus de test identifiés par leur cwd/commande, puis remplacé le correctif par une version plus petite et six tests réels, avec descendants finis. Les tests d'auteur seuls n'ont pas été considérés comme une preuve suffisante.

Vérifications : 28 tests ciblés distincts ; build réussi ; benchmark 17/17. Validation finale lint/typecheck/pack/tests : exit 0, 28 tests verts ; commit `623d19f64`. Les logs sont sous `_qa/audit/suite-first-*`. La suite globale n'est pas revendiquée.

## Première utilisation réelle de Code Buddy comme harnais

Le superviseur local `_qa/audit/fleet-harness.mjs` utilise **ToolHarness de Code Buddy compilé**, avec des opérations hôtes prédéfinies : contexte Code Explorer, impact, vérification via lm-resizer et lecture du statut des trois lanes. Les noms et arguments système sont fixés par le coordinateur ; aucune commande arbitraire issue d'un modèle n'est acceptée. Aucun modèle LLM n'est nécessaire pour ces opérations.

Trois appels réellement exécutés et journalisés dans `fleet-harness-events.jsonl` : contexte `runProc`, vérification (19 tests verts) et statut des lanes. Sur la vérification, lm-resizer rapporte 685 octets originaux, 316 compressés, soit 369 octets économisés. Ce n'est **pas** une mesure de quota facturé. Code Explorer : index initial construit ; un appel impact direct et un appel contexte par le harnais. L'index initial décrit la base de tranche et sera actualisé après commit ; ses numéros de ligne ne sont pas une preuve de fraîcheur du diff non commité.

Limite rencontrée : le premier essai via le dispatcher d'un CodeBuddyAgent a exécuté `bash` dans Docker ; `code-explorer` n'y était pas installé. Le superviseur utilise donc explicitement les adaptateurs hôtes prédéfinis du harnais, sans changer la politique générale de `bash`. La création de l'agent complet a aussi démarré une indexation en arrière-plan, inutile pour un simple superviseur. Les missions externes déjà lancées ne sont pas présentées rétroactivement comme des délégations initiées par ce harnais.

## Deuxième tranche : reprise des skills

Grok a produit un journal d'intention, une reprise d'application et un append idempotent. La revue Codex a demandé cinq corrections avant intégration : respecter propose-only à la reprise, vérifier les identités et empreintes sauvegardées, revalider la preuve même pour un fichier existant, lire le chemin réel du mutateur et préserver les journaux illisibles. Ces corrections ont été implémentées puis revues avant intégration. Le coordinateur a aussi protégé le journal, son moteur de reprise et l’archive contre les mutations DGM, et ajouté le refus d’écraser une archive corrompue.


La sonde réelle confirme désormais : `proofPending=true` après échec d'archivage ; au cycle suivant, `applied=true`, `phase=archived` et une seule entrée d'archive. Le registre et le fichier de skill sont réellement utilisés. La preuve comportementale est injectée : aucun appel fournisseur n'a été fait pour ce test.

La suite self-improvement + harnais + recherche a passé 403 tests avant les deux derniers cas d'archive corrompue. Ces deux cas, le journal et les protections ont ensuite passé 28 tests ciblés. Validation finale de cette tranche consignée ci-dessous à la livraison. Le stockage atomique ne constitue pas une transaction distribuée ou un verrou interprocessus ; deux coordinateurs doivent toujours réserver les zones. Les décisions d'application restent sous le mode d'autonomie courant.

Validation finale tranche reprise : `npm run validate` avec self-improvement, harnais et recherche, exit 0 ; 50 fichiers / 405 tests verts, 10 tests packaging verts, lint sans erreur et TypeScript vert. Build complet vert. lm-resizer : 355 285 octets originaux, 1 648 compressés (353 637 économisés) ; journal brut relu pour les totaux.


## Troisième tranche : supervision native

La preuve par script est intégrée à `src/harness/fleet-supervisor.ts`, exportée
par l'entrée publique du harnais, et accessible via **`buddy fleet supervise
<manifest> <operation> --json`**. `scripts/fleet-supervisor.mjs` n'est plus qu'un
point d'entrée de compatibilité. Guide et manifeste d'exemple : `docs/tool-harness.md`.

La configuration de l'opérateur fixe les exécutables et leurs arguments. La
cellule Code Buddy ne choisit qu'une opération existante ; les paramètres libres
sont refusés. Le résultat d'un processus échoué reste un échec jusqu'au code de
sortie CLI. L'annulation est transmise à `runProc` et son groupe de processus.
Aucun fournisseur LLM ni serveur Fleet n'est requis pour superviser localement.
Les limites restent explicites : 45 secondes par opération, 60 par cellule,
pas de nouveau service durable ou de délégation longue automatiquement lancée.

Preuve réelle avec le CLI compilé : contexte Code Explorer réussi puis
vérification **52 fichiers / 418 tests verts** en 12,68 s, via `fleet supervise`.
lm-resizer sur cette vérification : 588 octets originaux, 323 compressés,
265 économisés. Une deuxième suite ciblée vérifie le parsing Commander, les
manifestes, les échecs et l'annulation. Build final réussi après correction du
champ `required` manquant dans le premier schéma.

Le premier essai avec un CodeBuddyAgent complet avait laissé une indexation
active malgré `dispose` et SIGTERM. Le processus de cette seule sonde a été
identifié par son PID, sa commande et son cwd, puis terminé par SIGKILL. La
commande native n'instancie pas cet agent et ne déclenche pas cette indexation.
Le défaut général de fermeture de l'agent complet reste une piste séparée ;
il n'est pas déclaré corrigé par cette tranche.

Outillage du coordinateur : index Code Explorer construit, actualisé après les
commits `623d19f64` et `d34d1ebe4` ; lectures ciblées contexte/impact pour runProc,
SkillImprovementEngine et registerFleetCommands (six appels context/impact au
moins, directs ou via harnais). Les volumes indiqués sont ceux des commandes
mesurées ; aucun pourcentage de quota fournisseur économisé n'est revendiqué.

Validation finale native : `npm run validate` ciblé, exit 0 ; 19 tests, 10 packaging, lint (0 erreur / 2 488 avertissements) et TypeScript verts. Le contrôle de données personnelles séparé reste à **39/40**, avec les mêmes cinq chemins fautifs préexistants documentés dans les livraisons précédentes. Les fichiers de cette tranche étaient ajoutés à l'index avant ce contrôle.
