# Chapitre 14 : Apprentissage Persistant — L'Agent qui Évolue

---

## Scène d'ouverture : La Mémoire d'Hier

*Un mardi matin ordinaire...*

Lina ouvrait Grok-CLI pour la centième fois peut-être. Mais cette fois, quelque chose de différent se produisit.

```
grok> Bonjour !

Agent: Bonjour Lina ! Je vois que tu travailles sur le module de paiement
cette semaine. Hier, tu as corrigé un bug dans la validation des cartes.
Veux-tu que je te montre les tests qui pourraient encore échouer ?
```

Elle resta figée un instant. L'agent se *souvenait*. Non seulement de la conversation d'hier, mais du contexte de son travail, de ses habitudes, de ses préférences.

— "Comment..." commença-t-elle.

Puis elle sourit. Bien sûr. C'était le système de mémoire persistante qu'elle avait implémenté le mois dernier. Mais le voir fonctionner en pratique, avec cette fluidité naturelle, était autre chose.

Elle tapa :

```
grok> Montre-moi l'évolution de mes patterns de travail

Agent: Voici ton profil d'utilisation sur les 30 derniers jours :

📊 Sessions : 47 (moyenne 45 min)
🔧 Outil favori : multi-edit (234 utilisations)
📁 Fichiers fréquents : src/payment/*.ts (68%)
⏰ Heures actives : 9h-12h, 14h-18h
🎯 Taux de succès : 94% (en hausse de +7%)

Insights découverts :
- Tu préfères les commits atomiques (1-3 fichiers)
- Tu exécutes les tests après chaque modification majeure
- Tu utilises rarement la recherche fuzzy (préférence grep exact)
```

C'était comme avoir un assistant qui apprenait vraiment de chaque interaction.

---

## 14.1 Pourquoi l'Apprentissage Persistant ?

### 14.1.1 Les Limites du Stateless

Par défaut, les LLMs sont *stateless* — chaque conversation repart de zéro :

```
┌─────────────────────────────────────────────────────────────┐
│              AGENT STATELESS (TRADITIONNEL)                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Session 1        Session 2        Session 3               │
│  ┌─────────┐      ┌─────────┐      ┌─────────┐             │
│  │ "Qui    │      │ "Qui    │      │ "Qui    │             │
│  │  suis-  │      │  suis-  │      │  suis-  │             │
│  │  je ?" │       │  je ?"  │      │  je ?"  │             │
│  └─────────┘      └─────────┘      └─────────┘             │
│       ↓                ↓                ↓                   │
│  "Je ne sais      "Je ne sais      "Je ne sais             │
│   pas, je suis     pas, je suis     pas, je suis           │
│   un assistant"    un assistant"    un assistant"          │
│                                                             │
│  ❌ Pas de continuité                                       │
│  ❌ Répétition des mêmes erreurs                            │
│  ❌ Aucune personnalisation                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 14.1.2 L'Agent avec Mémoire Persistante

```
┌─────────────────────────────────────────────────────────────┐
│              AGENT AVEC MÉMOIRE PERSISTANTE                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Session 1        Session 2        Session 3               │
│  ┌─────────┐      ┌─────────┐      ┌─────────┐             │
│  │ "Qui    │      │ "Continue"│    │ "Comme  │             │
│  │  suis-  │      │           │    │  d'hab" │             │
│  │  je ?"  │      │           │    │         │             │
│  └─────────┘      └─────────┘      └─────────┘             │
│       │                │                │                   │
│       └────────────────┼────────────────┘                   │
│                        ↓                                    │
│              ┌──────────────────┐                           │
│              │  MÉMOIRE         │                           │
│              │  PERSISTANTE     │                           │
│              │  ├─ Profil user  │                           │
│              │  ├─ Historique   │                           │
│              │  ├─ Préférences  │                           │
│              │  └─ Leçons       │                           │
│              └──────────────────┘                           │
│                        ↓                                    │
│  "Bonjour Lina !   "Je reprends    "Je lance les          │
│   Tu travailles     le refactoring  tests payment          │
│   sur payment"      d'hier"         comme tu aimes"        │
│                                                             │
│  ✓ Continuité entre sessions                                │
│  ✓ Apprentissage des erreurs                                │
│  ✓ Personnalisation croissante                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 14.1.3 Types de Mémoire

```
┌─────────────────────────────────────────────────────────────┐
│            TAXONOMIE DES MÉMOIRES D'AGENT                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. MÉMOIRE ÉPISODIQUE                                      │
│     └─ "Que s'est-il passé ?"                               │
│        ├─ Conversations passées                             │
│        ├─ Actions effectuées                                │
│        └─ Résultats obtenus                                 │
│                                                             │
│  2. MÉMOIRE SÉMANTIQUE                                      │
│     └─ "Qu'ai-je appris ?"                                  │
│        ├─ Faits sur le codebase                             │
│        ├─ Préférences utilisateur                           │
│        └─ Patterns récurrents                               │
│                                                             │
│  3. MÉMOIRE PROCÉDURALE                                     │
│     └─ "Comment faire ?"                                    │
│        ├─ Séquences d'actions efficaces                     │
│        ├─ Solutions à des problèmes types                   │
│        └─ Workflows optimisés                               │
│                                                             │
│  4. MÉMOIRE PROSPECTIVE                                     │
│     └─ "Que dois-je faire ensuite ?"                        │
│        ├─ Tâches planifiées                                 │
│        ├─ Rappels contextuels                               │
│        └─ Objectifs à long terme                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 14.2 Architecture de la Mémoire Persistante

### 14.2.1 Structure du Système de Mémoire

```typescript
// src/memory/memory-system.ts

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Types de mémoire supportés
 */
export enum MemoryType {
  EPISODIC = 'episodic',     // Événements passés
  SEMANTIC = 'semantic',      // Connaissances apprises
  PROCEDURAL = 'procedural',  // Comment faire
  PROSPECTIVE = 'prospective' // À faire
}

/**
 * Entrée de mémoire générique
 */
interface MemoryEntry {
  id: string;
  type: MemoryType;
  content: unknown;
  timestamp: number;
  importance: number;  // 0-1
  accessCount: number;
  lastAccessed: number;
  metadata: Record<string, unknown>;
  embedding?: number[];  // Pour recherche sémantique
}

/**
 * Système de mémoire persistante unifié
 */
export class MemorySystem extends EventEmitter {
  private memories: Map<string, MemoryEntry> = new Map();
  private indices: {
    byType: Map<MemoryType, Set<string>>;
    byImportance: string[];  // Trié par importance
    byRecency: string[];     // Trié par date
  };
  private storagePath: string;
  private dirty: boolean = false;
  private autoSaveInterval: NodeJS.Timeout | null = null;

  constructor(storagePath: string) {
    super();
    this.storagePath = storagePath;
    this.indices = {
      byType: new Map(),
      byImportance: [],
      byRecency: []
    };

    // Initialiser les indices par type
    for (const type of Object.values(MemoryType)) {
      this.indices.byType.set(type, new Set());
    }
  }

  /**
   * Initialisation et chargement
   */
  async initialize(): Promise<void> {
    await this.load();
    this.startAutoSave();
    console.log(`[Memory] Loaded ${this.memories.size} memories`);
  }

  /**
   * Ajoute une nouvelle mémoire
   */
  async remember(
    type: MemoryType,
    content: unknown,
    options: RememberOptions = {}
  ): Promise<string> {
    const id = this.generateId();
    const now = Date.now();

    const entry: MemoryEntry = {
      id,
      type,
      content,
      timestamp: now,
      importance: options.importance ?? this.calculateImportance(content),
      accessCount: 0,
      lastAccessed: now,
      metadata: options.metadata ?? {},
      embedding: options.embedding
    };

    this.memories.set(id, entry);
    this.updateIndices(entry);
    this.dirty = true;

    this.emit('remember', entry);

    return id;
  }

  /**
   * Rappel d'une mémoire par ID
   */
  async recall(id: string): Promise<MemoryEntry | null> {
    const entry = this.memories.get(id);

    if (entry) {
      // Mise à jour des métriques d'accès
      entry.accessCount++;
      entry.lastAccessed = Date.now();
      this.dirty = true;

      this.emit('recall', entry);
    }

    return entry ?? null;
  }

  /**
   * Recherche dans les mémoires
   */
  async search(query: MemoryQuery): Promise<MemoryEntry[]> {
    let candidates: MemoryEntry[] = [];

    // Filtrage par type
    if (query.type) {
      const typeIds = this.indices.byType.get(query.type);
      if (typeIds) {
        candidates = Array.from(typeIds)
          .map(id => this.memories.get(id)!)
          .filter(Boolean);
      }
    } else {
      candidates = Array.from(this.memories.values());
    }

    // Filtrage par période
    if (query.since) {
      candidates = candidates.filter(m => m.timestamp >= query.since!);
    }
    if (query.until) {
      candidates = candidates.filter(m => m.timestamp <= query.until!);
    }

    // Filtrage par importance minimale
    if (query.minImportance) {
      candidates = candidates.filter(m => m.importance >= query.minImportance!);
    }

    // Recherche textuelle
    if (query.text) {
      const searchText = query.text.toLowerCase();
      candidates = candidates.filter(m => {
        const content = JSON.stringify(m.content).toLowerCase();
        return content.includes(searchText);
      });
    }

    // Recherche sémantique
    if (query.embedding) {
      candidates = this.rankBySimilarity(candidates, query.embedding);
    }

    // Tri
    switch (query.sortBy) {
      case 'importance':
        candidates.sort((a, b) => b.importance - a.importance);
        break;
      case 'recency':
        candidates.sort((a, b) => b.timestamp - a.timestamp);
        break;
      case 'frequency':
        candidates.sort((a, b) => b.accessCount - a.accessCount);
        break;
    }

    // Limite
    if (query.limit) {
      candidates = candidates.slice(0, query.limit);
    }

    return candidates;
  }

  /**
   * Oubli d'une mémoire
   */
  async forget(id: string): Promise<boolean> {
    const entry = this.memories.get(id);
    if (!entry) return false;

    this.memories.delete(id);
    this.removeFromIndices(entry);
    this.dirty = true;

    this.emit('forget', entry);

    return true;
  }

  /**
   * Consolidation des mémoires (nettoyage intelligent)
   */
  async consolidate(): Promise<ConsolidationReport> {
    const report: ConsolidationReport = {
      memoriesAnalyzed: this.memories.size,
      merged: 0,
      archived: 0,
      forgotten: 0,
      promoted: 0
    };

    const now = Date.now();
    const oneWeek = 7 * 24 * 60 * 60 * 1000;
    const oneMonth = 30 * 24 * 60 * 60 * 1000;

    for (const [id, entry] of this.memories) {
      const age = now - entry.timestamp;
      const staleness = now - entry.lastAccessed;

      // Oubli des mémoires non importantes et jamais accédées
      if (entry.importance < 0.2 && entry.accessCount === 0 && age > oneWeek) {
        await this.forget(id);
        report.forgotten++;
        continue;
      }

      // Archivage des mémoires anciennes mais potentiellement utiles
      if (age > oneMonth && staleness > oneWeek && entry.importance < 0.5) {
        entry.metadata.archived = true;
        report.archived++;
        continue;
      }

      // Promotion des mémoires fréquemment accédées
      if (entry.accessCount > 10 && entry.importance < 0.8) {
        entry.importance = Math.min(1, entry.importance + 0.1);
        report.promoted++;
      }
    }

    // Fusion des mémoires similaires
    report.merged = await this.mergeSimilarMemories();

    this.dirty = true;
    await this.save();

    return report;
  }

  /**
   * Fusion des mémoires similaires
   */
  private async mergeSimilarMemories(): Promise<number> {
    let merged = 0;
    const processedPairs = new Set<string>();

    for (const [id1, entry1] of this.memories) {
      if (!entry1.embedding) continue;

      for (const [id2, entry2] of this.memories) {
        if (id1 >= id2 || !entry2.embedding) continue;

        const pairKey = `${id1}-${id2}`;
        if (processedPairs.has(pairKey)) continue;
        processedPairs.add(pairKey);

        // Calcul de similarité
        const similarity = this.cosineSimilarity(
          entry1.embedding,
          entry2.embedding
        );

        // Fusion si très similaires
        if (similarity > 0.95 && entry1.type === entry2.type) {
          // Garder la plus importante, fusionner les métadonnées
          if (entry1.importance >= entry2.importance) {
            this.mergeInto(entry1, entry2);
            await this.forget(id2);
          } else {
            this.mergeInto(entry2, entry1);
            await this.forget(id1);
          }
          merged++;
        }
      }
    }

    return merged;
  }

  /**
   * Fusion de deux entrées
   */
  private mergeInto(target: MemoryEntry, source: MemoryEntry): void {
    target.accessCount += source.accessCount;
    target.importance = Math.max(target.importance, source.importance);
    target.metadata = { ...source.metadata, ...target.metadata };
    target.metadata.mergedFrom = [
      ...(target.metadata.mergedFrom as string[] || []),
      source.id
    ];
  }

  /**
   * Calcul de similarité cosinus
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Classement par similarité
   */
  private rankBySimilarity(
    memories: MemoryEntry[],
    queryEmbedding: number[]
  ): MemoryEntry[] {
    return memories
      .filter(m => m.embedding)
      .map(m => ({
        memory: m,
        similarity: this.cosineSimilarity(m.embedding!, queryEmbedding)
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .map(x => x.memory);
  }

  /**
   * Calcul automatique de l'importance
   */
  private calculateImportance(content: unknown): number {
    let importance = 0.5;  // Base

    const contentStr = JSON.stringify(content);

    // Heuristiques d'importance
    if (contentStr.includes('error') || contentStr.includes('bug')) {
      importance += 0.2;  // Erreurs = important
    }
    if (contentStr.includes('success') || contentStr.includes('fixed')) {
      importance += 0.15;  // Succès = important
    }
    if (contentStr.length > 1000) {
      importance += 0.1;  // Contenu substantiel
    }

    return Math.min(1, importance);
  }

  /**
   * Génération d'ID unique
   */
  private generateId(): string {
    return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Mise à jour des indices
   */
  private updateIndices(entry: MemoryEntry): void {
    this.indices.byType.get(entry.type)!.add(entry.id);
    this.indices.byImportance.push(entry.id);
    this.indices.byRecency.push(entry.id);

    // Tri périodique
    if (this.memories.size % 100 === 0) {
      this.sortIndices();
    }
  }

  /**
   * Suppression des indices
   */
  private removeFromIndices(entry: MemoryEntry): void {
    this.indices.byType.get(entry.type)!.delete(entry.id);
    this.indices.byImportance = this.indices.byImportance.filter(
      id => id !== entry.id
    );
    this.indices.byRecency = this.indices.byRecency.filter(
      id => id !== entry.id
    );
  }

  /**
   * Tri des indices
   */
  private sortIndices(): void {
    this.indices.byImportance.sort((a, b) => {
      const ma = this.memories.get(a)!;
      const mb = this.memories.get(b)!;
      return mb.importance - ma.importance;
    });

    this.indices.byRecency.sort((a, b) => {
      const ma = this.memories.get(a)!;
      const mb = this.memories.get(b)!;
      return mb.timestamp - ma.timestamp;
    });
  }

  /**
   * Sauvegarde sur disque
   */
  async save(): Promise<void> {
    if (!this.dirty) return;

    const data = {
      version: 1,
      exportedAt: Date.now(),
      memories: Array.from(this.memories.values())
    };

    await fs.mkdir(path.dirname(this.storagePath), { recursive: true });
    await fs.writeFile(this.storagePath, JSON.stringify(data, null, 2));
    this.dirty = false;

    this.emit('saved', { count: this.memories.size });
  }

  /**
   * Chargement depuis le disque
   */
  async load(): Promise<void> {
    try {
      const content = await fs.readFile(this.storagePath, 'utf-8');
      const data = JSON.parse(content);

      for (const entry of data.memories) {
        this.memories.set(entry.id, entry);
        this.updateIndices(entry);
      }

      this.sortIndices();
      this.emit('loaded', { count: this.memories.size });

    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[Memory] Error loading:', error);
      }
    }
  }

  /**
   * Démarrage de la sauvegarde automatique
   */
  private startAutoSave(): void {
    this.autoSaveInterval = setInterval(() => {
      this.save().catch(console.error);
    }, 60000);  // Toutes les minutes
  }

  /**
   * Arrêt propre
   */
  async shutdown(): Promise<void> {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }
    await this.save();
  }

  /**
   * Statistiques
   */
  getStats(): MemoryStats {
    const byType: Record<MemoryType, number> = {
      [MemoryType.EPISODIC]: 0,
      [MemoryType.SEMANTIC]: 0,
      [MemoryType.PROCEDURAL]: 0,
      [MemoryType.PROSPECTIVE]: 0
    };

    let totalImportance = 0;
    let totalAccess = 0;

    for (const entry of this.memories.values()) {
      byType[entry.type]++;
      totalImportance += entry.importance;
      totalAccess += entry.accessCount;
    }

    return {
      total: this.memories.size,
      byType,
      averageImportance: totalImportance / this.memories.size || 0,
      totalAccesses: totalAccess
    };
  }
}

// Types de support
interface RememberOptions {
  importance?: number;
  metadata?: Record<string, unknown>;
  embedding?: number[];
}

interface MemoryQuery {
  type?: MemoryType;
  text?: string;
  embedding?: number[];
  since?: number;
  until?: number;
  minImportance?: number;
  sortBy?: 'importance' | 'recency' | 'frequency';
  limit?: number;
}

interface ConsolidationReport {
  memoriesAnalyzed: number;
  merged: number;
  archived: number;
  forgotten: number;
  promoted: number;
}

interface MemoryStats {
  total: number;
  byType: Record<MemoryType, number>;
  averageImportance: number;
  totalAccesses: number;
}
```

---

## 14.3 Mémoire Épisodique : Se Souvenir des Événements

### 14.3.1 Capture des Événements

```typescript
// src/memory/episodic-memory.ts

import { MemorySystem, MemoryType } from './memory-system.js';

/**
 * Types d'épisodes
 */
export enum EpisodeType {
  CONVERSATION = 'conversation',
  TASK_COMPLETION = 'task_completion',
  ERROR_OCCURRED = 'error_occurred',
  LEARNING_MOMENT = 'learning_moment',
  USER_FEEDBACK = 'user_feedback'
}

/**
 * Structure d'un épisode
 */
interface Episode {
  type: EpisodeType;
  summary: string;
  details: {
    input?: string;
    output?: string;
    toolsUsed?: string[];
    filesModified?: string[];
    duration?: number;
    success?: boolean;
    errorMessage?: string;
  };
  context: {
    project?: string;
    branch?: string;
    workingDirectory?: string;
  };
  userReaction?: 'positive' | 'negative' | 'neutral';
}

/**
 * Gestionnaire de mémoire épisodique
 */
export class EpisodicMemory {
  private memory: MemorySystem;
  private currentSession: SessionContext | null = null;

  constructor(memory: MemorySystem) {
    this.memory = memory;
  }

  /**
   * Démarre une nouvelle session
   */
  startSession(context: Partial<SessionContext> = {}): string {
    const sessionId = `session_${Date.now()}`;

    this.currentSession = {
      id: sessionId,
      startTime: Date.now(),
      project: context.project,
      branch: context.branch,
      episodes: []
    };

    return sessionId;
  }

  /**
   * Enregistre un épisode dans la session courante
   */
  async recordEpisode(episode: Episode): Promise<string> {
    // Enrichissement avec le contexte de session
    if (this.currentSession) {
      episode.context = {
        ...episode.context,
        project: this.currentSession.project,
        branch: this.currentSession.branch
      };
      this.currentSession.episodes.push(episode);
    }

    // Calcul de l'importance
    const importance = this.calculateEpisodeImportance(episode);

    // Stockage
    return this.memory.remember(MemoryType.EPISODIC, episode, {
      importance,
      metadata: {
        sessionId: this.currentSession?.id,
        episodeType: episode.type
      }
    });
  }

  /**
   * Enregistre une conversation
   */
  async recordConversation(
    userMessage: string,
    agentResponse: string,
    toolsUsed: string[],
    success: boolean
  ): Promise<string> {
    return this.recordEpisode({
      type: EpisodeType.CONVERSATION,
      summary: this.summarizeConversation(userMessage, agentResponse),
      details: {
        input: userMessage,
        output: agentResponse,
        toolsUsed,
        success
      },
      context: {}
    });
  }

  /**
   * Enregistre une erreur
   */
  async recordError(
    context: string,
    errorMessage: string,
    resolution?: string
  ): Promise<string> {
    return this.recordEpisode({
      type: EpisodeType.ERROR_OCCURRED,
      summary: `Error in ${context}: ${errorMessage.slice(0, 100)}`,
      details: {
        errorMessage,
        output: resolution
      },
      context: {}
    });
  }

  /**
   * Enregistre un moment d'apprentissage
   */
  async recordLearningMoment(
    lesson: string,
    context: string,
    confidence: number
  ): Promise<string> {
    return this.recordEpisode({
      type: EpisodeType.LEARNING_MOMENT,
      summary: lesson,
      details: {
        input: context
      },
      context: {}
    });
  }

  /**
   * Rappel des épisodes similaires
   */
  async recallSimilarEpisodes(
    currentContext: string,
    limit: number = 5
  ): Promise<Episode[]> {
    // Recherche par similarité textuelle
    const memories = await this.memory.search({
      type: MemoryType.EPISODIC,
      text: currentContext,
      sortBy: 'importance',
      limit
    });

    return memories.map(m => m.content as Episode);
  }

  /**
   * Rappel des erreurs passées similaires
   */
  async recallSimilarErrors(
    errorPattern: string,
    limit: number = 3
  ): Promise<Episode[]> {
    const memories = await this.memory.search({
      type: MemoryType.EPISODIC,
      text: errorPattern,
      limit: limit * 2  // Prévoir le filtrage
    });

    return memories
      .filter(m => (m.content as Episode).type === EpisodeType.ERROR_OCCURRED)
      .slice(0, limit)
      .map(m => m.content as Episode);
  }

  /**
   * Résumé de la session courante
   */
  async summarizeCurrentSession(): Promise<SessionSummary> {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    const episodes = this.currentSession.episodes;

    return {
      sessionId: this.currentSession.id,
      duration: Date.now() - this.currentSession.startTime,
      episodeCount: episodes.length,
      conversationCount: episodes.filter(
        e => e.type === EpisodeType.CONVERSATION
      ).length,
      errorCount: episodes.filter(
        e => e.type === EpisodeType.ERROR_OCCURRED
      ).length,
      successRate: this.calculateSuccessRate(episodes),
      topicsDiscussed: this.extractTopics(episodes),
      toolsUsed: this.extractToolsUsed(episodes)
    };
  }

  /**
   * Termine la session et génère un résumé persistant
   */
  async endSession(): Promise<void> {
    if (!this.currentSession) return;

    const summary = await this.summarizeCurrentSession();

    // Stocker le résumé de session comme épisode important
    await this.memory.remember(MemoryType.EPISODIC, {
      type: 'session_summary',
      ...summary
    }, {
      importance: 0.8,
      metadata: {
        isSessionSummary: true
      }
    });

    this.currentSession = null;
  }

  /**
   * Calcul de l'importance d'un épisode
   */
  private calculateEpisodeImportance(episode: Episode): number {
    let importance = 0.5;

    // Erreurs = important
    if (episode.type === EpisodeType.ERROR_OCCURRED) {
      importance += 0.3;
    }

    // Apprentissage = important
    if (episode.type === EpisodeType.LEARNING_MOMENT) {
      importance += 0.25;
    }

    // Feedback utilisateur = important
    if (episode.userReaction === 'positive') {
      importance += 0.2;
    } else if (episode.userReaction === 'negative') {
      importance += 0.25;  // Négatif encore plus important pour apprendre
    }

    // Fichiers modifiés = important
    if (episode.details.filesModified && episode.details.filesModified.length > 0) {
      importance += 0.1;
    }

    return Math.min(1, importance);
  }

  /**
   * Résumé d'une conversation
   */
  private summarizeConversation(input: string, output: string): string {
    // Extraction des points clés
    const inputPreview = input.slice(0, 100);
    const hasCode = output.includes('```');
    const hasToolUse = output.includes('Tool:') || output.includes('Using:');

    let summary = inputPreview;
    if (hasCode) summary += ' [code generated]';
    if (hasToolUse) summary += ' [tools used]';

    return summary;
  }

  /**
   * Calcul du taux de succès
   */
  private calculateSuccessRate(episodes: Episode[]): number {
    const withSuccess = episodes.filter(e => e.details.success !== undefined);
    if (withSuccess.length === 0) return 1;

    const successes = withSuccess.filter(e => e.details.success);
    return successes.length / withSuccess.length;
  }

  /**
   * Extraction des sujets abordés
   */
  private extractTopics(episodes: Episode[]): string[] {
    const topics = new Set<string>();

    for (const episode of episodes) {
      // Extraction simple basée sur les mots-clés
      const text = episode.summary + ' ' + (episode.details.input || '');

      if (text.includes('test')) topics.add('testing');
      if (text.includes('refactor')) topics.add('refactoring');
      if (text.includes('bug') || text.includes('fix')) topics.add('debugging');
      if (text.includes('feature')) topics.add('feature development');
      if (text.includes('document')) topics.add('documentation');
    }

    return Array.from(topics);
  }

  /**
   * Extraction des outils utilisés
   */
  private extractToolsUsed(episodes: Episode[]): Record<string, number> {
    const tools: Record<string, number> = {};

    for (const episode of episodes) {
      for (const tool of episode.details.toolsUsed || []) {
        tools[tool] = (tools[tool] || 0) + 1;
      }
    }

    return tools;
  }
}

// Types
interface SessionContext {
  id: string;
  startTime: number;
  project?: string;
  branch?: string;
  episodes: Episode[];
}

interface SessionSummary {
  sessionId: string;
  duration: number;
  episodeCount: number;
  conversationCount: number;
  errorCount: number;
  successRate: number;
  topicsDiscussed: string[];
  toolsUsed: Record<string, number>;
}
```

---

## 14.4 Mémoire Sémantique : Apprendre des Faits

### 14.4.1 Extraction de Connaissances

```typescript
// src/memory/semantic-memory.ts

import { MemorySystem, MemoryType } from './memory-system.js';

/**
 * Types de faits
 */
export enum FactType {
  USER_PREFERENCE = 'user_preference',
  PROJECT_FACT = 'project_fact',
  CODE_PATTERN = 'code_pattern',
  TOOL_KNOWLEDGE = 'tool_knowledge',
  ERROR_PATTERN = 'error_pattern'
}

/**
 * Structure d'un fait
 */
interface Fact {
  type: FactType;
  subject: string;      // "user", "project:grok-cli", "tool:grep"
  predicate: string;    // "prefers", "uses", "has"
  object: string;       // "atomic commits", "TypeScript", "src/ structure"
  confidence: number;   // 0-1
  evidence: string[];   // IDs des épisodes sources
  lastValidated: number;
}

/**
 * Gestionnaire de mémoire sémantique
 */
export class SemanticMemory {
  private memory: MemorySystem;
  private factIndex: Map<string, Set<string>> = new Map();  // subject -> factIds

  constructor(memory: MemorySystem) {
    this.memory = memory;
  }

  /**
   * Apprend un nouveau fait
   */
  async learnFact(fact: Omit<Fact, 'confidence' | 'evidence' | 'lastValidated'>, evidenceId?: string): Promise<string> {
    // Chercher un fait existant similaire
    const existing = await this.findSimilarFact(fact);

    if (existing) {
      // Renforcer le fait existant
      return this.reinforceFact(existing.id, evidenceId);
    }

    // Nouveau fait
    const fullFact: Fact = {
      ...fact,
      confidence: 0.5,  // Confiance initiale modérée
      evidence: evidenceId ? [evidenceId] : [],
      lastValidated: Date.now()
    };

    const id = await this.memory.remember(MemoryType.SEMANTIC, fullFact, {
      importance: 0.6,
      metadata: {
        factType: fact.type,
        subject: fact.subject
      }
    });

    // Indexation
    if (!this.factIndex.has(fact.subject)) {
      this.factIndex.set(fact.subject, new Set());
    }
    this.factIndex.get(fact.subject)!.add(id);

    return id;
  }

  /**
   * Renforce un fait existant
   */
  private async reinforceFact(
    factId: string,
    evidenceId?: string
  ): Promise<string> {
    const entry = await this.memory.recall(factId);
    if (!entry) return factId;

    const fact = entry.content as Fact;

    // Augmentation de la confiance (convergence vers 1)
    fact.confidence = fact.confidence + (1 - fact.confidence) * 0.1;

    // Ajout de l'évidence
    if (evidenceId && !fact.evidence.includes(evidenceId)) {
      fact.evidence.push(evidenceId);
    }

    fact.lastValidated = Date.now();

    return factId;
  }

  /**
   * Recherche d'un fait similaire
   */
  private async findSimilarFact(
    fact: Partial<Fact>
  ): Promise<{ id: string; fact: Fact } | null> {
    const memories = await this.memory.search({
      type: MemoryType.SEMANTIC,
      text: `${fact.subject} ${fact.predicate} ${fact.object}`,
      limit: 5
    });

    for (const mem of memories) {
      const existing = mem.content as Fact;
      if (
        existing.subject === fact.subject &&
        existing.predicate === fact.predicate &&
        existing.object === fact.object
      ) {
        return { id: mem.id, fact: existing };
      }
    }

    return null;
  }

  /**
   * Récupère les faits sur un sujet
   */
  async getFactsAbout(subject: string): Promise<Fact[]> {
    const memories = await this.memory.search({
      type: MemoryType.SEMANTIC,
      text: subject,
      sortBy: 'importance',
      limit: 20
    });

    return memories
      .map(m => m.content as Fact)
      .filter(f => f.subject === subject || f.object.includes(subject));
  }

  /**
   * Récupère les préférences utilisateur
   */
  async getUserPreferences(): Promise<Fact[]> {
    const memories = await this.memory.search({
      type: MemoryType.SEMANTIC,
      minImportance: 0.5,
      limit: 50
    });

    return memories
      .map(m => m.content as Fact)
      .filter(f => f.type === FactType.USER_PREFERENCE);
  }

  /**
   * Apprend automatiquement des épisodes
   */
  async learnFromEpisodes(episodes: Episode[]): Promise<number> {
    let factsLearned = 0;

    for (const episode of episodes) {
      // Extraction des préférences
      const preferences = this.extractPreferences(episode);
      for (const pref of preferences) {
        await this.learnFact(pref);
        factsLearned++;
      }

      // Extraction des patterns de code
      const patterns = this.extractCodePatterns(episode);
      for (const pattern of patterns) {
        await this.learnFact(pattern);
        factsLearned++;
      }

      // Extraction des connaissances sur les outils
      const toolKnowledge = this.extractToolKnowledge(episode);
      for (const knowledge of toolKnowledge) {
        await this.learnFact(knowledge);
        factsLearned++;
      }
    }

    return factsLearned;
  }

  /**
   * Extraction des préférences
   */
  private extractPreferences(episode: Episode): Partial<Fact>[] {
    const facts: Partial<Fact>[] = [];

    // Préférence d'outils
    if (episode.details.toolsUsed) {
      for (const tool of episode.details.toolsUsed) {
        facts.push({
          type: FactType.USER_PREFERENCE,
          subject: 'user',
          predicate: 'uses',
          object: tool
        });
      }
    }

    // Préférence de fichiers
    if (episode.details.filesModified) {
      const directories = new Set(
        episode.details.filesModified.map(f => f.split('/').slice(0, -1).join('/'))
      );
      for (const dir of directories) {
        facts.push({
          type: FactType.USER_PREFERENCE,
          subject: 'user',
          predicate: 'works_in',
          object: dir
        });
      }
    }

    return facts;
  }

  /**
   * Extraction des patterns de code
   */
  private extractCodePatterns(episode: Episode): Partial<Fact>[] {
    const facts: Partial<Fact>[] = [];
    const output = episode.details.output || '';

    // Détection des patterns
    if (output.includes('async') && output.includes('await')) {
      facts.push({
        type: FactType.CODE_PATTERN,
        subject: 'codebase',
        predicate: 'uses',
        object: 'async/await pattern'
      });
    }

    if (output.includes('interface') || output.includes('type ')) {
      facts.push({
        type: FactType.CODE_PATTERN,
        subject: 'codebase',
        predicate: 'uses',
        object: 'TypeScript types'
      });
    }

    return facts;
  }

  /**
   * Extraction des connaissances sur les outils
   */
  private extractToolKnowledge(episode: Episode): Partial<Fact>[] {
    const facts: Partial<Fact>[] = [];

    // Apprentissage de l'efficacité des outils
    if (episode.details.toolsUsed && episode.details.success !== undefined) {
      for (const tool of episode.details.toolsUsed) {
        facts.push({
          type: FactType.TOOL_KNOWLEDGE,
          subject: `tool:${tool}`,
          predicate: episode.details.success ? 'succeeded_for' : 'failed_for',
          object: episode.summary.slice(0, 50)
        });
      }
    }

    return facts;
  }

  /**
   * Génère un profil utilisateur
   */
  async generateUserProfile(): Promise<UserProfile> {
    const preferences = await this.getUserPreferences();

    const profile: UserProfile = {
      favoriteTools: {},
      activeDirectories: {},
      workingHours: [],
      codePatterns: [],
      confidenceLevel: 0
    };

    for (const pref of preferences) {
      if (pref.predicate === 'uses' && pref.subject === 'user') {
        profile.favoriteTools[pref.object] =
          (profile.favoriteTools[pref.object] || 0) + pref.confidence;
      }

      if (pref.predicate === 'works_in') {
        profile.activeDirectories[pref.object] =
          (profile.activeDirectories[pref.object] || 0) + pref.confidence;
      }
    }

    // Normalisation
    const totalToolScore = Object.values(profile.favoriteTools).reduce((a, b) => a + b, 0);
    if (totalToolScore > 0) {
      for (const tool in profile.favoriteTools) {
        profile.favoriteTools[tool] /= totalToolScore;
      }
    }

    profile.confidenceLevel = preferences.length > 0
      ? preferences.reduce((sum, p) => sum + p.confidence, 0) / preferences.length
      : 0;

    return profile;
  }
}

// Types
interface Episode {
  type: string;
  summary: string;
  details: {
    input?: string;
    output?: string;
    toolsUsed?: string[];
    filesModified?: string[];
    success?: boolean;
  };
}

interface UserProfile {
  favoriteTools: Record<string, number>;
  activeDirectories: Record<string, number>;
  workingHours: number[];
  codePatterns: string[];
  confidenceLevel: number;
}
```

---

## 14.5 Mémoire Procédurale : Apprendre les Actions

### 14.5.1 Capture des Séquences d'Actions

```typescript
// src/memory/procedural-memory.ts

import { MemorySystem, MemoryType } from './memory-system.js';

/**
 * Structure d'une procédure
 */
interface Procedure {
  name: string;
  trigger: string;          // Condition de déclenchement
  steps: ProcedureStep[];
  successRate: number;
  executionCount: number;
  averageDuration: number;
  lastUsed: number;
}

interface ProcedureStep {
  action: string;
  tool?: string;
  parameters?: Record<string, unknown>;
  expectedOutcome?: string;
  alternatives?: ProcedureStep[];  // Plans B
}

/**
 * Gestionnaire de mémoire procédurale
 */
export class ProceduralMemory {
  private memory: MemorySystem;
  private procedures: Map<string, Procedure> = new Map();

  constructor(memory: MemorySystem) {
    this.memory = memory;
  }

  /**
   * Enregistre une nouvelle procédure
   */
  async learnProcedure(
    name: string,
    trigger: string,
    steps: ProcedureStep[]
  ): Promise<string> {
    const procedure: Procedure = {
      name,
      trigger,
      steps,
      successRate: 1.0,
      executionCount: 1,
      averageDuration: 0,
      lastUsed: Date.now()
    };

    const id = await this.memory.remember(MemoryType.PROCEDURAL, procedure, {
      importance: 0.7,
      metadata: {
        procedureName: name,
        stepCount: steps.length
      }
    });

    this.procedures.set(name, procedure);

    return id;
  }

  /**
   * Trouve une procédure applicable
   */
  async findApplicableProcedure(
    context: string
  ): Promise<Procedure | null> {
    const memories = await this.memory.search({
      type: MemoryType.PROCEDURAL,
      text: context,
      sortBy: 'frequency',
      limit: 10
    });

    // Trouver la meilleure correspondance
    for (const mem of memories) {
      const procedure = mem.content as Procedure;
      if (this.matchesTrigger(context, procedure.trigger)) {
        return procedure;
      }
    }

    return null;
  }

  /**
   * Vérification de correspondance du trigger
   */
  private matchesTrigger(context: string, trigger: string): boolean {
    // Correspondance simple par mots-clés
    const triggerWords = trigger.toLowerCase().split(/\s+/);
    const contextLower = context.toLowerCase();

    let matchCount = 0;
    for (const word of triggerWords) {
      if (contextLower.includes(word)) {
        matchCount++;
      }
    }

    // Au moins 50% des mots doivent correspondre
    return matchCount / triggerWords.length >= 0.5;
  }

  /**
   * Met à jour les statistiques d'une procédure
   */
  async recordExecution(
    name: string,
    success: boolean,
    duration: number
  ): Promise<void> {
    const procedure = this.procedures.get(name);
    if (!procedure) return;

    procedure.executionCount++;
    procedure.lastUsed = Date.now();

    // Mise à jour du taux de succès (moyenne mobile)
    const alpha = 0.3;  // Poids du nouveau résultat
    procedure.successRate = alpha * (success ? 1 : 0) +
                            (1 - alpha) * procedure.successRate;

    // Mise à jour de la durée moyenne
    procedure.averageDuration = alpha * duration +
                                (1 - alpha) * procedure.averageDuration;
  }

  /**
   * Apprend des patterns d'utilisation d'outils
   */
  async learnFromToolSequence(
    toolCalls: ToolCall[],
    context: string,
    success: boolean
  ): Promise<void> {
    if (!success || toolCalls.length < 2) return;

    // Extraction du pattern
    const steps: ProcedureStep[] = toolCalls.map(call => ({
      action: `Use ${call.tool}`,
      tool: call.tool,
      parameters: this.abstractParameters(call.params)
    }));

    // Génération du nom
    const procedureName = this.generateProcedureName(toolCalls);

    // Vérifier si procédure similaire existe
    const existing = await this.findSimilarProcedure(steps);

    if (existing) {
      await this.recordExecution(existing.name, true, 0);
    } else {
      await this.learnProcedure(procedureName, context, steps);
    }
  }

  /**
   * Abstraction des paramètres pour généralisation
   */
  private abstractParameters(
    params: Record<string, unknown>
  ): Record<string, unknown> {
    const abstracted: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string') {
        // Remplacer les chemins spécifiques par des patterns
        if (value.includes('/')) {
          abstracted[key] = '<path>';
        } else if (value.match(/\d+/)) {
          abstracted[key] = '<number>';
        } else {
          abstracted[key] = value;
        }
      } else {
        abstracted[key] = value;
      }
    }

    return abstracted;
  }

  /**
   * Génération du nom de procédure
   */
  private generateProcedureName(toolCalls: ToolCall[]): string {
    const tools = toolCalls.map(c => c.tool).join('_');
    return `auto_${tools}_${Date.now()}`;
  }

  /**
   * Recherche de procédure similaire
   */
  private async findSimilarProcedure(
    steps: ProcedureStep[]
  ): Promise<Procedure | null> {
    const memories = await this.memory.search({
      type: MemoryType.PROCEDURAL,
      limit: 50
    });

    for (const mem of memories) {
      const procedure = mem.content as Procedure;

      if (this.stepsMatch(procedure.steps, steps)) {
        return procedure;
      }
    }

    return null;
  }

  /**
   * Comparaison de séquences d'étapes
   */
  private stepsMatch(a: ProcedureStep[], b: ProcedureStep[]): boolean {
    if (a.length !== b.length) return false;

    for (let i = 0; i < a.length; i++) {
      if (a[i].tool !== b[i].tool) return false;
    }

    return true;
  }

  /**
   * Suggère des procédures basées sur le contexte
   */
  async suggestProcedures(context: string): Promise<ProcedureSuggestion[]> {
    const memories = await this.memory.search({
      type: MemoryType.PROCEDURAL,
      text: context,
      sortBy: 'frequency',
      limit: 5
    });

    return memories.map(mem => {
      const procedure = mem.content as Procedure;
      return {
        name: procedure.name,
        steps: procedure.steps.map(s => s.action),
        confidence: procedure.successRate * Math.min(1, procedure.executionCount / 10),
        estimatedDuration: procedure.averageDuration
      };
    });
  }

  /**
   * Exporte les procédures les plus utilisées
   */
  async exportTopProcedures(limit: number = 10): Promise<Procedure[]> {
    const memories = await this.memory.search({
      type: MemoryType.PROCEDURAL,
      sortBy: 'frequency',
      limit
    });

    return memories.map(m => m.content as Procedure);
  }
}

// Types
interface ToolCall {
  tool: string;
  params: Record<string, unknown>;
}

interface ProcedureSuggestion {
  name: string;
  steps: string[];
  confidence: number;
  estimatedDuration: number;
}
```

---

## 14.6 Intégration dans l'Agent

### 14.6.1 Agent avec Mémoire

```typescript
// src/agent/memory-aware-agent.ts

import { GrokAgent } from './grok-agent.js';
import { MemorySystem, MemoryType } from '../memory/memory-system.js';
import { EpisodicMemory } from '../memory/episodic-memory.js';
import { SemanticMemory } from '../memory/semantic-memory.js';
import { ProceduralMemory } from '../memory/procedural-memory.js';

/**
 * Agent enrichi avec mémoire persistante
 */
export class MemoryAwareAgent extends GrokAgent {
  private memorySystem: MemorySystem;
  private episodic: EpisodicMemory;
  private semantic: SemanticMemory;
  private procedural: ProceduralMemory;

  constructor(config: AgentConfig) {
    super(config);

    // Initialisation du système de mémoire
    this.memorySystem = new MemorySystem(
      config.memoryPath || '.grok/memory.json'
    );

    this.episodic = new EpisodicMemory(this.memorySystem);
    this.semantic = new SemanticMemory(this.memorySystem);
    this.procedural = new ProceduralMemory(this.memorySystem);
  }

  /**
   * Initialisation avec chargement de la mémoire
   */
  async initialize(): Promise<void> {
    await super.initialize();
    await this.memorySystem.initialize();

    // Démarrer une session
    this.episodic.startSession({
      project: this.detectProject(),
      branch: await this.detectBranch()
    });
  }

  /**
   * Traitement enrichi par la mémoire
   */
  async processWithMemory(message: string): Promise<AgentResponse> {
    const startTime = Date.now();

    // 1. Rappel du contexte pertinent
    const context = await this.gatherMemoryContext(message);

    // 2. Enrichissement du prompt
    const enrichedPrompt = this.enrichWithContext(message, context);

    // 3. Recherche de procédures applicables
    const procedure = await this.procedural.findApplicableProcedure(message);
    if (procedure) {
      console.log(`[Memory] Found applicable procedure: ${procedure.name}`);
    }

    // 4. Traitement standard
    const response = await super.processMessage(enrichedPrompt);

    // 5. Enregistrement de l'épisode
    await this.episodic.recordConversation(
      message,
      response.content,
      response.toolsUsed || [],
      !response.error
    );

    // 6. Apprentissage des patterns
    if (response.toolsUsed && response.toolsUsed.length > 1) {
      await this.procedural.learnFromToolSequence(
        response.toolCalls || [],
        message,
        !response.error
      );
    }

    // 7. Extraction de faits
    await this.learnFromInteraction(message, response);

    return response;
  }

  /**
   * Collecte du contexte mémoire
   */
  private async gatherMemoryContext(
    message: string
  ): Promise<MemoryContext> {
    const [
      similarEpisodes,
      userProfile,
      relevantFacts,
      suggestedProcedures
    ] = await Promise.all([
      this.episodic.recallSimilarEpisodes(message, 3),
      this.semantic.generateUserProfile(),
      this.semantic.getFactsAbout(this.detectTopic(message)),
      this.procedural.suggestProcedures(message)
    ]);

    return {
      similarEpisodes,
      userProfile,
      relevantFacts,
      suggestedProcedures
    };
  }

  /**
   * Enrichissement du prompt avec le contexte
   */
  private enrichWithContext(
    message: string,
    context: MemoryContext
  ): string {
    const parts: string[] = [];

    // Contexte des préférences utilisateur
    if (Object.keys(context.userProfile.favoriteTools).length > 0) {
      const topTools = Object.entries(context.userProfile.favoriteTools)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([tool]) => tool);

      parts.push(`[User prefers: ${topTools.join(', ')}]`);
    }

    // Contexte des épisodes similaires
    if (context.similarEpisodes.length > 0) {
      const episodeSummaries = context.similarEpisodes
        .map(e => e.summary)
        .join('; ');

      parts.push(`[Related past work: ${episodeSummaries}]`);
    }

    // Faits pertinents
    if (context.relevantFacts.length > 0) {
      const facts = context.relevantFacts
        .slice(0, 3)
        .map(f => `${f.subject} ${f.predicate} ${f.object}`)
        .join('; ');

      parts.push(`[Known facts: ${facts}]`);
    }

    // Procédures suggérées
    if (context.suggestedProcedures.length > 0) {
      const topProcedure = context.suggestedProcedures[0];
      parts.push(`[Suggested approach: ${topProcedure.steps.join(' → ')}]`);
    }

    if (parts.length > 0) {
      return `${parts.join('\n')}\n\nUser request: ${message}`;
    }

    return message;
  }

  /**
   * Apprentissage post-interaction
   */
  private async learnFromInteraction(
    _message: string,
    response: AgentResponse
  ): Promise<void> {
    // Extraction des faits des fichiers modifiés
    if (response.filesModified) {
      for (const file of response.filesModified) {
        await this.semantic.learnFact({
          type: FactType.PROJECT_FACT,
          subject: 'project',
          predicate: 'has_file',
          object: file
        });
      }
    }

    // Apprentissage des erreurs
    if (response.error) {
      await this.episodic.recordError(
        'processing',
        response.error,
        response.content
      );
    }
  }

  /**
   * Détection du sujet
   */
  private detectTopic(message: string): string {
    const lower = message.toLowerCase();

    if (lower.includes('test')) return 'testing';
    if (lower.includes('bug') || lower.includes('fix')) return 'debugging';
    if (lower.includes('refactor')) return 'refactoring';
    if (lower.includes('feature')) return 'development';

    return 'general';
  }

  /**
   * Détection du projet
   */
  private detectProject(): string {
    try {
      const packageJson = require(process.cwd() + '/package.json');
      return packageJson.name || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Détection de la branche
   */
  private async detectBranch(): Promise<string> {
    try {
      const { execSync } = require('child_process');
      return execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
    } catch {
      return 'unknown';
    }
  }

  /**
   * Arrêt propre
   */
  async shutdown(): Promise<void> {
    await this.episodic.endSession();
    await this.memorySystem.shutdown();
    await super.shutdown();
  }

  /**
   * Statistiques de mémoire
   */
  async getMemoryStats(): Promise<MemoryStats> {
    const sysStats = this.memorySystem.getStats();
    const profile = await this.semantic.generateUserProfile();

    return {
      ...sysStats,
      userConfidence: profile.confidenceLevel,
      topTools: Object.entries(profile.favoriteTools)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([tool, score]) => ({ tool, score }))
    };
  }
}

// Types
interface MemoryContext {
  similarEpisodes: Episode[];
  userProfile: UserProfile;
  relevantFacts: Fact[];
  suggestedProcedures: ProcedureSuggestion[];
}

interface MemoryStats {
  total: number;
  byType: Record<MemoryType, number>;
  averageImportance: number;
  totalAccesses: number;
  userConfidence: number;
  topTools: Array<{ tool: string; score: number }>;
}
```

---

## 14.7 Visualisation et Introspection

### 14.7.1 Commande /memory

```typescript
// src/commands/memory-command.ts

import { MemoryAwareAgent } from '../agent/memory-aware-agent.js';

export async function handleMemoryCommand(
  agent: MemoryAwareAgent,
  args: string[]
): Promise<string> {
  const subcommand = args[0] || 'status';

  switch (subcommand) {
    case 'status':
      return await formatMemoryStatus(agent);

    case 'profile':
      return await formatUserProfile(agent);

    case 'history':
      return await formatRecentHistory(agent, parseInt(args[1]) || 10);

    case 'procedures':
      return await formatProcedures(agent, parseInt(args[1]) || 5);

    case 'consolidate':
      return await runConsolidation(agent);

    case 'forget':
      return await forgetMemory(agent, args[1]);

    default:
      return `Unknown subcommand: ${subcommand}\n` +
        'Usage: /memory [status|profile|history|procedures|consolidate|forget]';
  }
}

async function formatMemoryStatus(agent: MemoryAwareAgent): Promise<string> {
  const stats = await agent.getMemoryStats();

  return `
┌${'─'.repeat(50)}┐
│ MEMORY STATUS                                    │
├${'─'.repeat(50)}┤
│ Total memories: ${stats.total.toString().padEnd(33)}│
│ Episodic: ${stats.byType.episodic.toString().padEnd(39)}│
│ Semantic: ${stats.byType.semantic.toString().padEnd(39)}│
│ Procedural: ${stats.byType.procedural.toString().padEnd(37)}│
│ Prospective: ${stats.byType.prospective.toString().padEnd(36)}│
├${'─'.repeat(50)}┤
│ Avg importance: ${stats.averageImportance.toFixed(2).padEnd(32)}│
│ Total accesses: ${stats.totalAccesses.toString().padEnd(32)}│
│ User confidence: ${(stats.userConfidence * 100).toFixed(0)}%${' '.repeat(29)}│
└${'─'.repeat(50)}┘
  `.trim();
}

async function formatUserProfile(agent: MemoryAwareAgent): Promise<string> {
  const profile = await agent.semantic.generateUserProfile();

  const toolLines = Object.entries(profile.favoriteTools)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tool, score]) => {
      const bar = '█'.repeat(Math.round(score * 20));
      return `  ${tool.padEnd(20)} ${bar} ${(score * 100).toFixed(0)}%`;
    })
    .join('\n');

  const dirLines = Object.entries(profile.activeDirectories)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([dir, score]) => `  ${dir}`)
    .join('\n');

  return `
USER PROFILE (confidence: ${(profile.confidenceLevel * 100).toFixed(0)}%)

Favorite Tools:
${toolLines}

Active Directories:
${dirLines}

Code Patterns: ${profile.codePatterns.join(', ') || 'None detected'}
  `.trim();
}

async function formatRecentHistory(
  agent: MemoryAwareAgent,
  limit: number
): Promise<string> {
  const episodes = await agent.episodic.recallSimilarEpisodes('', limit);

  const lines = episodes.map((ep, i) => {
    const date = new Date(ep.timestamp || Date.now()).toLocaleDateString();
    const success = ep.details.success ? '✓' : '✗';
    return `${i + 1}. [${date}] ${success} ${ep.summary.slice(0, 60)}`;
  });

  return `RECENT HISTORY (${limit} episodes)\n\n${lines.join('\n')}`;
}

async function formatProcedures(
  agent: MemoryAwareAgent,
  limit: number
): Promise<string> {
  const procedures = await agent.procedural.exportTopProcedures(limit);

  const lines = procedures.map((proc, i) => {
    const steps = proc.steps.map(s => s.action).join(' → ');
    const success = (proc.successRate * 100).toFixed(0);
    return `${i + 1}. ${proc.name}\n   Steps: ${steps}\n   Success: ${success}% (${proc.executionCount} runs)`;
  });

  return `LEARNED PROCEDURES\n\n${lines.join('\n\n')}`;
}

async function runConsolidation(agent: MemoryAwareAgent): Promise<string> {
  const report = await agent.memorySystem.consolidate();

  return `
CONSOLIDATION COMPLETE

Analyzed: ${report.memoriesAnalyzed}
Merged: ${report.merged}
Archived: ${report.archived}
Forgotten: ${report.forgotten}
Promoted: ${report.promoted}
  `.trim();
}

async function forgetMemory(
  agent: MemoryAwareAgent,
  id: string
): Promise<string> {
  if (!id) {
    return 'Usage: /memory forget <memory_id>';
  }

  const success = await agent.memorySystem.forget(id);
  return success ? `Memory ${id} forgotten.` : `Memory ${id} not found.`;
}
```

---

## 14.8 Exercices Pratiques

### Exercice 1 : Système de Mémoire Simple

```typescript
/**
 * Exercice : Implémenter un système de mémoire basique
 *
 * Objectifs :
 * 1. Stocker des souvenirs avec importance
 * 2. Rappeler les plus pertinents
 * 3. Oublier les moins importants
 */

class SimpleMemory {
  private memories: Array<{
    content: string;
    importance: number;
    timestamp: number;
    accessCount: number;
  }> = [];

  remember(content: string, importance: number = 0.5): void {
    // TODO: Ajouter à la mémoire
    throw new Error('Not implemented');
  }

  recall(query: string, limit: number = 5): string[] {
    // TODO: Retourner les souvenirs les plus pertinents
    throw new Error('Not implemented');
  }

  forget(threshold: number = 0.3): number {
    // TODO: Oublier les souvenirs sous le seuil
    // Retourner le nombre de souvenirs oubliés
    throw new Error('Not implemented');
  }
}

// Tests
const memory = new SimpleMemory();
memory.remember("User likes TypeScript", 0.9);
memory.remember("Temp file created", 0.1);
memory.remember("Important bug fixed", 0.8);

const recalled = memory.recall("TypeScript", 2);
console.assert(recalled.length <= 2, "Should respect limit");

const forgotten = memory.forget(0.5);
console.assert(forgotten === 1, "Should forget low-importance memory");
```

### Exercice 2 : Apprentissage de Préférences

```typescript
/**
 * Exercice : Apprendre les préférences utilisateur
 *
 * Objectifs :
 * 1. Observer les actions utilisateur
 * 2. Inférer les préférences
 * 3. Adapter les suggestions
 */

class PreferenceLearner {
  private observations: Array<{
    action: string;
    context: string;
    outcome: 'positive' | 'negative' | 'neutral';
  }> = [];

  observe(action: string, context: string, outcome: 'positive' | 'negative' | 'neutral'): void {
    // TODO: Enregistrer l'observation
    throw new Error('Not implemented');
  }

  getPreferences(): Record<string, number> {
    // TODO: Calculer les scores de préférence
    // -1 (aversion) à +1 (préférence)
    throw new Error('Not implemented');
  }

  suggest(context: string): string[] {
    // TODO: Suggérer des actions basées sur les préférences
    throw new Error('Not implemented');
  }
}

// Tests
const learner = new PreferenceLearner();
learner.observe("use grep", "searching", "positive");
learner.observe("use grep", "searching", "positive");
learner.observe("use find", "searching", "negative");

const prefs = learner.getPreferences();
console.assert(prefs["grep"] > prefs["find"], "Should prefer grep");
```

### Exercice 3 : Consolidation de Mémoire

```typescript
/**
 * Exercice : Implémenter la consolidation
 *
 * Objectifs :
 * 1. Fusionner les mémoires similaires
 * 2. Promouvoir les importantes
 * 3. Archiver les anciennes
 */

class MemoryConsolidator {
  consolidate(memories: Memory[]): ConsolidationResult {
    // TODO: Implémenter la consolidation
    // 1. Trouver les mémoires similaires (même contenu)
    // 2. Les fusionner en gardant la plus importante
    // 3. Augmenter l'importance des fréquemment accédées
    // 4. Marquer les vieilles comme archivées

    throw new Error('Not implemented');
  }
}

interface Memory {
  id: string;
  content: string;
  importance: number;
  accessCount: number;
  timestamp: number;
  archived?: boolean;
}

interface ConsolidationResult {
  merged: number;
  promoted: number;
  archived: number;
}
```

---

## 14.9 Points Clés du Chapitre

```
┌─────────────────────────────────────────────────────────────┐
│       RÉCAPITULATIF : APPRENTISSAGE PERSISTANT              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. MÉMOIRE ÉPISODIQUE                                      │
│     ├─ Capture des événements et conversations              │
│     ├─ Sessions avec contexte (projet, branche)             │
│     ├─ Rappel des situations similaires                     │
│     └─ Génération de résumés de session                     │
│                                                             │
│  2. MÉMOIRE SÉMANTIQUE                                      │
│     ├─ Extraction de faits (préférences, patterns)          │
│     ├─ Renforcement par répétition                          │
│     ├─ Profil utilisateur dynamique                         │
│     └─ Niveau de confiance croissant                        │
│                                                             │
│  3. MÉMOIRE PROCÉDURALE                                     │
│     ├─ Apprentissage des séquences d'actions                │
│     ├─ Abstraction des paramètres                           │
│     ├─ Suggestion de procédures                             │
│     └─ Statistiques d'efficacité                            │
│                                                             │
│  4. CONSOLIDATION                                           │
│     ├─ Fusion des mémoires similaires                       │
│     ├─ Oubli des non-pertinentes                            │
│     ├─ Promotion des fréquentes                             │
│     └─ Archivage des anciennes                              │
│                                                             │
│  5. INTÉGRATION AGENT                                       │
│     ├─ Enrichissement du contexte                           │
│     ├─ Apprentissage continu                                │
│     ├─ Personnalisation progressive                         │
│     └─ Introspection (/memory)                              │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  BÉNÉFICES                                                  │
│  ├─ Continuité entre sessions                               │
│  ├─ Personnalisation croissante                             │
│  ├─ Réduction des répétitions                               │
│  └─ Amélioration continue                                   │
└─────────────────────────────────────────────────────────────┘
```

---

## Épilogue : L'Agent qui se Souvient

Trois mois plus tard, Lina utilisait Grok-CLI quotidiennement. Mais ce n'était plus le même agent. Il avait changé — il avait appris.

```
grok> Bonjour !

Agent: Bonjour Lina ! Je vois que c'est lundi — tu commences
généralement par vérifier les tests du week-end. Veux-tu que je
lance la suite de tests pour le module de paiement ?

Tu sais, la dernière fois que tu as travaillé sur ce module (il y
a 12 jours), tu as corrigé un bug de validation. Je garde un œil
sur les cas similaires.
```

Lina sourit. L'agent ne répondait plus seulement à ses questions — il anticipait ses besoins, se souvenait de son contexte, apprenait de chaque interaction.

— "C'est comme avoir un collègue qui ne prend jamais de vacances," murmura-t-elle.

Elle ajouta une note dans le fichier de configuration :

```json
{
  "memory": {
    "enabled": true,
    "consolidation": "weekly",
    "retentionDays": 90,
    "notes": "Best feature. Makes everything feel natural."
  }
}
```

L'apprentissage persistant n'était pas juste une fonctionnalité technique — c'était ce qui transformait un outil en assistant. Un assistant qui grandissait avec son utilisateur.

---

*Dans le chapitre final, nous assemblerons tous les composants étudiés pour contempler l'architecture complète de Grok-CLI, comprenant comment chaque pièce s'intègre dans un système cohérent et extensible.*
