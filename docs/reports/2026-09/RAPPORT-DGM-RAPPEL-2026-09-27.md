# Rappel des articles pour la DGM — 27 septembre 2026

> **Mesure invalidée pour la production.** La relecture indépendante a montré que les requêtes ci-dessous provenaient des articles visés et différaient des descriptions réellement envoyées par la DGM. Le « avant » ci-dessous n'était pas non plus le chemin de production. Ces chiffres restent archivés comme expérience exploratoire ; la reprise et la mesure corrigée sont dans `RAPPORT-DGM-RAPPEL-REPRISE-2026-09-27.md`. La commande de banc documentée ci-dessous appartient à l'ancienne version du script et ne fonctionne plus.

Chantier en cours sur `sol/dgm-rappel-hybride-2026-09-27`, départ `8a2891851`.

Le rapport de livraison et les mesures détaillées sont remis dans le répertoire de partage convenu. Les données de jugement et la copie du registre CKG restent hors du dépôt public.

## Reproduction

Le banc est `scripts/dgm-relevance-benchmark.ts`; ses 20 besoins sont dans `tests/fixtures/dgm-relevance-20.json`. Il exige une copie explicite du registre et du JSONL des jugements ; il ne lit jamais le profil CKG par défaut. Exemple avec des chemins locaux choisis par l'opérateur :

```bash
CODEBUDDY_CKG_ENGINE=ts npx tsx scripts/dgm-relevance-benchmark.ts \
  --ledger <copie-du-registre.jsonl> --judgments <jugements.jsonl> \
  --output <mesures.json> --hybrid
```

`--hyde <hypotheses.json>` ajoute la variante HyDE ; les hypothèses se génèrent avec `python3 scripts/dgm-hyde-local.py --output <hypotheses.json>` lorsqu'Ollama est disponible localement. Le banc contrôle l'alignement de la fixture et des 122 jugements du pilote, garde les listes complètes de candidats et enregistre les empreintes SHA-256 des deux entrées. Les IC à 95 % proviennent de 4 000 rééchantillonnages des 20 requêtes avec graine fixe `20260927`. Précision@5 : cinq places au dénominateur ; rappel@20 et nDCG@10 : macro-moyennes sur les 18 requêtes ayant au moins un positif. Les deux requêtes sans positif y sont indéfinies et restent dans la précision.

Les étiquettes positives sont `annotation_sol_titre`, produites par Sol à partir des titres ; elles ne sont pas une vérité humaine indépendante. Les 80 autres lignes du JSONL évaluent des objectifs et leur porte, sans étiquette de pertinence d'article. Les variantes ont été choisies sur les mêmes 20 besoins ; les intervalles décrivent la variabilité entre besoins de ce pilote et ne constituent pas une validation tenue à l'écart.

Le comportement est réversible par `CODEBUDDY_DGM_RESEARCH_RETRIEVAL=legacy`, `CODEBUDDY_DGM_RESEARCH_FILTER=legacy` et `CODEBUDDY_DGM_RESEARCH_QUERY=component` (ou les options équivalentes de `fetchResearchGoals`). HyDE reste une expérience de banc et n'est pas appelé dans le chemin de production.

## Mesures du pilote

| Variante | Précision@5 (IC 95 %) | Rappel@20 (IC 95 %) | nDCG@10 (IC 95 %) | Trouvés sur 42 |
|---|---:|---:|---:|---:|
| Référence, seuil 0,32 | 0,090 [0,040 ; 0,150] | 0,546 [0,361 ; 0,725] | 0,206 [0,101 ; 0,320] | 23 |
| Sans seuil | 0,090 [0,040 ; 0,150] | 0,574 [0,398 ; 0,745] | 0,206 [0,101 ; 0,320] | 24 |
| BM25 + embeddings, RRF | 0,190 [0,130 ; 0,260] | 0,713 [0,558 ; 0,851] | 0,463 [0,329 ; 0,601] | 30 |
| RRF + description répétée | 0,190 [0,130 ; 0,260] | 0,676 [0,519 ; 0,815] | 0,430 [0,313 ; 0,542] | 28 |
| RRF + HyDE local | 0,170 [0,100 ; 0,240] | 0,704 [0,525 ; 0,861] | 0,338 [0,226 ; 0,444] | 29 |

Le seuil retiré et le RRF simple sont retenus. La description répétée et HyDE restent des variantes d'essai, car elles font moins bien que le RRF simple sur ce pilote. Un appel direct de `fetchResearchGoals` avec un profil CKG temporaire et une réponse de synthèse injectée a produit un objectif de recherche pour `voice-loop` (1 objectif, sortie processus 0). Les tests ciblés : 2 fichiers, 16 tests verts ; `npx tsc --noEmit` et ESLint ciblé : 0 erreur. Windows, moteur Rust, qualité des objectifs et jeu de jugement humain tenu à l'écart non vérifiés.
