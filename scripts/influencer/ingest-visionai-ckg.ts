#!/usr/bin/env -S npx tsx
/**
 * Ingère les fiches Vision IA déjà analysées dans le Collective Knowledge Graph.
 *
 * L'identifiant `youtube:vision-ia:<videoId>` rend l'opération idempotente.
 * Aucun LLM distant n'est appelé : l'auto-liage réutilise les embeddings locaux
 * configurés par le CKG.
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getCollectiveKnowledgeGraph } from '../../src/memory/collective-knowledge-graph.js';

interface SourceRecord {
  video_id?: string;
  title?: string;
  published?: string;
  url?: string;
}

interface ItemRecord {
  name?: string;
  publisher?: string;
  description?: string;
  sources?: SourceRecord[];
}

interface SeenRecord {
  title?: string;
  published?: string;
  url?: string;
  main_subject?: string;
  summary?: string;
  item_keys?: string[];
}

interface WatchState {
  seen_videos?: Record<string, SeenRecord>;
  items?: Record<string, ItemRecord>;
}

function positiveInt(flag: string, fallback: number): number {
  const index = process.argv.indexOf(flag);
  if (index < 0) return fallback;
  const value = Number.parseInt(process.argv[index + 1] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const workdir = process.env.VEILLE_YOUTUBE_WORKDIR
  ?? join(homedir(), '.codebuddy', 'veille');
const state = JSON.parse(
  await readFile(join(workdir, 'index.json'), 'utf8'),
) as WatchState;
const seen = Object.entries(state.seen_videos ?? {}).sort(
  ([, left], [, right]) =>
    String(left.published ?? '').localeCompare(String(right.published ?? '')),
);
const limit = positiveInt('--limit', seen.length);
const graph = getCollectiveKnowledgeGraph();
let ingested = 0;
let unchanged = 0;

for (const [videoId, video] of seen.slice(0, limit)) {
  const tools = (video.item_keys ?? [])
    .map((key) => state.items?.[key])
    .filter((item): item is ItemRecord => Boolean(item))
    .map((item) => {
      const publisher = item.publisher && item.publisher !== 'inconnu'
        ? ` (${item.publisher})`
        : '';
      return `${item.name ?? 'Nouveauté'}${publisher}: ${item.description ?? ''}`;
    });
  const abstract = [
    `Date: ${video.published ?? 'inconnue'}.`,
    `Sujet: ${video.main_subject ?? video.title ?? videoId}.`,
    video.summary ?? '',
    tools.length > 0 ? `Outils et modèles: ${tools.join(' | ')}` : '',
    video.url ? `Source: ${video.url}` : '',
  ].filter(Boolean).join(' ');
  const result = await graph.ingestPublication(
    {
      id: `youtube:vision-ia:${videoId}`,
      title: video.title ?? videoId,
      abstract,
      source: 'youtube:vision-ia',
      agentId: 'vision-ia-watch',
    },
    { autoLinkK: 3, autoLinkThreshold: 0.5 },
  );
  if (result) {
    ingested++;
  } else {
    unchanged++;
  }
}

const stats = graph.getStats();
process.stdout.write(
  `Vision IA → CKG: ${ingested} ingérée(s), ${unchanged} inchangée(s). `
  + `Graphe: ${stats.entities} entités, ${stats.relations} relations.\n`,
);
