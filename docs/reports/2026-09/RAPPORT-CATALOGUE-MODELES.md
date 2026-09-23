# Catalogue de modèles configurable

Branche `feat/catalogue-modeles-configurable-2026-09-23`, base `origin/main` `f48f5c1e4`. Arbre propre au départ. Rien n'est poussé ni fusionné. Le profil réel n'a pas été modifié.

Le rapport détaillé, les journaux de la barrière Docker et le dossier de fusion sont dans
`/home/patrice/Videos/Partage/20260923-reprise-pilotage-opus/lot20-catalogue-modeles/implementation/`.

Le catalogue utilisateur vit dans le TOML existant (`config.toml`, profils, `--profile`). Le mode `merge` ne remplace que les champs écrits. Les rôles `primary`, `fast` / `compact` et `vision` se choisissent dans la configuration. La fenêtre de contexte se découvre (Ollama `/api/show`, compatible OpenAI `/v1/models`) et se met en cache avec une durée de vie. Priorité : CLI, puis `CODEBUDDY_MODEL` / `GROK_MODEL`, puis profil, configuration, découverte, catalogue intégré. Une configuration invalide affiche `Configuration de modèle invalide` et ne substitue pas un autre modèle.

Guide : `docs/catalogue-modeles.md`. Commande : `buddy models list|show|refresh`.

Preuves dans la barrière sans réseau : 143 tests voisins et neufs verts, puis 43 tests des chargeurs dont les deux tests `CODEBUDDY_MODEL`. La même sélection restaurée depuis `origin/main` : 121 tests verts, aucun échec nouveau. Six mutants, un par règle, tous rouges sur l'assertion attendue.
