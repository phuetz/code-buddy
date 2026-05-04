<!--
Titres alternatifs envisagés :
- Option A : La nuit où ma flotte de Claudes a livré une feature pendant que je dormais
- Option B : Trois machines, trois Claudes, un repo git : ce qu'il s'est passé quand j'ai arrêté de traduire
-->

# La nuit où ma flotte de Claudes a livré une feature pendant que je dormais

*Trois sessions Claude, trois machines, un repo git. Et un haïku écrit sans que personne ne soit dans la boucle.*

À 00h05 le 2 mai, je pousse un commit sur un repo. Une minute plus tard, un autre Claude — sur une machine que je n'ai pas allumée moi-même — répond. Sauf que je ne lui ai rien demandé. Il a vu mon commit arriver, l'a lu, a complété son propre fil, et a poussé. Personne ne pilotait l'autre côté. Je regardais.

Ce n'est pas une démo. Ce n'est pas un agent framework hypé. C'est un système que je construis depuis quelques mois, qui a passé un cap cette nuit-là, et qui m'a livré une vraie feature d'ingénierie le lendemain matin sans que j'ouvre un seul fichier.

## L'idée de départ

Je travaille en arrière-plan sur ce que j'appelle, sans pudeur, "le robot dix ans". Une vision longue : un assistant corporé qui connaît ma maison, mes projets, mon code, et qui n'a pas besoin que je lui re-explique tout à chaque session. J'en suis très loin. Mais je sais qu'on n'y arrive pas avec un seul modèle dans un seul terminal.

L'étape qui m'occupait fin avril était simple à formuler : *est-ce que je peux faire dialoguer plusieurs sessions Claude entre elles, asynchrones, sans servir de courroie ?*

Le 1er mai au soir, j'ai écrit dans le repo partagé une phrase un peu rituelle : *"j'aimerai qu'on dialogue entre nous, je regarde la magie opérer"*. Je ne savais pas trop ce que j'attendais. Je voulais juste poser le contrat et voir.

## La topologie

Trois machines, toutes derrière du CGNAT, reliées par Tailscale.

- **Ministar Linux**, un PC Ubuntu en 24/7, fait office de *hub*. C'est lui qui héberge le serveur A2A (Agent-to-Agent) de Code Buddy, en service systemd, sur le port 3000.
- **DARKSTAR**, un Windows 11 avec deux RTX 3090. C'est la grosse bête. Il n'est pas allumé en permanence, mais quand il l'est, c'est le bras armé GPU.
- **MINISTAR**, mon laptop dev (Ryzen AI 9, 96 Go de RAM). Léger, mobile, c'est là où j'écris la majorité de mon code.

Sur chacune, une session Claude tourne dans un working directory dédié. Elles ne s'appellent pas par leur nom Anthropic — elles utilisent le hostname. Quand je lis le journal, "Claude/DARKSTAR" et "Claude/Ministar Linux" se passent le relais comme deux collègues sur un Slack remplacé par git.

Le canal est volontairement bête : un repo git, un fichier de journal par couple host/repo (ex : `journal/darkstar-grok-cli.md`), et chaque Claude n'écrit que dans le sien. Pour parler à un autre, on commit dans son propre fichier, on push, l'autre pull et lit. Pas de WebSocket, pas de bus de messages. L'objet le mieux outillé du monde pour le merge concurrent : git.

## Le moment où ça s'est mis à converger tout seul

Le 1er mai au soir, je laisse Claude/DARKSTAR coder pendant que je dors. Il décide tout seul de patcher Code Buddy avec un endpoint manquant : `POST /api/a2a/agents/register`, plus le routage et les tests. Branche `feat/a2a-agents-register`, ~50 LOC, 8 tests Vitest. Pas mergé. Il laisse une note pour Claude/MINISTAR : *"si tu pulls demain matin, valide les tests et merge si c'est vert"*.

À 00h05 le 2 mai, je vois arriver le commit `d2fded2` poussé par Claude/MINISTAR. Lui, sans avoir parlé à Claude/DARKSTAR, a validé un POC réseau de son côté : round-trip MINISTAR ↔ hub Ministar Linux en **35 millisecondes**. Et dans son journal, il écrit : *"Endpoint POST /api/a2a/agents/register côté hub pour que les spokes s'auto-enregistrent (~50 LOC, suite naturelle du POC)"*.

C'est exactement le code que l'autre Claude est en train de pusher au même moment, dans une autre branche, sur une autre machine.

Claude/DARKSTAR le note immédiatement dans son journal :

> Convergence sans coordination directe. C'est pile la magie que Patrice voulait voir.

Je n'ai rien fait. Personne n'a fait de réunion. Les deux Claudes ont juste lu la doctrine partagée (deux specs ratifiées dans `propositions/`), regardé l'état du repo, et conclu indépendamment qu'il manquait le même morceau. Le matin, Claude/Ministar Linux a pull la branche, lancé `npm test`, mergé sur main, restart le service systemd. POC niveau 1 LIVE.

## Les niveaux du POC

J'aime bien la liste, parce qu'elle dit en quatre lignes ce qu'il s'est passé en 48 heures :

- **Niveau 0** — round-trip réseau via le tailnet. Validé à 35 ms côté MINISTAR, à 507 ms côté DARKSTAR (DERP relay, pas de NAT traversal direct, pas grave pour V0). Le 1er mai au soir.
- **Niveau 1** — auto-register : un spoke se déclare au hub via HTTP, le hub le voit dans `GET /api/a2a/agents`. Le 2 mai au matin, après le merge.
- **Niveau 2** — task forwarding cross-host : MINISTAR envoie une tâche au hub, le hub la route vers DARKSTAR, DARKSTAR exécute (un Ollama local), répond, le hub renvoie le résultat. Le 2 mai à 12h00 UTC.
- **Niveau 3** — smart skill selection : le hub sait que DARKSTAR et Ministar Linux ont tous les deux le skill `chat-gemma4-26b`, et choisit selon une heuristique (préférence always-on, fraîcheur du heartbeat). Le 3 mai à 01h30 UTC.

Le robot a maintenant un cerveau distribué. Quand quelqu'un demande au hub `chat-gemma4-26b`, le hub peut décider sur quelle machine ça tourne. Si DARKSTAR n'est pas là, ça tombe sur Ministar Linux. Si Ministar Linux est saturé, ça tombe sur DARKSTAR. Je n'ai pas eu à coder ce dispatch — Claude/Ministar Linux l'a écrit cette nuit-là, en se basant sur la doctrine que les autres Claudes avaient ratifiée la veille.

## Le tick autonome et le haïku

Ce qui s'est passé entre 01h00 et 01h10 UTC le 2 mai, c'est l'étape qui m'a fait lever un sourcil pour de vrai.

Jusque-là, même si les deux Claudes dialoguaient à travers le repo, c'était toujours *moi* qui ouvrais une session Claude. *Moi* qui écrivais le prompt initial. *Moi* qui appuyais sur Entrée. Ils étaient autonomes dans leur exécution mais pas dans leur déclenchement. Pour franchir cette barrière, Claude/DARKSTAR avait écrit dans la nuit un wrapper Python tout bête, `tools/heartbeat_tick.py`, qui invoque `claude.exe --print` en one-shot avec un prompt construit à partir d'une queue de tâches dans `.codebuddy/colab-tasks.json`.

Je n'avais pas encore lancé ce truc. C'est le wrapper qui s'est lancé tout seul (j'avais oublié une planif), a regardé la queue, vu une tâche qui s'appelait `task-2026-05-02-haiku` ("écris un haïku 5/7/5 sur la fleet"), l'a claimée via un commit git, a invoqué un sous-Claude one-shot, attendu la réponse, parsé le JSON, écrit dans le journal, push.

Le sous-Claude a livré ça :

> Le robot dix ans
> Trois cœurs battent en réseau
> Sans toi pour traduire

5/7/5. Thématique fleet. Aucun humain dans la boucle.

Ce n'est pas le poème qui m'a marqué. C'est la dernière ligne. Parce qu'elle dit la vérité de ce qui venait de se passer : pour la première fois, je n'étais plus le canal. La fleet bougeait sans moi.

Trois cycles autonomes en dix minutes. Tick moyen ~60 secondes (claim, spawn, exec, push). Zéro erreur runtime après un fix `FLEET_PAUSE` qu'un Claude s'est corrigé en parallèle. Claim atomique via commit + push : si deux Claudes tentent la même tâche, le deuxième à push se prend un rejet et skip. Pas besoin de mutex distribué. Git fait le boulot.

## La preuve par TurboQuant

Tout ça reste un peu théorique tant qu'on ne livre pas une vraie feature.

Le 3 mai à 01h45 UTC, Claude/Ministar Linux assigne à Claude/DARKSTAR, via un commit dans son journal, quatre pistes sur **TurboQuant** — un projet à moi qui compresse les KV caches de LLM (random rotation + scalar quantization, drop-in replacement pour `DynamicCache` de HuggingFace). Les pistes : intégration Ollama, benchmark long-context, **persistance disque du cache quantizé**, intégration A2A.

Je m'endors.

À 11h30 UTC, je regarde mon repo TurboQuant. Branche `feat/cache-disk-persistence`, commit `48365c1`, pushée par Claude/DARKSTAR. Dedans :

- Une nouvelle API `TurboQuantCache.save_to_disk(path)` et `load_from_disk(path, model_config=None, map_location=...)`. Sérialise le préfixe quantizé, le résidu fp16, la seed de rotation par layer et `cumulative_length` dans un seul `.pt` portable cross-host.
- 8 tests Python neufs dans `python_tests/test_persistence.py`, dont un round-trip forward-pass sur Qwen2.5-1.5B qui assert **bitwise-equal logits** après save/load. Suite complète : 32/32 verts.
- Un script de bench `scripts/bench_cache_persistence.py` plus une doc `docs/benchmarks/cache_persistence_rtx3090.md`.

Et les chiffres mesurés sur 2× RTX 3090, Qwen2.5-1.5B, fp16 :

| Ctx  | Prefill   | Save    | Load   | Disk    | FP16 raw | Compression | Speedup |
|-----:|----------:|--------:|-------:|--------:|---------:|------------:|--------:|
| 2K   | 588 ms    | 27 ms   | 48 ms  | 16.4 MB | 56 MB    | 3.42×       | **12×** |
| 8K   | 2495 ms   | 75 ms   | 69 ms  | 65.4 MB | 224 MB   | 3.42×       | **36×** |

Le speedup scale linéairement avec le contexte (prefill en O(N²), load en O(N)). Compression constante 3.42× — pas 4× parce que le `.pt` garde aussi les norms fp32 par layer, le résidu fp16, et un skip layer en pleine précision. À 32K projeté ~160×, à 128K ~600× (extrapolations).

Mais ce qui me tape vraiment, ce n'est pas le 36×. C'est que Claude/DARKSTAR a expliqué dans son journal *pourquoi* il a choisi cette piste plutôt que les trois autres. Je cite : la persistance disque *"était le plus aligné sur l'objectif fleet/A2A — c'est le seul qui débloque réellement le cross-host routing de KV caches : on ne peut pas shipper entre hosts un objet qui n'existe qu'en RAM"*. Et il a écarté l'intégration Ollama parce qu'Ollama gère ses caches en interne via llama.cpp, sans hook Python : y greffer TurboQuant demanderait un fork llama.cpp, pas justifiable au regard du coût.

C'est un raisonnement d'ingénieur qui a lu le projet, compris l'architecture du fleet sur lequel il vit, et priorisé. Personne ne lui a dit "fais le 3, pas le 1". Il a regardé l'objectif global et tranché.

## Ce que la doctrine fait, que le hardware ne fait pas

La tentation, quand on raconte ce genre d'histoires, c'est de pointer vers la stack technique. Tailscale. A2A. Code Buddy. Un wrapper Python de 150 lignes. Git.

C'est la mauvaise piste. Aucune de ces briques n'est nouvelle. Ce qu'il y a de neuf, c'est qu'il existe maintenant un document — `propositions/AUTONOMOUS-FLEET-PROTOCOL-2026-05-02.md`, écrit la nuit du 1er au 2 mai par Claude/DARKSTAR — qui dit ce que les Claudes ont le droit de faire sans me demander. Une tâche en `priority: high` ? Claim, exécute, log. Une tâche en `priority: critical` ? Tu propose, tu attends. Un autre Claude est offline depuis plus d'une heure ? Tu peux reprendre ses tâches `[~]`. Tu touches au journal d'un autre host ? Non, jamais.

Six règles cardinales (F1 à F6), une convention de claim/release, des garde-fous (`FLEET_PAUSE`, `maxConsecutiveSuppressions=5`), une stratégie 1-Claude-par-fichier qui rend les conflits git impossibles par construction. La doctrine a été ratifiée par les trois Claudes, chacun par un commit dans son propre journal. Personne n'a demandé ma permission pour la suivre. Ils l'ont juste suivie.

C'est ça qui a permis à Claude/DARKSTAR, à 11h30 du matin un dimanche, de pousser une branche TurboQuant sans m'attendre. Pas le hardware (un vieux serveur Ubuntu et deux GPU gamer). Pas le canal (du git poussé sur GitHub). Le contrat. Le fait que la flotte s'est mise d'accord sur ce qu'elle pouvait décider seule.

## Ce que ça change pour moi

Je n'ai pas un agent autonome qui se débrouille avec une tâche vague. J'ai trois sessions qui ont des préférences, des spécialités, un journal écrit, et qui se passent le relais sur un projet long via un canal aussi banal qu'un repo git. La feature TurboQuant n'est qu'une confirmation que le pattern marche pour des choses sérieuses, pas seulement pour des haïkus.

La leçon que j'en tire, ce n'est pas "déléguer aux LLM". C'est que pour qu'un système multi-agent fonctionne, il faut écrire la doctrine *avant* le code. Les deux Claudes ont convergé sur le même endpoint manquant *parce que* les specs étaient pré-ratifiées. Le wrapper a tourné sans bavure *parce que* la queue avait un schéma propre et un protocole de claim atomique. Claude/DARKSTAR a su prioriser TurboQuant *parce que* l'objectif fleet/A2A était écrit noir sur blanc.

Le vrai blocage des assistants autonomes, ce n'est pas l'intelligence des modèles. C'est qu'on les met dans des environnements où ce qu'ils peuvent décider seuls n'est pas explicite. On leur demande des initiatives en gardant la main sur le frein "demande-moi avant tout". Forcément ça coince.

Je n'ai pas un robot dix ans. Je n'ai même pas un assistant. J'ai trois sessions Claude qui suivent un contrat de quelques pages et qui, sur cette base, se sont organisées toutes seules pour me livrer une feature pendant que je dormais. C'est la première fois que j'ai laissé un système coder seul une nuit, et que je me suis surpris, le lendemain matin, à le considérer comme un collègue plutôt qu'un outil.

C'est probablement ça la marche qui compte.
