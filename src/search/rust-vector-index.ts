/**
 * Index vectoriel servi par le moteur Rust `buddy-memory`.
 *
 * Même interface que `USearchVectorIndex`, même algorithme (HNSW), mais sans
 * dépendance native npm : `usearch` ne publie aucun binaire Windows — seulement
 * `darwin-arm64+x64`, `linux-arm64` et `linux-x64` — et son amont n'a pas même de
 * script `prebuild-win`. Sur Windows, `node-gyp-build` doit donc compiler du C++
 * via MSVC, ce qui échoue silencieusement puisque le paquet est optionnel, et la
 * recherche sémantique retombe alors sur une boucle cosinus O(n) en JavaScript.
 *
 * Le sidecar Rust, lui, se compile partout où cargo tourne. C'est `hnsw_rs`, la
 * crate qui sert déjà le graphe de connaissances ici et le moteur vectoriel de
 * RagChat sur près de deux millions de fragments.
 *
 * @see buddy-memory/src/vindex.rs pour les méthodes `vindex.*`
 */

import { logger } from '../utils/logger.js';
import { BuddyMemoryClient } from '../memory/buddy-memory-client.js';
import type { IndexableVector, VectorSearchResult } from './usearch-index.js';

export interface RustVectorIndexOptions {
  /** Nom de l'index dans le registre du sidecar. */
  name: string;
  dimensions: number;
  /** Capacité initiale ; l'index grandit au-delà, c'est une réservation. */
  capacity?: number;
  /** Client partagé. Fourni par l'appelant pour qu'un seul sidecar serve tout. */
  client: BuddyMemoryClient;
}

interface RustHit {
  id: string;
  score: number;
}

/**
 * Trois méthodes de l'interface d'origine sont **synchrones** — `remove`, `size`
 * et `clear` — alors que le sidecar répond de façon asynchrone. Elles sont donc
 * servies par un miroir local des identifiants vivants, tenu à jour à chaque
 * opération, et l'appel distant part sans être attendu. Le miroir est la source de
 * vérité pour ces trois-là ; une erreur distante est journalisée, jamais avalée en
 * silence. C'est le prix d'une interface conçue pour une bibliothèque en processus.
 */
export class RustVectorIndex {
  private readonly name: string;
  private readonly dimensions: number;
  private readonly capacity: number;
  private readonly client: BuddyMemoryClient;
  private readonly metadata = new Map<string, Record<string, unknown>>();
  /** Miroir local des identifiants vivants (voir la note ci-dessus). */
  private readonly liveIds = new Set<string>();
  private created = false;

  constructor(options: RustVectorIndexOptions) {
    this.name = options.name;
    this.dimensions = options.dimensions;
    this.capacity = options.capacity ?? 1024;
    this.client = options.client;
  }

  /** Vrai si le moteur Rust est joignable. Sert à décider du repli AVANT d'indexer. */
  static engineAvailable(client: BuddyMemoryClient): boolean {
    try {
      return client.available();
    } catch {
      return false;
    }
  }

  private async ensureCreated(): Promise<void> {
    if (this.created) return;
    await this.client.call('vindex.create', {
      name: this.name,
      dim: this.dimensions,
      capacity: this.capacity,
    });
    this.created = true;
  }

  async add(vector: IndexableVector): Promise<void> {
    await this.ensureCreated();
    await this.client.call('vindex.insert', {
      name: this.name,
      id: vector.id,
      vector: Array.from(vector.embedding),
    });
    this.liveIds.add(vector.id);
    if (vector.metadata) this.metadata.set(vector.id, vector.metadata);
  }

  /**
   * Indexation par lot : un seul aller-retour pour N vecteurs. Sur un dépôt entier,
   * c'est ce qui fait la différence — le coût du transport domine autrement celui
   * de l'insertion elle-même.
   */
  async addBatch(vectors: IndexableVector[]): Promise<void> {
    if (vectors.length === 0) return;
    await this.ensureCreated();
    await this.client.call('vindex.insert', {
      name: this.name,
      items: vectors.map((v) => ({ id: v.id, vector: Array.from(v.embedding) })),
    });
    for (const v of vectors) {
      this.liveIds.add(v.id);
      if (v.metadata) this.metadata.set(v.id, v.metadata);
    }
  }

  async search(query: number[] | Float32Array, k = 10): Promise<VectorSearchResult[]> {
    await this.ensureCreated();
    const hits = (await this.client.call('vindex.search', {
      name: this.name,
      vector: Array.from(query),
      k,
    })) as RustHit[];
    if (!Array.isArray(hits)) return [];
    return hits.map((h) => {
      // Le sidecar rend une DISTANCE cosinus (0 = identique, 2 = opposé). L'interface
      // publique promet une similarité « higher is better » : même conversion que
      // `USearchVectorIndex.distanceToScore`, pour que les seuils des appelants
      // gardent exactement le même sens.
      const distance = h.score;
      const result: VectorSearchResult = {
        id: h.id,
        score: Math.max(0, 1 - distance / 2),
        distance,
      };
      const meta = this.metadata.get(h.id);
      if (meta) result.metadata = meta;
      return result;
    });
  }

  remove(id: string): boolean {
    const known = this.liveIds.delete(id);
    this.metadata.delete(id);
    if (known) {
      void this.client
        .call('vindex.remove', { name: this.name, id })
        .catch((err) => logger.warn(`[rust-vector-index] suppression de « ${id} » : ${String(err)}`));
    }
    return known;
  }

  size(): number {
    return this.liveIds.size;
  }

  clear(): void {
    this.liveIds.clear();
    this.metadata.clear();
    void this.client
      .call('vindex.clear', { name: this.name })
      .catch((err) => logger.warn(`[rust-vector-index] vidage : ${String(err)}`));
  }

  /** Vide le registre distant ET le miroir local, en attendant la confirmation. */
  async drop(): Promise<void> {
    this.liveIds.clear();
    this.metadata.clear();
    this.created = false;
    await this.client.call('vindex.drop', { name: this.name });
  }

  /**
   * La persistance appartient au client : le sidecar reste sans état sur disque,
   * et c'est l'appelant qui sait où écrire. `dump` rend les vecteurs vivants.
   */
  async dump(): Promise<{ dim: number; items: Array<{ id: string; vector: number[] }> }> {
    await this.ensureCreated();
    return (await this.client.call('vindex.dump', { name: this.name })) as {
      dim: number;
      items: Array<{ id: string; vector: number[] }>;
    };
  }

  async loadFrom(items: Array<{ id: string; vector: number[] }>): Promise<void> {
    await this.client.call('vindex.load', {
      name: this.name,
      dim: this.dimensions,
      items,
    });
    this.created = true;
    this.liveIds.clear();
    for (const it of items) this.liveIds.add(it.id);
  }
}
