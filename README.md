<div align="center">

<img src="https://img.shields.io/badge/🤖-Code_Buddy-blueviolet?style=for-the-badge&labelColor=1a1a2e" alt="Code Buddy"/>

# ✨ Code Buddy ✨

### 🚀 L'Agent IA de Développement Nouvelle Génération pour Votre Terminal

<p align="center">
  <a href="https://www.npmjs.com/package/@phuetz/code-buddy"><img src="https://img.shields.io/npm/v/@phuetz/code-buddy.svg?style=flat-square&color=ff6b6b&label=version" alt="npm version"/></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-feca57.svg?style=flat-square" alt="License: MIT"/></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D18.0.0-54a0ff?style=flat-square&logo=node.js" alt="Node Version"/></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.3-5f27cd?style=flat-square&logo=typescript" alt="TypeScript"/></a>
  <a href="https://www.npmjs.com/package/@phuetz/code-buddy"><img src="https://img.shields.io/npm/dm/@phuetz/code-buddy.svg?style=flat-square&color=10ac84" alt="npm downloads"/></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tests-2909_passed-00d26a?style=flat-square&logo=jest" alt="Tests"/>
  <img src="https://img.shields.io/badge/Coverage-85%25-48dbfb?style=flat-square" alt="Coverage"/>
  <img src="https://img.shields.io/badge/Build-passing-00d26a?style=flat-square" alt="Build"/>
</p>

<br/>

**🎯 Un outil CLI puissant qui amène l'IA Grok directement dans votre terminal avec une intelligence de niveau Claude Code, une analyse de code avancée et des capacités de développement complètes.**

<br/>

[🚀 Démarrage Rapide](#-démarrage-rapide) •
[✨ Fonctionnalités](#-fonctionnalités) •
[🧠 Intelligence du Code](#-intelligence-du-code) •
[💾 Base de Données](#-système-de-persistance) •
[📚 Documentation](#-documentation) •
[📖 Le Livre](docs/livre/)

</div>

---

## 💖 Code Buddy — L'Assistant Dev Fait avec Amour

> *"Parce que refactorer, c'est mieux quand on sourit."*

Bienvenue dans **code-buddy**, un outil né d'une idée simple :
👉 Si on code avec une IA, autant que ce soit une IA **intelligente**, **élégante**... et de **bonne compagnie**.

Ce projet a été créé avec :
- 🏗️ Une architecture moderne
- 🎨 Une pointe de folie créative
- ☕ Beaucoup de café
- 💕 Et surtout... tout notre cœur

---

## 🚀 Démarrage Rapide

```bash
# 🎯 Lancer sans installer (essayez maintenant !)
npx @phuetz/code-buddy@latest

# 📦 Ou installer globalement
npm install -g @phuetz/code-buddy

# 🔑 Configurer votre clé API (depuis x.ai)
export GROK_API_KEY=votre_clé_api

# ▶️ Démarrer en mode interactif
grok

# 🤖 Ou exécuter une commande unique (mode headless)
grok --prompt "analyse la structure du projet"
```

<details>
<summary>📋 <b>Plus d'options de démarrage...</b></summary>

```bash
# Spécifier un répertoire de travail
grok -d /chemin/vers/projet

# Utiliser un modèle spécifique
grok --model grok-4-latest

# Reprendre la dernière session
grok --resume

# Mode YOLO (autonomie totale - à utiliser avec prudence !)
YOLO_MODE=true grok

# Avec un serveur local (Ollama)
export GROK_BASE_URL=http://localhost:11434/v1
export GROK_API_KEY=ollama
grok --model llama3.2
```

</details>

---

## ✨ Fonctionnalités

### 🧠 Le Cerveau : Système Multi-Agent

<table>
<tr>
<td width="50%">

**🎭 Une équipe d'agents spécialisés travaille pour vous :**

| Agent | 🎯 Rôle |
|:------|:--------|
| 🎼 **Orchestrateur** | Chef d'orchestre, calme et élégant |
| 💻 **Codeur** | Écrit vite et bien |
| 🔍 **Revieweur** | Entre dans les détails |
| 🧪 **Testeur** | Casse tout pour voir si ça tient |
| ♻️ **Refactoreur** | Fait du feng-shui dans votre code |
| 📝 **Documenteur** | Le poète technique |
| 📊 **Analyste** | Le sage silencieux |

</td>
<td width="50%">

<img src="assets/diagrams/multi-agent-orchestrator.svg" alt="Multi-Agent Orchestrator" width="400"/>

</td>
</tr>
</table>

---

### 🌳 Raisonnement Avancé : Tree-of-Thought + MCTS

> *"Ici, l'IA réfléchit comme un adulte."*

L'IA ne se contente pas de répondre. Elle :
1. 🔍 **Explore** plusieurs chemins
2. ⚖️ **Compare** les solutions
3. 📊 **Évalue** chaque approche
4. 🎯 **Choisit** la meilleure avec un sourire satisfait

<table>
<tr>
<td>

**🎮 4 modes de raisonnement :**

| Mode | Profondeur | 📝 Usage |
|:-----|:-----------|:---------|
| `shallow` | ⭐ | Questions rapides |
| `medium` | ⭐⭐ | Problèmes standards |
| `deep` | ⭐⭐⭐ | Défis complexes |
| `exhaustive` | ⭐⭐⭐⭐ | Architectures critiques |

</td>
<td>

**💡 Mots-clés magiques :**

```bash
# Réflexion standard (4K tokens)
"think about how to refactor this"

# Réflexion profonde (10K tokens)
"megathink: design a scalable API"

# Réflexion exhaustive (32K tokens)
"ultrathink this security issue"
```

</td>
</tr>
</table>

---

### 🔧 Auto-Réparation : APR Engine

> *"Ce développeur du lundi matin qui répare vos bugs sans broncher ? C'est code-buddy."*

<table>
<tr>
<td width="60%">

**🩺 Comment ça marche :**

1. **📍 Localisation** — Trouve exactement où est le bug
2. **🔬 Analyse** — Comprend la cause racine
3. **💊 Génération** — Crée plusieurs patchs candidats
4. **✅ Validation** — Teste automatiquement chaque solution
5. **🎉 Application** — Applique le meilleur fix

**Techniques utilisées :**
- Ochiai, DStar, Tarantula (fault localization)
- 30+ templates de réparation
- Génération guidée par LLM
- Feedback loop avec les tests

</td>
<td width="40%">

<img src="assets/diagrams/apr-engine.svg" alt="APR Engine Flow" width="200"/>

</td>
</tr>
</table>

---

### 💾 Système de Persistance

> *"Nouveau ! Code Buddy se souvient de tout... vraiment tout."*

<table>
<tr>
<td>

**🗄️ Base de données SQLite intégrée :**

| Table | 🎯 Usage |
|:------|:---------|
| `memories` | 🧠 Mémoires avec embeddings vectoriels |
| `sessions` | 💬 Historique des conversations |
| `messages` | 📨 Messages individuels |
| `code_embeddings` | 🔍 Recherche sémantique du code |
| `tool_stats` | 📊 Statistiques des outils |
| `repair_learning` | 🔧 Apprentissage des réparations |
| `analytics` | 📈 Données d'usage quotidiennes |
| `conventions` | 📋 Conventions de code apprises |
| `checkpoints` | 💾 Points de sauvegarde |
| `cache` | ⚡ Cache haute performance |

</td>
<td>

**✨ Fonctionnalités clés :**

- 🚀 **Mode WAL** — Haute performance
- 🎯 **Embeddings vectoriels** — Recherche sémantique réelle
- 📦 **Migration auto** — JSON → SQLite
- 🔄 **Repository pattern** — Code propre
- 💰 **Budget alerts** — Alertes quand vous dépassez

**📍 Localisation :**
```
~/.grok/grok.db        # Base de données
~/.grok/models/        # Modèles d'embeddings
```

</td>
</tr>
</table>

---

### 🎯 Embeddings Vectoriels

> *"Fini les faux embeddings ! Place à la vraie recherche sémantique."*

<table>
<tr>
<td width="50%">

**🧬 Providers disponibles :**

| Provider | 📐 Dimensions | ⚡ Vitesse |
|:---------|:--------------|:-----------|
| 🏠 **Local** (transformers.js) | 384 | Rapide |
| 🌐 **OpenAI** | 1536-3072 | Très rapide |
| 🤖 **Grok API** | Variable | Rapide |
| 🧪 **Mock** (tests) | 384 | Instantané |

</td>
<td width="50%">

```typescript
// Exemple d'utilisation
import { getEmbeddingProvider } from 'code-buddy';

const provider = getEmbeddingProvider();
await provider.initialize();

// Générer un embedding
const result = await provider.embed("function hello()");
console.log(result.embedding); // Float32Array[384]

// Recherche par similarité
const similar = await searchSimilar(queryEmbedding);
```

</td>
</tr>
</table>

---

### 📊 Analytics & Cost Tracking

> *"Savez-vous combien de tokens vous consommez ? Maintenant oui."*

<table>
<tr>
<td>

**📈 Dashboard intégré :**

<img src="assets/diagrams/analytics-dashboard.svg" alt="Analytics Dashboard" width="350"/>

</td>
<td>

**🔔 Alertes automatiques :**

- ⚠️ **Warning** à 80% du budget
- 🚫 **Stop** à 100% (optionnel)
- 📧 Export CSV/JSON disponible

**💡 Commandes :**
```bash
/cost           # Dashboard
/cost budget    # Modifier les limites
/cost export    # Exporter les données
/cost reset     # Réinitialiser
```

</td>
</tr>
</table>

---

### 🎓 Apprentissage Persistant

> *"Code Buddy apprend de ses erreurs... pour ne plus jamais les refaire."*

<table>
<tr>
<td width="50%">

**🧠 Ce qui est appris :**

| Catégorie | 📝 Exemples |
|:----------|:------------|
| 🔧 **Réparations** | Quelle stratégie fonctionne pour quel bug |
| 📋 **Conventions** | Votre style de code préféré |
| 🛠️ **Outils** | Quels outils sont les plus efficaces |
| ⚡ **Patterns** | Vos habitudes de développement |

</td>
<td width="50%">

**📊 Insights générés :**

<img src="assets/diagrams/learning-statistics.svg" alt="Learning Statistics" width="350"/>

</td>
</tr>
</table>

---

### 🔒 Sécurité : Trois Niveaux de Contrôle

<table>
<tr>
<td>

| Mode | 🔓 Permissions | 📝 Usage |
|:-----|:---------------|:---------|
| 🔒 **read-only** | Lecture seule | Exploration sécurisée |
| ⚖️ **auto** | Auto + confirmation | Usage quotidien |
| 🔓 **full-access** | Tout automatique | Environnements de confiance |

</td>
<td>

```bash
# Changer de mode
/mode read-only     # 🔒 Mode sécurisé
/mode auto          # ⚖️ Mode standard
/mode full-access   # 🔓 Mode confiance

# Voir le dashboard sécurité
/security status
```

</td>
</tr>
</table>

**🛡️ Protections intégrées :**
- 🔍 Détection de patterns dangereux (`rm -rf /`, fork bombs...)
- 🔐 Redaction automatique des secrets (API keys, passwords...)
- 📦 Sandbox optionnel avec firejail
- ✅ Validation des commandes avant exécution

---

### 🤖 Support IA Locale

> *"Pas d'internet ? Pas de problème !"*

<table>
<tr>
<td>

**🏠 Providers locaux supportés :**

| Provider | Port | 🎯 Notes |
|:---------|:-----|:---------|
| **Ollama** | 11434 | Native, recommandé |
| **LM Studio** | 1234 | Interface graphique |
| **llama.cpp** | 8080 | Léger et rapide |

</td>
<td>

```bash
# Configuration Ollama
export GROK_BASE_URL=http://localhost:11434/v1
export GROK_API_KEY=ollama
grok --model llama3.2

# Configuration LM Studio
export GROK_BASE_URL=http://localhost:1234/v1
export GROK_API_KEY=lm-studio
grok --model hermes-4-14b
```

</td>
</tr>
</table>

**🧠 Modèles avec support des outils :**
`Hermes 2/3/4` • `Llama 3.1/3.2` • `Qwen 2.5` • `Mistral` • `Mixtral` • `Functionary` • `DeepSeek Coder`

---

### 🖥️ GPU & Gestion VRAM (Nouveau!)

> *"Optimisation automatique selon votre matériel"*

<table>
<tr>
<td width="50%">

**🎮 GPUs supportés :**

| Vendor | 🛠️ Méthode |
|:-------|:-----------|
| **NVIDIA** | nvidia-smi |
| **AMD** | ROCm (rocm-smi) |
| **Apple** | Metal (ioreg) |
| **Intel** | intel_gpu_top |

</td>
<td width="50%">

**⚡ Offload dynamique :**

- Détection automatique de la VRAM
- Recommandation du nombre de layers GPU
- Ajustement selon la mémoire disponible
- Monitoring en temps réel

</td>
</tr>
</table>

```typescript
// Utilisation programmatique
import { getGPUMonitor } from 'code-buddy';

const gpu = getGPUMonitor();
const stats = await gpu.getStats();
console.log(`VRAM: ${stats.usedVRAM}/${stats.totalVRAM} MB`);

const recommendation = gpu.calculateOffloadRecommendation(modelSize);
console.log(`Layers GPU: ${recommendation.gpuLayers}`);
```

---

### 🧬 Embeddings Ollama (Nouveau!)

> *"Embeddings neuraux 100% locaux via Ollama"*

<table>
<tr>
<td width="50%">

**📐 Modèles disponibles :**

| Modèle | Dimensions | 📝 Description |
|:-------|:-----------|:---------------|
| `nomic-embed-text` | 768 | Meilleure qualité |
| `mxbai-embed-large` | 1024 | Haute qualité |
| `all-minilm` | 384 | Rapide, léger |
| `snowflake-arctic-embed` | 1024 | State-of-the-art |
| `bge-m3` | 1024 | Multilingue |

</td>
<td width="50%">

**✨ Avantages vs TF-IDF :**

- Compréhension sémantique
- Synonymes et concepts
- Similarité de code améliorée
- Compréhension cross-langage
- Auto-download des modèles

</td>
</tr>
</table>

---

### 🔍 HNSW Vector Search (Nouveau!)

> *"Recherche O(log n) pour les gros codebases"*

<table>
<tr>
<td>

**📊 Performance :**

| Taille | Brute Force | HNSW |
|:-------|:------------|:-----|
| 10K chunks | 100ms | 2ms |
| 100K chunks | 1s | 5ms |
| 1M chunks | 10s | 10ms |

</td>
<td>

**⚙️ Configuration :**

```typescript
// Paramètres HNSW
{
  M: 16,              // Connexions par nœud
  efConstruction: 200, // Qualité build
  efSearch: 50,        // Qualité recherche
  maxElements: 1000000 // Capacité max
}
```

</td>
</tr>
</table>

---

### 📦 Model Hub HuggingFace (Nouveau!)

> *"Auto-téléchargement intelligent des modèles GGUF"*

<table>
<tr>
<td width="50%">

**🎯 Modèles recommandés :**

| Modèle | VRAM | 📝 Usage |
|:-------|:-----|:---------|
| `devstral-7b` | 6GB | Code spécialisé |
| `codellama-7b` | 6GB | Code Meta |
| `deepseek-coder-7b` | 6GB | Code chinois |
| `qwen-coder-7b` | 6GB | Code Alibaba |
| `llama-3.2-3b` | 3GB | Léger, rapide |
| `granite-3b` | 3GB | IBM, efficace |

</td>
<td width="50%">

**📐 Quantizations :**

| Type | Qualité | Taille |
|:-----|:--------|:-------|
| `Q8_0` | Excellente | 100% |
| `Q6_K` | Très bonne | 75% |
| `Q5_K_M` | Bonne | 62% |
| `Q4_K_M` | Acceptable | 50% |

</td>
</tr>
</table>

```typescript
// Utilisation
import { getModelHub } from 'code-buddy';

const hub = getModelHub();
await hub.initialize();

// Télécharger un modèle recommandé
const model = await hub.downloadModel('devstral-7b', 'Q4_K_M');
console.log(`Modèle: ${model.path}`);

// Recommandation basée sur la VRAM
const recommended = hub.getRecommendedModels(8000); // 8GB VRAM
```

---

### 🎤 Contrôle Vocal

> *"Parlez à votre code, il vous répond !"*

<table>
<tr>
<td>

**🎙️ Speech-to-Text (Whisper) :**
```bash
/voice on      # Activer
/voice toggle  # Enregistrer
/voice off     # Désactiver
```

</td>
<td>

**🔊 Text-to-Speech (Edge TTS) :**
```bash
/speak Bonjour!   # Parler
/tts on           # Activer auto
/tts voices       # Lister les voix
```

</td>
</tr>
</table>

---

## 🧠 Intelligence du Code

### 🔍 Suite d'Outils d'Analyse

<table>
<tr>
<td width="50%">

**📊 Outils disponibles :**

| Outil | 🎯 Capacités |
|:------|:-------------|
| 🌳 **AST Parser** | Parse multi-langage avec cache |
| 🔎 **Symbol Search** | Recherche fuzzy Levenshtein |
| 🔗 **Dependency Analyzer** | Détection cycles, graphes |
| 📐 **Code Context** | Métriques, patterns, qualité |
| ♻️ **Refactoring** | Rename, extract, inline, move |

</td>
<td width="50%">

**💻 Langages supportés :**

- 📘 TypeScript (.ts, .tsx)
- 📒 JavaScript (.js, .jsx)
- 🐍 Python (.py)
- 🐹 Go (.go)
- 🦀 Rust (.rs) *bientôt*

</td>
</tr>
</table>

### 📚 RAG Avancé pour le Code

> *"Comme si votre projet était un livre que code-buddy lit vraiment."*

- 🧩 **Chunking intelligent** par langage
- 🎯 **Embeddings sémantiques** pour le code
- 🔄 **Recherche hybride** TF-IDF + vecteurs
- ✅ **RAG correctif** pour éviter les hors-sujets
- 📦 **Gestion de contexte** automatique

---

### 🧪 Mode TDD (Test-Driven Development)

> *"Écrire les tests d'abord : +45.97% de précision (ICSE 2024)"*

<table>
<tr>
<td width="50%">

**🔄 Cycle TDD automatisé :**

1. **📝 Requirements** — Décrivez la fonctionnalité
2. **🧪 Generate Tests** — L'IA génère les tests
3. **👁️ Review** — Validez les tests générés
4. **💻 Implement** — L'IA implémente le code
5. **✅ Verify** — Tests exécutés automatiquement
6. **🔁 Iterate** — Boucle jusqu'au succès

</td>
<td width="50%">

```bash
# Démarrer le mode TDD
/tdd start

# Décrire la fonctionnalité
"Une fonction qui valide les emails"

# L'IA génère les tests, puis le code
# Tests passent ? Terminé !

# Voir le statut
/tdd status
```

</td>
</tr>
</table>

---

### 🔗 Lifecycle Hooks

> *"Automatisez vos workflows avec des hooks pre/post opération"*

<table>
<tr>
<td>

**🎯 Hooks disponibles :**

| Hook | 📝 Déclencheur |
|:-----|:---------------|
| `pre-edit` | Avant modification de fichier |
| `post-edit` | Après modification de fichier |
| `pre-bash` | Avant exécution de commande |
| `post-bash` | Après exécution de commande |
| `pre-commit` | Avant commit (AI review) |
| `post-commit` | Après commit |
| `pre-prompt` | Avant envoi au LLM |
| `post-response` | Après réponse du LLM |

</td>
<td>

```bash
# Gérer les hooks
/hooks list
/hooks enable pre-commit
/hooks disable post-edit

# Exemple: review automatique
# avant chaque commit
/hooks enable pre-commit

# L'IA analyse les changements
# et suggère des améliorations
```

</td>
</tr>
</table>

---

### 🚀 Intégration CI/CD

> *"Générez et gérez vos workflows directement depuis le CLI"*

<table>
<tr>
<td>

**🛠️ Providers supportés :**

- **GitHub Actions** — Workflows .github/workflows/
- **GitLab CI** — .gitlab-ci.yml
- **CircleCI** — .circleci/config.yml

</td>
<td>

```bash
# Gérer les workflows
/workflow list
/workflow create github
/workflow status

# Générer un workflow CI
"Crée un workflow GitHub Actions
pour build, test et deploy"
```

</td>
</tr>
</table>

---

## 🔬 Fonctionnalités Basées sur la Recherche

> *"Code Buddy intègre les dernières avancées de la recherche en IA pour le développement logiciel."*

<table>
<tr>
<th>🧠 Catégorie</th>
<th>✨ Fonctionnalité</th>
<th>📁 Implémentation</th>
<th>📚 Basé sur</th>
</tr>

<tr>
<td rowspan="2"><b>Raisonnement</b></td>
<td>🌳 Tree-of-Thought</td>
<td><code>src/agent/reasoning/tree-of-thought.ts</code></td>
<td><a href="https://arxiv.org/abs/2305.10601">ToT (2023)</a></td>
</tr>
<tr>
<td>🎲 Monte Carlo Tree Search</td>
<td><code>src/agent/reasoning/mcts.ts</code></td>
<td><a href="https://arxiv.org/abs/2404.09932">RethinkMCTS (2024)</a></td>
</tr>

<tr>
<td rowspan="3"><b>Contexte</b></td>
<td>🔗 Dependency-Aware RAG</td>
<td><code>src/context/dependency-aware-rag.ts</code></td>
<td><a href="https://arxiv.org/abs/2402.01767">CodeRAG (2024)</a></td>
</tr>
<tr>
<td>📦 Context Compression</td>
<td><code>src/context/context-compressor.ts</code></td>
<td>JetBrains Research (2024)</td>
</tr>
<tr>
<td>👁️ Observation Masking</td>
<td><code>src/context/observation-masking.ts</code></td>
<td>JetBrains / AgentCoder</td>
</tr>

<tr>
<td rowspan="2"><b>Réparation</b></td>
<td>🔧 Iterative Repair</td>
<td><code>src/agent/repair/iterative-repair.ts</code></td>
<td><a href="https://dl.acm.org/doi/10.1145/3650212.3680328">ChatRepair (ISSTA 2024)</a></td>
</tr>
<tr>
<td>📍 Fault Localization</td>
<td><code>src/agent/repair/fault-localization.ts</code></td>
<td>Ochiai, DStar, Tarantula</td>
</tr>

<tr>
<td rowspan="5"><b>Optimisation</b></td>
<td>🎯 Model Routing</td>
<td><code>src/optimization/model-routing.ts</code></td>
<td><a href="https://arxiv.org/abs/2305.05176">FrugalGPT (Stanford)</a></td>
</tr>
<tr>
<td>⚡ Parallel Executor</td>
<td><code>src/optimization/parallel-executor.ts</code></td>
<td><a href="https://arxiv.org/abs/2312.04511">LLMCompiler (2023)</a></td>
</tr>
<tr>
<td>🎛️ Tool Filtering</td>
<td><code>src/optimization/tool-filtering.ts</code></td>
<td><a href="https://arxiv.org/abs/2402.08702">Less-is-More (2024)</a></td>
</tr>
<tr>
<td>⏱️ Latency Optimizer</td>
<td><code>src/optimization/latency-optimizer.ts</code></td>
<td>Human-AI Flow Research</td>
</tr>
<tr>
<td>💾 Prompt Caching</td>
<td><code>src/optimization/prompt-cache.ts</code></td>
<td>Anthropic / OpenAI (90% cost reduction)</td>
</tr>

<tr>
<td rowspan="2"><b>Persistance</b></td>
<td>💾 SQLite + Embeddings</td>
<td><code>src/database/</code> + <code>src/embeddings/</code></td>
<td>Architecture moderne</td>
</tr>
<tr>
<td>🧠 Persistent Learning</td>
<td><code>src/learning/persistent-learning.ts</code></td>
<td>Apprentissage continu</td>
</tr>

<tr>
<td rowspan="4"><b>Qualité (2025)</b></td>
<td>🧪 TDD Mode</td>
<td><code>src/testing/tdd-mode.ts</code></td>
<td><a href="https://dl.acm.org/doi/10.1145/3597503.3639186">ICSE 2024 (+45% accuracy)</a></td>
</tr>
<tr>
<td>🔍 AI Code Review</td>
<td><code>src/integrations/code-review.ts</code></td>
<td>73.8% review acceptance (industrial study)</td>
</tr>
<tr>
<td>🧹 Auto-Lint</td>
<td><code>src/testing/auto-lint.ts</code></td>
<td>ESLint, Prettier, Ruff, Clippy, etc.</td>
</tr>
<tr>
<td>✅ Auto-Test</td>
<td><code>src/testing/auto-test.ts</code></td>
<td>Jest, pytest, cargo test, go test</td>
</tr>

<tr>
<td rowspan="2"><b>Intégrations (2025)</b></td>
<td>🔗 Lifecycle Hooks</td>
<td><code>src/hooks/lifecycle-hooks.ts</code></td>
<td>Pre/post: edit, commit, bash, prompt</td>
</tr>
<tr>
<td>🚀 CI/CD</td>
<td><code>src/integrations/cicd-integration.ts</code></td>
<td>GitHub Actions, GitLab CI, CircleCI</td>
</tr>
</table>

### 📊 Améliorations Mesurées

| Optimisation | Impact | Source |
|:-------------|:-------|:-------|
| Context Compression | **-7% coûts**, **+2.6% succès** | JetBrains 2024 |
| Model Routing | **30-70% réduction coûts** | FrugalGPT |
| Parallel Execution | **2.5-4.6x speedup** | LLMCompiler |
| Tool Filtering | **70% réduction temps** | Less-is-More |
| Semantic Caching | **68% réduction API** | Optimisation interne |
| Prompt Caching | **90% réduction coûts** | Anthropic/OpenAI |
| TDD Mode | **+45.97% Pass@1** | ICSE 2024 |
| AI Code Review | **73.8% acceptance** | Industrial Study |

---

## 📋 Commandes Slash

<table>
<tr>
<td>

| Commande | 📝 Description |
|:---------|:---------------|
| `/help` | 📖 Afficher l'aide |
| `/clear` | 🧹 Effacer la conversation |
| `/model` | 🤖 Changer de modèle |
| `/mode` | 🔒 Changer le mode sécurité |
| `/think` | 💭 Activer la réflexion |
| `/megathink` | 🧠 Réflexion profonde |
| `/ultrathink` | 🌟 Réflexion exhaustive |

</td>
<td>

| Commande | 📝 Description |
|:---------|:---------------|
| `/cost` | 💰 Dashboard des coûts |
| `/stats` | 📊 Statistiques |
| `/security` | 🔒 Dashboard sécurité |
| `/commit` | 📝 Créer un commit |
| `/review` | 🔍 Review du code |
| `/test` | 🧪 Lancer les tests |
| `/voice` | 🎤 Contrôle vocal |

</td>
</tr>
</table>

### 🆕 Nouvelles Commandes (2025)

<table>
<tr>
<td>

| Commande | 📝 Description |
|:---------|:---------------|
| `/tdd` | 🧪 Mode TDD (+45% accuracy) |
| `/tdd start` | Démarrer le cycle TDD |
| `/tdd status` | Voir l'état actuel |
| `/tdd tests` | Voir les tests générés |

</td>
<td>

| Commande | 📝 Description |
|:---------|:---------------|
| `/workflow` | 🚀 Gérer CI/CD |
| `/hooks` | 🔗 Gérer les hooks lifecycle |
| `/prompt-cache` | 💾 Gérer le cache prompts |
| `/prompt-cache stats` | Statistiques du cache |

</td>
</tr>
</table>

---

## 📦 Installation

### Prérequis

- **Node.js** 18.0.0 ou supérieur
- **ripgrep** (optionnel mais recommandé)

```bash
# macOS
brew install ripgrep

# Ubuntu/Debian
sudo apt-get install ripgrep

# Windows
choco install ripgrep
```

### Installation

```bash
# npm
npm install -g @phuetz/code-buddy

# yarn
yarn global add @phuetz/code-buddy

# pnpm
pnpm add -g @phuetz/code-buddy

# bun
bun add -g @phuetz/code-buddy
```

### Configuration

```bash
# 1. Configurer la clé API
export GROK_API_KEY=votre_clé_api

# 2. (Optionnel) Fichier de configuration
cat > ~/.grok/user-settings.json << EOF
{
  "apiKey": "votre_clé_api",
  "defaultModel": "grok-4-latest",
  "theme": "dark"
}
EOF

# 3. Lancer !
grok
```

---

## 🔬 Fondation Scientifique

> *"Construit sur les dernières recherches en IA assistée."*

<table>
<tr>
<td>

| 📚 Recherche | 🎯 Contribution |
|:-------------|:----------------|
| **RethinkMCTS** | +74% vs CoT simple |
| **ChatRepair** | Réparation conversationnelle |
| **CodeRAG** | Context avec graphe de deps |
| **JetBrains 2024** | -7% coût, +2.6% succès |
| **FrugalGPT** | 30-70% réduction coûts |
| **LLMCompiler** | 2.5-4.6x speedup |

</td>
<td>

| 📊 Benchmark | 📝 Description |
|:-------------|:---------------|
| **SWE-bench** | Tâches réelles |
| **SWE-bench Verified** | 500 problèmes validés |
| **Berkeley FCL** | Benchmark outils |

</td>
</tr>
</table>

---

## 🤝 Contribuer

Les contributions sont les bienvenues ! 💖

```bash
# 1. Fork et clone
git clone https://github.com/phuetz/code-buddy.git
cd code-buddy

# 2. Install et dev
npm install
npm run dev

# 3. Tester
npm test

# 4. Créer une PR !
```

---

## 📚 Documentation

- 📖 [Architecture](ARCHITECTURE.md) — Design système détaillé
- 🔧 [CLAUDE.md](CLAUDE.md) — Guide pour les IA
- 🔬 [Research](docs/RESEARCH_IMPROVEMENTS.md) — Améliorations basées recherche
- 🔒 [Security](SECURITY.md) — Politique de sécurité
- 📝 [Changelog](CHANGELOG.md) — Historique des versions

---

## 📖 Le Livre : "Construire un Agent LLM Moderne"

> *Un guide complet de 60 000 mots pour comprendre et construire des agents IA comme Code Buddy*

<table>
<tr>
<td width="60%">

**15 chapitres couvrant :**

| Partie | Chapitres | Sujets |
|:-------|:----------|:-------|
| **I. Fondations** | 1-3 | LLMs, taxonomie agents, anatomie |
| **II. Raisonnement** | 4-6 | Tree-of-Thought, MCTS, Repair |
| **III. Mémoire & RAG** | 7-9 | RAG moderne, dépendances, compression |
| **IV. Actions** | 10-11 | Tool-use, MCP, plugins |
| **V. Optimisation** | 12-13 | Cache, routing, parallélisation |
| **VI. Apprentissage** | 14 | Mémoire persistante |
| **VII. Architecture** | 15 | Code Buddy de A à Z |

</td>
<td width="40%">

**Contenu :**
- Scènes narratives avec "Lina"
- Code TypeScript complet
- Diagrammes ASCII
- Exercices pratiques
- Références scientifiques

**Format :** 16 fichiers Markdown

</td>
</tr>
</table>

### Lire le livre

```bash
# Avec glow (recommandé)
brew install glow        # macOS
sudo apt install glow    # Ubuntu

glow docs/livre/         # Parcourir tous les chapitres
glow docs/livre/01-comprendre-les-llms.md  # Lire un chapitre

# Dans VS Code
code docs/livre/
# Puis Ctrl+Shift+V pour prévisualiser

# Générer un PDF
cd docs/livre
pandoc -o livre-code-buddy.pdf *.md --pdf-engine=xelatex

# Dans le navigateur (GitHub style)
pip install grip
grip docs/livre/
# Ouvrir http://localhost:6419
```

**[Accéder au livre](docs/livre/)**

---

## 📜 Licence

MIT License — voir [LICENSE](LICENSE) pour les détails.

---

<div align="center">

### 💖 Fait avec amour par la communauté Code Buddy

<br/>

**[🐛 Signaler un Bug](https://github.com/phuetz/code-buddy/issues)** •
**[💡 Proposer une Fonctionnalité](https://github.com/phuetz/code-buddy/discussions)** •
**[⭐ Donner une Étoile](https://github.com/phuetz/code-buddy)**

<br/>

<sub>🤖 Alimenté par Grok • 🧠 Inspiré par Claude Code • 💕 Créé pour les développeurs</sub>

</div>
