# Choisir les fournisseurs, modèles, rôles et replis

Les choix de session existants restent prioritaires : `--model`, alias, profil
TOML, choix utilisateur et modèle sauvegardé. Les défauts des consommateurs
proviennent de `src/config/model-defaults.ts`, avec surcharge par fournisseur.

Dans `~/.codebuddy/config.toml` ou `.codebuddy/config.toml` :

```toml
[model_defaults.xai]
primary = "grok-4.7"
fast = "grok-4.7-build-fast"
review = "grok-4.7"
architect = "grok-4.7"
fallback = ["grok-4.6"]
models = ["grok-4.7", "grok-4.6"]

[profiles.revue.model_defaults.xai]
review = "grok-4.6"
```

Les tables du projet gagnent champ par champ sur celles de l'utilisateur.
`--profile revue` applique ensuite le profil. `models` remplace la liste hors
ligne proposée pour ce fournisseur ; le principal reste inclus. La découverte
réussie d'un fournisseur fournit ses modèles réellement disponibles.

Les clés de fournisseur sont `xai`, `chatgpt` (OAuth), `openai` (API),
`anthropic`, `google`, `ollama`, `lmstudio`, `mistral`, `deepseek`, `lemonade`
`openrouter`, `azure`, `bedrock`, `groq` et `fal` (vidéo). Chaque modèle doit être compatible avec le fournisseur qui
l'exécute. Pour changer le fournisseur de la session, utiliser les réglages
existants `CODEBUDDY_PROVIDER`, un profil avec `baseURL`/`model`, ou un alias :

```toml
[model_roles]
primary = "principal"

[model_aliases.principal]
provider = "grok"
model = "grok-4.7"
```

Les variables du fournisseur (`GROK_MODEL` ou `XAI_MODEL`, `CHATGPT_MODEL`,
`OPENAI_MODEL`, `GEMINI_MODEL`, etc.) surchargent son principal TOML.
`CODEBUDDY_XAI_MODEL_REVIEW` surcharge le rôle `review` ; le même patron
`CODEBUDDY_<FOURNISSEUR>_MODEL_<ROLE>` s'applique aux autres rôles.
Les rôles sans défaut spécialisé héritent du principal. Les rôles `fast`,
`reasoning`, `architect`, `quality` et `review` ont des défauts intégrés.
Les sous-agents utilisent aussi `coding`, `testing`, `debug`, `exploration`,
`refactoring` et `docs`. Les options explicites de leurs appels restent prioritaires. Les rôles locaux
`onboarding` (installation par doctor) et `hint` (indication de pull) se règlent
de la même façon.

Les rôles spécialisés (`embedding`, `transcription`, `speech`, `image`, `video`,
`tokenizer`, modèles locaux et encodeurs de médias) conservent un défaut adapté
à leur protocole : changer le modèle de chat ne choisit pas un modèle audio.
Leur rôle TOML ou leur variable dédiée peut les remplacer. Les variables
spécifiques déjà proposées par les outils média restent prioritaires.

`CODEBUDDY_XAI_FALLBACK_MODELS="modele-a,modele-b"` surcharge la liste TOML
`fallback`. Ces listes alimentent `ModelFailoverChain` ; les chemins de
compatibilité ChatGPT et Gemini utilisent leurs listes de fournisseur. Avec un
catalogue ChatGPT disponible, une liste explicite conserve son ordre et seuls
les modèles proposés par le compte sont retenus ; une liste vide désactive les
replis de modèle.
Pour le repli **entre fournisseurs du moteur principal**, utiliser le mécanisme
existant, activé explicitement :

```sh
CODEBUDDY_PROVIDER_FALLBACK=true
CODEBUDDY_FALLBACK_CHAIN="grok:grok-4.7>openai:gpt-4o>ollama:mon-modele-local"
```

Les rôles par fournisseur ne constituent pas une route automatique entre
fournisseurs : un rôle xAI ne doit pas désigner un modèle OpenAI.

## Catalogue ChatGPT

La version annoncée au catalogue Codex est `0.159.0`.
`CODEBUDDY_CODEX_CLIENT_VERSION` la remplace lors de la création du client.
Le catalogue du compte reste déterminant : `buddy --list-models` affiche les
modèles visibles servis par le backend, dont GPT-6.1 Sol lorsqu'il est proposé.
Sans connexion ou lorsque la découverte échoue, la liste retombe sur le défaut
configuré. Le défaut intégré reste `gpt-6-sol`.

## Fenêtres de contexte

Les capacités restent dans `src/config/model-tools.ts`, surchargeables via le
catalogue TOML existant. Grok 4.7 API utilise 500 000 jetons ; Build Fast utilise
la limite CLI de 256 000. Le motif des modèles API Fast à 2 millions de jetons
ne s'applique plus à Build Fast. GPT-6.1 hérite de la fenêtre OAuth de 272 000
jetons, avec le plafond de sortie historique de la famille (non mesuré ici).
