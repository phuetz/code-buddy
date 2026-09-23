# Catalogue de modèles

On règle une partie des modèles dans le TOML déjà utilisé par Code Buddy. Cette page décrit uniquement ce que cette version applique vraiment. Le reste du logiciel garde ses catalogues écrits dans le code.

## Fichier lu

Le lecteur du catalogue, le préchargement de `--profile` et l'écriture de `/config set` passent par la même fonction, `resolveUserConfigFile` :

- `CODEBUDDY_CONFIG` s'il est posé (chemin complet du fichier)
- sinon `$CODEBUDDY_HOME/.codebuddy/config.toml` si `CODEBUDDY_HOME` est posée
- sinon `~/.codebuddy/config.toml`

Au démarrage d'une session, `.codebuddy/config.toml` du répertoire courant est analysé à part, puis fusionné par-dessus le fichier précédent. Les valeurs du projet gagnent, champ par champ. `buddy models --config <fichier>` lit exactement ce fichier.

Un profil nommé s'active avec `buddy --profile <nom>`. `core` et `all` sont intégrés : ils n'ont pas besoin d'être recopiés dans le fichier, et ils ne choisissent pas de modèle. Un profil du fichier peut n'avoir aucun `active_model` : la session démarre quand même.

## Ordre réel au démarrage

`loadModel` appelle `resolveStartupModel`. Le premier niveau non vide gagne :

1. `--model` (ou `-m`)
2. `CODEBUDDY_MODEL`, puis `GROK_MODEL`
3. `active_model` du profil demandé, s'il en a un
4. `[model_roles] primary`, ou `active_model` s'il est différent de la valeur du fichier généré
5. le modèle sauvé dans les réglages, s'il est compatible avec le fournisseur détecté
6. le modèle par défaut du fournisseur détecté

Le fichier généré contient `active_model = "grok-code-fast"`. Cette valeur ne masque pas le fournisseur détecté. Pour forcer ce modèle, passez `--model`, `CODEBUDDY_MODEL`, ou `[model_roles] primary`.

Si le fournisseur détecté est Ollama et qu'aucun des niveaux 1 à 4 n'est rempli, la sonde historique des modèles installés s'applique encore. `OLLAMA_MODEL`, s'il est posé et absent du serveur, n'est pas remplacé par un autre tag.

Une valeur vide est ignorée. Un nom fixé dans la configuration et inconnu du catalogue arrête la session avec `Configuration de modèle invalide`. Aucun autre modèle n'est mis à la place. Un modèle sauvé incompatible avec le fournisseur détecté est ignoré : c'est le comportement historique, le modèle par défaut du fournisseur est alors utilisé.

`CODEBUDDY_MAX_CONTEXT` reste un plafond de fenêtre. Il gagne sur la fiche.

## Ce qu'une entrée de modèle change

`[catalogue] mode = "merge"` est le seul mode. Il est aussi le défaut. Une entrée `[models.<nom>]` ne remplace que les champs qu'elle écrit, et seulement chez les consommateurs suivants :

- `max_context_tokens` (ou `context_window`), `max_tokens` (ou `max_output_tokens`), `reasoning`, `vision`, `tools`, `input` : lus par `getModelToolConfig` au démarrage de la session
- `price_per_m_input` et `price_per_m_output`, écrits ensemble : lus par `getModelPricing`

`provider` reste une colonne historique de la table. Cette version ne s'en sert pas pour choisir le fournisseur de la session. `model_id` écrit dans une entrée `[models.*]` est refusé, sauf s'il répète exactement l'identifiant déjà intégré pour ce nom (les fichiers générés le font, et cela ne change pas le nom envoyé). Pour choisir un modèle, utilisez le nom de la table, un alias ou `primary`. `buddy models show` n'affiche ni `provider` ni `model_id`.

`[model_roles]` ne lit que `primary`. `[model_aliases]` résout ce nom au moment du choix ci-dessus et dans `buddy models show`. La cible doit être un modèle connu, sinon la configuration est refusée. Ces alias ne s'ajoutent pas à `/switch`.

`/config set` réécrit le fichier résolu ci-dessus, sans effacer `[catalogue]`, `[model_roles]`, `[model_aliases]`, les capacités des `[models.*]`, ni les `[profiles.*]`.

## Ce que cette version ne fait pas

- pas de `mode = "replace"`
- pas de rôles `fast`, `compact` ou `vision`
- pas de `buddy models refresh`, pas de cache JSON de fenêtre de contexte
- pas de nouvelle découverte réseau ajoutée par ce catalogue pour choisir un identifiant ou une fenêtre. La sonde Ollama déjà en place reste : si ce fournisseur est détecté et qu'aucun des niveaux 1 à 4 n'est rempli, elle peut encore choisir un modèle installé

```bash
buddy models list --config ./config.toml
buddy models show grok-4 --config ./config.toml
```

## Exemple

Aucune clé secrète. Les adresses ne sont pas nécessaires ici : le fournisseur de la session reste celui qui est détecté.

```toml
[catalogue]
mode = "merge"

[model_roles]
primary = "exemple-principal"

[model_aliases]
best = "exemple-principal"

[models.exemple-principal]
max_context_tokens = 128000
max_tokens = 8192
reasoning = true
vision = false
tools = true
input = ["text"]
price_per_m_input = 0
price_per_m_output = 0

[models.exemple-rapide]
max_context_tokens = 32000
reasoning = false
vision = false
tools = true

[models.grok-4]
max_context_tokens = 128000

[profiles.rapide]
active_model = "exemple-rapide"
```

Sans `--model` ni variable d'environnement, `buddy --profile rapide` utilise `exemple-rapide`. Sans profil, `primary` choisit `exemple-principal`.
