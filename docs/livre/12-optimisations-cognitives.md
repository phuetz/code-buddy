# Chapitre 12 — Optimisations Cognitives

---

> **Scène**
>
> *Lina regarde ses métriques. Son agent fonctionne bien, mais...*
>
> *"68% de mes appels API sont des questions similaires," constate-t-elle. "Je demande 'comment lister les fichiers' cent fois par jour avec des variantes."*
>
> *Elle calcule. À $0.03 par requête, ça fait $2 par jour gaspillés sur des questions déjà résolues.*
>
> *"J'ai besoin d'un cache intelligent. Pas juste un cache exact — un cache qui comprend que 'ls' et 'lister les fichiers' c'est la même chose."*

---

## Introduction

Un agent naïf appelle le LLM pour chaque requête, même quand la réponse est connue. Les **optimisations cognitives** réduisent les appels API en cachant intelligemment les réponses et en réutilisant les résultats.

Ce chapitre explore le caching sémantique, le caching des résultats d'outils, et les techniques de pré-calcul.

---

## 12.1 Le Coût de la Redondance

### 12.1.1 Analyse des patterns de requêtes

```
┌─────────────────────────────────────────────────────────────────────┐
│                ANALYSE DES REQUÊTES (1 semaine)                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Total requêtes : 10,000                                            │
│                                                                      │
│  Par type :                                                         │
│  ├── Uniques (vraiment nouvelles)    : 3,200  (32%)                 │
│  ├── Quasi-identiques (reformulations): 4,800  (48%)                │
│  └── Répétitions exactes             : 2,000  (20%)                 │
│                                                                      │
│  Coût sans cache :                                                  │
│  └── 10,000 × $0.05 = $500                                          │
│                                                                      │
│  Coût avec cache sémantique :                                       │
│  └── 3,200 × $0.05 + overhead = $170                                │
│                                                                      │
│  Économie potentielle : 66%                                         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 12.1.2 Types de redondance

| Type | Exemple | Cache possible |
|------|---------|----------------|
| **Exact** | "ls" → "ls" | Cache simple |
| **Sémantique** | "liste les fichiers" → "ls" | Cache sémantique |
| **Paramétrique** | "lis config.ts" → "lis utils.ts" | Cache partiel |
| **Contextuel** | Même question, contexte différent | Pas de cache |

---

## 12.2 Semantic Response Cache

### 12.2.1 Principe

Au lieu de chercher une correspondance exacte, on compare la **similarité sémantique** entre les requêtes :

```
┌─────────────────────────────────────────────────────────────────────┐
│                   SEMANTIC CACHE FLOW                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   Requête : "Comment lister les fichiers ?"                         │
│                 │                                                    │
│                 ▼                                                    │
│   ┌─────────────────────────────┐                                   │
│   │     Embed la requête        │                                   │
│   │     [0.23, -0.45, 0.12, ...]│                                   │
│   └──────────────┬──────────────┘                                   │
│                  │                                                   │
│                  ▼                                                   │
│   ┌─────────────────────────────┐                                   │
│   │  Chercher dans le cache     │                                   │
│   │  (similarité cosine > 0.92) │                                   │
│   └──────────────┬──────────────┘                                   │
│                  │                                                   │
│         ┌───────┴───────┐                                           │
│         │               │                                            │
│         ▼               ▼                                            │
│   ┌──────────┐    ┌──────────┐                                      │
│   │  CACHE   │    │  CACHE   │                                      │
│   │   HIT    │    │   MISS   │                                      │
│   └────┬─────┘    └────┬─────┘                                      │
│        │               │                                             │
│        ▼               ▼                                             │
│   Retourner        Appeler LLM                                      │
│   réponse cachée   Cacher la réponse                                │
│                                                                      │
│   Match trouvé :                                                    │
│   "ls ou dir pour lister" → 0.94 similarité                         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 12.2.2 Implémentation

```typescript
// src/utils/semantic-cache.ts
interface CacheEntry {
  id: string;
  query: string;
  queryEmbedding: number[];
  response: string;
  createdAt: Date;
  accessCount: number;
  lastAccess: Date;
  metadata: {
    model: string;
    tokens: number;
    context?: string;
  };
}

export class SemanticCache {
  private entries: Map<string, CacheEntry> = new Map();
  private embedder: Embedder;
  private similarityThreshold = 0.92;
  private maxEntries = 10_000;
  private ttlMs = 7 * 24 * 60 * 60 * 1000; // 7 jours

  async get(query: string): Promise<CacheResult | null> {
    // Embed la query
    const queryEmbedding = await this.embedder.embed(query);

    // Chercher la meilleure correspondance
    let bestMatch: CacheEntry | null = null;
    let bestSimilarity = 0;

    for (const entry of this.entries.values()) {
      // Vérifier TTL
      if (Date.now() - entry.createdAt.getTime() > this.ttlMs) {
        this.entries.delete(entry.id);
        continue;
      }

      const similarity = cosineSimilarity(queryEmbedding, entry.queryEmbedding);

      if (similarity > bestSimilarity && similarity >= this.similarityThreshold) {
        bestSimilarity = similarity;
        bestMatch = entry;
      }
    }

    if (bestMatch) {
      // Mettre à jour les stats
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

  async set(query: string, response: string, metadata: CacheMetadata): Promise<void> {
    // Vérifier la limite
    if (this.entries.size >= this.maxEntries) {
      this.evictOldest();
    }

    const queryEmbedding = await this.embedder.embed(query);

    const entry: CacheEntry = {
      id: crypto.randomUUID(),
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

  private evictOldest(): void {
    // Stratégie LRU avec pondération par accessCount
    let oldest: CacheEntry | null = null;
    let lowestScore = Infinity;

    for (const entry of this.entries.values()) {
      const age = Date.now() - entry.lastAccess.getTime();
      const score = entry.accessCount / (age / 3600000); // accès par heure

      if (score < lowestScore) {
        lowestScore = score;
        oldest = entry;
      }
    }

    if (oldest) {
      this.entries.delete(oldest.id);
    }
  }

  async save(path: string): Promise<void> {
    const data = Array.from(this.entries.values());
    await fs.writeFile(path, JSON.stringify(data, null, 2));
  }

  async load(path: string): Promise<void> {
    try {
      const data = JSON.parse(await fs.readFile(path, 'utf-8'));
      for (const entry of data) {
        entry.createdAt = new Date(entry.createdAt);
        entry.lastAccess = new Date(entry.lastAccess);
        this.entries.set(entry.id, entry);
      }
    } catch {
      // Fichier inexistant ou corrompu
    }
  }

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
      avgAccessesPerEntry: totalAccess / this.entries.size,
      oldestEntry,
      estimatedSavings: totalAccess * 0.03 // $0.03 par requête économisée
    };
  }
}
```

### 12.2.3 Intégration avec l'agent

```typescript
// src/agent/grok-agent.ts
export class GrokAgent {
  private semanticCache: SemanticCache;

  async chat(message: string): Promise<string> {
    // 1. Vérifier le cache
    const cached = await this.semanticCache.get(message);

    if (cached) {
      console.log(`[Cache HIT] Similarity: ${(cached.similarity * 100).toFixed(1)}%`);
      return cached.response;
    }

    // 2. Appeler le LLM
    const response = await this.client.chat(this.buildMessages(message));

    // 3. Cacher la réponse
    await this.semanticCache.set(message, response.content, {
      model: this.currentModel,
      tokens: response.usage.totalTokens
    });

    return response.content;
  }
}
```

---

## 12.3 Tool Result Cache

### 12.3.1 Pourquoi cacher les outils ?

Certains outils retournent des résultats stables :

| Outil | Stabilité | Cacheable |
|-------|-----------|-----------|
| `read_file` | Dépend du fichier | Oui, avec invalidation |
| `list_directory` | Change rarement | Oui, TTL court |
| `git_status` | Change souvent | Non |
| `search` | Stable par session | Oui, TTL moyen |
| `bash` (pure) | Déterministe | Oui |
| `bash` (side effects) | Non | Non |

### 12.3.2 Implémentation

```typescript
// src/performance/tool-cache.ts
interface ToolCacheEntry {
  key: string;
  result: ToolResult;
  timestamp: Date;
  ttl: number;
  invalidators: string[]; // Fichiers/events qui invalident
}

export class ToolCache {
  private cache: LRUCache<string, ToolCacheEntry>;
  private defaultTTL = 5 * 60 * 1000; // 5 minutes

  private toolConfig: Record<string, ToolCacheConfig> = {
    'read_file': {
      enabled: true,
      ttl: 10 * 60 * 1000,
      keyGenerator: (args) => `read:${args.path}`,
      invalidators: (args) => [args.path]
    },
    'list_directory': {
      enabled: true,
      ttl: 2 * 60 * 1000,
      keyGenerator: (args) => `ls:${args.path}`,
      invalidators: (args) => [args.path]
    },
    'search_content': {
      enabled: true,
      ttl: 15 * 60 * 1000,
      keyGenerator: (args) => `search:${args.pattern}:${args.path || '*'}`,
      invalidators: () => [] // Invalidé par toute écriture
    },
    'git_status': {
      enabled: false // Change trop souvent
    },
    'bash': {
      enabled: false // Side effects potentiels
    }
  };

  constructor() {
    this.cache = new LRUCache({
      max: 1000,
      ttl: this.defaultTTL
    });
  }

  async get(toolName: string, args: unknown): Promise<ToolResult | null> {
    const config = this.toolConfig[toolName];
    if (!config?.enabled) return null;

    const key = config.keyGenerator(args);
    const entry = this.cache.get(key);

    if (entry && Date.now() - entry.timestamp.getTime() < entry.ttl) {
      return entry.result;
    }

    return null;
  }

  async set(toolName: string, args: unknown, result: ToolResult): Promise<void> {
    const config = this.toolConfig[toolName];
    if (!config?.enabled) return;
    if (!result.success) return; // Ne pas cacher les erreurs

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

  invalidate(path: string): void {
    // Invalider toutes les entrées liées à ce chemin
    for (const [key, entry] of this.cache.entries()) {
      if (entry.invalidators.some(inv => path.startsWith(inv) || inv.startsWith(path))) {
        this.cache.delete(key);
      }
    }
  }

  invalidateAll(): void {
    this.cache.clear();
  }

  getStats(): ToolCacheStats {
    return {
      size: this.cache.size,
      maxSize: this.cache.max,
      // Les stats de hits/misses nécessitent un wrapper
    };
  }
}
```

### 12.3.3 Invalidation intelligente

```typescript
// Écouter les modifications de fichiers
class FileWatcher {
  private watcher: FSWatcher;
  private toolCache: ToolCache;

  start(directory: string): void {
    this.watcher = watch(directory, { recursive: true });

    this.watcher.on('change', (eventType, filename) => {
      if (eventType === 'change' || eventType === 'rename') {
        const fullPath = path.join(directory, filename as string);
        this.toolCache.invalidate(fullPath);
      }
    });
  }
}

// Invalidation après certains outils
const invalidatingTools = ['write_file', 'edit_file', 'delete_file', 'bash'];

function afterToolExecution(toolName: string, args: unknown, result: ToolResult): void {
  if (invalidatingTools.includes(toolName) && result.success) {
    if (toolName === 'bash') {
      // Invalider tout (on ne sait pas ce que la commande a fait)
      toolCache.invalidateAll();
    } else {
      // Invalider le chemin spécifique
      toolCache.invalidate(args.path);
    }
  }
}
```

---

## 12.4 Pré-calcul et Warming

### 12.4.1 Pré-chargement du contexte

```typescript
// src/performance/context-preloader.ts
export class ContextPreloader {
  private embedder: Embedder;
  private ragRetriever: CodebaseRetriever;

  async preload(projectRoot: string): Promise<void> {
    console.log('Preloading context...');

    // 1. Pré-calculer les embeddings des fichiers importants
    const importantPatterns = [
      '**/package.json',
      '**/README.md',
      '**/src/index.{ts,js}',
      '**/src/types/**',
      '**/.env.example'
    ];

    for (const pattern of importantPatterns) {
      const files = await glob(pattern, { cwd: projectRoot });
      for (const file of files) {
        await this.ragRetriever.ensureIndexed(file);
      }
    }

    // 2. Pré-charger les dépendances fréquentes
    const packageJson = path.join(projectRoot, 'package.json');
    if (await exists(packageJson)) {
      const pkg = JSON.parse(await fs.readFile(packageJson, 'utf-8'));
      const deps = Object.keys(pkg.dependencies || {}).slice(0, 10);

      // Pré-fetcher la doc des dépendances principales
      for (const dep of deps) {
        await this.fetchDependencyInfo(dep);
      }
    }

    // 3. Pré-calculer les patterns de code fréquents
    await this.analyzeCodePatterns(projectRoot);

    console.log('Context preloaded.');
  }

  private async analyzeCodePatterns(projectRoot: string): Promise<void> {
    // Analyser les imports les plus fréquents
    // Analyser les types les plus utilisés
    // Pré-indexer pour les recherches futures
  }
}
```

### 12.4.2 Cache de templates

```typescript
// src/performance/template-cache.ts
export class PromptTemplateCache {
  private templates: Map<string, CompiledTemplate> = new Map();

  constructor() {
    // Pré-compiler les templates fréquents
    this.precompile();
  }

  private precompile(): void {
    const commonTemplates = {
      'code_explanation': `
        Explain the following code:
        \`\`\`{{language}}
        {{code}}
        \`\`\`
        Focus on: {{focus}}
      `,
      'bug_fix': `
        Fix this bug:
        Error: {{error}}
        Code:
        \`\`\`{{language}}
        {{code}}
        \`\`\`
        The code should: {{expected_behavior}}
      `,
      'refactor': `
        Refactor this code to improve {{aspect}}:
        \`\`\`{{language}}
        {{code}}
        \`\`\`
        Constraints: {{constraints}}
      `
    };

    for (const [name, template] of Object.entries(commonTemplates)) {
      this.templates.set(name, this.compile(template));
    }
  }

  private compile(template: string): CompiledTemplate {
    // Extraire les variables {{var}}
    const variables = template.match(/\{\{(\w+)\}\}/g) || [];
    const varNames = variables.map(v => v.slice(2, -2));

    return {
      template,
      variables: varNames,
      render: (values: Record<string, string>) => {
        let result = template;
        for (const [key, value] of Object.entries(values)) {
          result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
        }
        return result;
      }
    };
  }

  render(name: string, values: Record<string, string>): string {
    const template = this.templates.get(name);
    if (!template) {
      throw new Error(`Template not found: ${name}`);
    }
    return template.render(values);
  }
}
```

---

## 12.5 Métriques et Monitoring

### 12.5.1 Dashboard d'optimisation

```typescript
interface OptimizationMetrics {
  // Cache sémantique
  semanticCache: {
    hits: number;
    misses: number;
    hitRate: number;
    avgSimilarity: number;
    estimatedSavings: number;
  };

  // Cache outils
  toolCache: {
    hits: number;
    misses: number;
    hitRate: number;
    invalidations: number;
  };

  // Général
  totalRequests: number;
  cachedRequests: number;
  apiCalls: number;
  estimatedCost: number;
  actualCost: number;
}

function printOptimizationDashboard(metrics: OptimizationMetrics): void {
  const savings = metrics.estimatedCost - metrics.actualCost;
  const savingsPercent = (savings / metrics.estimatedCost) * 100;

  console.log(`
┌─────────────────────────────────────────────────────────────────────┐
│                  OPTIMIZATION DASHBOARD                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  SEMANTIC CACHE                                                     │
│  ├── Hit Rate        : ${(metrics.semanticCache.hitRate * 100).toFixed(1)}%                             │
│  ├── Hits/Misses     : ${metrics.semanticCache.hits}/${metrics.semanticCache.misses}                          │
│  ├── Avg Similarity  : ${(metrics.semanticCache.avgSimilarity * 100).toFixed(1)}%                             │
│  └── Est. Savings    : $${metrics.semanticCache.estimatedSavings.toFixed(2)}                            │
│                                                                      │
│  TOOL CACHE                                                         │
│  ├── Hit Rate        : ${(metrics.toolCache.hitRate * 100).toFixed(1)}%                             │
│  ├── Hits/Misses     : ${metrics.toolCache.hits}/${metrics.toolCache.misses}                          │
│  └── Invalidations   : ${metrics.toolCache.invalidations}                              │
│                                                                      │
│  COST ANALYSIS                                                      │
│  ├── Without cache   : $${metrics.estimatedCost.toFixed(2)}                            │
│  ├── With cache      : $${metrics.actualCost.toFixed(2)}                            │
│  └── Savings         : $${savings.toFixed(2)} (${savingsPercent.toFixed(1)}%)                  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
  `);
}
```

### 12.5.2 Alertes d'optimisation

```typescript
function checkOptimizationHealth(metrics: OptimizationMetrics): Alert[] {
  const alerts: Alert[] = [];

  // Cache hit rate trop bas
  if (metrics.semanticCache.hitRate < 0.3) {
    alerts.push({
      level: 'warning',
      message: 'Semantic cache hit rate below 30%. Consider adjusting similarity threshold.'
    });
  }

  // Beaucoup d'invalidations
  if (metrics.toolCache.invalidations > metrics.toolCache.hits) {
    alerts.push({
      level: 'info',
      message: 'High tool cache invalidation rate. Caching may not be effective for this workflow.'
    });
  }

  // Coût élevé malgré le cache
  if (metrics.actualCost > 100 && savingsPercent < 20) {
    alerts.push({
      level: 'warning',
      message: 'High API costs with low cache savings. Review caching strategy.'
    });
  }

  return alerts;
}
```

---

## 12.6 Bonnes Pratiques

### 12.6.1 Quand cacher

| Situation | Cacher ? | Raison |
|-----------|----------|--------|
| Questions fréquentes | Oui | ROI élevé |
| Réponses personnalisées | Non | Contexte différent |
| Outils déterministes | Oui | Résultat stable |
| Outils avec side effects | Non | Comportement différent |
| Session longue | Oui, TTL court | Contexte évolue |
| Multi-utilisateurs | Attention | Isolation nécessaire |

### 12.6.2 Tuning du seuil de similarité

| Seuil | Effet |
|-------|-------|
| 0.99 | Très conservateur, peu de hits |
| 0.95 | Équilibré |
| 0.90 | Agressif, risque de faux positifs |
| 0.85 | Très agressif, qualité réduite |

### 12.6.3 Gestion de la mémoire

```typescript
// Limite de mémoire pour le cache
const MAX_CACHE_MEMORY = 100 * 1024 * 1024; // 100 MB

function estimateEntrySize(entry: CacheEntry): number {
  return (
    entry.query.length * 2 +  // UTF-16
    entry.queryEmbedding.length * 8 +  // Float64
    entry.response.length * 2 +
    200  // Overhead
  );
}

function enforceMemoryLimit(): void {
  let totalSize = 0;

  for (const entry of cache.entries.values()) {
    totalSize += estimateEntrySize(entry);
  }

  while (totalSize > MAX_CACHE_MEMORY && cache.entries.size > 0) {
    const oldest = findOldestEntry();
    totalSize -= estimateEntrySize(oldest);
    cache.entries.delete(oldest.id);
  }
}
```

---

## Résumé

Dans ce chapitre, nous avons vu :

| Concept | Point clé |
|---------|-----------|
| **Problème** | 68% des requêtes sont redondantes |
| **Semantic Cache** | Similarité cosine > seuil |
| **Tool Cache** | LRU + TTL + invalidation |
| **Pré-calcul** | Embeddings, templates, contexte |
| **Résultats** | Jusqu'à 68% de réduction des coûts |

---

## Exercices

1. **Seuil** : Testez différents seuils de similarité (0.85, 0.90, 0.95) et mesurez hit rate vs qualité.

2. **Invalidation** : Implémentez un système d'invalidation basé sur les timestamps de fichiers.

3. **Métriques** : Ajoutez un tracking des économies réalisées par le cache.

4. **Optimisation** : Identifiez les 10 requêtes les plus fréquentes de votre usage et optimisez pour elles.

---

## Pour aller plus loin

- GPTCache: Semantic Caching for LLMs
- Grok-CLI : `src/utils/semantic-cache.ts`, `src/performance/tool-cache.ts`

---

*Prochainement : Chapitre 13 — Optimisations Système*

