# Outillage de travail — 13 septembre 2026

Branche `codex/audit-ameliorations-2026-09-13`, correctifs `8e4e593b4`.
Codex : Code Explorer et avertissement du prompt ; Astra : catalogue des missions,
puis revue indépendante de Code Explorer. Original préservé hors coordination.

## Livré

- `buddy fleet mission list <store> [--limit 1..100] [--cursor <hash>]` : projection
  de métadonnées, sans commande/arguments/workspace/sorties/capsule/génération.
  Corruption signalée génériquement ; lecture absente sans création. Pagination
  vivante, lecture interne bornée par page, balayage des noms en mémoire bornée.
- Fraîcheur Code Explorer : identifiants Git complets validés, Git invoqué sans
  shell, HEAD comparé directement (un retour en arrière reste périmé même à zéro
  commits derrière). Index incomplet ou invérifiable signalé au prompt, sans
  indexation automatique. Métadonnées legacy explicitement reconnues conservées.
- Analyses API identiques simultanées regroupées par chemin résolu dans un même
  processus ; options différentes sérialisées ; échec libère la place. Option
  incremental disponible ; stderr limité aux 65536 derniers caractères. Le
  rafraîchissement automatique choisit le binaire effectivement disponible.

## Preuves

`npm run validate` avec HOME isolé, deux workers, filtres plugin Code Explorer,
prompt-builder, harness et CLI missions : **159 tests / 10 fichiers + 10 tests de
pack**. TypeScript et lint passent (2488 avertissements historiques, zéro erreur).
Build réussi. La première validation était verte ; après une observation d’Astra
sur les métadonnées modernes incomplètes, correction/test puis validation finale.

Harnais natif `fleet supervise` utilisé pour Code Explorer context et vérification
avec lm-resizer : **79/79**. CLI compilée `fleet mission list` utilisée sur notre
registre réel : mission terminée retrouvée, projection vérifiée sans contenu.

Preuve avec vrais processus enfants et exécutable fixture : deux demandes
simultanées sur deux managers lancent **2 processus avant, 1 après**. Le script de
preuve a été corrigé pour son exécutable ESM, puis réussite ; aucun changement de
production supplémentaire requis pour cette fixture.

Logs locaux : `_qa/audit/work-tools-{validate-final,build,proof,native-context,native-verify}.json`,
catalogue `_qa/audit/work-tools-native-list.json`. Index Code Explorer rafraîchi
sans enrichissement LLM. Aucun appel Fable, service permanent, push ou fusion.

## Limites

La fraîcheur compare les commits, pas les changements non commités. La déduplication
ne coordonne ni les autres processus ni un indexeur déjà détaché. Elle ne réduit
pas le coût de résolution globale de Code Explorer lors d’analyses séquentielles.
Le catalogue lit les enregistrements complets sélectionnés (maximum 3 Mo chacun)
avant projection ; les pages ne constituent pas un instantané transactionnel.
