/**
 * Knowledge Graph Memory — memU-inspired persistent memory
 *
 * Local knowledge graph that memorizes user preferences, habits, temporal
 * patterns, and entity relationships. The agent improves over time.
 *
 * Unlike flat memory (MEMORY.md, EnhancedMemory), this captures RELATIONS
 * between entities — enabling context-aware recall like:
 *   "User → prefers → short responses" + "time:morning → weight:0.9"
 *   "User → works_on → ProjectX" + "ProjectX → uses → TypeScript"
 *   "Client → named → Jean" + "Jean → is → VIP"
 *
 * Storage: JSON file (lightweight, no Neo4j dependency)
 *
 * memU parity features:
 *   - 3-layer hierarchy (entities → relations → categories with auto-summaries)
 *   - Salience scoring: similarity * log(reinforcement+1) * recency_decay
 *   - Content-hash dedup (SHA256 normalized)
 *   - Intent routing (skip injection for trivial messages)
 *   - Category auto-summaries (compressed topic representations)
 *   - Background-safe extraction (fire-and-forget)
 *   - Reinforcement counting (frequently mentioned = more important)
 */

import { createHash } from 'crypto';
import { dirname, join } from 'path';
import { logger } from '../utils/logger.js';
import { readJsonAtomic, writeJsonAtomic } from '../utils/atomic-write.js';
import { shouldWriteProjectRuntimeFiles } from '../utils/runtime-flags.js';

// ============================================================================
// Types
// ============================================================================

export type EntityType =
  | 'user' | 'project' | 'person' | 'tool' | 'concept'
  | 'preference' | 'habit' | 'file' | 'technology' | 'organization'
  // Collective Knowledge Graph (CKG) vocabulary — the agent collective's shared memory.
  | 'agent' | 'task' | 'lesson' | 'decision' | 'fact'
  // Scientific-discovery memory: a finding ingested from a publication, auto-linked to its
  // nearest neighbours (Patrice's vision — "relier les découvertes aux plus proches").
  | 'discovery';

export type RelationType =
  | 'prefers' | 'dislikes' | 'uses' | 'works_on' | 'knows'
  | 'related_to' | 'created_by' | 'depends_on' | 'temporal_pattern'
  | 'has_style' | 'avoids' | 'collaborates_with' | 'owns'
  // CKG relations.
  | 'decided_by' | 'blocks' | 'learned_from' | 'supersedes' | 'verified_by'
  // Domain-NEUTRAL research relations (any field: AI, physics, biology, medicine…) — to
  // link discoveries and capture "what works / doesn't" without hardcoding any domain.
  | 'supports' | 'contradicts' | 'builds_on';

export interface Entity {
  id: string;
  type: EntityType;
  name: string;
  properties: Record<string, unknown>;
  /** Confidence score 0-1 */
  confidence: number;
  /** Number of times this entity was referenced */
  mentions: number;
  createdAt: Date;
  updatedAt: Date;
  // --- CKG bi-temporal + attribution (all optional → existing user-graph JSON still loads) ---
  /** Valid-time start: when the fact became true (Zep bi-temporal). */
  validFrom?: Date;
  /** Valid-time end: when it stopped being true; `null`/absent = currently true. */
  validTo?: Date | null;
  /** Transaction-time: when the system recorded it (drives cross-machine merge). */
  recordedAt?: Date;
  /** Which agent contributed this (`<host>/<repo>`, defaultFleetAgentId). */
  agentId?: string;
  /** Provenance label (e.g. 'chat', 'council', 'worklog', 'dream'). */
  source?: string;
}

export interface Relation {
  id: string;
  sourceId: string;
  targetId: string;
  type: RelationType;
  /** Weight/strength of the relation (0-1) */
  weight: number;
  properties: Record<string, unknown>;
  /** Temporal context (e.g., "morning", "weekday", "friday_afternoon") */
  temporalContext?: string;
  confidence: number;
  mentions: number;
  createdAt: Date;
  updatedAt: Date;
  // --- CKG bi-temporal + attribution (all optional → existing relations still load) ---
  /** Valid-time start: when the relation became true. */
  validFrom?: Date;
  /** Valid-time end: when it stopped being true; `null`/absent = currently true. */
  validTo?: Date | null;
  /** Transaction-time: when the system recorded it. */
  recordedAt?: Date;
  /** Which agent contributed this. */
  agentId?: string;
  /** Provenance label. */
  source?: string;
}

export interface GraphQuery {
  /** Starting entity name or ID */
  from?: string;
  /** Entity type filter */
  entityType?: EntityType;
  /** Relation type filter */
  relationType?: RelationType;
  /** Max traversal depth */
  depth?: number;
  /** Minimum confidence threshold */
  minConfidence?: number;
  /** Temporal filter (e.g., "morning", "weekday") */
  temporalFilter?: string;
  /** Max results */
  limit?: number;
}

export interface GraphContext {
  /** Relevant facts for the current turn */
  facts: string[];
  /** Active preferences */
  preferences: string[];
  /** Temporal habits active now */
  temporalHabits: string[];
  /** Related entities */
  relatedEntities: string[];
  /** Total token estimate */
  tokenEstimate: number;
}

// ============================================================================
// memU Layer 3: Auto-Categories with Summaries
// ============================================================================

export interface MemoryCategory {
  /** Category name (auto-generated from entity clustering) */
  name: string;
  /** LLM-generated or rule-based summary of all entities in this category */
  summary: string;
  /** Entity IDs belonging to this category */
  entityIds: string[];
  /** Number of items (for tiered retrieval sufficiency check) */
  itemCount: number;
  /** Last updated */
  updatedAt: Date;
}

// ============================================================================
// memU Salience Scoring
// ============================================================================

/**
 * Salience score: combines relevance, reinforcement, and recency.
 * Formula from memU: similarity * log(reinforcement+1) * exp(-0.693 * days / halfLife)
 */
export function computeSalience(
  mentions: number,
  updatedAt: Date,
  halfLifeDays = 60,
  baseSimilarity = 1.0,
): number {
  const daysSinceUpdate = (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60 * 24);
  const reinforcement = Math.log(mentions + 1);
  const recencyDecay = Math.exp(-0.693 * daysSinceUpdate / halfLifeDays);
  return baseSimilarity * reinforcement * recencyDecay;
}

// ============================================================================
// memU Content-Hash Dedup
// ============================================================================

/**
 * Content hash for deduplication (memU pattern: SHA256 of normalized text).
 */
export function contentHash(type: string, text: string): string {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(`${type}:${normalized}`).digest('hex').substring(0, 16);
}

// ============================================================================
// memU Intent Router (skip retrieval for trivial messages)
// ============================================================================

const TRIVIAL_PATTERNS = [
  /^(hi|hello|hey|bonjour|salut|coucou|merci|thanks|thank you|ok|okay|oui|non|yes|no)\s*[.!?]?$/i,
  /^(good\s+(?:morning|afternoon|evening|night)|bonne?\s+(?:matin|journée|soirée|nuit))\s*[.!?]?$/i,
  /^\/\w+/,  // slash commands
  /^\s*$/,   // empty
];

/**
 * Determine if a message is trivial (no memory retrieval needed).
 * memU pattern: intent routing to skip retrieval for greetings/commands.
 */
export function isTrivialMessage(message: string): boolean {
  return TRIVIAL_PATTERNS.some(p => p.test(message.trim()));
}

// ============================================================================
// Entity Extraction Patterns
// ============================================================================

const EXTRACTION_PATTERNS: Array<{
  pattern: RegExp;
  entityType: EntityType;
  relationType: RelationType;
  extract: (match: RegExpMatchArray) => { entity: string; target?: string; properties?: Record<string, unknown> };
}> = [
  // Preferences: "I prefer X", "I like X", "je préfère X"
  {
    pattern: /(?:i\s+prefer|i\s+like|je\s+pr[ée]f[èe]re|j'aime)\s+(.+?)(?:\.|$)/i,
    entityType: 'preference',
    relationType: 'prefers',
    extract: (m) => ({ entity: (m[1] ?? '').trim() }),
  },
  // Dislikes: "I don't like X", "I hate X", "je déteste X"
  {
    pattern: /(?:i\s+(?:don'?t|do\s+not)\s+like|i\s+hate|i\s+dislike|je\s+d[ée]teste|je\s+n'aime\s+pas)\s+(.+?)(?:\.|$)/i,
    entityType: 'preference',
    relationType: 'dislikes',
    extract: (m) => ({ entity: (m[1] ?? '').trim() }),
  },
  // Working on: "I'm working on X", "je travaille sur X"
  {
    pattern: /(?:i(?:'m|\s+am)\s+working\s+on|je\s+travaille\s+sur)\s+(.+?)(?:\.|$)/i,
    entityType: 'project',
    relationType: 'works_on',
    extract: (m) => ({ entity: (m[1] ?? '').trim() }),
  },
  // Uses: "I use X", "we use X", "on utilise X"
  {
    pattern: /(?:i\s+use|we\s+use|on\s+utilise|j'utilise|nous\s+utilisons)\s+(.+?)(?:\s+for\s+|\.|\s+pour\s+|$)/i,
    entityType: 'technology',
    relationType: 'uses',
    extract: (m) => ({ entity: (m[1] ?? '').trim() }),
  },
  // Knows person: "my colleague X", "mon collègue X", "X is a VIP"
  {
    pattern: /(?:my\s+(?:colleague|client|boss|manager|friend)|mon\s+(?:coll[èe]gue|client|chef))\s+(?:is\s+)?(\w+)/i,
    entityType: 'person',
    relationType: 'knows',
    extract: (m) => ({ entity: (m[1] ?? '').trim() }),
  },
  // VIP/important: "X is a VIP", "X is important"
  {
    pattern: /(\w+)\s+(?:is\s+(?:a\s+)?(?:VIP|important|key|critical)|est\s+(?:un\s+)?(?:VIP|important))/i,
    entityType: 'person',
    relationType: 'related_to',
    extract: (m) => ({ entity: (m[1] ?? '').trim(), properties: { importance: 'vip' } }),
  },
  // Temporal: "in the morning I prefer X", "le matin je préfère X"
  {
    pattern: /(?:in\s+the\s+)?(?:morning|matin|evening|soir|afternoon|apr[èe]s-midi|friday|vendredi|weekend)\s+(?:i\s+prefer|je\s+pr[ée]f[èe]re)\s+(.+?)(?:\.|$)/i,
    entityType: 'habit',
    relationType: 'temporal_pattern',
    extract: (m) => {
      const temporal = (m[0] ?? '').match(/morning|matin|evening|soir|afternoon|apr[èe]s-midi|friday|vendredi|weekend/i);
      return { entity: (m[1] ?? '').trim(), properties: { temporal: temporal?.[0]?.toLowerCase() } };
    },
  },
  // Style: "always use X", "toujours utiliser X"
  {
    pattern: /(?:always\s+use|toujours\s+utiliser|never\s+use|jamais\s+utiliser)\s+(.+?)(?:\.|$)/i,
    entityType: 'preference',
    relationType: 'has_style',
    extract: (m) => ({ entity: (m[1] ?? '').trim(), properties: { strength: (m[0] ?? '').match(/never|jamais/i) ? 'avoid' : 'always' } }),
  },
];

// ============================================================================
// Temporal Utilities
// ============================================================================

function getCurrentTemporalContext(): string[] {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();
  const contexts: string[] = [];

  if (hour >= 5 && hour < 12) contexts.push('morning', 'matin');
  else if (hour >= 12 && hour < 14) contexts.push('midday', 'midi');
  else if (hour >= 14 && hour < 18) contexts.push('afternoon', 'après-midi');
  else if (hour >= 18 && hour < 22) contexts.push('evening', 'soir');
  else contexts.push('night', 'nuit');

  if (day === 0 || day === 6) contexts.push('weekend');
  else contexts.push('weekday');

  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayNamesFr = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  // day is Date.getDay() (0-6); both arrays have 7 entries so lookups are in-bounds.
  // Guard preserves behavior: push only the entries that exist (always true here).
  const dayName = dayNames[day];
  const dayNameFr = dayNamesFr[day];
  if (dayName !== undefined) contexts.push(dayName);
  if (dayNameFr !== undefined) contexts.push(dayNameFr);

  return contexts;
}

// ============================================================================
// Knowledge Graph
// ============================================================================

export class KnowledgeGraph {
  private entities: Map<string, Entity> = new Map();
  private relations: Map<string, Relation> = new Map();
  /** Adjacency list: entityId -> Set of relationIds */
  private adjacency: Map<string, Set<string>> = new Map();
  /** Reverse adjacency: targetId -> Set of relationIds */
  private reverseAdjacency: Map<string, Set<string>> = new Map();
  private dbPath: string;
  private dirty = false;
  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private idCounter = 0;
  /** memU Layer 3: auto-categories with summaries */
  private categories: Map<string, MemoryCategory> = new Map();
  /** memU: content-hash index for O(1) dedup */
  private contentHashes: Set<string> = new Set();

  constructor(cwd: string = process.cwd()) {
    const dir = join(cwd, '.codebuddy');
    this.dbPath = join(dir, 'knowledge-graph.json');
  }

  // ──────────────────────────────────────────────────────────────
  // Entity CRUD
  // ──────────────────────────────────────────────────────────────

  addEntity(type: EntityType, name: string, properties: Record<string, unknown> = {}, confidence = 0.7): Entity {
    // Check for existing entity with same name+type
    const existing = this.findEntity(name, type);
    if (existing) {
      existing.mentions++;
      existing.confidence = Math.min(1, existing.confidence + 0.05);
      existing.updatedAt = new Date();
      Object.assign(existing.properties, properties);
      this.markDirty();
      return existing;
    }

    const id = `e_${++this.idCounter}_${Date.now()}`;
    const entity: Entity = {
      id,
      type,
      name: name.toLowerCase().trim(),
      properties,
      confidence,
      mentions: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.entities.set(id, entity);
    this.adjacency.set(id, new Set());
    this.reverseAdjacency.set(id, new Set());
    this.markDirty();
    return entity;
  }

  findEntity(name: string, type?: EntityType): Entity | undefined {
    const normalized = name.toLowerCase().trim();
    for (const entity of this.entities.values()) {
      if (entity.name === normalized && (!type || entity.type === type)) {
        return entity;
      }
    }
    return undefined;
  }

  getEntity(id: string): Entity | undefined {
    return this.entities.get(id);
  }

  removeEntity(id: string): boolean {
    if (!this.entities.has(id)) return false;

    // Remove all relations involving this entity
    const outgoing = this.adjacency.get(id) || new Set();
    const incoming = this.reverseAdjacency.get(id) || new Set();

    for (const relId of [...outgoing, ...incoming]) {
      this.relations.delete(relId);
    }

    this.adjacency.delete(id);
    this.reverseAdjacency.delete(id);
    this.entities.delete(id);
    this.markDirty();
    return true;
  }

  // ──────────────────────────────────────────────────────────────
  // Relation CRUD
  // ──────────────────────────────────────────────────────────────

  addRelation(
    sourceId: string,
    targetId: string,
    type: RelationType,
    properties: Record<string, unknown> = {},
    temporalContext?: string,
    weight = 0.7,
  ): Relation | null {
    if (!this.entities.has(sourceId) || !this.entities.has(targetId)) return null;

    // Check for existing relation
    const existing = this.findRelation(sourceId, targetId, type);
    if (existing) {
      existing.mentions++;
      existing.weight = Math.min(1, existing.weight + 0.05);
      existing.updatedAt = new Date();
      if (temporalContext) existing.temporalContext = temporalContext;
      Object.assign(existing.properties, properties);
      this.markDirty();
      return existing;
    }

    const id = `r_${++this.idCounter}_${Date.now()}`;
    const relation: Relation = {
      id,
      sourceId,
      targetId,
      type,
      weight,
      properties,
      temporalContext,
      confidence: 0.7,
      mentions: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.relations.set(id, relation);
    if (!this.adjacency.has(sourceId)) this.adjacency.set(sourceId, new Set());
    if (!this.reverseAdjacency.has(targetId)) this.reverseAdjacency.set(targetId, new Set());
    this.adjacency.get(sourceId)!.add(id);
    this.reverseAdjacency.get(targetId)!.add(id);
    this.markDirty();
    return relation;
  }

  findRelation(sourceId: string, targetId: string, type?: RelationType): Relation | undefined {
    const outgoing = this.adjacency.get(sourceId);
    if (!outgoing) return undefined;

    for (const relId of outgoing) {
      const rel = this.relations.get(relId);
      if (rel && rel.targetId === targetId && (!type || rel.type === type)) {
        return rel;
      }
    }
    return undefined;
  }

  // ──────────────────────────────────────────────────────────────
  // Graph Traversal
  // ──────────────────────────────────────────────────────────────

  /**
   * Get all relations from an entity (outgoing).
   */
  getRelationsFrom(entityId: string, type?: RelationType): Relation[] {
    const outgoing = this.adjacency.get(entityId);
    if (!outgoing) return [];

    const results: Relation[] = [];
    for (const relId of outgoing) {
      const rel = this.relations.get(relId);
      if (rel && (!type || rel.type === type)) {
        results.push(rel);
      }
    }
    return results.sort((a, b) => b.weight - a.weight);
  }

  /**
   * Get all relations to an entity (incoming).
   */
  getRelationsTo(entityId: string, type?: RelationType): Relation[] {
    const incoming = this.reverseAdjacency.get(entityId);
    if (!incoming) return [];

    const results: Relation[] = [];
    for (const relId of incoming) {
      const rel = this.relations.get(relId);
      if (rel && (!type || rel.type === type)) {
        results.push(rel);
      }
    }
    return results.sort((a, b) => b.weight - a.weight);
  }

  /**
   * BFS traversal from an entity up to a given depth.
   */
  traverse(startId: string, depth = 2, minConfidence = 0.3): Array<{ entity: Entity; relation: Relation; depth: number }> {
    const results: Array<{ entity: Entity; relation: Relation; depth: number }> = [];
    const visited = new Set<string>([startId]);
    const queue: Array<{ entityId: string; currentDepth: number }> = [{ entityId: startId, currentDepth: 0 }];

    while (queue.length > 0) {
      const { entityId, currentDepth } = queue.shift()!;
      if (currentDepth >= depth) continue;

      const outgoing = this.adjacency.get(entityId) || new Set();
      for (const relId of outgoing) {
        const rel = this.relations.get(relId);
        if (!rel || rel.confidence < minConfidence) continue;

        const target = this.entities.get(rel.targetId);
        if (!target || visited.has(target.id)) continue;

        visited.add(target.id);
        results.push({ entity: target, relation: rel, depth: currentDepth + 1 });
        queue.push({ entityId: target.id, currentDepth: currentDepth + 1 });
      }
    }

    return results;
  }

  /**
   * Query the graph with filters.
   */
  query(q: GraphQuery): Array<{ entity: Entity; relations: Relation[] }> {
    const results: Array<{ entity: Entity; relations: Relation[] }> = [];
    const limit = q.limit || 20;
    const minConf = q.minConfidence || 0.3;

    // Find starting entities
    let candidates: Entity[];
    if (q.from) {
      const entity = this.findEntity(q.from) || this.getEntity(q.from);
      if (!entity) return [];

      // Traverse from this entity
      const traversed = this.traverse(entity.id, q.depth || 2, minConf);
      candidates = traversed.map(t => t.entity);
    } else {
      candidates = [...this.entities.values()];
    }

    // Apply filters
    for (const entity of candidates) {
      if (q.entityType && entity.type !== q.entityType) continue;
      if (entity.confidence < minConf) continue;

      let relations = [...this.getRelationsFrom(entity.id), ...this.getRelationsTo(entity.id)];

      if (q.relationType) {
        relations = relations.filter(r => r.type === q.relationType);
      }

      if (q.temporalFilter) {
        relations = relations.filter(r =>
          !r.temporalContext || r.temporalContext.includes(q.temporalFilter!)
        );
      }

      if (relations.length > 0 || !q.relationType) {
        results.push({ entity, relations });
      }

      if (results.length >= limit) break;
    }

    return results;
  }

  // ──────────────────────────────────────────────────────────────
  // Auto-Extraction from User Messages
  // ──────────────────────────────────────────────────────────────

  /**
   * Extract entities and relations from a user message.
   * Returns the number of new facts extracted.
   */
  extractFromMessage(message: string): number {
    let extracted = 0;
    const userEntity = this.ensureUserEntity();

    for (const pattern of EXTRACTION_PATTERNS) {
      const match = message.match(pattern.pattern);
      if (!match) continue;

      const { entity: name, properties } = pattern.extract(match);
      if (!name || name.length < 2 || name.length > 100) continue;

      const target = this.addEntity(pattern.entityType, name, properties || {});
      const temporal = (properties as Record<string, unknown>)?.temporal as string | undefined;

      this.addRelation(
        userEntity.id,
        target.id,
        pattern.relationType,
        properties || {},
        temporal,
      );

      extracted++;
    }

    return extracted;
  }

  /**
   * Ensure the "user" entity exists.
   */
  private ensureUserEntity(): Entity {
    const existing = this.findEntity('user', 'user');
    if (existing) return existing;
    return this.addEntity('user', 'user', {}, 1.0);
  }

  // ──────────────────────────────────────────────────────────────
  // Context Generation (for system prompt injection)
  // ──────────────────────────────────────────────────────────────

  /**
   * Build a context block for the current turn.
   * Returns relevant facts, preferences, and temporal habits.
   */
  buildContextBlock(currentQuery?: string, maxTokens = 600): GraphContext {
    const context: GraphContext = {
      facts: [],
      preferences: [],
      temporalHabits: [],
      relatedEntities: [],
      tokenEstimate: 0,
    };

    const userEntity = this.findEntity('user', 'user');
    if (!userEntity) return context;

    const temporalContexts = getCurrentTemporalContext();

    // 1. User preferences
    const prefRelations = this.getRelationsFrom(userEntity.id, 'prefers');
    for (const rel of prefRelations.slice(0, 10)) {
      const target = this.entities.get(rel.targetId);
      if (!target) continue;
      context.preferences.push(`Prefers: ${target.name}${rel.temporalContext ? ` (${rel.temporalContext})` : ''}`);
    }

    // 2. User dislikes
    const dislikeRelations = this.getRelationsFrom(userEntity.id, 'dislikes');
    for (const rel of dislikeRelations.slice(0, 5)) {
      const target = this.entities.get(rel.targetId);
      if (!target) continue;
      context.preferences.push(`Dislikes: ${target.name}`);
    }

    // 3. Style preferences
    const styleRelations = this.getRelationsFrom(userEntity.id, 'has_style');
    for (const rel of styleRelations.slice(0, 5)) {
      const target = this.entities.get(rel.targetId);
      if (!target) continue;
      const strength = rel.properties?.strength === 'avoid' ? 'Never use' : 'Always use';
      context.preferences.push(`${strength}: ${target.name}`);
    }

    // 4. Temporal habits (active NOW)
    const temporalRelations = this.getRelationsFrom(userEntity.id, 'temporal_pattern');
    for (const rel of temporalRelations) {
      if (!rel.temporalContext) continue;
      const isActive = temporalContexts.some(tc =>
        rel.temporalContext!.toLowerCase().includes(tc)
      );
      if (isActive) {
        const target = this.entities.get(rel.targetId);
        if (target) {
          context.temporalHabits.push(`Now (${rel.temporalContext}): ${target.name}`);
        }
      }
    }

    // 5. Projects and technologies
    const workRelations = this.getRelationsFrom(userEntity.id, 'works_on');
    for (const rel of workRelations.slice(0, 3)) {
      const project = this.entities.get(rel.targetId);
      if (!project) continue;
      const techRels = this.getRelationsFrom(project.id, 'uses');
      const techs = techRels
        .map(tr => this.entities.get(tr.targetId)?.name)
        .filter(Boolean)
        .join(', ');
      context.facts.push(`Works on: ${project.name}${techs ? ` (${techs})` : ''}`);
    }

    // 6. Known people
    const knowsRelations = this.getRelationsFrom(userEntity.id, 'knows');
    for (const rel of knowsRelations.slice(0, 5)) {
      const person = this.entities.get(rel.targetId);
      if (!person) continue;
      const importance = person.properties?.importance;
      context.relatedEntities.push(
        `Knows: ${person.name}${importance ? ` (${importance})` : ''}`
      );
    }

    // Estimate tokens (~4 chars per token)
    const allItems = [...context.facts, ...context.preferences, ...context.temporalHabits, ...context.relatedEntities];
    context.tokenEstimate = Math.ceil(allItems.join('\n').length / 4);

    // Trim to budget
    if (context.tokenEstimate > maxTokens) {
      const ratio = maxTokens / context.tokenEstimate;
      const trimTo = (arr: string[]) => arr.slice(0, Math.max(1, Math.floor(arr.length * ratio)));
      context.facts = trimTo(context.facts);
      context.preferences = trimTo(context.preferences);
      context.temporalHabits = trimTo(context.temporalHabits);
      context.relatedEntities = trimTo(context.relatedEntities);
      context.tokenEstimate = maxTokens;
    }

    return context;
  }

  /**
   * Format the context block as a string for system prompt injection.
   */
  formatContextBlock(currentQuery?: string, maxTokens = 600): string {
    const ctx = this.buildContextBlock(currentQuery, maxTokens);
    const sections: string[] = [];

    if (ctx.temporalHabits.length > 0) {
      sections.push(`Active habits:\n${ctx.temporalHabits.map(h => `  - ${h}`).join('\n')}`);
    }
    if (ctx.preferences.length > 0) {
      sections.push(`Preferences:\n${ctx.preferences.map(p => `  - ${p}`).join('\n')}`);
    }
    if (ctx.facts.length > 0) {
      sections.push(`Context:\n${ctx.facts.map(f => `  - ${f}`).join('\n')}`);
    }
    if (ctx.relatedEntities.length > 0) {
      sections.push(`People:\n${ctx.relatedEntities.map(r => `  - ${r}`).join('\n')}`);
    }

    if (sections.length === 0) return '';
    return `<knowledge_graph>\n${sections.join('\n')}\n</knowledge_graph>`;
  }

  // ──────────────────────────────────────────────────────────────
  // memU Layer 3: Category Management
  // ──────────────────────────────────────────────────────────────

  /**
   * Auto-categorize entities into topic groups.
   * Call periodically (e.g., after batch extraction or on session end).
   */
  autoCategorizе(): void {
    // Group entities by type as categories
    const typeGroups: Map<string, string[]> = new Map();
    for (const entity of this.entities.values()) {
      if (entity.type === 'user') continue; // skip meta-entity
      const key = entity.type;
      if (!typeGroups.has(key)) typeGroups.set(key, []);
      typeGroups.get(key)!.push(entity.id);
    }

    for (const [type, entityIds] of typeGroups) {
      const existing = this.categories.get(type);
      const entities = entityIds.map(id => this.entities.get(id)).filter(Boolean) as Entity[];
      const summary = entities
        .sort((a, b) => computeSalience(b.mentions, b.updatedAt) - computeSalience(a.mentions, a.updatedAt))
        .slice(0, 15)
        .map(e => `${e.name} (${e.mentions}×, conf:${e.confidence.toFixed(2)})`)
        .join(', ');

      if (existing) {
        existing.entityIds = entityIds;
        existing.summary = summary;
        existing.itemCount = entityIds.length;
        existing.updatedAt = new Date();
      } else {
        this.categories.set(type, {
          name: type,
          summary,
          entityIds,
          itemCount: entityIds.length,
          updatedAt: new Date(),
        });
      }
    }

    this.markDirty();
  }

  /**
   * Get category summaries (memU tiered retrieval: check categories first).
   */
  getCategorySummaries(): MemoryCategory[] {
    return [...this.categories.values()].sort((a, b) => b.itemCount - a.itemCount);
  }

  /**
   * Get entities in a category, ranked by salience score.
   */
  getCategoryEntities(categoryName: string, limit = 10): Array<{ entity: Entity; salience: number }> {
    const cat = this.categories.get(categoryName);
    if (!cat) return [];

    return cat.entityIds
      .map(id => this.entities.get(id))
      .filter(Boolean)
      .map(e => ({
        entity: e!,
        salience: computeSalience(e!.mentions, e!.updatedAt),
      }))
      .sort((a, b) => b.salience - a.salience)
      .slice(0, limit);
  }

  // ──────────────────────────────────────────────────────────────
  // memU: Intent-Aware Context Generation
  // ──────────────────────────────────────────────────────────────

  /**
   * Smart context generation with intent routing (memU pattern).
   * Skips injection for trivial messages. Uses tiered retrieval:
   * 1. Check if message is trivial → return empty
   * 2. Check category summaries → if sufficient, return summary-level context
   * 3. Drill into entities → return full context
   */
  formatContextBlockSmart(message: string, maxTokens = 600): string {
    // Intent routing: skip for trivial messages
    if (isTrivialMessage(message)) {
      return '';
    }
    return this.formatContextBlock(message, maxTokens);
  }

  // ──────────────────────────────────────────────────────────────
  // memU: Reinforcement-Aware Extraction
  // ──────────────────────────────────────────────────────────────

  /**
   * Extract with content-hash dedup (memU pattern).
   * Returns number of NEW facts (deduped entries return 0 but still reinforce).
   */
  extractFromMessageDeduped(message: string): { extracted: number; reinforced: number } {
    let extracted = 0;
    let reinforced = 0;
    const userEntity = this.ensureUserEntity();

    for (const pattern of EXTRACTION_PATTERNS) {
      const match = message.match(pattern.pattern);
      if (!match) continue;

      const { entity: name, properties } = pattern.extract(match);
      if (!name || name.length < 2 || name.length > 100) continue;

      // Content-hash dedup
      const hash = contentHash(pattern.entityType, name);
      const isNew = !this.contentHashes.has(hash);
      this.contentHashes.add(hash);

      const target = this.addEntity(pattern.entityType, name, properties || {});
      const temporal = (properties as Record<string, unknown>)?.temporal as string | undefined;

      this.addRelation(
        userEntity.id,
        target.id,
        pattern.relationType,
        properties || {},
        temporal,
      );

      if (isNew) extracted++;
      else reinforced++;
    }

    return { extracted, reinforced };
  }

  // ──────────────────────────────────────────────────────────────
  // Decay & Maintenance
  // ──────────────────────────────────────────────────────────────

  /**
   * Decay confidence of old, unused entities and relations.
   * Call periodically (e.g., daily or on session start).
   */
  decay(halfLifeDays = 60): number {
    let decayed = 0;
    const now = Date.now();

    for (const entity of this.entities.values()) {
      const ageDays = (now - entity.updatedAt.getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays > halfLifeDays / 2) {
        const factor = Math.exp(-Math.LN2 * ageDays / halfLifeDays);
        entity.confidence = Math.max(0.1, entity.confidence * factor);
        decayed++;
      }
    }

    // Remove entities with very low confidence and no recent mentions
    const toRemove: string[] = [];
    for (const entity of this.entities.values()) {
      if (entity.confidence < 0.15 && entity.mentions <= 1) {
        toRemove.push(entity.id);
      }
    }
    for (const id of toRemove) {
      this.removeEntity(id);
    }

    if (decayed > 0 || toRemove.length > 0) {
      this.markDirty();
      logger.debug(`KnowledgeGraph: decayed ${decayed} entities, removed ${toRemove.length}`);
    }
    return decayed;
  }

  // ──────────────────────────────────────────────────────────────
  // Stats
  // ──────────────────────────────────────────────────────────────

  getStats(): {
    entityCount: number;
    relationCount: number;
    entityTypes: Record<string, number>;
    relationTypes: Record<string, number>;
    avgConfidence: number;
  } {
    const entityTypes: Record<string, number> = {};
    const relationTypes: Record<string, number> = {};
    let totalConf = 0;

    for (const e of this.entities.values()) {
      entityTypes[e.type] = (entityTypes[e.type] || 0) + 1;
      totalConf += e.confidence;
    }
    for (const r of this.relations.values()) {
      relationTypes[r.type] = (relationTypes[r.type] || 0) + 1;
    }

    return {
      entityCount: this.entities.size,
      relationCount: this.relations.size,
      entityTypes,
      relationTypes,
      avgConfidence: this.entities.size > 0 ? totalConf / this.entities.size : 0,
    };
  }

  /**
   * Get all entities, optionally filtered by type.
   */
  getAllEntities(type?: EntityType): Entity[] {
    const results: Entity[] = [];
    for (const entity of this.entities.values()) {
      if (!type || entity.type === type) {
        results.push(entity);
      }
    }
    return results.sort((a, b) => b.mentions - a.mentions);
  }

  /**
   * Get all relations for a given entity (both directions).
   */
  getAllRelations(entityName: string): Array<{ relation: Relation; source: Entity; target: Entity }> {
    const entity = this.findEntity(entityName);
    if (!entity) return [];

    const results: Array<{ relation: Relation; source: Entity; target: Entity }> = [];

    const outgoing = this.getRelationsFrom(entity.id);
    for (const rel of outgoing) {
      const target = this.entities.get(rel.targetId);
      if (target) results.push({ relation: rel, source: entity, target });
    }

    const incoming = this.getRelationsTo(entity.id);
    for (const rel of incoming) {
      const source = this.entities.get(rel.sourceId);
      if (source) results.push({ relation: rel, source, target: entity });
    }

    return results;
  }

  /**
   * Clear all entities and relations.
   */
  clear(): void {
    this.entities.clear();
    this.relations.clear();
    this.adjacency.clear();
    this.reverseAdjacency.clear();
    this.idCounter = 0;
    this.markDirty();
  }

  // ──────────────────────────────────────────────────────────────
  // Persistence (JSON file)
  // ──────────────────────────────────────────────────────────────

  async load(): Promise<void> {
    if (this.loaded) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      try {
        const data = await readJsonAtomic(this.dbPath, {
          entities: [] as Entity[],
          relations: [] as Relation[],
          categories: [] as MemoryCategory[],
          contentHashes: [] as string[],
        }, {
          mode: 0o600,
          isValid: (value): value is {
            entities: Entity[];
            relations: Relation[];
            categories: MemoryCategory[];
            contentHashes: string[];
          } => Boolean(
            value && typeof value === 'object'
              && Array.isArray((value as { entities?: unknown }).entities)
              && Array.isArray((value as { relations?: unknown }).relations)
              && Array.isArray((value as { categories?: unknown }).categories)
              && Array.isArray((value as { contentHashes?: unknown }).contentHashes),
          ),
        });

        // Restore entities
        for (const e of data.entities || []) {
          e.createdAt = new Date(e.createdAt);
          e.updatedAt = new Date(e.updatedAt);
          this.entities.set(e.id, e);
          this.adjacency.set(e.id, new Set());
          this.reverseAdjacency.set(e.id, new Set());
          const idNum = parseInt(e.id.split('_')[1] || '0');
          if (idNum > this.idCounter) this.idCounter = idNum;
        }

        // Restore relations
        for (const r of data.relations || []) {
          r.createdAt = new Date(r.createdAt);
          r.updatedAt = new Date(r.updatedAt);
          this.relations.set(r.id, r);
          if (this.adjacency.has(r.sourceId)) this.adjacency.get(r.sourceId)!.add(r.id);
          if (this.reverseAdjacency.has(r.targetId)) this.reverseAdjacency.get(r.targetId)!.add(r.id);
          const idNum = parseInt(r.id.split('_')[1] || '0');
          if (idNum > this.idCounter) this.idCounter = idNum;
        }

        // Restore categories (memU Layer 3)
        for (const c of data.categories || []) {
          c.updatedAt = new Date(c.updatedAt);
          this.categories.set(c.name, c);
        }

        // Restore content hashes
        for (const h of data.contentHashes || []) {
          this.contentHashes.add(h);
        }

        logger.debug(`KnowledgeGraph: loaded ${this.entities.size} entities, ${this.relations.size} relations, ${this.categories.size} categories`);
      } catch (err) {
        logger.debug(`KnowledgeGraph load failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        this.loaded = true;
        this.loadPromise = null;
      }
    })();

    return this.loadPromise;
  }

  async save(): Promise<void> {
    if (!this.dirty) return;
    if (!shouldWriteProjectRuntimeFiles()) {
      this.dirty = false;
      return;
    }

    try {
      const data = {
        version: 2,
        savedAt: new Date().toISOString(),
        entities: [...this.entities.values()],
        relations: [...this.relations.values()],
        categories: [...this.categories.values()],
        contentHashes: [...this.contentHashes],
      };
      await writeJsonAtomic(this.dbPath, data, { mode: 0o600 });
      this.dirty = false;
      logger.debug(`KnowledgeGraph: saved ${data.entities.length} entities, ${data.relations.length} relations, ${data.categories.length} categories`);
    } catch (err) {
      logger.debug(`KnowledgeGraph save failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private markDirty(): void {
    this.dirty = true;
    // Debounced auto-save (5 seconds)
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 5000);
  }

  /**
   * Force immediate save (for session end).
   */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.save();
  }

  dispose(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _graph: KnowledgeGraph | null = null;

export function getKnowledgeGraph(cwd?: string): KnowledgeGraph {
  if (!_graph) {
    _graph = new KnowledgeGraph(cwd);
  }
  return _graph;
}

export function resetKnowledgeGraph(): void {
  if (_graph) {
    _graph.dispose();
    _graph = null;
  }
}
