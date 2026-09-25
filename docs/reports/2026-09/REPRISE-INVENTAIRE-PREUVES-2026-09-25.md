# Reprise de l’inventaire des preuves — 25 septembre 2026

Chantier réservé sur `docs/inventaire-preuves-2026-09-25` à partir de `085482281`.
Les trois contre-revues P1, P2 et P3 sont lues en entier. Le rapport de livraison et les sorties de commandes sont conservés dans le dossier de reprise du partage.

État initial : P1 surclasse `/team`, P2 surclasse Verifier et cite un journal contradictoire, P3 présente un rejeu « Rêve » sujet à une course. Le comptage P4 demande une réconciliation explicite.

État candidat : `/team` et Verifier sont 🧪 ; les deux unités `/batch` restent ✅. Le journal P2 cité prouve une acceptation 2/2 visibles et 3/3 cachés. Les contrôles P2 exigent une proposition évaluée. P1 refuse un sélecteur inconnu et n’annonce plus « OK » après échec du conseil. P3 attend la promotion mémoire et impose des profils jetables et des dépendances explicites. P4 distingue l’affirmation historique 105, la liste historique 103 et les 116 noms runtime (114 lignes avec deux alias).

Sondes ciblées : rouges avant correction, vertes après correction ; les mutants P1, P2 et P3 reproduisent le faux résultat. Sorties intégrales dans le dossier de reprise. Un premier export du commit correctif `bc17c3a3e` a confirmé le type-check (code 0). Les suites P1/P2/P4 y rencontrent le refus de socket locale du lanceur `tsx` ; P3 s’arrête sur six tests Rust de pont réseau (`EPERM`, 36 autres réussis). La sonde Ollama loopback est également inaccessible. Le lint a signalé un bloc `catch` vide dans le harnais P3 ; il est corrigé avant le rejeu final.

Un rejeu direct sans socket de la sonde P2 `output-sanitizer` sur le commit de clôture a détecté un écart de code entre la branche d’inventaire et le correctif P2 cité : caractère de largeur nulle conservé, 59 caractères retirés au lieu de 60. L’inventaire distingue désormais le succès historique P2 du défaut présent sur cette branche. La sortie directe est ajoutée aux preuves sans altérer le journal historique.

État déployé : aucun. Aucun push ni fusion.
