# Avant-propos

---

## Pourquoi ce livre ?

Il y a deux ans, j'ai commencé à expérimenter avec les grands modèles de langage. Comme beaucoup de développeurs, j'ai d'abord été fasciné par leurs capacités, puis rapidement frustré par leurs limitations. Un chatbot qui invente des fichiers inexistants, qui oublie ce qu'on lui a dit trois messages plus tôt, qui refuse d'exécuter une simple commande shell — ce n'était pas l'assistant intelligent que j'avais imaginé.

Alors j'ai commencé à construire. Pas juste une interface autour d'une API, mais un véritable **agent** : un système capable de raisonner, de se souvenir, d'agir, et d'apprendre de ses erreurs.

Ce livre est le résultat de cette exploration. Il documente non seulement *comment* construire un agent LLM moderne, mais surtout *pourquoi* certaines architectures fonctionnent et d'autres échouent.

---

## L'histoire de Lina

Tout au long de ce livre, vous suivrez **Lina**, une développeuse fictive mais représentative de milliers d'ingénieurs qui tentent aujourd'hui de dompter les LLMs. Lina n'est pas une experte en machine learning — elle est pragmatique, curieuse, et parfois frustrée. Elle veut des résultats, pas des théories abstraites.

À travers son parcours, vous vivrez les mêmes défis, les mêmes "eureka", et les mêmes solutions que j'ai découvertes en construisant Grok-CLI.

---

## Ce que vous apprendrez

Ce livre n'est pas un tutoriel de prompt engineering. C'est un guide d'architecture pour construire des systèmes intelligents robustes.

Vous apprendrez à :

1. **Comprendre** les fondements des LLMs — pas juste comment les utiliser, mais pourquoi ils se comportent comme ils le font

2. **Architecturer** un agent complet avec reasoning, mémoire, outils, et apprentissage

3. **Implémenter** des techniques issues de la recherche récente : Tree-of-Thought, Monte-Carlo Tree Search, RAG avec dépendances, réparation itérative

4. **Optimiser** pour la performance et les coûts avec FrugalGPT, exécution parallèle, et caching sémantique

5. **Sécuriser** votre agent avec des modes d'approbation, du sandboxing, et de la redaction automatique

---

## Comment lire ce livre

Ce livre est organisé en sept parties progressives :

| Partie | Chapitres | Focus |
|--------|-----------|-------|
| **I. Fondations** | 1-3 | Comprendre les LLMs et l'anatomie d'un agent |
| **II. Reasoning** | 4-6 | Tree-of-Thought, MCTS, réparation automatique |
| **III. Mémoire** | 7-9 | RAG moderne, compression de contexte |
| **IV. Action** | 10-11 | Outils, plugins, MCP Protocol |
| **V. Optimisation** | 12-13 | Performance, coûts, latence |
| **VI. Apprentissage** | 14 | Mémoire persistante, amélioration continue |
| **VII. Étude de cas** | 15 | Grok-CLI de bout en bout |

Vous pouvez lire le livre de manière linéaire, ou sauter directement aux parties qui vous intéressent. Chaque chapitre est relativement autonome, bien que les concepts s'appuient les uns sur les autres.

---

## Le code source

Tous les exemples de ce livre proviennent de **Grok-CLI**, un agent open-source que j'ai développé. Le code complet est disponible sur GitHub :

```
https://github.com/phuetz/grok-cli
```

Je vous encourage à cloner le projet et à expérimenter pendant votre lecture. Rien ne remplace la pratique.

```bash
git clone https://github.com/phuetz/grok-cli.git
cd grok-cli
npm install
export GROK_API_KEY=your_key
npm run dev
```

---

## Remerciements

Ce livre n'existerait pas sans :

- La communauté open-source qui a partagé recherches, idées et code
- Les chercheurs derrière ToT, MCTS, FrugalGPT, LLMCompiler, ChatRepair et tant d'autres publications qui ont guidé cette architecture
- Les early adopters de Grok-CLI qui ont testé, rapporté des bugs, et suggéré des améliorations
- Ma famille qui a supporté mes soirées de coding

---

## Une invitation

L'intelligence artificielle évolue à une vitesse vertigineuse. Ce que vous lisez aujourd'hui sera peut-être obsolète dans un an. Mais les *principes* — la décomposition de problèmes, la mémoire structurée, l'action sécurisée, l'apprentissage continu — ces principes resteront.

Mon espoir est que ce livre vous donne non seulement des techniques concrètes, mais surtout une *façon de penser* les systèmes intelligents. Que vous construisiez un assistant de code, un agent de recherche, ou quelque chose que personne n'a encore imaginé.

Bienvenue dans le monde des agents LLM modernes.

---

*Patrice Huetz*
*2025*

---

> *"The best way to predict the future is to invent it."*
> — Alan Kay

