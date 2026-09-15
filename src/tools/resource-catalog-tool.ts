import { z } from 'zod';
import { publicResourceStatus, ResourceCatalog, resourceSchema, selectionWarning } from '../fleet/resource-catalog.js';
import { RESOURCE_CATALOG_TOOL_DEF } from '../codebuddy/resource-catalog-tool-defs.js';
import type { ToolResult } from '../types/index.js';
import type { ITool, IToolMetadata, IValidationResult } from './registry/types.js';

const schema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('list') }).strict(),
  z.object({ operation: z.literal('select'), capability: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,95}$/),
    kind: resourceSchema.shape.kind.optional() }).strict(),
]);

export class ResourceCatalogTool implements ITool {
  readonly name = 'resource_catalog';
  readonly description = RESOURCE_CATALOG_TOOL_DEF.function.description;
  constructor(private readonly catalog = new ResourceCatalog()) {}
  getSchema() { return RESOURCE_CATALOG_TOOL_DEF.function; }
  getMetadata(): IToolMetadata {
    return { name: this.name, description: this.description, category: 'system',
      keywords: ['resource', 'catalog', 'network', 'fleet', 'ragchat', 'available', 'ressources', 'réseau'],
      priority: 7, modifiesFiles: false, makesNetworkRequests: false };
  }
  isAvailable() { return true; }
  validate(input: unknown): IValidationResult {
    return schema.safeParse(input).success ? { valid: true } : { valid: false, errors: ['Paramètres du catalogue invalides.'] };
  }
  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { success: false, error: 'Paramètres du catalogue invalides ; seules list et select sont disponibles.' };
    try {
      const args = parsed.data;
      const result = args.operation === 'list' ? { resources: (await this.catalog.list()).map(publicResourceStatus) }
        : await this.catalog.select(args.capability, args.kind).then(choice => {
          const warning = selectionWarning(choice.selected);
          return { excluded: choice.excluded, reason: choice.reason,
            selected: choice.selected ? publicResourceStatus(choice.selected) : null, ...(warning ? { warning } : {}) };
        });
      return { success: true, output: JSON.stringify({ ...result, dispatched: false, probed: false,
        instruction: 'Déclarations explicites, santé observée sans preuve d’usage et charge inconnue. Aucune sonde ni exécution effectuée. Une sélection ne change pas les endpoints des autres outils ; ragchat_search utilise RAGCHAT_BASE_URL configuré séparément.' }) };
    } catch {
      return { success: false, error: 'Catalogue indisponible ou invalide ; aucune sonde, écriture ni exécution effectuée.' };
    }
  }
}
