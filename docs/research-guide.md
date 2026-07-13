# Guide Recherche — Deep Research & SearXNG

`buddy research "<sujet>"` lance par défaut le **Wide Research**
(un ensemble d'items indépendants traité par vagues concurrentes, synthèse non
déterministe, pas de citations garanties). Ce guide couvre la suite **Deep Research**, opt-in via
`--deep` et ses trois extensions (`--iterations`, `--perspectives`/`--storm`,
`--ckg`), ainsi que **SearXNG** comme méta-moteur de recherche web privé.

Toute la suite Deep Research est **bornée** (nombre de sources, de tours, de
rounds — jamais un coût qui explose avec le sujet) et **jamais bloquante** :
chaque étage a un repli déterministe si le LLM ou un provider échoue.

## Quand utiliser quoi

| Besoin | Commande |
|---|---|
| Un tour d'horizon rapide, sans exigence de citations | `buddy research "<sujet>"` (Wide Research, comportement historique) |
| Un rapport **cité** (`[1]`, `[2]`… + section Références), déterministe | `buddy research --deep "<sujet>"` |
| Le rapport `--deep` mais avec une **boucle de comblement de lacunes** (plusieurs rounds de recherche) | `buddy research --deep --iterations 3 "<sujet>"` |
| Un article encyclopédique **multi-angles** (praticien/sceptique/historique/architecte…) avec plan et sections co-écrites | `buddy research --deep --perspectives 4 "<sujet>"` ou `--storm` |
| Faire profiter le run de la **mémoire collective** (CKG) du fleet, et l'enrichir en retour | ajouter `--ckg` (ou `CODEBUDDY_COLLECTIVE_MEMORY=true`) à n'importe laquelle des commandes `--deep` ci-dessus |
| Une recherche web sans clé API, auto-hébergée, privée | définir `SEARXNG_URL` avant d'appeler `buddy research` (n'importe quel mode) |

## Exemples de commandes

```bash
# Wide Research avec les valeurs par défaut (5 items / concurrence 5)
buddy research "tendances de l'IA générative en 2026"

# 120 angles au total, par vagues de 12 workers simultanés
buddy research "marché européen de la robotique" --wide --items 120 --concurrency 12

# Deep Research — Phase A : pipeline déterministe et cité
buddy research --deep "impact des LLM sur le développement logiciel"

# Phase B — boucle itérative de comblement de lacunes (2-5 rounds, ici 3)
buddy research --deep --iterations 3 "gouvernance de l'IA en Europe"

# Phase C — STORM multi-perspectives (N personas, ici 4 explicite)
buddy research --deep --perspectives 4 "faut-il réguler les agents autonomes ?"

# Alias du dessus avec le nombre de perspectives par défaut (4)
buddy research --deep --storm "histoire du calcul quantique"

# Phase D — pont vers la mémoire collective (CKG)
buddy research --deep --ckg "état de l'art du RAG hybride"

# SearXNG auto-hébergé, préféré en tête de chaîne quand défini
SEARXNG_URL=http://localhost:8888 buddy research --deep "..."

# Sauvegarder le rapport dans un fichier (fonctionne avec tous les modes)
buddy research --deep --iterations 2 "sujet" --report rapport.md
```

## Checkpoint et reprise du Wide Research

Le Wide Research parallèle peut enregistrer son état après la décomposition,
après chaque item terminé et à la fin de chaque vague :

```bash
# Nouvelle recherche durable
buddy research "robotique domestique" --wide --items 100 --concurrency 10 \
  --checkpoint .codebuddy/research/robot.json

# Reprise avec les mêmes sujet et options ; les workers déjà réussis ne repartent pas
buddy research "robotique domestique" --items 100 --concurrency 10 \
  --resume .codebuddy/research/robot.json

# Sortie machine : un seul document JSON sur stdout
buddy research "robotique domestique" --resume .codebuddy/research/robot.json --json

# Contexte transmis à chaque worker et modèle explicitement prioritaire
buddy research "robotique domestique" --wide --context "Privilégier mes notes locales" --model gemma-3
```

`--checkpoint` et `--resume` sont mutuellement exclusifs et concernent le Wide
Research (pas `--deep`/STORM). La reprise vérifie le sujet, le nombre total
d'items, la concurrence, les rounds, les timeouts et un fingerprint des paramètres d'exécution. En
cas de différence, elle s'arrête avant de lancer un worker et laisse le fichier
intact.

Le volume total `--items` est borné entre **1 et 250**. `--concurrency` est
borné entre **1 et 20**, et ne peut pas dépasser le nombre d'items. Par exemple,
`--items 250 --concurrency 10` produit 25 vagues au maximum. L'ancien
`--workers N` reste accepté comme raccourci compatible : il fixe les deux
valeurs au même nombre, avec son plafond historique de 20. Le nombre de rounds
vaut toujours au moins **1**. Une décomposition LLM vide ou trop courte est
complétée automatiquement : un run ne peut donc jamais être marqué terminé
avec zéro item.

Sans `--timeout-ms`, le délai global n'est plus figé à cinq minutes : il est
calculé à partir du nombre de vagues, du timeout par worker et des niveaux de
synthèse. La CLI affiche ce budget auto-calculé avant le départ. Un
`--timeout-ms` explicite reste prioritaire et n'est jamais agrandi en silence.
À l'expiration d'un worker, Code Buddy lui transmet une annulation coopérative
et conserve son slot jusqu'à sa terminaison effective. Une dépendance qui tarde
à s'arrêter ne permet donc ni à la vague suivante de dépasser `--concurrency`,
ni au rapport de revenir pendant que des agents fantômes continuent en arrière-plan.

La synthèse finale est elle aussi bornée. Code Buddy ne concatène pas 100 à
250 rapports dans un prompt unique : il regroupe les résultats par budget de
caractères et par fan-in, synthétise ces groupes par vagues, puis réduit les
résumés niveau par niveau jusqu'au rapport final. Un manifeste déterministe
liste chaque item réussi ou échoué. Si un résultat doit être tronqué dans un
prompt intermédiaire, le rapport le signale explicitement et sa version brute
reste entière dans le checkpoint, afin qu'une reprise puisse régénérer la
synthèse sans relancer les workers réussis.

`--checkpoint` refuse d'écraser un fichier qui n'est pas déjà un checkpoint
compatible. Si le checkpoint existe déjà, utilisez `--resume` ; pour un nouveau
run, choisissez un nouveau chemin.

Le checkpoint est un JSON versionné écrit par fichier temporaire puis renommage
atomique. Il contient le sujet, les options d'exécution non sensibles, les
sous-sujets, les résultats d'items, la taille des vagues et l'état du run. Il ne contient ni clé
API, ni en-têtes, ni configuration provider brute. Un chemin relatif est résolu
depuis le répertoire courant. Les checkpoints sont des états locaux de
confiance, privés (`0600` sous POSIX) et appartenant à l'utilisateur courant ;
un répertoire, une cible symbolique ou un chemin traversant un parent
symbolique est refusé. Le checkpoint et `--report` doivent désigner deux
fichiers réellement distincts : les alias canoniques et hardlinks sont aussi
détectés. En mode durable, le rapport crée ses répertoires parents et est lui
aussi remplacé atomiquement.

Les sorties de workers, erreurs, rapports, affichage humain et document JSON
sont filtrés avant exposition : clés connues, en-têtes `Bearer` et motifs de
credentials sont remplacés par `[REDACTED]`. Le JSON annonce `completed`,
`partial` ou `failed`, fournit les comptes explicites et `resumeAvailable`.
Un résultat partiel ou échoué termine avec un code de sortie **1**, tout en
laissant le checkpoint reprenable intact.

`--perspectives N` implique `--deep` et prime sur `--iterations` (chaque
perspective ne fait qu'un seul round de recherche, mais en parallèle des
autres). `--ckg` se greffe sur n'importe quelle combinaison des trois autres.

## Le pipeline Deep Research, étage par étage

### Phase A — pipeline de base (`--deep` seul)

Implémentation : `src/agent/deep-research.ts` (`runDeepResearchPipeline`).

1. **plan** — un appel LLM borné découpe la question en sous-questions
   (par défaut **4 max**), chacune avec des requêtes de recherche concrètes
   (par défaut **3 par sous-question**) ; repli déterministe si le LLM échoue
   ou renvoie un JSON invalide.
2. **collect** — fan-out déterministe : chaque requête → `web_search` (top
   **5** résultats), URLs dédupliquées, plafond global de **12 sources**,
   scraping en lots parallèles de **5**. Une source qui échoue au scraping
   est simplement abandonnée (jamais bloquant).
3. **dedup** — détection de quasi-doublons entre sources (normalisation →
   hachage par shingles de 4 mots → similarité de Jaccard, seuil **0.8**).
4. **cite** — un registre de sources `{id, url, title}` est propagé de la
   collecte à la synthèse ; le rapport porte des marqueurs `[n]` et une
   section `## Références` numérotée, **toujours rendue de façon
   déterministe** (jamais dépendante du LLM, même si la synthèse échoue).
5. **synthesize** — un appel LLM agrège les sources dédupliquées en un
   rapport structuré (TL;DR + une section par sous-question) ; repli
   déterministe (extraits cités bruts) si le LLM échoue.

### Phase B — boucle itérative (`--iterations N`)

Implémentation : `runDeepResearchLoop` (même fichier). `--iterations 1`
(la valeur par défaut) délègue **à l'identique** à la Phase A — le mécanisme
de lacunes n'est jamais sollicité. `--iterations N` (N ≥ 2, borné à **5**)
ajoute après le premier round : analyse de lacunes par LLM sur le brouillon
courant → nouvelles requêtes ciblées → nouveau fan-out → fusion dans le même
registre de citations (dédup par URL exacte **et** empreinte de contenu) →
resynthèse. La boucle s'arrête sur convergence (« suffisant »), gain marginal
nul, plafond cumulé de **50 sources**, ou échec de l'analyse de lacunes —
jamais sur un simple timeout silencieux.

### Phase C — STORM multi-perspectives (`--perspectives N` / `--storm`)

Implémentation : `src/agent/deep-research-storm.ts` (`runStormResearch`).
Inspiré de STORM (Stanford) : au lieu d'un seul point de vue, **N
perspectives diversifiées** (par défaut **4**, bornées **[2, 6]**) — dérivées
des angles des personas du council (`praticien`, `sceptique`, `architecte`,
`critique`, `stratège`…) plus un angle « historien / état de l'art »
signature de STORM — recherchent le sujet **en parallèle**, chacune via son
propre fan-out Phase A. Les sources sont fusionnées dans un registre de
citations partagé (plafond cumulé **40 sources**), puis un plan (table des
matières, jusqu'à **8 sections × 6 sous-sections**) est généré et chaque
section est **co-écrite en parallèle**, ancrée dans ses sources les plus
pertinentes. Si le plan échoue ou qu'aucune source n'a été collectée, le
pipeline se replie sur la synthèse plate de la Phase A — jamais d'échec sec.

### Phase D — pont mémoire collective (`--ckg`)

Implémentation : `src/agent/deep-research-ckg.ts`. Activé par `--ckg` **ou**
par `CODEBUDDY_COLLECTIVE_MEMORY=true` (même verrou que le reste de
l'injection CKG). Sans l'un des deux, le run est **strictement identique**
(pas de rappel, pas d'ingestion). Quand actif :

- **rappel** (lecture, en début de run) : jusqu'à **6** entrées (borné
  **[1, 20]**) déjà connues du collectif sont injectées dans le rapport, dans
  une section distincte `## Mémoire collective` avec sa propre numérotation
  `[Mk]` — jamais mélangée aux citations web `[n]`.
- **ingestion** (écriture, en fin de run) : les sources web dédupliquées du
  run sont ingérées dans le graphe comme nœuds `discovery` (idempotent —
  dédup par hash de contenu côté CKG, donc relancer la même recherche
  renforce la connaissance existante plutôt que de la dupliquer).

## Ce que contient le rapport

Tout rapport Deep Research (Phase A/B/C, avec ou sans D) suit la même forme :

1. Un `## TL;DR` de 2 à 4 phrases.
2. Le corps : une section par sous-question (Phase A/B) ou par section du
   plan avec table des matières (Phase C/STORM) — chaque affirmation non
   triviale porte une citation `[n]`.
3. `## Mémoire collective` (uniquement avec `--ckg`, citations `[Mk]`),
   placée juste avant les Références.
4. `## Références` — la liste numérotée `[n] Titre — URL`, toujours rendue
   déterministe à partir du registre de sources.

Quand le rapport est sauvegardé (`--report fichier.md`), un en-tête de
métadonnées précède le contenu : mode (`deep` / `deep (STORM
multi-perspective)`), nombre de sources et de doublons écartés, nombre de
rounds (Phase B), perspectives (Phase C), rappels/ingestions CKG (Phase D),
et si le planner/la synthèse ont utilisé le LLM ou le repli déterministe.

## Clés d'API qui améliorent la recherche

`buddy research --deep` (et Wide Research) s'appuient sur le `web_search`
intégré (`src/tools/web-search.ts`), qui essaie les providers dans cet ordre
(mode auto) :

```
SearXNG (si SEARXNG_URL défini) → Brave MCP → Brave API → Perplexity → Serper → DuckDuckGo
```

| Variable | Effet |
|---|---|
| `BRAVE_API_KEY` | Recherche indexée Brave — la plus fiable, utilisée directement par `web_search` |
| `PERPLEXITY_API_KEY` (ou `OPENROUTER_API_KEY`) | Recherche IA Perplexity, utilisée directement par `web_search` |
| `SERPER_API_KEY` | Google via Serper, utilisée directement par `web_search` |
| `FIRECRAWL_API_KEY` | Améliore le **scraping** des sources collectées (sinon repli sur un fetch simple) |
| `EXA_API_KEY` | Active un **serveur MCP Exa** séparé (`src/mcp/config.ts`) — un chemin distinct du `web_search` intégré, pas un fallback de la même chaîne |
| — (aucune clé) | `DuckDuckGo` (public, sans clé) ou `SearXNG` (auto-hébergé, sans clé — voir ci-dessous) |

Sans aucune clé, la recherche fonctionne quand même (DuckDuckGo), mais avec
moins de rappel/fraîcheur que Brave ou Perplexity.

## SearXNG — méta-moteur privé, sans clé

`SEARXNG_URL` pointe vers une instance [SearXNG](https://docs.searxng.org/)
auto-hébergée (méta-moteur agrégeant plusieurs sources, sans clé API,
respectueux de la vie privée — cohérent avec la philosophie « local d'abord »
de Code Buddy). Quand elle est définie, SearXNG passe **en tête** de la
chaîne de providers de `web_search` ; absente, elle n'est jamais essayée et
le comportement reste identique à l'historique.

```bash
# Exemple : lancer une instance SearXNG locale (docker), puis pointer dessus
docker run -d --name searxng -p 8888:8080 searxng/searxng

SEARXNG_URL=http://localhost:8888 buddy research --deep "mon sujet"
```

L'implémentation interroge `{SEARXNG_URL}/search?format=json` et mappe
`results[]` (`title`/`url`/`content`) vers le format interne. L'URL n'est
volontairement **pas** passée par le garde-fou SSRF (elle est traitée comme
un endpoint de confiance configuré par l'opérateur, au même titre que
`OLLAMA_HOST`) — il suffit qu'elle soit une URL http(s) bien formée, sinon le
provider est désactivé avec un avertissement (jamais un crash).

## QA scientifique (PaperQA2) — en construction

Une direction distincte de Deep Research : au lieu de synthétiser depuis le
web, **interroger un corpus de documents** (PDF scientifiques) avec des
réponses ancrées dans des passages précis. Inspirée de
[PaperQA2](https://arxiv.org/abs/2409.13740).

**État réel (2026-07) : fondation posée, pas encore utilisable.** Seule la
**Phase 1** est livrée (`src/research/paper-qa/`) : un parseur PDF structurel
et un chunker de prose qui découpent un document en passages **avec
provenance réelle** (page, section, offset) — sans aucun appel LLM ni réseau.
Ce que ça permet aujourd'hui : rien de directement pilotable en CLI ou par
l'agent — c'est une brique interne.

Ce qui **manque encore** (Phases 2 à 4, non livrées) : un index des passages
(embeddings), un mécanisme de réponse ancrée (citation systématique du
passage source), et surtout un **tool/CLI pour interroger un corpus** — donc
à ce jour, il n'existe **aucune commande `buddy` pour poser une question à
un ensemble de PDF**. Ne pas confondre avec `buddy research ingest|recall`
(le pont CKG déjà opérationnel, qui ingère des publications découvertes sur
le web dans le graphe de connaissances collectif — un mécanisme différent et
déjà utilisable).
