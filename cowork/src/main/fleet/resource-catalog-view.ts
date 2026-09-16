/**
 * Read-only resource catalog view for Cowork (P8).
 *
 * Calls the core ResourceCatalog.list() (file read only: no probe, no network,
 * no write) and returns the core public projection — declarations, state and
 * endpoint REFERENCES, never resolved URLs or internal fingerprints. The field
 * whitelist is re-applied here so an older core cannot leak extra fields.
 */

export interface CoworkResourceRow {
  id: string;
  kind: string;
  hostId: string;
  declaredCapabilities: string[];
  endpointRef: string;
  permissions: { probe: boolean; use: boolean };
  state: string;
  reason: string;
  checkedAt: number | null;
  latencyMs: number | null;
}

export type CoworkResourceCatalogView =
  | { status: 'ok'; resources: CoworkResourceRow[] }
  | { status: 'empty'; hint: string }
  | { status: 'error'; message: string };

export interface ResourceCatalogCoreModule {
  ResourceCatalog: new () => { filename: string; list: () => Promise<unknown[]> };
  publicResourceStatus: (entry: never) => {
    resource: { id: string; kind: string; hostId: string; declaredCapabilities: string[]; endpointRef: string; permissions: { probe: boolean; use: boolean } };
    state: string;
    reason: string;
    checkedAt: number | null;
    latencyMs: number | null;
  };
}

export const COWORK_RESOURCES_EMPTY_HINT =
  'Aucune ressource déclarée. Dans un terminal : buddy resources add <fichier.json> (champs : buddy resources schema), puis buddy resources probe <id>.';

export async function listCoworkResources(
  loadCore: () => Promise<ResourceCatalogCoreModule | null>,
): Promise<CoworkResourceCatalogView> {
  const mod = await loadCore();
  if (!mod?.ResourceCatalog || !mod.publicResourceStatus) {
    return { status: 'error', message: 'Moteur Code Buddy indisponible : catalogue des ressources non lu.' };
  }
  try {
    const entries = await new mod.ResourceCatalog().list();
    if (entries.length === 0) return { status: 'empty', hint: COWORK_RESOURCES_EMPTY_HINT };
    return {
      status: 'ok',
      resources: entries.map((entry) => {
        const view = mod.publicResourceStatus(entry as never);
        const r = view.resource;
        return {
          id: r.id,
          kind: r.kind,
          hostId: r.hostId,
          declaredCapabilities: [...r.declaredCapabilities],
          endpointRef: r.endpointRef,
          permissions: { probe: r.permissions.probe === true, use: r.permissions.use === true },
          state: view.state,
          reason: view.reason,
          checkedAt: view.checkedAt,
          latencyMs: view.latencyMs,
        };
      }),
    };
  } catch (error) {
    const code = error instanceof Error ? error.message.split(':')[0] : 'INVALID_CATALOG';
    return { status: 'error', message: `Catalogue illisible (${code}) ; rien n’a été modifié.` };
  }
}
