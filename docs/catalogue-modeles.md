# Catalogue de modèles

Les identifiants et les capacités des modèles changent souvent. On les règle dans la configuration TOML déjà utilisée par Code Buddy, pas dans le code source.

Fichier lu :

- `CODEBUDDY_CONFIG` s'il est posé
- sinon `$CODEBUDDY_HOME/config.toml`, ou `~/.codebuddy/config.toml` si `CODEBUDDY_HOME` n'est pas posée

Au démarrage d'une session, `.codebuddy/config.toml` du répertoire courant est ajouté par-dessus ce fichier lorsqu'il existe. Les clés du projet gagnent. `buddy models --config <fichier>` lit exactement ce fichier, sans ouvrir un autre profil.

Un profil nommé s'active avec `buddy --profile <nom>`. Il ne crée pas un second format : c'est une table `[profiles.<nom>]` du même fichier.

## Ordre de priorité

Pour le modèle effectivement utilisé :

1. l'option `--model` de la ligne de commande
2. la variable `CODEBUDDY_MODEL`, puis la variable historique `GROK_MODEL`
3. `active_model` du profil demandé
4. le rôle `primary` ou `active_model` de la configuration
5. l'identifiant publié par le fournisseur lors d'une découverte
6. le catalogue intégré au logiciel

Une valeur vide est ignorée. Une valeur présente n'est jamais remplacée en silence par une autre. Si le nom fixé dans la configuration est inconnu, Code Buddy s'arrête et affiche `Configuration de modèle invalide`. Il n'utilise pas un autre modèle à la place.

`CODEBUDDY_MAX_CONTEXT` reste un plafond explicite de fenêtre de contexte. Il gagne sur la fiche, la découverte et le catalogue intégré.

## Fusion avec le catalogue intégré

`[catalogue] mode = "merge"` est le défaut. Une entrée `[models.<nom>]` ne remplace que les champs qu'elle écrit. Le fournisseur, le prix, la vision ou les outils déjà connus restent en place.

`mode = "replace"` est volontaire : le catalogue intégré n'est plus complété. Il faut alors déclarer chaque modèle utilisé.

Les rôles sont indépendants du catalogue :

- `primary` : modèle principal (équivalent de `active_model`)
- `fast` ou `compact` : modèle court, pour une tâche rapide
- `vision` : modèle qui accepte une image

Les alias de `[model_aliases]` s'ajoutent à ceux du logiciel. Un alias utilisateur de même nom gagne.

## Découverte de la fenêtre de contexte

Quand le fournisseur le permet, Code Buddy interroge :

- Ollama : `POST /api/show`
- un serveur compatible OpenAI : `GET /v1/models` (`context_length` ou `max_model_len`)

Le résultat est écrit dans `context-length-cache.json`, à côté du fichier de configuration, ou à l'endroit donné par `--cache`. La durée de vie est `context_cache_ttl_seconds` (défaut : 3600). Une entrée périmée n'est pas réutilisée. Si le fournisseur ne répond pas, la découverte échoue avec un message clair et n'invente pas une fenêtre.

```bash
buddy models list --config ./config.toml
buddy models show exemple-principal --config ./config.toml
buddy models refresh --config ./config.toml --cache ./context-length-cache.json \
  --provider ollama --base-url http://127.0.0.1:11434 --model exemple-principal
```

`refresh` n'écrit le cache que si `--cache` ou `--config` est donné.

## Exemple complet

Aucune clé n'est écrite ici. `EXEMPLE_API_KEY` est le nom d'une variable d'environnement, pas sa valeur. L'adresse est locale.

```toml
[catalogue]
mode = "merge"
context_cache_ttl_seconds = 3600

[model_roles]
primary = "exemple-principal"
fast = "exemple-rapide"
compact = "exemple-rapide"
vision = "exemple-vision"

[model_aliases]
best = "exemple-principal"

[models.exemple-principal]
provider = "openai"
model_id = "exemple-principal"
price_per_m_input = 0
price_per_m_output = 0
max_context_tokens = 128000
reasoning = true
vision = false
tools = true
input = ["text"]

[models.exemple-rapide]
provider = "openai"
model_id = "exemple-rapide"
price_per_m_input = 0
price_per_m_output = 0
max_context_tokens = 32000
reasoning = false
vision = false
tools = true
input = ["text"]

[models.exemple-vision]
provider = "openai"
model_id = "exemple-vision"
price_per_m_input = 0
price_per_m_output = 0
max_context_tokens = 128000
reasoning = false
vision = true
tools = true
input = ["text", "image"]

# Le modèle intégré grok-4 garde son fournisseur et ses prix.
# Seule la fenêtre est surchargée.
[models.grok-4]
max_context_tokens = 128000

[profiles.rapide]
active_model = "exemple-rapide"

[providers.local]
base_url = "http://127.0.0.1:11434"
api_key_env = "EXEMPLE_API_KEY"
type = "custom"
enabled = true
```

Lancer une session avec ce profil :

```bash
buddy --profile rapide --model exemple-rapide
```

Sans `--model`, le profil choisit `exemple-rapide`. Sans profil, le rôle `primary` choisit `exemple-principal`.
