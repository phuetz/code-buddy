# Chapitre 3 — Anatomie d'un Agent Autonome

---

> **Scène**
>
> *Lina a couvert le tableau blanc de diagrammes. Des flèches partent dans tous les sens.*
>
> *"Ok, récapitulons," dit-elle en pointant le centre du tableau. "Un agent a besoin de..."*
>
> *Elle écrit en gros :*
>
> **REASONING — MEMORY — ACTION — LEARNING — SECURITY**
>
> *"Ces cinq piliers. Si l'un manque, ce n'est pas vraiment un agent."*
>
> *Marc observe le schéma. "Ça ressemble à un cerveau humain, en fait."*
>
> *"Exactement. On essaie de reproduire ce que fait un développeur quand il résout un problème. Réfléchir, se souvenir, agir, apprendre, et... ne pas tout casser."*

---

## Introduction

Un agent n'est pas juste un LLM avec des outils. C'est une architecture complexe où plusieurs systèmes collaborent pour produire un comportement intelligent. Ce chapitre dissèque chaque composant d'un agent moderne et montre comment ils interagissent.

---

## 3.1 Vue d'Ensemble : Les Six Composants

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AGENT COGNITIF                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    INTERFACE UTILISATEUR                     │    │
│  │  (CLI, TUI, API, Voice)                                     │    │
│  └────────────────────────────┬────────────────────────────────┘    │
│                               │                                      │
│                               ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                       ORCHESTRATEUR                          │    │
│  │  (Boucle agentique, gestion du flow)                        │    │
│  └────────────────────────────┬────────────────────────────────┘    │
│                               │                                      │
│         ┌─────────┬───────────┼───────────┬─────────┐               │
│         │         │           │           │         │               │
│         ▼         ▼           ▼           ▼         ▼               │
│  ┌──────────┐┌──────────┐┌──────────┐┌──────────┐┌──────────┐      │
│  │ REASONING││  MEMORY  ││  ACTION  ││ LEARNING ││ SECURITY │      │
│  │          ││          ││          ││          ││          │      │
│  │ • ToT    ││ • Short  ││ • Tools  ││ • Patterns││ • Sandbox│      │
│  │ • MCTS   ││ • Long   ││ • APIs   ││ • Stats  ││ • Perms  │      │
│  │ • Repair ││ • RAG    ││ • MCP    ││ • Adapt  ││ • Audit  │      │
│  └──────────┘└──────────┘└──────────┘└──────────┘└──────────┘      │
│         │         │           │           │         │               │
│         └─────────┴───────────┼───────────┴─────────┘               │
│                               │                                      │
│                               ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                     PERSISTANCE                              │    │
│  │  (SQLite, Embeddings, Cache)                                │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

Chaque composant a un rôle précis :

| Composant | Rôle | Analogie humaine |
|-----------|------|------------------|
| **Orchestrateur** | Coordonne le flux | Conscience |
| **Reasoning** | Résout les problèmes | Réflexion |
| **Memory** | Stocke et retrouve | Mémoire |
| **Action** | Interagit avec le monde | Corps/mains |
| **Learning** | S'améliore | Expérience |
| **Security** | Protège | Prudence |

---

## 3.2 L'Orchestrateur : Le Chef d'Orchestre

### 3.2.1 La boucle agentique

L'orchestrateur implémente la boucle fondamentale de tout agent :

```
┌─────────────────────────────────────────────────────────────────────┐
│                      BOUCLE AGENTIQUE                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   START                                                             │
│     │                                                                │
│     ▼                                                                │
│   ┌─────────────┐                                                   │
│   │  PERCEIVE   │ ◄── Recevoir input utilisateur                    │
│   └──────┬──────┘     ou résultat d'outil                           │
│          │                                                           │
│          ▼                                                           │
│   ┌─────────────┐                                                   │
│   │   THINK     │ ◄── Appeler le LLM avec contexte                  │
│   └──────┬──────┘                                                   │
│          │                                                           │
│          ▼                                                           │
│   ┌─────────────┐                                                   │
│   │   DECIDE    │ ◄── Interpréter la réponse                        │
│   └──────┬──────┘                                                   │
│          │                                                           │
│    ┌─────┴─────┐                                                    │
│    │           │                                                     │
│    ▼           ▼                                                     │
│  ┌─────┐   ┌─────┐                                                  │
│  │TOOL │   │TEXT │                                                  │
│  │CALL │   │ONLY │                                                  │
│  └──┬──┘   └──┬──┘                                                  │
│     │         │                                                      │
│     ▼         │                                                      │
│  ┌─────────┐  │                                                     │
│  │ EXECUTE │  │                                                     │
│  └────┬────┘  │                                                     │
│       │       │                                                      │
│       ▼       │                                                      │
│  ┌─────────┐  │                                                     │
│  │ OBSERVE │  │                                                     │
│  └────┬────┘  │                                                     │
│       │       │                                                      │
│       └───────┴───────┐                                             │
│                       │                                              │
│               ┌───────▼───────┐                                     │
│               │   COMPLETE?   │                                     │
│               └───────┬───────┘                                     │
│                       │                                              │
│               Non ────┴──── Oui                                     │
│                │            │                                        │
│                │            ▼                                        │
│                │         ┌──────┐                                   │
│                │         │ END  │                                   │
│                │         └──────┘                                   │
│                │                                                     │
│                └───────────────────────► (retour à PERCEIVE)        │
│                                                                      │
│   Limite : max 30-400 rounds selon configuration                    │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2.2 Implémentation Grok-CLI

```typescript
// src/agent/grok-agent.ts (simplifié)
export class GrokAgent {
  private maxRounds: number = 30;
  private currentRound: number = 0;

  async run(userMessage: string): Promise<void> {
    // Ajouter le message à l'historique
    this.addMessage({ role: 'user', content: userMessage });

    while (this.currentRound < this.maxRounds) {
      this.currentRound++;

      // 1. THINK - Appeler le LLM
      const response = await this.client.chat({
        messages: this.messages,
        tools: this.getAvailableTools()
      });

      // 2. DECIDE - Analyser la réponse
      if (response.tool_calls && response.tool_calls.length > 0) {
        // Tool call demandé
        for (const toolCall of response.tool_calls) {
          // 3. EXECUTE
          const result = await this.executeTool(toolCall);

          // 4. OBSERVE - Ajouter le résultat au contexte
          this.addToolResult(toolCall.id, result);
        }
        // Continuer la boucle
      } else {
        // Réponse textuelle finale
        this.emit('response', response.content);
        break; // Fin de la boucle
      }
    }
  }
}
```

### 3.2.3 Gestion des limites

L'orchestrateur doit gérer plusieurs limites :

| Limite | Valeur typique | Raison |
|--------|----------------|--------|
| **Max rounds** | 30-400 | Éviter les boucles infinies |
| **Max tokens** | 128K | Limite du modèle |
| **Max coût** | $10/session | Budget |
| **Timeout** | 5min/tool | Performance |

```typescript
// Détection de boucle infinie
if (this.detectLoop()) {
  this.emit('warning', 'Possible boucle détectée');
  // Stratégies : reset context, changer d'approche, demander à l'utilisateur
}
```

---

## 3.3 Reasoning : Le Moteur de Réflexion

### 3.3.1 Les niveaux de raisonnement

Grok-CLI implémente plusieurs niveaux de raisonnement selon la complexité :

```
┌─────────────────────────────────────────────────────────────────────┐
│                   NIVEAUX DE REASONING                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  NIVEAU 0 : DIRECT                                                  │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Question simple → Réponse directe                          │    │
│  │  "Quelle heure est-il ?" → Appel tool datetime              │    │
│  │  Tokens thinking : 0                                        │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  NIVEAU 1 : CHAIN-OF-THOUGHT (think)                               │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Problème modéré → Raisonnement linéaire                    │    │
│  │  "Refactor cette fonction" → Analyse → Plan → Exécution     │    │
│  │  Tokens thinking : ~4,000                                   │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  NIVEAU 2 : TREE-OF-THOUGHT (megathink)                            │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Problème complexe → Exploration multi-chemins              │    │
│  │  "Debug ce crash aléatoire" → Hypothèses → Tests → Solution │    │
│  │  Tokens thinking : ~10,000                                  │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  NIVEAU 3 : MCTS (ultrathink)                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Problème critique → Simulation et optimisation             │    │
│  │  "Redesign l'architecture" → Variantes → Évaluation → Best  │    │
│  │  Tokens thinking : ~32,000                                  │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.3.2 Détection du niveau requis

```typescript
// src/agent/thinking-keywords.ts (simplifié)
export class ThinkingKeywordsManager {
  detectLevel(message: string): ThinkingLevel {
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes('ultrathink') ||
        lowerMessage.includes('deep analysis')) {
      return ThinkingLevel.MCTS;
    }

    if (lowerMessage.includes('megathink') ||
        lowerMessage.includes('think hard')) {
      return ThinkingLevel.TREE_OF_THOUGHT;
    }

    if (lowerMessage.includes('think') ||
        this.isComplexTask(message)) {
      return ThinkingLevel.CHAIN_OF_THOUGHT;
    }

    return ThinkingLevel.DIRECT;
  }

  private isComplexTask(message: string): boolean {
    const complexIndicators = [
      'debug', 'refactor', 'optimize', 'architect',
      'investigate', 'analyze', 'design'
    ];
    return complexIndicators.some(ind =>
      message.toLowerCase().includes(ind)
    );
  }
}
```

### 3.3.3 Architecture du module Reasoning

```
src/agent/reasoning/
├── index.ts              # Point d'entrée, routing
├── tree-of-thought.ts    # Exploration multi-chemins
├── mcts.ts               # Monte-Carlo Tree Search
├── evaluator.ts          # Évaluation des solutions
└── pruning.ts            # Élagage des branches inutiles
```

---

## 3.4 Memory : La Mémoire Multi-Niveaux

### 3.4.1 Les trois horizons de mémoire

```
┌─────────────────────────────────────────────────────────────────────┐
│                    ARCHITECTURE MÉMOIRE                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │              MÉMOIRE COURT TERME                             │    │
│  │  ┌─────────────────────────────────────────────────────┐    │    │
│  │  │  Conversation courante                               │    │    │
│  │  │  • Messages user/assistant                           │    │    │
│  │  │  • Tool calls et résultats                          │    │    │
│  │  │  • Durée : session active                           │    │    │
│  │  │  • Stockage : RAM                                   │    │    │
│  │  └─────────────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                              │                                       │
│                              ▼                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │              MÉMOIRE MOYEN TERME                             │    │
│  │  ┌─────────────────────────────────────────────────────┐    │    │
│  │  │  Contexte de session                                 │    │    │
│  │  │  • Fichiers lus/modifiés                            │    │    │
│  │  │  • Décisions prises                                 │    │    │
│  │  │  • Durée : session (heures)                         │    │    │
│  │  │  • Stockage : SQLite (sessions table)               │    │    │
│  │  └─────────────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                              │                                       │
│                              ▼                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │              MÉMOIRE LONG TERME                              │    │
│  │  ┌─────────────────────────────────────────────────────┐    │    │
│  │  │  Connaissances persistantes                          │    │    │
│  │  │  • Embeddings du codebase                           │    │    │
│  │  │  • Patterns de réparation appris                    │    │    │
│  │  │  • Conventions du projet                            │    │    │
│  │  │  • Durée : permanente                               │    │    │
│  │  │  • Stockage : SQLite + fichiers embeddings          │    │    │
│  │  └─────────────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.4.2 Schéma de la base de données

```sql
-- src/database/schema.sql (simplifié)

-- Mémoire long terme avec embeddings
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  type TEXT NOT NULL,  -- 'fact', 'preference', 'convention'
  embedding BLOB,      -- Vecteur 384/1536 dimensions
  importance REAL DEFAULT 0.5,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  accessed_at DATETIME,
  access_count INTEGER DEFAULT 0
);

-- Sessions (mémoire moyen terme)
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  started_at DATETIME,
  ended_at DATETIME,
  summary TEXT,
  metadata JSON
);

-- Messages de conversation
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  role TEXT NOT NULL,  -- 'user', 'assistant', 'tool'
  content TEXT,
  tool_calls JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Patterns de réparation appris
CREATE TABLE repair_learning (
  id TEXT PRIMARY KEY,
  error_pattern TEXT NOT NULL,
  solution_pattern TEXT NOT NULL,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  confidence REAL GENERATED ALWAYS AS (
    success_count * 1.0 / (success_count + failure_count + 1)
  )
);
```

### 3.4.3 RAG : Retrieval-Augmented Generation

Le RAG permet de retrouver les informations pertinentes dans la mémoire long terme :

```typescript
// src/context/codebase-rag/retriever.ts (simplifié)
export class CodebaseRetriever {
  async retrieve(query: string, limit: number = 5): Promise<RetrievedDoc[]> {
    // 1. Générer l'embedding de la query
    const queryEmbedding = await this.embedder.embed(query);

    // 2. Recherche par similarité cosine
    const candidates = await this.db.query(`
      SELECT id, content, embedding,
             cosine_similarity(embedding, ?) as score
      FROM code_embeddings
      ORDER BY score DESC
      LIMIT ?
    `, [queryEmbedding, limit * 2]);

    // 3. Reranking avec les dépendances
    const reranked = await this.dependencyAwareRerank(candidates, query);

    return reranked.slice(0, limit);
  }
}
```

### 3.4.4 Compression de contexte

Quand le contexte devient trop grand :

```typescript
// src/context/context-compressor.ts (simplifié)
export class ContextCompressor {
  compress(context: Context, maxTokens: number): Context {
    const prioritized = this.prioritize(context);

    let tokens = 0;
    const result: Context = { messages: [] };

    for (const item of prioritized) {
      const itemTokens = this.countTokens(item);

      if (tokens + itemTokens > maxTokens) {
        // Tenter de résumer au lieu de supprimer
        const summary = this.summarize(item);
        if (tokens + this.countTokens(summary) <= maxTokens) {
          result.messages.push(summary);
          tokens += this.countTokens(summary);
        }
        // Sinon, skip
      } else {
        result.messages.push(item);
        tokens += itemTokens;
      }
    }

    return result;
  }

  private prioritize(context: Context): Message[] {
    // Ordre de priorité :
    // 1. System prompt (toujours)
    // 2. Derniers messages user/assistant
    // 3. Tool results récents
    // 4. Contexte code actif
    // 5. Historique ancien (résumé)
    return context.messages.sort((a, b) =>
      this.getPriority(b) - this.getPriority(a)
    );
  }
}
```

---

## 3.5 Action : Les Outils de l'Agent

### 3.5.1 Anatomie d'un outil

Chaque outil suit une interface standard :

```typescript
// src/tools/types.ts
export interface Tool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  requiresConfirmation?: boolean;
  timeout?: number;

  execute(args: Record<string, unknown>): Promise<ToolResult>;
}

export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}
```

### 3.5.2 Les 41 outils de Grok-CLI

```
┌─────────────────────────────────────────────────────────────────────┐
│                       CATALOGUE D'OUTILS                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  FICHIERS (12 outils)                                               │
│  ├── read_file          Lire un fichier                             │
│  ├── write_file         Écrire un fichier                           │
│  ├── edit_file          Éditer une partie de fichier                │
│  ├── multi_edit         Éditions multiples atomiques                │
│  ├── list_directory     Lister un répertoire                        │
│  ├── create_directory   Créer un répertoire                         │
│  ├── delete_file        Supprimer un fichier                        │
│  ├── move_file          Déplacer/renommer                           │
│  ├── copy_file          Copier un fichier                           │
│  ├── file_info          Métadonnées d'un fichier                    │
│  ├── find_files         Recherche par pattern glob                  │
│  └── search_content     Recherche dans le contenu                   │
│                                                                      │
│  SHELL (4 outils)                                                   │
│  ├── bash               Exécuter une commande                       │
│  ├── interactive_bash   Session shell interactive                   │
│  ├── background_task    Tâche en arrière-plan                       │
│  └── kill_process       Terminer un processus                       │
│                                                                      │
│  GIT (5 outils)                                                     │
│  ├── git_status         État du repo                                │
│  ├── git_diff           Différences                                 │
│  ├── git_commit         Créer un commit                             │
│  ├── git_log            Historique                                  │
│  └── git_branch         Gestion branches                            │
│                                                                      │
│  RECHERCHE (4 outils)                                               │
│  ├── search_code        Recherche sémantique                        │
│  ├── find_symbol        Trouver définition                          │
│  ├── find_references    Trouver utilisations                        │
│  └── search_web         Recherche web                               │
│                                                                      │
│  MÉDIAS (5 outils)                                                  │
│  ├── screenshot         Capture d'écran                             │
│  ├── audio_transcribe   Transcrire audio                            │
│  ├── video_extract      Extraire frames                             │
│  ├── image_analyze      Analyser image                              │
│  └── qr_code            Générer/lire QR                             │
│                                                                      │
│  DOCUMENTS (5 outils)                                               │
│  ├── pdf_extract        Extraire texte PDF                          │
│  ├── excel_read         Lire Excel/CSV                              │
│  ├── excel_write        Écrire Excel                                │
│  ├── archive_extract    Extraire archives                           │
│  └── archive_create     Créer archives                              │
│                                                                      │
│  SYSTÈME (6 outils)                                                 │
│  ├── memory_store       Stocker en mémoire                          │
│  ├── memory_recall      Rappeler de mémoire                         │
│  ├── spawn_agent        Lancer sous-agent                           │
│  ├── http_request       Requête HTTP                                │
│  ├── database_query     Query SQL                                   │
│  └── thinking           Réflexion approfondie                       │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.5.3 Exemple d'implémentation d'outil

```typescript
// src/tools/text-editor.ts (simplifié)
export class ReadFileTool implements Tool {
  name = 'read_file';
  description = 'Read the contents of a file at the specified path';

  inputSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The path to the file to read'
      },
      encoding: {
        type: 'string',
        enum: ['utf-8', 'base64'],
        default: 'utf-8'
      }
    },
    required: ['path']
  };

  requiresConfirmation = false; // Lecture = safe

  async execute(args: { path: string; encoding?: string }): Promise<ToolResult> {
    try {
      // Validation du chemin
      const safePath = this.validatePath(args.path);

      // Lecture
      const content = await fs.readFile(safePath, {
        encoding: args.encoding ?? 'utf-8'
      });

      // Troncature si trop long
      const truncated = this.truncateIfNeeded(content, 50000);

      return {
        success: true,
        output: truncated.content,
        metadata: {
          path: safePath,
          size: content.length,
          truncated: truncated.wasTruncated
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to read file: ${error.message}`
      };
    }
  }

  private validatePath(path: string): string {
    // Empêcher path traversal
    const resolved = path.resolve(path);
    const cwd = process.cwd();

    if (!resolved.startsWith(cwd)) {
      throw new Error('Path outside working directory');
    }

    return resolved;
  }
}
```

### 3.5.4 Flux d'exécution d'un outil

```
┌─────────────────────────────────────────────────────────────────────┐
│                  FLUX D'EXÉCUTION OUTIL                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   LLM demande : { tool: "bash", args: { command: "rm -rf /" } }    │
│                              │                                       │
│                              ▼                                       │
│   ┌──────────────────────────────────────────────────────────┐      │
│   │                    VALIDATION                             │      │
│   │  1. Schema JSON valide ?                                 │      │
│   │  2. Paramètres requis présents ?                         │      │
│   │  3. Types corrects ?                                     │      │
│   └──────────────────────────────────────────────────────────┘      │
│                              │                                       │
│                              ▼                                       │
│   ┌──────────────────────────────────────────────────────────┐      │
│   │                    SÉCURITÉ                               │      │
│   │  1. Commande blacklistée ? (rm -rf /, format C:)         │      │
│   │  2. Path dans working dir ?                              │      │
│   │  3. Permissions suffisantes ?                            │      │
│   └──────────────────────────────────────────────────────────┘      │
│                              │                                       │
│                              ▼                                       │
│   ┌──────────────────────────────────────────────────────────┐      │
│   │                  CONFIRMATION                             │      │
│   │  Si requiresConfirmation = true :                        │      │
│   │  → Afficher à l'utilisateur                              │      │
│   │  → Attendre approbation                                  │      │
│   │  → Si refusé : annuler                                   │      │
│   └──────────────────────────────────────────────────────────┘      │
│                              │                                       │
│                              ▼                                       │
│   ┌──────────────────────────────────────────────────────────┐      │
│   │                    EXÉCUTION                              │      │
│   │  1. Sandbox si nécessaire (firejail)                     │      │
│   │  2. Timeout                                              │      │
│   │  3. Capture stdout/stderr                                │      │
│   └──────────────────────────────────────────────────────────┘      │
│                              │                                       │
│                              ▼                                       │
│   ┌──────────────────────────────────────────────────────────┐      │
│   │                  POST-TRAITEMENT                          │      │
│   │  1. Redaction de secrets (API keys, passwords)           │      │
│   │  2. Troncature si output trop long                       │      │
│   │  3. Logging pour audit                                   │      │
│   └──────────────────────────────────────────────────────────┘      │
│                              │                                       │
│                              ▼                                       │
│   Résultat retourné au LLM                                          │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3.6 Learning : L'Apprentissage Continu

### 3.6.1 Ce que l'agent apprend

```
┌─────────────────────────────────────────────────────────────────────┐
│                    APPRENTISSAGE AGENT                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  PATTERNS DE RÉPARATION                                             │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Erreur observée → Solution appliquée → Résultat            │    │
│  │                                                              │    │
│  │  Exemple :                                                   │    │
│  │  "Cannot find module 'X'" → npm install X → ✓ résolu        │    │
│  │  → Mémorisé avec confidence 0.95                            │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  CONVENTIONS DE CODE                                                │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Style observé dans le projet                               │    │
│  │                                                              │    │
│  │  • Indentation : 2 spaces                                   │    │
│  │  • Quotes : single                                          │    │
│  │  • Semicolons : yes                                         │    │
│  │  • Naming : camelCase                                       │    │
│  │  → Appliqué automatiquement au code généré                  │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  STATISTIQUES D'OUTILS                                              │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Outil → Temps moyen → Taux succès → Fréquence              │    │
│  │                                                              │    │
│  │  bash      : 1.2s, 85%, 45%                                 │    │
│  │  read_file : 0.1s, 99%, 30%                                 │    │
│  │  edit_file : 0.3s, 92%, 20%                                 │    │
│  │  → Utilisé pour prédiction et optimisation                  │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  PRÉFÉRENCES UTILISATEUR                                            │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Comportements observés                                     │    │
│  │                                                              │    │
│  │  • Préfère explications détaillées                          │    │
│  │  • Demande confirmation avant git push                      │    │
│  │  • Utilise TypeScript strict                                │    │
│  │  → Personnalise les réponses futures                        │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.6.2 Boucle d'apprentissage

```typescript
// src/learning/persistent-learning.ts (simplifié)
export class PersistentLearning {
  async learnFromRepair(
    error: string,
    solution: string,
    success: boolean
  ): Promise<void> {
    // Extraire le pattern d'erreur
    const errorPattern = this.extractPattern(error);

    // Chercher si on connaît déjà ce pattern
    const existing = await this.db.query(`
      SELECT * FROM repair_learning
      WHERE error_pattern = ?
    `, [errorPattern]);

    if (existing) {
      // Mettre à jour les stats
      await this.db.run(`
        UPDATE repair_learning
        SET ${success ? 'success_count' : 'failure_count'} =
            ${success ? 'success_count' : 'failure_count'} + 1
        WHERE id = ?
      `, [existing.id]);
    } else {
      // Nouveau pattern
      await this.db.run(`
        INSERT INTO repair_learning (error_pattern, solution_pattern, success_count)
        VALUES (?, ?, ?)
      `, [errorPattern, solution, success ? 1 : 0]);
    }
  }

  async suggestSolution(error: string): Promise<string | null> {
    const errorPattern = this.extractPattern(error);

    // Chercher les solutions avec haute confiance
    const solutions = await this.db.query(`
      SELECT solution_pattern, confidence
      FROM repair_learning
      WHERE error_pattern LIKE ?
      AND confidence > 0.7
      ORDER BY confidence DESC
      LIMIT 1
    `, [`%${errorPattern}%`]);

    return solutions[0]?.solution_pattern ?? null;
  }
}
```

---

## 3.7 Security : La Protection Multi-Couches

### 3.7.1 Les trois modes d'approbation

```
┌─────────────────────────────────────────────────────────────────────┐
│                    MODES D'APPROBATION                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  MODE 1 : READ-ONLY (Minimal trust)                                 │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  ✓ Autorisé : read_file, list_dir, git_status, search       │    │
│  │  ✗ Bloqué  : write, edit, bash, delete, git_commit          │    │
│  │  Usage    : Exploration, audit, review                       │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  MODE 2 : AUTO-APPROVE (Default)                                    │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  ✓ Auto   : read, write dans working dir, git add/commit    │    │
│  │  ? Confirm: bash dangereux, delete, git push                │    │
│  │  ✗ Bloqué : rm -rf, format, credentials                     │    │
│  │  Usage    : Développement quotidien                          │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  MODE 3 : FULL-ACCESS (YOLO mode)                                   │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  ✓ Auto   : Tout sauf blacklist absolue                     │    │
│  │  ✗ Bloqué : rm -rf /, format, credentials en clair          │    │
│  │  Usage    : Scripts automatisés, CI/CD                       │    │
│  │  ⚠️ DANGER : À utiliser avec précaution                       │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.7.2 Architecture de sécurité

```typescript
// src/security/index.ts (simplifié)
export class SecurityManager {
  private approvalMode: ApprovalMode;
  private sandbox: SandboxManager;
  private redactor: DataRedactor;
  private auditor: SecurityAuditor;

  async checkPermission(tool: Tool, args: unknown): Promise<PermissionResult> {
    // 1. Vérifier la blacklist absolue
    if (this.isAbsolutelyForbidden(tool, args)) {
      return { allowed: false, reason: 'Operation forbidden' };
    }

    // 2. Vérifier selon le mode
    const modeResult = this.approvalMode.check(tool, args);
    if (!modeResult.allowed) {
      return modeResult;
    }

    // 3. Vérifier les permissions spécifiques
    const permResult = await this.checkSpecificPermissions(tool, args);

    return permResult;
  }

  async executeSecurely(tool: Tool, args: unknown): Promise<ToolResult> {
    // 1. Sandbox si nécessaire
    const executor = this.shouldSandbox(tool)
      ? this.sandbox.wrap(tool.execute)
      : tool.execute;

    // 2. Exécuter avec timeout
    const result = await withTimeout(
      executor(args),
      tool.timeout ?? 30000
    );

    // 3. Redacter les secrets dans l'output
    const redactedResult = this.redactor.redact(result);

    // 4. Logger pour audit
    await this.auditor.log({
      tool: tool.name,
      args: this.redactor.redact(args),
      result: redactedResult,
      timestamp: new Date()
    });

    return redactedResult;
  }
}
```

### 3.7.3 Redaction automatique

```typescript
// src/security/data-redaction.ts (simplifié)
export class DataRedactor {
  private patterns = [
    // API Keys
    { regex: /(?:api[_-]?key|apikey)[=:]\s*["']?([a-zA-Z0-9_-]{20,})["']?/gi,
      replace: '$1=[REDACTED]' },

    // Passwords
    { regex: /(?:password|passwd|pwd)[=:]\s*["']?([^"'\s]+)["']?/gi,
      replace: '$1=[REDACTED]' },

    // Tokens
    { regex: /(?:token|bearer)\s+([a-zA-Z0-9._-]{20,})/gi,
      replace: 'token [REDACTED]' },

    // AWS Keys
    { regex: /AKIA[0-9A-Z]{16}/g,
      replace: '[AWS_KEY_REDACTED]' },

    // Private keys
    { regex: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END/g,
      replace: '[PRIVATE_KEY_REDACTED]' }
  ];

  redact(data: unknown): unknown {
    if (typeof data === 'string') {
      return this.redactString(data);
    }
    if (typeof data === 'object' && data !== null) {
      return this.redactObject(data);
    }
    return data;
  }

  private redactString(str: string): string {
    let result = str;
    for (const pattern of this.patterns) {
      result = result.replace(pattern.regex, pattern.replace);
    }
    return result;
  }
}
```

---

## 3.8 Persistance : La Fondation Stable

### 3.8.1 Architecture de stockage

```
┌─────────────────────────────────────────────────────────────────────┐
│                    ARCHITECTURE PERSISTANCE                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ~/.grok/                                                           │
│  ├── grok.db                    SQLite principal                    │
│  │   ├── memories               Mémoire long terme                  │
│  │   ├── sessions               Historique sessions                 │
│  │   ├── messages               Messages conversation               │
│  │   ├── repair_learning        Patterns de réparation              │
│  │   ├── conventions            Conventions code                    │
│  │   ├── tool_stats             Stats d'utilisation                 │
│  │   └── analytics              Métriques                           │
│  │                                                                   │
│  ├── cache/                                                         │
│  │   ├── semantic-cache.json    Cache réponses API                  │
│  │   ├── tool-cache.json        Cache résultats outils              │
│  │   └── embeddings/            Embeddings calculés                 │
│  │                                                                   │
│  ├── settings.json              Configuration utilisateur           │
│  └── logs/                      Logs structurés                     │
│                                                                      │
│  .grok/ (dans le projet)                                            │
│  ├── project-settings.json      Config projet                       │
│  ├── mcp.json                   Serveurs MCP                        │
│  ├── hooks.json                 Hooks personnalisés                 │
│  └── approval-mode.json         Mode d'approbation                  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.8.2 Caching multi-niveaux

```typescript
// src/performance/cache-manager.ts (simplifié)
export class CacheManager {
  private semanticCache: SemanticCache;
  private toolCache: ToolCache;
  private memoryCache: Map<string, unknown>;

  async get<T>(key: string, type: CacheType): Promise<T | null> {
    // 1. Cache mémoire (plus rapide)
    if (this.memoryCache.has(key)) {
      return this.memoryCache.get(key) as T;
    }

    // 2. Cache approprié selon le type
    let value: T | null = null;

    switch (type) {
      case 'semantic':
        value = await this.semanticCache.find(key);
        break;
      case 'tool':
        value = await this.toolCache.get(key);
        break;
    }

    // 3. Mettre en cache mémoire si trouvé
    if (value !== null) {
      this.memoryCache.set(key, value);
    }

    return value;
  }
}
```

---

## 3.9 Le Flux Complet : Un Exemple

> *Lina tape une commande :*
>
> `"Trouve et corrige le bug dans la fonction calculateTotal"`

Voici ce qui se passe dans l'agent :

```
┌─────────────────────────────────────────────────────────────────────┐
│            FLUX COMPLET : "Corrige le bug dans calculateTotal"       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. ORCHESTRATEUR reçoit le message                                 │
│     └─► Ajoute à l'historique de conversation                       │
│                                                                      │
│  2. MEMORY rappelle le contexte                                     │
│     └─► RAG trouve : calculateTotal dans src/utils/math.ts          │
│     └─► Charge les dépendances : types.ts, constants.ts             │
│                                                                      │
│  3. REASONING évalue la complexité                                  │
│     └─► "debug" détecté → Chain-of-thought activé                   │
│                                                                      │
│  4. LLM appelé avec contexte enrichi                                │
│     └─► Prompt : message + fichiers + instructions de debug         │
│                                                                      │
│  5. LLM répond : tool_call(search_content, {pattern: "error"})      │
│                                                                      │
│  6. SECURITY vérifie                                                │
│     └─► search_content = lecture seule = auto-approved              │
│                                                                      │
│  7. ACTION exécute                                                  │
│     └─► Recherche dans math.ts                                      │
│     └─► Trouve : ligne 45, division potentielle par 0               │
│                                                                      │
│  8. ORCHESTRATEUR continue la boucle                                │
│                                                                      │
│  9. LLM analyse et propose : tool_call(edit_file, {...})            │
│                                                                      │
│ 10. SECURITY vérifie                                                │
│     └─► edit_file dans working dir = auto-approved                  │
│                                                                      │
│ 11. ACTION exécute                                                  │
│     └─► Ajoute garde : if (divisor === 0) throw new Error(...)      │
│                                                                      │
│ 12. LLM propose : tool_call(bash, {command: "npm test"})            │
│                                                                      │
│ 13. ACTION exécute les tests                                        │
│     └─► Tests passent ✓                                             │
│                                                                      │
│ 14. LEARNING mémorise                                               │
│     └─► Pattern : "division by zero" → "add guard check"            │
│     └─► Confidence +1                                               │
│                                                                      │
│ 15. LLM répond : "Bug corrigé ! Ajouté vérification division..."    │
│                                                                      │
│ 16. ORCHESTRATEUR termine                                           │
│     └─► Affiche la réponse à l'utilisateur                          │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Résumé

Dans ce chapitre, nous avons disséqué les six composants d'un agent :

| Composant | Rôle | Fichiers clés Grok-CLI |
|-----------|------|------------------------|
| **Orchestrateur** | Coordonne la boucle | `grok-agent.ts` |
| **Reasoning** | Résout les problèmes | `reasoning/*.ts` |
| **Memory** | Stocke et retrouve | `database/`, `context/` |
| **Action** | Exécute les outils | `tools/*.ts` |
| **Learning** | S'améliore | `learning/*.ts` |
| **Security** | Protège | `security/*.ts` |

---

## Exercices

1. **Diagramme** : Dessinez le flux pour la commande "Crée un fichier test.txt avec Hello World".

2. **Implémentation** : Implémentez un outil simple (ex: `word_count`) en suivant l'interface `Tool`.

3. **Sécurité** : Listez 5 commandes bash qui devraient être bloquées et pourquoi.

4. **Mémoire** : Concevez le schéma SQL pour stocker les préférences utilisateur.

---

## Pour aller plus loin

- Grok-CLI Source : `src/agent/grok-agent.ts`
- Tool Implementations : `src/tools/`
- Security Layer : `src/security/`

---

*Fin de la Partie I — Fondations*

*Prochainement : Partie II — Reasoning & Planification*
*Chapitre 4 — Tree-of-Thought (ToT)*

