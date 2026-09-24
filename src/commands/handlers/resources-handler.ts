/**
 * /resources — read-only view of the explicit resource catalog (P8).
 *
 * Reads ~/.codebuddy/resources/catalog.json through ResourceCatalog.list():
 * no probe, no network, no write, no dispatch. Shows endpoint REFERENCES
 * (environment variable names), never resolved URLs or fingerprints.
 */

import fs from 'node:fs';
import type { CommandHandlerResult } from './branch-handlers.js';
import { publicResourceStatus, ResourceCatalog, type PublicResourceStatus } from '../../fleet/resource-catalog.js';
import { failureFlag } from '../slash-failure.js';

export const RESOURCES_EMPTY_HINT =
  'No resource catalog yet. Declare one with `buddy resources add <file.json>` (fields: `buddy resources schema`), '
  + 'then refresh its health explicitly with `buddy resources probe <id>`.';

function textResult(content: string): CommandHandlerResult {
  return { handled: true, ...failureFlag(content), entry: { type: 'assistant', content, timestamp: new Date() } };
}

function age(from: number | null, now: number): string {
  if (from === null) return 'never';
  const minutes = Math.max(0, Math.round((now - from) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 120) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

export function formatResourcesTable(resources: PublicResourceStatus[], now = Date.now()): string {
  const lines = [`Resources (${resources.length}) — read-only, no probe`, ''];
  for (const entry of resources) {
    const r = entry.resource;
    const use = r.permissions.use ? 'use' : 'no-use';
    const probe = r.permissions.probe ? 'probe' : 'no-probe';
    lines.push(`  ${r.id}  [${r.kind}] on ${r.hostId}`);
    lines.push(`    state: ${entry.state} (${entry.reason}), checked ${age(entry.checkedAt, now)}`);
    lines.push(`    capabilities: ${r.declaredCapabilities.join(', ')} · endpoint ref: ${r.endpointRef} · ${use}, ${probe}`);
  }
  lines.push('', 'Health is not proof of usage and load is unknown. Refresh with `buddy resources probe <id>`.');
  return lines.join('\n');
}

export async function handleResources(catalog = new ResourceCatalog(), now: () => number = Date.now): Promise<CommandHandlerResult> {
  let resources: PublicResourceStatus[];
  try {
    resources = (await catalog.list()).map(publicResourceStatus);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'INVALID_CATALOG';
    return textResult(`Resource catalog unreadable (${code}). Nothing was changed; inspect ${catalog.filename}.`);
  }
  if (resources.length === 0) {
    return textResult(fs.existsSync(catalog.filename) ? `The resource catalog is empty. ${RESOURCES_EMPTY_HINT.replace(/^No resource catalog yet\. /, '')}` : RESOURCES_EMPTY_HINT);
  }
  return textResult(formatResourcesTable(resources, now()));
}
