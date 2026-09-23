# Catalogue de modèles configurable

Branche `feat/catalogue-modeles-configurable-2026-09-23`, base `origin/main` `f48f5c1e4`. Rien n'est poussé ni fusionné. Le profil réel n'a pas été modifié.

Le catalogue utilisateur vit dans le TOML existant (`config.toml`, profils, `--profile`). Le seul mode est `merge` : une entrée ne remplace que les champs écrits. Seul le rôle `primary` choisit le modèle de la session. Les capacités et les deux prix, quand ils sont écrits, alimentent `getModelToolConfig` et `getModelPricing`. Il n'y a pas de commande `refresh` ni de cache JSON dans cette version. Priorité au démarrage : `--model`, puis `CODEBUDDY_MODEL` / `GROK_MODEL`, puis le profil, puis `primary` ou un `active_model` explicite, puis le réglage sauvé compatible, puis le fournisseur détecté. Le `active_model` du fichier généré ne masque pas ce fournisseur. Une configuration invalide affiche `Configuration de modèle invalide` et ne substitue pas un autre modèle.

Guide : `docs/catalogue-modeles.md`. Commande : `buddy models list|show`.
