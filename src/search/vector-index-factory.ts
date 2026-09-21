/**
 * Choisit le moteur vectoriel : `usearch` là où il s'installe, le sidecar Rust
 * ailleurs, et la boucle JavaScript seulement si les deux manquent.
 *
 * Mesuré le 21/09/2026 (dim 384, embeddings en grappes, k=10) :
 *
 * | Moteur | Latence par recherche | Rappel |
 * |---|---|---|
 * | `usearch`, en processus | **0,39 ms** | 86 % |
 * | sidecar Rust (`hnsw_rs`) | ~2 ms, **plat** | 83 % |
 * | boucle JavaScript O(n) | 26 ms à 20 k, 69 ms à 50 k | exact |
 *
 * `usearch` gagne là où il existe : même qualité, cinq fois plus rapide, aucun
 * aller-retour. Mais son paquet npm ne livre **aucun binaire Windows** — seulement
 * `darwin-arm64+x64`, `linux-arm64` et `linux-x64` — et l'amont n'a même pas de
 * script `prebuild-win`. Sur Windows, la recherche sémantique retombait donc sur une
 * boucle O(n) dont le coût croît avec le dépôt. Le sidecar Rust, lui, reste plat.
 *
 * Le repli JavaScript n'est pas supprimé : il sert encore si le binaire Rust n'a pas
 * été compilé. Il cesse simplement d'être le premier recours.
 */

import { logger } from '../utils/logger.js';
import { USearchVectorIndex } from './usearch-index.js';
import type { IndexableVector, VectorSearchResult } from './usearch-index.js';

export type VectorEngine = 'usearch' | 'rust' | 'javascript';

export interface VectorIndexLike {
  add(vector: IndexableVector): Promise<void>;
  search(query: number[] | Float32Array, k?: number): Promise<VectorSearchResult[]>;
  remove(id: string): boolean;
  size(): number;
  clear(): void;
}

export interface VectorIndexChoice {
  index: VectorIndexLike;
  engine: VectorEngine;
}

export interface CreateVectorIndexOptions {
  /** Nom de l'index, nécessaire au registre du sidecar Rust. */
  name: string;
  dimensions: number;
  capacity?: number;
  /** Force un moteur. Sert aux bancs d'essai, et à contourner un incident. */
  prefer?: VectorEngine;
}

let usearchUtilisable: boolean | null = null;

/**
 * Charge réellement le paquet natif. Instancier `USearchVectorIndex` ne prouve
 * rien : son chargement est paresseux, si bien qu'un `try/catch` autour du
 * constructeur n'attrape jamais rien et que le repli interne s'active plus tard,
 * silencieusement. C'est le défaut que cette fabrique corrige.
 */
export async function usearchDisponible(): Promise<boolean> {
  if (usearchUtilisable !== null) return usearchUtilisable;
  try {
    const specifier = 'usearch';
    await import(specifier);
    usearchUtilisable = true;
  } catch {
    usearchUtilisable = false;
  }
  return usearchUtilisable;
}

/** Réarme la détection — pour les tests, qui changent l'environnement en cours de route. */
export function reinitialiserDetection(): void {
  usearchUtilisable = null;
}

export async function createVectorIndex(
  options: CreateVectorIndexOptions,
): Promise<VectorIndexChoice> {
  const { name, dimensions, capacity, prefer } = options;

  if (prefer !== 'rust' && prefer !== 'javascript' && (await usearchDisponible())) {
    return {
      index: new USearchVectorIndex({ dimensions, metric: 'cos' }) as unknown as VectorIndexLike,
      engine: 'usearch',
    };
  }

  if (prefer !== 'javascript') {
    try {
      const [{ RustVectorIndex }, { BuddyMemoryClient, resolveBuddyMemoryBin }] =
        await Promise.all([
          import('./rust-vector-index.js'),
          import('../memory/buddy-memory-client.js'),
        ]);
      if (resolveBuddyMemoryBin()) {
        const client = new BuddyMemoryClient({ ledgerPath: ledgerParDefaut() });
        // Un binaire présent et vivant ne suffit pas : un exemplaire antérieur à
        // `vindex.*` répond `unknown method` à la première insertion, une fois le
        // moteur choisi et sans repli possible. On le lui demande donc d'abord.
        if (client.available() && (await parleVindex(client))) {
          const opts = { name, dimensions, client } as ConstructorParameters<typeof RustVectorIndex>[0];
          if (capacity !== undefined) opts.capacity = capacity;
          return { index: new RustVectorIndex(opts) as unknown as VectorIndexLike, engine: 'rust' };
        }
      }
    } catch (err) {
      logger.debug(`[vector-index] sidecar Rust indisponible : ${String(err)}`);
    }
  }

  // Dernier recours : la boucle JavaScript, via le repli interne de
  // `USearchVectorIndex` (qui s'active tout seul quand le paquet natif manque).
  logger.debug('[vector-index] ni usearch ni le sidecar Rust — repli JavaScript O(n)');
  return {
    index: new USearchVectorIndex({ dimensions, metric: 'cos' }) as unknown as VectorIndexLike,
    engine: 'javascript',
  };
}

/** Le sidecar connaît-il les méthodes `vindex.*` ? Un `unknown method` ici coûte
 *  moins cher qu'un abandon d'indexation après que le moteur a été retenu. */
async function parleVindex(client: { call(m: string, p?: Record<string, unknown>): Promise<unknown> }): Promise<boolean> {
  try {
    await client.call('vindex.list', {});
    return true;
  } catch (err) {
    logger.debug(`[vector-index] le binaire ne parle pas vindex.* : ${String(err)}`);
    return false;
  }
}

function ledgerParDefaut(): string {
  const home =
    process.env.CODEBUDDY_HOME ??
    (process.env.HOME ? `${process.env.HOME}/.codebuddy` : '.codebuddy');
  return `${home}/collective/ckg-ledger.jsonl`;
}
