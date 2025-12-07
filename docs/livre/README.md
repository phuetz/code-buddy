# Construire un Agent LLM Moderne

**De la Théorie à Grok-CLI**

> *Un guide pratique de plus de 65 000 mots pour comprendre et construire des agents IA de développement*

---

## Table des Matières

### Avant-propos
- [00. Avant-propos](00-avant-propos.md) — Introduction, personnage de Lina, structure du livre

### Partie I : Fondations
- [01. Comprendre les LLMs](01-comprendre-les-llms.md) — Transformers, attention, tokenization, hallucinations
- [02. Le Rôle des Agents](02-role-des-agents.md) — Taxonomie : Chatbot → Assistant → Agent → Multi-Agent
- [03. Anatomie d'un Agent](03-anatomie-agent.md) — 6 composants : Orchestrateur, Raisonnement, Mémoire, Action, Apprentissage, Sécurité

### Partie II : Raisonnement et Planification
- [04. Tree-of-Thought](04-tree-of-thought.md) — Exploration BFS/DFS, évaluation des chemins
- [05. Monte-Carlo Tree Search](05-mcts.md) — UCB1, Select-Expand-Simulate-Backpropagate
- [06. Repair et Réflexion](06-repair-reflexion.md) — ChatRepair, localisation de fautes, boucle de feedback

### Partie III : Mémoire, RAG et Contexte
- [07. RAG Moderne](07-rag-moderne.md) — Embeddings, chunking AST, recherche hybride, reranking
- [08. Dependency-Aware RAG](08-dependency-aware-rag.md) — Graphe de dépendances, expansion contextuelle
- [09. Compression de Contexte](09-context-compression.md) — Priorités, résumé, observation masking

### Partie IV : Action et Outils
- [10. Tool-Use](10-tool-use.md) — 41 outils Grok-CLI, validation, exécution parallèle
- [11. Plugins et MCP](11-plugins-mcp.md) — Architecture plugin, Model Context Protocol, transports

### Partie V : Optimisation
- [12. Optimisations Cognitives](12-optimisations-cognitives.md) — Cache sémantique (68% réduction), cache d'outils
- [13. Optimisations Système](13-optimisations-systeme.md) — Model routing (FrugalGPT), parallélisation (LLMCompiler), lazy loading

### Partie VI : Apprentissage
- [14. Apprentissage Persistant](14-apprentissage-persistant.md) — Mémoire épisodique, sémantique, procédurale

### Partie VII : Étude de Cas
- [15. Architecture Complète](15-architecture-complete.md) — Grok-CLI de A à Z, 6 couches, intégration

### Annexes
- [📚 Glossaire](glossaire.md) — Définitions des termes techniques
- [🔍 Index](index.md) — Index alphabétique des concepts
- [📖 Bibliographie](bibliographie.md) — Références scientifiques et ressources

---

## Comment Lire ce Livre

### Option 1 : Terminal avec Glow (recommandé)

```bash
# Installation
brew install glow        # macOS
sudo apt install glow    # Ubuntu/Debian
choco install glow       # Windows

# Parcourir le livre
glow .                   # Menu interactif
glow 01-comprendre-les-llms.md  # Chapitre spécifique
```

### Option 2 : VS Code

```bash
code .
# Ouvrir un fichier .md
# Ctrl+Shift+V (ou Cmd+Shift+V) pour prévisualiser
```

### Option 3 : Navigateur (GitHub style)

```bash
pip install grip
grip .
# Ouvrir http://localhost:6419
```

### Option 4 : Générer un PDF

```bash
# Installer pandoc et LaTeX
sudo apt install pandoc texlive-xetex  # Ubuntu
brew install pandoc basictex           # macOS

# Générer le PDF complet
pandoc -o livre-grok-cli.pdf \
  00-avant-propos.md \
  01-comprendre-les-llms.md \
  02-role-des-agents.md \
  03-anatomie-agent.md \
  04-tree-of-thought.md \
  05-mcts.md \
  06-repair-reflexion.md \
  07-rag-moderne.md \
  08-dependency-aware-rag.md \
  09-context-compression.md \
  10-tool-use.md \
  11-plugins-mcp.md \
  12-optimisations-cognitives.md \
  13-optimisations-systeme.md \
  14-apprentissage-persistant.md \
  15-architecture-complete.md \
  --pdf-engine=xelatex \
  -V geometry:margin=1in \
  -V fontsize=11pt \
  --toc \
  --toc-depth=2
```

---

## À Propos

Ce livre a été généré dans le cadre du projet Grok-CLI pour documenter les techniques modernes de construction d'agents LLM. Chaque chapitre inclut :

- **Scène narrative** : Suivez Lina, développeuse, dans son parcours
- **Contenu technique** : Explications détaillées avec diagrammes ASCII
- **Code TypeScript** : Implémentations complètes et fonctionnelles
- **Exercices** : Mettez en pratique les concepts appris

### Références Scientifiques

Le livre s'appuie sur des publications récentes :
- Tree-of-Thought (Yao et al., 2023)
- RethinkMCTS (Zhang et al., 2024)
- ChatRepair (ISSTA 2024)
- CodeRAG (2024)
- FrugalGPT (Stanford, 2023)
- LLMCompiler (Berkeley, 2023)
- JetBrains Research (2024)

---

*Bonne lecture !*
