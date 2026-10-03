import type { ToolResult } from '../types/index.js';
import type { ITool, IToolExecutionContext, IToolMetadata } from './registry/types.js';
import { COLAB_RUN_TOOL_DEF } from '../codebuddy/colab-tool-defs.js';
import { ColabRunner, colabJobSchema, isColabEnabled } from '../compute/colab-runner.js';
import { scrubSecrets } from '../security/secret-scrubber.js';

/** Confirmation is enforced by ToolHandler using requiresConfirmation metadata. */
export class ColabRunTool implements ITool {
  readonly name = 'colab_run';
  readonly description = COLAB_RUN_TOOL_DEF.function.description;
  getSchema() { return COLAB_RUN_TOOL_DEF.function; }
  getMetadata(): IToolMetadata {
    return { name: this.name, description: this.description, category: 'system', keywords: ['colab', 'gpu', 'torch', 'diffusion', 'training'],
      priority: 8, requiresConfirmation: true, makesNetworkRequests: true, modifiesFiles: true, effect: 'emission', fleetSafe: false };
  }
  isAvailable() { return isColabEnabled(); }
  validate(input: unknown) {
    return colabJobSchema.safeParse(input).success ? { valid: true } : { valid: false, errors: ['Invalid Colab script, GPU, dependencies or deadline'] };
  }
  async execute(input: Record<string, unknown>, context?: IToolExecutionContext): Promise<ToolResult> {
    try {
      const job = colabJobSchema.parse(input);
      const result = await new ColabRunner({ projectRoot: context?.cwd }).run(job, context?.abortSignal);
      return { success: true, output: JSON.stringify(result) };
    } catch (error) { return { success: false, error: scrubSecrets(String(error)) }; }
  }
}
