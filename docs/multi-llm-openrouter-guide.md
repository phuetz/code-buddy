# Conseil multi‑LLM gratuit avec OpenRouter

## Prompt optimisé

> En mode Plan, conçois puis utilise un système de conseil multi‑LLM pour Code Buddy. Il doit interroger simultanément plusieurs modèles OpenRouter gratuits, attribuer à chaque modèle un rôle complémentaire adapté à la tâche, tolérer les timeouts et les erreurs 429, puis produire une réponse finale traçable. Utilise le chemin local Qwen/Pocket TTS pour les interactions vocales immédiates et réserve le conseil cloud aux décisions complexes ou asynchrones. Propose des cas d’usage concrets, mesure la latence de chaque modèle, évite toute dépense en choisissant exclusivement `openrouter/free` ou des variantes `:free`, et conserve un repli utile lorsqu’un agrégateur est indisponible. Valide l’intégration par tests unitaires, appel API réel et vérification dans Cowork, sans exposer la clé API.

## Fonctionnement

Le tool `mixture_of_agents` est autorisé en mode Plan car il effectue uniquement des lectures réseau. Il choisit un profil, lance ses spécialistes simultanément avec `Promise.all`, conserve les réponses valides malgré les endpoints saturés, puis utilise `openrouter/free` pour la synthèse.

Le profil `fast` est différent : deux modèles courent en parallèle et la meilleure réponse courte est retenue sans deuxième appel séquentiel. Il vise quelques secondes, mais ne remplace pas le modèle local du dialogue vocal.

```text
Question
   ├── spécialiste A + rôle A ─┐
   ├── spécialiste B + rôle B ─┼── synthèse gratuite ── réponse
   ├── spécialiste C + rôle C ─┤
   └── routeur libre + arbitre ─┘
```

## Profils disponibles

| Profil | Usage | Rôles principaux |
|---|---|---|
| `balanced` | Question complexe générale | analyste, critique, praticien, arbitre |
| `fast` | Réponse redondante bornée | répondant rapide, vérificateur |
| `code` | Implémentation et revue | architecte, implémenteur, reviewer, mainteneur |
| `architecture` | Choix techniques structurants | système, performance, produit, critique |
| `decision` | Arbitrage réversible | avocat, sceptique, analyste, décideur |
| `research` | Recherche et synthèse longue | cartographe, chercheur, vérificateur, éditeur |
| `security` | Audit défensif | threat modeler, défenseur, reviewer, priorisateur |

## Modèles gratuits proposés dans Cowork

- `openrouter/free` : repli général et agrégateur résilient.
- `openai/gpt-oss-20b:free` : raisonnement court, outils et vérification.
- `cohere/north-mini-code:free` : agent de code compact et rapide.
- `qwen/qwen3-coder:free` : gros dépôts et contexte jusqu’à 1M.
- `qwen/qwen3-next-80b-a3b-instruct:free` : généraliste efficace et francophone.
- `google/gemma-4-26b-a4b-it:free` : vision, outils et raisonnement.
- `nvidia/nemotron-3-super-120b-a12b:free` : architecture et raisonnement long.
- `nvidia/nemotron-3-ultra-550b-a55b:free` : recherche profonde et orchestration agentique, avec contexte 1M ; à réserver aux tâches asynchrones car il est nettement plus lent.
- `meta-llama/llama-3.3-70b-instruct:free` : rédaction et seconde opinion.
- `poolside/laguna-xs-2.1:free` : coding agent expérimental avec repli obligatoire.

La disponibilité gratuite varie. Un modèle épinglé peut répondre 429 alors que `openrouter/free` fonctionne ; ce comportement est prévu par le routeur.

## Exemples

Dans le chat :

```text
/plan
Analyse cette migration avec mixture_of_agents, profil architecture.
Je veux les invariants à préserver, les modes de panne, les mesures de performance
et une recommandation réversible avant toute modification.
```

Appel de tool :

```json
{
  "user_prompt": "Compare ces deux architectures et propose une migration sûre.",
  "use_case": "architecture"
}
```

Conseil adaptatif en CLI :

```bash
buddy council "Faut-il séparer le pipeline vocal du moteur agentique ?" \
  --count 3 --models openrouter --task-type reasoning
```

## Cas d’usage à forte valeur

1. Valider un plan avant modification de plusieurs modules.
2. Faire relire une migration de schéma, API ou dépendance majeure.
3. Générer implémentation, tests adversariaux et critique dans le même tour.
4. Réaliser un threat model et classer les mesures correctives.
5. Comparer des modèles, frameworks ou fournisseurs selon des critères explicites.
6. Vérifier une recherche en séparant faits, inférences et informations manquantes.
7. Examiner une décision produit avec avocat, sceptique et seuil de réévaluation.
8. Produire une synthèse longue à partir de perspectives indépendantes.

## Garde-fous

- Le dialogue vocal garde `qwen3:4b-instruct` local : le réseau gratuit est trop variable pour le premier son.
- Les profils gratuits utilisent une seule tentative par modèle ; un 429 ne déclenche pas une boucle coûteuse.
- `fast` est limité à 256 tokens et 10 secondes par modèle.
- Les autres profils plafonnent entre 1 024 et 2 048 tokens par siège.
- Si la synthèse échoue, la meilleure réponse spécialiste est rendue avec `aggregation_degraded: true`.
- Les résultats exposent `latency_ms` et le rôle de chaque modèle.
- L’endpoint gratuit Nemotron Ultra ne doit recevoir aucune donnée personnelle, voix, visage ou information confidentielle ; NVIDIA indique que les sessions gratuites peuvent être journalisées pour la sécurité et l’amélioration du modèle.
- Avec au moins 10 dollars de crédits achetés, OpenRouter documente 1 000 requêtes `:free` par jour et 20 requêtes par minute : [limites officielles](https://openrouter.ai/docs/api/reference/limits).

## Validation réelle du 10 juillet 2026

- La clé est reconnue par OpenRouter comme appartenant à un compte payant.
- Le premier prototype trop généreux (512 tokens et synthèse séquentielle) prenait 48,1 s.
- Après bornage, le profil `fast` a interrogé North Mini Code et GPT‑OSS 20B simultanément en 5,2 s au total ; latences individuelles 2,75 s et 5,19 s.
- Le routeur gratuit a aussi répondu correctement en 1,77 s sur une requête courte, avec un coût API déclaré à zéro.
- Plusieurs modèles épinglés ont renvoyé 429 pendant le même test : le repli et la tolérance partielle sont donc nécessaires, pas théoriques.
