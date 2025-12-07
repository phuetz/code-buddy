# Chapitre 12 — Optimisations Cognitives 🧠

---

## 🎬 Scène d'ouverture

*Vendredi soir, 19h30. La plupart des bureaux sont déjà vides. Lina, elle, fixe son écran avec une obsession croissante.*

*Sur son moniteur, un graphique en temps réel. Chaque seconde, une nouvelle requête apparaît. Elle a commencé à les colorer mentalement : bleu pour les nouvelles, orange pour les "déjà vues".*

*Orange. Orange. Bleu. Orange. Orange. Orange.*

**Lina** *(murmurant)* : "C'est pas possible..."

*Elle attrape son carnet et commence à noter. Dix minutes plus tard, elle a son verdict.*

**Lina** : "68%. 68% de mes requêtes API sont des variations de la même chose."

*Marc passe derrière elle, sa veste déjà sur l'épaule.*

**Marc** : "Tu comptes rester tard un vendredi ?"

**Lina** *(sans se retourner)* : "Regarde ça."

*Elle lui montre son carnet. Une colonne de requêtes, avec des flèches reliant celles qui sont équivalentes.*

```
"Comment lister les fichiers ?"
"ls"
"Montre-moi le contenu du dossier"
"Affiche les fichiers"
"Que contient ce répertoire ?"
```

**Marc** *(posant sa veste)* : "Cinq façons de poser la même question."

**Lina** : "Et mon agent appelle l'API cinq fois. À $0.03 par requête, ça fait $15 par jour perdus sur des questions dont il connaît déjà la réponse. $450 par mois. $5,400 par an."

*Elle se retourne enfin.*

**Lina** : "C'est plus que mon premier salaire de stage."

**Marc** *(s'asseyant)* : "Tu sais ce qui est frustrant ? Le cerveau humain résout ce problème naturellement. Tu ne 're-réfléchis' pas à comment faire du café chaque matin."

**Lina** : "Exactement ! J'ai besoin d'un cache. Mais pas un cache bête qui compare des strings caractère par caractère."

**Marc** : "Un cache qui comprend que 'ls' et 'lister les fichiers' veulent dire la même chose..."

**Lina** *(les yeux brillants)* : "Un cache **sémantique**. Qui compare le sens, pas les mots."

*Marc sourit. Il retire sa veste.*

**Marc** : "Ok. Je reste. On va construire quelque chose d'élégant."

---

## 📋 Table des Matières

| Section | Titre | Description |
|:-------:|-------|-------------|
| 12.1 | 💸 Le Coût de la Redondance | Analyse des patterns de requêtes |
| 12.2 | 🔮 Semantic Response Cache | Caching basé sur la similarité |
| 12.3 | 🔧 Tool Result Cache | Caching des résultats d'outils |
| 12.4 | ⚡ Pré-calcul et Warming | Anticipation des besoins |
| 12.5 | 📊 Métriques et Monitoring | Dashboard d'optimisation |
| 12.6 | ✅ Bonnes Pratiques | Guidelines de caching |

---

## 12.1 💸 Le Coût de la Redondance

Un agent naïf appelle le LLM pour chaque requête, même quand la réponse a déjà été calculée. Cette approche « sans mémoire » génère un gaspillage considérable — en temps, en argent, et en ressources environnementales.

### 12.1.1 🔍 Analyse des Patterns de Requêtes

Avant d'optimiser, il faut mesurer. Une analyse sur une semaine d'utilisation typique révèle un pattern frappant :

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    📊 ANALYSE DES REQUÊTES (1 semaine)                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  📈 Total requêtes : 10,000                                                 │
│                                                                             │
│  📁 Répartition par type :                                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                                                                     │   │
│  │   🆕 Uniques (vraiment nouvelles)     ████████░░░░░░░░░░  32%       │   │
│  │                                        (3,200 requêtes)             │   │
│  │                                                                     │   │
│  │   🔄 Quasi-identiques (reformulations) ████████████████░░  48%      │   │
│  │                                        (4,800 requêtes)             │   │
│  │                                                                     │   │
│  │   📋 Répétitions exactes              ██████████░░░░░░░░  20%       │   │
│  │                                        (2,000 requêtes)             │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  💰 Analyse des coûts :                                                     │
│  ┌────────────────────────────────────────────┐                            │
│  │  Sans cache    : 10,000 × $0.05 = $500     │                            │
│  │  Avec cache    : 3,200 × $0.05 + overhead  │                            │
│  │                  = ~$170                    │                            │
│  │                                            │                            │
│  │  📉 Économie potentielle : 66% ($330)      │                            │
│  └────────────────────────────────────────────┘                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

Cette analyse révèle que **68% des requêtes** (quasi-identiques + répétitions) pourraient être servies depuis un cache, sans jamais toucher à l'API.

### 12.1.2 📊 Types de Redondance

Toutes les redondances ne se valent pas. Certaines sont faciles à détecter, d'autres nécessitent une compréhension sémantique :

| Type | Icône | Exemple | Détection | Cache Possible |
|------|:-----:|---------|-----------|:--------------:|
| **Exact** | 📋 | `"ls"` → `"ls"` | Triviale | ✅ Simple |
| **Sémantique** | 🔮 | `"liste les fichiers"` → `"ls"` | Embeddings | ✅ Sémantique |
| **Paramétrique** | 🔢 | `"lis config.ts"` → `"lis utils.ts"` | Template | ⚠️ Partiel |
| **Contextuel** | 📍 | Même question, contexte différent | Impossible | ❌ Non |

**La clé** : Un cache exact capture 20% des cas. Un cache sémantique en capture 68%.

### 12.1.3 🎯 Pourquoi 68% ?

Ce chiffre n'est pas arbitraire — il émerge de patterns cognitifs prévisibles :

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                   🧠 PATTERNS DE REDONDANCE                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. 🔄 REFORMULATION NATURELLE                                              │
│     ├── "Comment lister les fichiers ?"                                     │
│     ├── "Montre-moi le contenu du dossier"                                  │
│     ├── "ls dans ce répertoire"                                             │
│     └── "Quels fichiers sont présents ?"                                    │
│     → Même intention, 4 formulations différentes                            │
│                                                                             │
│  2. 📚 EXPLORATION PROGRESSIVE                                              │
│     ├── "Comment fonctionne useState ?"                                     │
│     ├── "useState avec des objets ?"                                        │
│     └── "useState et useEffect ?"                                           │
│     → Variations sur un même thème                                          │
│                                                                             │
│  3. 🔁 RÉPÉTITION DE SESSION                                                │
│     ├── Questions oubliées et reposées                                      │
│     ├── Vérification de réponses précédentes                                │
│     └── Travail sur plusieurs fichiers similaires                           │
│     → Le cerveau humain n'a pas de cache parfait non plus                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 12.2 🔮 Semantic Response Cache

Le **cache sémantique** est la technique la plus puissante pour réduire les appels API. Au lieu de chercher une correspondance exacte, il compare la *signification* des requêtes.

### 12.2.1 📐 Principe Mathématique

L'idée est simple : deux requêtes qui signifient la même chose devraient avoir la même réponse.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    🔮 SEMANTIC CACHE FLOW                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   📥 Requête : "Comment lister les fichiers ?"                              │
│                        │                                                    │
│                        ▼                                                    │
│        ┌───────────────────────────────────┐                               │
│        │   🧮 Embed la requête              │                               │
│        │   → [0.23, -0.45, 0.12, ...]       │                               │
│        │   (vecteur de 1536 dimensions)     │                               │
│        └───────────────────┬───────────────┘                               │
│                            │                                                │
│                            ▼                                                │
│        ┌───────────────────────────────────┐                               │
│        │   🔍 Chercher dans le cache        │                               │
│        │   Similarité cosine > 0.92 ?       │                               │
│        └───────────────────┬───────────────┘                               │
│                            │                                                │
│              ┌─────────────┴─────────────┐                                 │
│              │                           │                                  │
│              ▼                           ▼                                  │
│   ┌───────────────────┐       ┌───────────────────┐                        │
│   │   ✅ CACHE HIT     │       │   ❌ CACHE MISS    │                        │
│   │   (sim = 0.94)     │       │                   │                        │
│   └─────────┬─────────┘       └─────────┬─────────┘                        │
│             │                           │                                   │
│             ▼                           ▼                                   │
│   ┌───────────────────┐       ┌───────────────────┐                        │
│   │ 📤 Retourner       │       │ 🤖 Appeler LLM     │                        │
│   │ réponse cachée     │       │ 💾 Cacher réponse  │                        │
│   └───────────────────┘       └───────────────────┘                        │
│                                                                             │
│   🎯 Match trouvé :                                                         │
│   "ls ou dir pour lister" → Similarité 0.94 ✓                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

La **similarité cosine** mesure l'angle entre deux vecteurs :

```
                    A · B           Σ(aᵢ × bᵢ)
cos(θ) = ─────────────────── = ──────────────────────
               ||A|| × ||B||     √Σaᵢ² × √Σbᵢ²
```

- **cos = 1.0** : Vecteurs identiques (même direction)
- **cos = 0.0** : Vecteurs orthogonaux (aucune relation)
- **cos = -1.0** : Vecteurs opposés

En pratique, un seuil de **0.92** offre un bon équilibre entre hits et précision.

### 12.2.2 🔧 Implémentation Complète

```typescript
// src/utils/semantic-cache.ts
import { createHash } from 'crypto';
import { promises as fs } from 'fs';

/**
 * 📦 Structure d'une entrée de cache
 * Stocke non seulement la réponse, mais aussi les métadonnées
 * nécessaires pour l'éviction et l'analyse.
 */
interface CacheEntry {
  id: string;                    // 🔑 Identifiant unique
  query: string;                 // 📝 Requête originale
  queryEmbedding: number[];      // 🧮 Embedding de la requête
  response: string;              // 💬 Réponse cachée
  createdAt: Date;               // 📅 Date de création
  accessCount: number;           // 📊 Nombre d'accès
  lastAccess: Date;              // ⏰ Dernier accès
  metadata: {
    model: string;               // 🤖 Modèle utilisé
    tokens: number;              // 🔢 Tokens consommés
    context?: string;            // 📍 Contexte optionnel
  };
}

/**
 * 📊 Résultat d'une recherche dans le cache
 */
interface CacheResult {
  response: string;              // 💬 La réponse
  similarity: number;            // 📐 Score de similarité
  originalQuery: string;         // 📝 Requête qui a généré cette réponse
  metadata: CacheEntry['metadata'];
}

/**
 * 🔮 SemanticCache - Cache intelligent basé sur la similarité sémantique
 *
 * Contrairement à un cache exact (key → value), ce cache trouve des
 * correspondances même quand les requêtes sont formulées différemment.
 *
 * Exemple :
 * - "Comment lister les fichiers ?" → embedding → recherche
 * - Trouve "ls ou dir pour lister" avec similarité 0.94
 * - Retourne la réponse cachée
 */
export class SemanticCache {
  private entries: Map<string, CacheEntry> = new Map();
  private embedder: Embedder;

  // ⚙️ Configuration
  private readonly similarityThreshold = 0.92;  // Seuil de correspondance
  private readonly maxEntries = 10_000;          // Limite d'entrées
  private readonly ttlMs = 7 * 24 * 60 * 60 * 1000; // TTL : 7 jours

  constructor(embedder: Embedder) {
    this.embedder = embedder;
  }

  /**
   * 🔍 Recherche une correspondance sémantique dans le cache
   *
   * @param query - La requête à chercher
   * @returns La meilleure correspondance ou null
   */
  async get(query: string): Promise<CacheResult | null> {
    // 1️⃣ Calculer l'embedding de la requête
    const queryEmbedding = await this.embedder.embed(query);

    // 2️⃣ Chercher la meilleure correspondance
    let bestMatch: CacheEntry | null = null;
    let bestSimilarity = 0;

    for (const entry of this.entries.values()) {
      // ⏰ Vérifier le TTL
      if (Date.now() - entry.createdAt.getTime() > this.ttlMs) {
        this.entries.delete(entry.id);
        continue;
      }

      // 📐 Calculer la similarité
      const similarity = this.cosineSimilarity(
        queryEmbedding,
        entry.queryEmbedding
      );

      if (similarity > bestSimilarity &&
          similarity >= this.similarityThreshold) {
        bestSimilarity = similarity;
        bestMatch = entry;
      }
    }

    // 3️⃣ Retourner le résultat
    if (bestMatch) {
      // 📊 Mettre à jour les stats
      bestMatch.accessCount++;
      bestMatch.lastAccess = new Date();

      return {
        response: bestMatch.response,
        similarity: bestSimilarity,
        originalQuery: bestMatch.query,
        metadata: bestMatch.metadata
      };
    }

    return null;
  }

  /**
   * 💾 Ajoute une nouvelle entrée au cache
   *
   * @param query - La requête
   * @param response - La réponse à cacher
   * @param metadata - Métadonnées (modèle, tokens)
   */
  async set(
    query: string,
    response: string,
    metadata: CacheEntry['metadata']
  ): Promise<void> {
    // 🧹 Vérifier la limite
    if (this.entries.size >= this.maxEntries) {
      this.evictLeastValuable();
    }

    // 🧮 Calculer l'embedding
    const queryEmbedding = await this.embedder.embed(query);

    // 📦 Créer l'entrée
    const entry: CacheEntry = {
      id: createHash('sha256')
        .update(query + Date.now())
        .digest('hex')
        .slice(0, 16),
      query,
      queryEmbedding,
      response,
      createdAt: new Date(),
      accessCount: 0,
      lastAccess: new Date(),
      metadata
    };

    this.entries.set(entry.id, entry);
  }

  /**
   * 📐 Calcule la similarité cosine entre deux vecteurs
   */
  private cosineSimilarity(a: number[], b: number[]): number {
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
   * 🧹 Éviction intelligente - LRU pondéré par popularité
   *
   * Au lieu d'un simple LRU, on calcule un score qui combine :
   * - La récence (quand a-t-elle été accédée ?)
   * - La fréquence (combien de fois ?)
   */
  private evictLeastValuable(): void {
    let victim: CacheEntry | null = null;
    let lowestScore = Infinity;

    for (const entry of this.entries.values()) {
      // 📊 Score = accès par heure depuis création
      const ageHours = (Date.now() - entry.createdAt.getTime()) / 3600000;
      const score = entry.accessCount / Math.max(ageHours, 1);

      if (score < lowestScore) {
        lowestScore = score;
        victim = entry;
      }
    }

    if (victim) {
      this.entries.delete(victim.id);
    }
  }

  /**
   * 💾 Persiste le cache sur disque
   */
  async save(path: string): Promise<void> {
    const data = Array.from(this.entries.values());
    await fs.writeFile(path, JSON.stringify(data, null, 2));
  }

  /**
   * 📂 Charge le cache depuis le disque
   */
  async load(path: string): Promise<void> {
    try {
      const raw = await fs.readFile(path, 'utf-8');
      const data = JSON.parse(raw);

      for (const entry of data) {
        entry.createdAt = new Date(entry.createdAt);
        entry.lastAccess = new Date(entry.lastAccess);
        this.entries.set(entry.id, entry);
      }
    } catch {
      // Fichier inexistant ou corrompu — on commence vide
    }
  }

  /**
   * 📊 Retourne les statistiques du cache
   */
  getStats(): CacheStats {
    let totalAccess = 0;
    let oldestEntry: Date | null = null;

    for (const entry of this.entries.values()) {
      totalAccess += entry.accessCount;
      if (!oldestEntry || entry.createdAt < oldestEntry) {
        oldestEntry = entry.createdAt;
      }
    }

    return {
      entries: this.entries.size,
      totalAccesses: totalAccess,
      avgAccessesPerEntry: this.entries.size > 0
        ? totalAccess / this.entries.size
        : 0,
      oldestEntry,
      estimatedSavings: totalAccess * 0.03 // $0.03 par requête économisée
    };
  }
}
```

### 12.2.3 🔌 Intégration avec l'Agent

```typescript
// src/agent/grok-agent.ts
export class GrokAgent {
  private semanticCache: SemanticCache;
  private cacheHits = 0;
  private cacheMisses = 0;

  async chat(message: string): Promise<string> {
    // 1️⃣ Vérifier le cache sémantique
    const cached = await this.semanticCache.get(message);

    if (cached) {
      this.cacheHits++;
      console.log(
        `✅ [Cache HIT] Similarity: ${(cached.similarity * 100).toFixed(1)}%`
      );
      console.log(`   Original: "${cached.originalQuery.slice(0, 50)}..."`);
      return cached.response;
    }

    this.cacheMisses++;
    console.log(`❌ [Cache MISS] Calling LLM...`);

    // 2️⃣ Appeler le LLM
    const response = await this.client.chat(this.buildMessages(message));

    // 3️⃣ Cacher la réponse pour les futures requêtes similaires
    await this.semanticCache.set(message, response.content, {
      model: this.currentModel,
      tokens: response.usage.totalTokens
    });

    return response.content;
  }

  /**
   * 📊 Retourne le taux de hits du cache
   */
  getCacheHitRate(): number {
    const total = this.cacheHits + this.cacheMisses;
    return total > 0 ? this.cacheHits / total : 0;
  }
}
```

### 12.2.4 📊 Comparaison des Approches

| Approche | Hit Rate | Faux Positifs | Complexité | Coût Embedding |
|----------|:--------:|:-------------:|:----------:|:--------------:|
| **Cache exact** | ~20% | 0% | O(1) | Aucun |
| **Cache normalisé** | ~35% | ~1% | O(1) | Aucun |
| **Cache sémantique** | ~68% | ~3% | O(n) | $0.0001/req |
| **Cache sém. + LSH** | ~65% | ~4% | O(1) | $0.0001/req |

> 💡 **LSH (Locality-Sensitive Hashing)** : Technique pour accélérer la recherche de voisins proches. Au lieu de comparer avec tous les vecteurs (O(n)), on hache les vecteurs de manière à ce que les vecteurs similaires aient le même hash (O(1)).

---

## 12.3 🔧 Tool Result Cache

Les outils aussi peuvent être cachés. Certains retournent des résultats stables — lire un fichier qui n'a pas changé retourne toujours le même contenu.

### 12.3.1 📊 Classification des Outils

| Outil | Icône | Stabilité | Cacheable | Stratégie |
|-------|:-----:|-----------|:---------:|-----------|
| `read_file` | 📄 | Stable jusqu'à modification | ✅ | TTL + invalidation |
| `list_directory` | 📁 | Change rarement | ✅ | TTL court (2 min) |
| `search_content` | 🔍 | Stable par session | ✅ | TTL moyen (15 min) |
| `git_status` | 📊 | Change souvent | ❌ | Pas de cache |
| `bash` (pure) | 💻 | Déterministe | ⚠️ | Dépend de la commande |
| `bash` (side effects) | ⚠️ | Imprévisible | ❌ | Jamais |

### 12.3.2 🔧 Implémentation

```typescript
// src/performance/tool-cache.ts
import { LRUCache } from 'lru-cache';

/**
 * 📦 Entrée du cache d'outil
 */
interface ToolCacheEntry {
  key: string;              // 🔑 Clé unique (outil + args)
  result: ToolResult;       // 📤 Résultat de l'exécution
  timestamp: Date;          // ⏰ Moment du cache
  ttl: number;              // ⏳ Durée de vie en ms
  invalidators: string[];   // 🎯 Chemins qui invalident cette entrée
}

/**
 * ⚙️ Configuration par outil
 */
interface ToolCacheConfig {
  enabled: boolean;
  ttl: number;
  keyGenerator: (args: Record<string, unknown>) => string;
  invalidators: (args: Record<string, unknown>) => string[];
}

/**
 * 🔧 ToolCache - Cache intelligent pour les résultats d'outils
 *
 * Chaque outil a sa propre stratégie de caching :
 * - read_file : cache long, invalidé par écriture
 * - list_directory : cache court, invalidé par changement
 * - search : cache moyen, invalidé par toute écriture
 */
export class ToolCache {
  private cache: LRUCache<string, ToolCacheEntry>;
  private readonly defaultTTL = 5 * 60 * 1000; // 5 minutes

  // 📋 Configuration par outil
  private readonly toolConfig: Record<string, ToolCacheConfig> = {
    'read_file': {
      enabled: true,
      ttl: 10 * 60 * 1000, // 10 minutes
      keyGenerator: (args) => `read:${args.path}`,
      invalidators: (args) => [args.path as string]
    },
    'list_directory': {
      enabled: true,
      ttl: 2 * 60 * 1000, // 2 minutes
      keyGenerator: (args) => `ls:${args.path}`,
      invalidators: (args) => [args.path as string]
    },
    'search_content': {
      enabled: true,
      ttl: 15 * 60 * 1000, // 15 minutes
      keyGenerator: (args) => `search:${args.pattern}:${args.path || '*'}`,
      invalidators: () => [] // Invalidé globalement
    },
    'git_status': {
      enabled: false, // Trop volatil
      ttl: 0,
      keyGenerator: () => 'git:status',
      invalidators: () => []
    },
    'bash': {
      enabled: false, // Side effects potentiels
      ttl: 0,
      keyGenerator: () => '',
      invalidators: () => []
    }
  };

  constructor() {
    this.cache = new LRUCache<string, ToolCacheEntry>({
      max: 1000,
      ttl: this.defaultTTL
    });
  }

  /**
   * 🔍 Cherche un résultat dans le cache
   */
  async get(toolName: string, args: Record<string, unknown>): Promise<ToolResult | null> {
    const config = this.toolConfig[toolName];
    if (!config?.enabled) return null;

    const key = config.keyGenerator(args);
    const entry = this.cache.get(key);

    if (entry) {
      // ⏰ Vérifier le TTL
      const age = Date.now() - entry.timestamp.getTime();
      if (age < entry.ttl) {
        console.log(`🔧 [Tool Cache HIT] ${toolName}: ${key}`);
        return entry.result;
      }
    }

    return null;
  }

  /**
   * 💾 Stocke un résultat dans le cache
   */
  async set(
    toolName: string,
    args: Record<string, unknown>,
    result: ToolResult
  ): Promise<void> {
    const config = this.toolConfig[toolName];
    if (!config?.enabled) return;
    if (!result.success) return; // ❌ Ne pas cacher les erreurs

    const key = config.keyGenerator(args);
    const invalidators = config.invalidators(args);

    this.cache.set(key, {
      key,
      result,
      timestamp: new Date(),
      ttl: config.ttl ?? this.defaultTTL,
      invalidators
    });
  }

  /**
   * 🗑️ Invalide les entrées liées à un chemin
   */
  invalidate(path: string): void {
    let invalidated = 0;

    for (const [key, entry] of this.cache.entries()) {
      const shouldInvalidate = entry.invalidators.some(inv =>
        path.startsWith(inv) || inv.startsWith(path)
      );

      if (shouldInvalidate) {
        this.cache.delete(key);
        invalidated++;
      }
    }

    if (invalidated > 0) {
      console.log(`🗑️ [Tool Cache] Invalidated ${invalidated} entries for: ${path}`);
    }
  }

  /**
   * 🧹 Invalide tout le cache
   */
  invalidateAll(): void {
    const size = this.cache.size;
    this.cache.clear();
    console.log(`🧹 [Tool Cache] Cleared all ${size} entries`);
  }
}
```

### 12.3.3 🔄 Invalidation Intelligente

L'invalidation est la partie la plus délicate du caching. Un cache qui sert des données périmées est pire que pas de cache du tout.

```typescript
// src/performance/cache-invalidator.ts
import { watch, FSWatcher } from 'fs';
import { EventEmitter } from 'events';

/**
 * 👁️ FileWatcher - Surveille les modifications de fichiers
 * et invalide le cache automatiquement
 */
export class CacheInvalidator extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private toolCache: ToolCache;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(toolCache: ToolCache) {
    super();
    this.toolCache = toolCache;
  }

  /**
   * 👁️ Démarre la surveillance d'un répertoire
   */
  start(directory: string): void {
    this.watcher = watch(directory, { recursive: true });

    this.watcher.on('change', (eventType, filename) => {
      if (eventType === 'change' || eventType === 'rename') {
        const fullPath = path.join(directory, filename as string);

        // 🔄 Debounce pour éviter les invalidations multiples
        this.debounce(fullPath, () => {
          this.toolCache.invalidate(fullPath);
          this.emit('invalidated', fullPath);
        });
      }
    });

    console.log(`👁️ Watching ${directory} for changes`);
  }

  private debounce(key: string, fn: () => void, ms = 100): void {
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);

    this.debounceTimers.set(key, setTimeout(() => {
      fn();
      this.debounceTimers.delete(key);
    }, ms));
  }

  stop(): void {
    this.watcher?.close();
    this.debounceTimers.forEach(t => clearTimeout(t));
    this.debounceTimers.clear();
  }
}

/**
 * 🔗 Hook d'invalidation post-outil
 * Certains outils modifient le système de fichiers — il faut
 * invalider le cache après leur exécution.
 */
const INVALIDATING_TOOLS = [
  'write_file',
  'edit_file',
  'delete_file',
  'bash'
];

export function afterToolExecution(
  toolName: string,
  args: Record<string, unknown>,
  result: ToolResult,
  toolCache: ToolCache
): void {
  if (!INVALIDATING_TOOLS.includes(toolName)) return;
  if (!result.success) return;

  if (toolName === 'bash') {
    // ⚠️ On ne sait pas ce que la commande a fait
    // Invalidation totale par sécurité
    toolCache.invalidateAll();
  } else if (args.path) {
    // 🎯 Invalidation ciblée
    toolCache.invalidate(args.path as string);
  }
}
```

---

## 12.4 ⚡ Pré-calcul et Warming

Plutôt que d'attendre les requêtes, on peut **anticiper** les besoins et précalculer les données fréquemment utilisées.

### 12.4.1 🚀 Pré-chargement du Contexte

```typescript
// src/performance/context-preloader.ts

/**
 * 🚀 ContextPreloader - Précharge le contexte au démarrage
 *
 * Stratégie : identifier les fichiers "importants" et les
 * pré-indexer avant que l'utilisateur ne les demande.
 */
export class ContextPreloader {
  private embedder: Embedder;
  private ragRetriever: CodebaseRetriever;
  private toolCache: ToolCache;

  // 📋 Patterns de fichiers importants (par ordre de priorité)
  private readonly importantPatterns = [
    '**/package.json',        // 📦 Dépendances
    '**/README.md',           // 📖 Documentation
    '**/src/index.{ts,js}',   // 🚪 Point d'entrée
    '**/src/types/**',        // 📝 Types partagés
    '**/.env.example',        // ⚙️ Configuration
    '**/tsconfig.json',       // 🔧 Config TypeScript
    '**/Dockerfile',          // 🐳 Conteneurisation
  ];

  async preload(projectRoot: string): Promise<PreloadResult> {
    console.log('🚀 Preloading context...');
    const startTime = Date.now();
    let filesProcessed = 0;

    // 1️⃣ Pré-calculer les embeddings des fichiers importants
    for (const pattern of this.importantPatterns) {
      const files = await glob(pattern, { cwd: projectRoot });

      for (const file of files) {
        await this.ragRetriever.ensureIndexed(file);
        filesProcessed++;
      }
    }

    // 2️⃣ Pré-charger les métadonnées des dépendances
    await this.preloadDependencies(projectRoot);

    // 3️⃣ Pré-cacher les structures de répertoires fréquentes
    await this.precacheDirectories(projectRoot);

    const duration = Date.now() - startTime;
    console.log(`✅ Context preloaded: ${filesProcessed} files in ${duration}ms`);

    return {
      filesProcessed,
      duration,
      cacheWarmth: this.calculateWarmth()
    };
  }

  private async preloadDependencies(projectRoot: string): Promise<void> {
    const packagePath = path.join(projectRoot, 'package.json');

    try {
      const pkg = JSON.parse(await fs.readFile(packagePath, 'utf-8'));
      const deps = Object.keys(pkg.dependencies || {}).slice(0, 10);

      console.log(`📦 Preloading info for ${deps.length} dependencies...`);

      // Pré-fetcher les infos des dépendances principales
      for (const dep of deps) {
        await this.fetchDependencyInfo(dep);
      }
    } catch {
      // Pas de package.json — on continue
    }
  }

  private async precacheDirectories(projectRoot: string): Promise<void> {
    const commonDirs = ['src', 'lib', 'tests', 'docs'];

    for (const dir of commonDirs) {
      const fullPath = path.join(projectRoot, dir);
      if (await exists(fullPath)) {
        // Simuler un list_directory pour le mettre en cache
        const entries = await fs.readdir(fullPath, { withFileTypes: true });
        await this.toolCache.set('list_directory', { path: fullPath }, {
          success: true,
          output: entries.map(e => ({
            name: e.name,
            type: e.isDirectory() ? 'directory' : 'file'
          }))
        });
      }
    }
  }

  private calculateWarmth(): number {
    // Ratio entrées en cache / entrées attendues
    const stats = this.toolCache.getStats();
    return Math.min(stats.size / 100, 1.0);
  }
}
```

### 12.4.2 📋 Cache de Templates

Les prompts suivent souvent des patterns répétitifs. En pré-compilant les templates, on économise du traitement.

```typescript
// src/performance/template-cache.ts

/**
 * 📋 Template compilé et prêt à l'emploi
 */
interface CompiledTemplate {
  name: string;
  template: string;
  variables: string[];
  render: (values: Record<string, string>) => string;
}

/**
 * 📋 PromptTemplateCache - Pré-compile les templates de prompts
 *
 * Exemple :
 *   template: "Explain {{code}} focusing on {{aspect}}"
 *   values: { code: "...", aspect: "performance" }
 *   result: "Explain ... focusing on performance"
 */
export class PromptTemplateCache {
  private templates: Map<string, CompiledTemplate> = new Map();

  constructor() {
    this.precompile();
  }

  private precompile(): void {
    const commonTemplates: Record<string, string> = {
      'code_explanation': `
Explain the following {{language}} code:

\`\`\`{{language}}
{{code}}
\`\`\`

Focus on: {{focus}}
Explain step by step what it does.
      `.trim(),

      'bug_fix': `
Fix this bug in {{language}} code:

**Error:** {{error}}

**Code:**
\`\`\`{{language}}
{{code}}
\`\`\`

**Expected behavior:** {{expected_behavior}}

Provide the corrected code with an explanation.
      `.trim(),

      'refactor': `
Refactor this {{language}} code to improve {{aspect}}:

\`\`\`{{language}}
{{code}}
\`\`\`

**Constraints:**
{{constraints}}

Show the refactored version with explanations.
      `.trim(),

      'test_generation': `
Generate tests for this {{language}} code using {{framework}}:

\`\`\`{{language}}
{{code}}
\`\`\`

Include tests for: {{scenarios}}
      `.trim()
    };

    for (const [name, template] of Object.entries(commonTemplates)) {
      this.templates.set(name, this.compile(name, template));
    }

    console.log(`📋 Precompiled ${this.templates.size} prompt templates`);
  }

  private compile(name: string, template: string): CompiledTemplate {
    // Extraire les variables {{var}}
    const matches = template.match(/\{\{(\w+)\}\}/g) || [];
    const variables = [...new Set(matches.map(v => v.slice(2, -2)))];

    return {
      name,
      template,
      variables,
      render: (values: Record<string, string>) => {
        let result = template;
        for (const [key, value] of Object.entries(values)) {
          result = result.replace(
            new RegExp(`\\{\\{${key}\\}\\}`, 'g'),
            value
          );
        }
        return result;
      }
    };
  }

  render(templateName: string, values: Record<string, string>): string {
    const template = this.templates.get(templateName);

    if (!template) {
      throw new Error(`Template not found: ${templateName}`);
    }

    // Vérifier que toutes les variables sont fournies
    const missing = template.variables.filter(v => !(v in values));
    if (missing.length > 0) {
      throw new Error(
        `Missing template variables: ${missing.join(', ')}`
      );
    }

    return template.render(values);
  }

  list(): string[] {
    return Array.from(this.templates.keys());
  }
}
```

---

## 12.5 📊 Métriques et Monitoring

Sans métriques, on optimise à l'aveugle. Un bon dashboard révèle les opportunités d'amélioration.

### 12.5.1 🎛️ Dashboard d'Optimisation

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     📊 OPTIMIZATION DASHBOARD                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  🔮 SEMANTIC CACHE                        🔧 TOOL CACHE                     │
│  ┌─────────────────────────────┐         ┌─────────────────────────────┐   │
│  │ Hit Rate    : ████████░░ 78%│         │ Hit Rate    : ██████░░░░ 62%│   │
│  │ Hits/Misses : 7,823 / 2,177 │         │ Hits/Misses : 1,245 / 763   │   │
│  │ Avg Sim.    : 94.3%         │         │ Invalidations : 89          │   │
│  │ Entries     : 8,432         │         │ Entries     : 234           │   │
│  │ Est. Savings: $234.69       │         │ Memory      : 12.4 MB       │   │
│  └─────────────────────────────┘         └─────────────────────────────┘   │
│                                                                             │
│  💰 COST ANALYSIS                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                                                                     │   │
│  │   Without cache : ████████████████████████████████████ $500.00     │   │
│  │   With cache    : ████████████░░░░░░░░░░░░░░░░░░░░░░░░ $170.31     │   │
│  │                                                                     │   │
│  │   💵 Savings    : $329.69 (65.9%)                                   │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ⏱️ PERFORMANCE                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │   Cache lookup    : 0.8ms avg                                       │   │
│  │   Embedding calc  : 45ms avg                                        │   │
│  │   LLM call        : 1,200ms avg                                     │   │
│  │   Cache hit       : 46ms (96% faster than LLM)                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 12.5.2 📈 Implémentation des Métriques

```typescript
// src/performance/optimization-metrics.ts

/**
 * 📊 Structure des métriques d'optimisation
 */
interface OptimizationMetrics {
  // 🔮 Cache sémantique
  semanticCache: {
    hits: number;
    misses: number;
    hitRate: number;
    avgSimilarity: number;
    entries: number;
    estimatedSavings: number;
  };

  // 🔧 Cache outils
  toolCache: {
    hits: number;
    misses: number;
    hitRate: number;
    invalidations: number;
    entries: number;
    memoryMB: number;
  };

  // 💰 Coûts
  cost: {
    totalRequests: number;
    cachedRequests: number;
    apiCalls: number;
    estimatedCost: number;  // Sans cache
    actualCost: number;     // Avec cache
    savings: number;
    savingsPercent: number;
  };

  // ⏱️ Performance
  performance: {
    avgCacheLookupMs: number;
    avgEmbeddingMs: number;
    avgLlmCallMs: number;
    avgCacheHitMs: number;
  };
}

/**
 * 📊 MetricsCollector - Collecte et agrège les métriques
 */
export class MetricsCollector {
  private semanticHits = 0;
  private semanticMisses = 0;
  private toolHits = 0;
  private toolMisses = 0;
  private toolInvalidations = 0;
  private similarities: number[] = [];
  private timings: Record<string, number[]> = {
    cacheLookup: [],
    embedding: [],
    llmCall: [],
    cacheHit: []
  };

  recordSemanticHit(similarity: number): void {
    this.semanticHits++;
    this.similarities.push(similarity);
  }

  recordSemanticMiss(): void {
    this.semanticMisses++;
  }

  recordToolHit(): void {
    this.toolHits++;
  }

  recordToolMiss(): void {
    this.toolMisses++;
  }

  recordToolInvalidation(): void {
    this.toolInvalidations++;
  }

  recordTiming(type: keyof typeof this.timings, ms: number): void {
    this.timings[type].push(ms);
    // Garder seulement les 1000 dernières mesures
    if (this.timings[type].length > 1000) {
      this.timings[type].shift();
    }
  }

  getMetrics(
    semanticCache: SemanticCache,
    toolCache: ToolCache
  ): OptimizationMetrics {
    const semanticTotal = this.semanticHits + this.semanticMisses;
    const toolTotal = this.toolHits + this.toolMisses;

    const avgSimilarity = this.similarities.length > 0
      ? this.similarities.reduce((a, b) => a + b, 0) / this.similarities.length
      : 0;

    const estimatedCost = (this.semanticHits + this.semanticMisses) * 0.05;
    const actualCost = this.semanticMisses * 0.05;
    const savings = estimatedCost - actualCost;

    return {
      semanticCache: {
        hits: this.semanticHits,
        misses: this.semanticMisses,
        hitRate: semanticTotal > 0 ? this.semanticHits / semanticTotal : 0,
        avgSimilarity,
        entries: semanticCache.getStats().entries,
        estimatedSavings: this.semanticHits * 0.03
      },
      toolCache: {
        hits: this.toolHits,
        misses: this.toolMisses,
        hitRate: toolTotal > 0 ? this.toolHits / toolTotal : 0,
        invalidations: this.toolInvalidations,
        entries: toolCache.getStats().size,
        memoryMB: toolCache.getStats().memoryBytes / (1024 * 1024)
      },
      cost: {
        totalRequests: semanticTotal,
        cachedRequests: this.semanticHits,
        apiCalls: this.semanticMisses,
        estimatedCost,
        actualCost,
        savings,
        savingsPercent: estimatedCost > 0 ? (savings / estimatedCost) * 100 : 0
      },
      performance: {
        avgCacheLookupMs: this.avgTiming('cacheLookup'),
        avgEmbeddingMs: this.avgTiming('embedding'),
        avgLlmCallMs: this.avgTiming('llmCall'),
        avgCacheHitMs: this.avgTiming('cacheHit')
      }
    };
  }

  private avgTiming(type: string): number {
    const values = this.timings[type];
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }
}
```

### 12.5.3 ⚠️ Alertes d'Optimisation

```typescript
// src/performance/optimization-alerts.ts

interface Alert {
  level: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  suggestion: string;
}

/**
 * ⚠️ Vérifie la santé des optimisations et génère des alertes
 */
export function checkOptimizationHealth(
  metrics: OptimizationMetrics
): Alert[] {
  const alerts: Alert[] = [];

  // 📉 Cache hit rate trop bas
  if (metrics.semanticCache.hitRate < 0.3) {
    alerts.push({
      level: 'warning',
      code: 'LOW_HIT_RATE',
      message: `Semantic cache hit rate at ${(metrics.semanticCache.hitRate * 100).toFixed(1)}%`,
      suggestion: 'Consider lowering similarity threshold (currently 0.92)'
    });
  }

  // 🔄 Trop d'invalidations
  if (metrics.toolCache.invalidations > metrics.toolCache.hits) {
    alerts.push({
      level: 'info',
      code: 'HIGH_INVALIDATION',
      message: `Tool cache invalidations (${metrics.toolCache.invalidations}) exceed hits`,
      suggestion: 'This workflow may not benefit from tool caching'
    });
  }

  // 💰 Coût élevé malgré le cache
  if (metrics.cost.actualCost > 100 && metrics.cost.savingsPercent < 20) {
    alerts.push({
      level: 'warning',
      code: 'LOW_SAVINGS',
      message: `High costs ($${metrics.cost.actualCost.toFixed(2)}) with only ${metrics.cost.savingsPercent.toFixed(1)}% savings`,
      suggestion: 'Review caching strategy or query patterns'
    });
  }

  // ⏱️ Cache lookup trop lent
  if (metrics.performance.avgCacheLookupMs > 100) {
    alerts.push({
      level: 'warning',
      code: 'SLOW_CACHE',
      message: `Cache lookup averaging ${metrics.performance.avgCacheLookupMs.toFixed(1)}ms`,
      suggestion: 'Consider implementing LSH for O(1) lookups'
    });
  }

  // 📊 Similarité moyenne basse
  if (metrics.semanticCache.avgSimilarity > 0 &&
      metrics.semanticCache.avgSimilarity < 0.90) {
    alerts.push({
      level: 'info',
      code: 'LOW_SIMILARITY',
      message: `Average match similarity at ${(metrics.semanticCache.avgSimilarity * 100).toFixed(1)}%`,
      suggestion: 'Matches may be less accurate than ideal'
    });
  }

  return alerts;
}
```

---

## 12.6 ✅ Bonnes Pratiques

### 12.6.1 📋 Matrice de Décision : Cacher ou Non ?

| Situation | Cacher ? | Icône | Raison |
|-----------|:--------:|:-----:|--------|
| Questions générales fréquentes | ✅ Oui | 🔮 | ROI élevé |
| Réponses personnalisées | ❌ Non | 🎯 | Contexte différent |
| Outils déterministes | ✅ Oui | 🔧 | Résultat stable |
| Outils avec side effects | ❌ Non | ⚠️ | Comportement imprévisible |
| Session longue (> 1h) | ✅ TTL court | ⏳ | Contexte évolue |
| Multi-utilisateurs | ⚠️ Attention | 👥 | Isolation nécessaire |
| Données sensibles | ❌ Non | 🔒 | Risque de fuite |

### 12.6.2 🎚️ Tuning du Seuil de Similarité

| Seuil | Hit Rate | Faux Positifs | Recommandation |
|:-----:|:--------:|:-------------:|----------------|
| 0.99 | ~25% | ~0% | 🔒 Ultra-conservateur |
| 0.95 | ~50% | ~1% | ✅ **Production recommandé** |
| 0.92 | ~65% | ~3% | ⚖️ Équilibré (défaut) |
| 0.90 | ~72% | ~5% | 🚀 Agressif |
| 0.85 | ~80% | ~12% | ⚠️ Risque qualité |

> 💡 **Conseil** : Commencez à 0.92, mesurez pendant une semaine, puis ajustez selon les faux positifs observés.

### 12.6.3 💾 Gestion de la Mémoire

```typescript
// src/performance/memory-manager.ts

/**
 * 💾 Gestionnaire de mémoire pour les caches
 */
export class CacheMemoryManager {
  private readonly MAX_MEMORY = 100 * 1024 * 1024; // 100 MB

  /**
   * 📏 Estime la taille d'une entrée en mémoire
   */
  estimateEntrySize(entry: CacheEntry): number {
    return (
      entry.query.length * 2 +           // UTF-16
      entry.queryEmbedding.length * 8 +  // Float64
      entry.response.length * 2 +         // UTF-16
      200                                 // Overhead objet
    );
  }

  /**
   * 📊 Calcule la mémoire totale utilisée
   */
  calculateTotalMemory(entries: CacheEntry[]): number {
    return entries.reduce(
      (total, entry) => total + this.estimateEntrySize(entry),
      0
    );
  }

  /**
   * 🧹 Enforce la limite de mémoire
   */
  enforceLimit(cache: SemanticCache): number {
    let totalSize = 0;
    let evicted = 0;
    const entries = Array.from(cache.entries());

    // Calculer la taille totale
    for (const entry of entries) {
      totalSize += this.estimateEntrySize(entry);
    }

    // Éviction si nécessaire
    while (totalSize > this.MAX_MEMORY && entries.length > 0) {
      const oldest = this.findLeastValuable(entries);
      totalSize -= this.estimateEntrySize(oldest);
      cache.delete(oldest.id);
      evicted++;
    }

    if (evicted > 0) {
      console.log(
        `🧹 Memory enforcement: evicted ${evicted} entries, ` +
        `freed ${(evicted * 50 / 1024).toFixed(1)} KB`
      );
    }

    return evicted;
  }

  private findLeastValuable(entries: CacheEntry[]): CacheEntry {
    return entries.reduce((min, entry) => {
      const minScore = this.valueScore(min);
      const entryScore = this.valueScore(entry);
      return entryScore < minScore ? entry : min;
    });
  }

  private valueScore(entry: CacheEntry): number {
    const ageHours = (Date.now() - entry.lastAccess.getTime()) / 3600000;
    return entry.accessCount / Math.max(ageHours, 0.1);
  }
}
```

### 12.6.4 📊 Tableau Récapitulatif des Résultats

| Métrique | Sans Optimisation | Avec Optimisation | Amélioration |
|----------|------------------:|------------------:|-------------:|
| Requêtes API/jour | 10,000 | 3,200 | -68% |
| Coût/jour | $500 | $170 | -66% |
| Latence moyenne | 1,200ms | 420ms | -65% |
| Latence P99 | 3,500ms | 1,800ms | -49% |

---

## 📝 Points Clés

| Concept | Icône | Description | Impact |
|---------|:-----:|-------------|--------|
| **Redondance** | 💸 | 68% des requêtes sont similaires | Opportunité majeure |
| **Semantic Cache** | 🔮 | Similarité cosine > seuil | 66% économies API |
| **Tool Cache** | 🔧 | LRU + TTL + invalidation | Latence réduite |
| **Pré-calcul** | ⚡ | Embeddings, templates, contexte | Démarrage rapide |
| **Monitoring** | 📊 | Dashboard en temps réel | Amélioration continue |

---

## 🏋️ Exercices

### Exercice 1 : 🎚️ Calibration du Seuil
Testez différents seuils de similarité (0.85, 0.90, 0.95, 0.99) sur votre workload typique. Mesurez :
- Le hit rate
- Le nombre de faux positifs (réponses incorrectes)
- La satisfaction utilisateur

**Objectif** : Trouver le seuil optimal pour votre cas d'usage.

### Exercice 2 : 🔄 Invalidation Avancée
Implémentez un système d'invalidation basé sur :
- Les timestamps de fichiers
- Les dépendances entre fichiers (si A importe B, invalider A quand B change)
- Les événements Git (commits, branches)

### Exercice 3 : 📊 Dashboard Temps Réel
Créez un dashboard TUI (Text User Interface) avec blessed ou ink qui affiche :
- Hit rates en temps réel
- Économies cumulées
- Top 10 des requêtes les plus cachées
- Alertes actives

### Exercice 4 : 🧪 A/B Testing
Comparez deux stratégies de caching sur une semaine :
- Groupe A : Cache sémantique seul
- Groupe B : Cache sémantique + cache d'outils

Mesurez : coûts, latence, qualité des réponses.

---

## 📚 Références

| Source | Description | Lien |
|--------|-------------|------|
| **GPTCache** | Semantic caching library for LLMs | [GitHub](https://github.com/zilliztech/GPTCache) |
| **Cosine Similarity** | Mesure de similarité vectorielle | [Wikipedia](https://en.wikipedia.org/wiki/Cosine_similarity) |
| **LSH** | Locality-Sensitive Hashing | [Stanford](https://cs.stanford.edu/~jtyler/lsh.pdf) |
| **LRU Cache** | Least Recently Used éviction | [npm lru-cache](https://www.npmjs.com/package/lru-cache) |
| **Grok-CLI** | `src/utils/semantic-cache.ts`, `src/performance/tool-cache.ts` | Local |

---

## 🌅 Épilogue — La Mémoire de la Machine

*Une semaine plus tard. Vendredi soir, encore. Mais cette fois, Lina est déjà debout, manteau sur le dos, sac à l'épaule.*

**Marc** *(surpris)* : "Tu pars à l'heure ?"

**Lina** *(souriant)* : "Regarde."

*Elle tourne son écran vers lui. Le dashboard de métriques.*

```
Hit Rate:       68.2%
Économies:      $347.50 cette semaine
Latence moy.:   420ms (vs 1,200ms avant)
Cache entries:  12,847
```

**Marc** : "68% de hit rate. Ton agent se *souvient*."

**Lina** : "Le plus beau ? Quand je tape 'ls', il reconnaît que c'est la même question que 'liste les fichiers' de ce matin. Similarité 0.94."

*Elle fait défiler les logs.*

**Lina** : "Et regarde ici. Quand j'ai modifié `utils.ts` à 15h, le cache a automatiquement invalidé toutes les entrées qui référençaient ce fichier. Zéro donnée périmée."

**Marc** : "Élégant. Tu as donné une mémoire à ton agent."

*Un silence. Lina hésite.*

**Lina** : "Marc... Il y a quelque chose qui me tracasse quand même."

**Marc** : "Hmm ?"

**Lina** : "Le cache, c'est pour la *sortie*. On évite de recalculer les mêmes réponses. Mais pour l'*entrée*..."

*Elle fait défiler jusqu'aux logs de tool calls.*

**Lina** : "Grok-CLI a 41 outils. À chaque requête, mon agent reçoit la description de ces 41 outils. Même quand la tâche est simple — genre lire un fichier — il doit traiter 41 descriptions avant de choisir."

**Marc** *(fronçant les sourcils)* : "3,000 tokens juste pour la liste des outils..."

**Lina** : "Exactement. Et j'ai lu un papier récemment. Des chercheurs de... attend..."

*Elle cherche dans ses notes.*

**Lina** : "'Less is More: Fewer Tool Descriptions Lead to Better LLM Reasoning'. Ils ont montré que donner **moins** d'outils au modèle améliore à la fois la précision ET la vitesse."

**Marc** *(intéressé)* : "Counter-intuitif. Comme JetBrains avec le contexte."

**Lina** : "Même principe ! Trop de choix = paralysie de l'analyse. Si je filtre dynamiquement les outils pour ne montrer que les pertinents..."

*Elle note rapidement sur son carnet.*

**Marc** : "Tu veux implémenter ça ce soir ?"

**Lina** *(riant)* : "Non, je vais enfin profiter de mon vendredi. Mais lundi..."

*Elle range son carnet.*

**Lina** : "Lundi, on s'attaque aux optimisations système. Filtrage d'outils, routing de modèles, parallélisation..."

**Marc** : "Le trio infernal de la performance."

**Lina** : "FrugalGPT pour le routing. LLMCompiler pour la parallélisation. Et Less-is-More pour les outils."

*Elle enfile son manteau.*

**Lina** : "On a optimisé la mémoire. Maintenant, on optimise la réflexion elle-même."

*Elle éteint son écran. La pièce devient silencieuse, mais quelque part dans le cloud, son agent continue de servir des réponses depuis son cache, se souvenant de chaque question déjà posée.*

---

## 🧭 Navigation

| Précédent | Suivant |
|:---------:|:-------:|
| [← Chapitre 11 : Plugins et MCP](11-plugins-mcp.md) | [Chapitre 13 : Optimisations Système →](13-optimisations-systeme.md) |

---

*Dans le prochain chapitre : Trois techniques qui ont révolutionné les agents LLM — FrugalGPT de Stanford, LLMCompiler de Berkeley, et le principe "Less is More" qui défie l'intuition. Préparez-vous à diviser vos coûts par trois.*
