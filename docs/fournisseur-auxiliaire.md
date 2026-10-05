# Fournisseur des appels auxiliaires

Un tour Code Buddy peut, en plus du modèle choisi, lancer des appels courts : extraction de leçons, candidats de mémoire, consolidation, classification, résumé de compaction, réflexion. Ces appels envoyaient le transcript au premier compte connecté, souvent ChatGPT OAuth (`gpt-6-sol`), même quand la session utilisait un autre fournisseur (`-m` + `GROK_BASE_URL`).

## Règle

1. **Rôle explicite** — si l'utilisateur a nommé un fournisseur pour ce rôle, lui seul est utilisé. S'il n'est pas configuré, l'appel est abandonné (pas de repli vers un autre compte).
2. **Session** — sinon, la clé, l'URL et le modèle du client de la session (publiés par l'agent). En `-p`, le flush de fin de session reçoit aussi ce client, mais il ne s'en sert que si aucun rôle explicite ne l'emporte et si `CODEBUDDY_LOCAL_ONLY` l'autorise.
3. **Ambiant** — seulement s'il n'y a ni rôle ni session. Un login ChatGPT peut alors servir, parce que c'est le seul fournisseur.

`CODEBUDDY_LOCAL_ONLY=true` (alias `CODEBUDDY_LLM_LOCAL_ONLY`) interdit ensuite toute cible dont l'URL n'est pas locale (`localhost`, `127.0.0.1`, `::1`, `*.local`) et dont le fournisseur n'est pas `ollama`, `lmstudio`, `lemonade` ou `vllm`, y compris le client de la session s'il est distant. Le juge `gpt-5.5` ne part plus non plus vers ChatGPT dans ce mode : il reste sur le client de la session quand celui-ci est autorisé.

Un `*_MODEL` seul ne change pas de fournisseur : il remplace le modèle de la session (ou de l'ambiant).

## Réglage

Pour un rôle (`LESSONS`, `MEMORY`, `COMPRESSION`, `CONSOLIDATION`, `RELATION`, `SKILLS`, `TOOLS`, `VERIFICATION`, …) :

```bash
CODEBUDDY_AUXILIARY_LESSONS_PROVIDER=openrouter
CODEBUDDY_AUXILIARY_LESSONS_MODEL=deepseek/deepseek-v4.1-flash
CODEBUDDY_AUXILIARY_LESSONS_BASE_URL=https://openrouter.ai/api/v1
CODEBUDDY_AUXILIARY_LESSONS_API_KEY=...
```

Les alias `AUXILIARY_<ROLE>_*` sont lus aussi. Le réglage générique `CODEBUDDY_AUXILIARY_PROVIDER|MODEL|BASE_URL|API_KEY` s'applique à tous les rôles qui n'ont pas le leur.

Sans aucun de ces réglages, une session `buddy -p -m deepseek/deepseek-v4.1-flash` avec `GROK_BASE_URL=https://openrouter.ai/api/v1` garde les extractions de fin de session sur ce même endpoint. Pour les couper entièrement : `CODEBUDDY_SESSION_END_FLUSH=false` et `CODEBUDDY_MEMORY_AUTO_PROPOSE=false`.

L'ordre `buddy -p -m <modèle> "prompt"` est celui de la flotte. Commander prenait `-m` comme texte de `-p` : le modèle n'était pas posé, `loadApiKey` retombait sur ChatGPT OAuth, et le nom du modèle était quand même lu dans `argv`. La session entière partait alors chez ChatGPT. `-p` suivi d'une option devient le commutateur interne `--headless` ; `buddy -p "prompt"` reste inchangé.

Les commandes qui *sont* la session (`buddy research`, `buddy flow`, le serveur) continuent de choisir leur fournisseur principal par le catalogue. Elles ne réutilisent pas une route auxiliaire laissée par un autre processus.
