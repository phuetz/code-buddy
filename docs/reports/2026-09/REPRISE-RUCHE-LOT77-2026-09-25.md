# Reprise Ruche, lot 77

Chantier réservé sur la branche locale `feat/ruche-agents-2026-09-25`.
Départ : `6f8eab8ef`. Correctif : `a62a34e40`.
Le rapport détaillé et les sorties brutes sont déposés dans le dossier de livraison du lot 77.

| Constat de la contre-revue | Action | Vérification |
| --- | --- | --- |
| Double ingestion des événements sur un profil agent standard (bloquant) | La CLI ingère dans le journal d'autorité seulement s'il est distinct du journal agent. | Cinq tests CLI rouges avant, 21 tests ciblés verts après, cinq tests rouges avec le mutant. |
| Absence de couverture de la CLI activée (moyen) | Cinq commandes d'agent exécutées et leur événement signé vérifié sur disque. | Les cinq tests sont distincts et détectent le mutant. |
| Absence de couverture des délais invalides (faible) | Deux tests de bornes ajoutés. | Deux tests rouges avec le contrôle retiré. |

Typage et lint ciblé du candidat : code de sortie 0. Suites élargies sur le commit final : à compléter dans le rapport de livraison.

État source : prototype opt-in. État candidat : correctif local. État déployé : aucun.
