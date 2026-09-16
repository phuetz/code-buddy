/**
 * Pipeline CLI Command
 *
 * Commander.js subcommand for managing and running pipelines.
 * Supports running from YAML/JSON files, listing, validating, and status checks.
 */

import { Command } from 'commander';
import { logger } from '../utils/logger.js';
import type { PipelineConfig, ApprovalGateConfig } from '../workflows/pipeline.js';
import type { ConfirmationOptions } from '../utils/confirmation-service.js';

/** Standalone CLI bridge; tool policy, trust and confirmations stay in ToolHandler. */
export function createPipelineRuntime(): Pick<PipelineConfig, 'toolExecutor' | 'approvalHandler'> & { dispose(): Promise<void> } {
  const controller = new AbortController();
  let handler: import('../agent/tool-handler.js').ToolHandler | undefined;
  let marketplace: import('../plugins/marketplace.js').PluginMarketplace | undefined;
  let repair: import('../agent/execution/repair-coordinator.js').RepairCoordinator | undefined;
  let service: import('../utils/confirmation-service.js').ConfirmationService | undefined;
  let readline: import('node:readline/promises').Interface | undefined;
  let ownsListener = false;
  const onConfirmation = (options: ConfirmationOptions): void => {
    void (async () => {
      try {
        const { createInterface } = await import('node:readline/promises');
        readline = createInterface({ input: process.stdin, output: process.stderr });
        process.stderr.write(`${JSON.stringify({ operation: options.operation, target: options.filename,
          preview: options.diffPreview ?? options.content })}\n`);
        const answer = await readline.question('Approve this operation? [y/N] ');
        service?.confirmOperation(/^(y|yes|o|oui)$/i.test(answer.trim()));
      } catch {
        service?.rejectOperation('Approval input closed');
      } finally {
        readline?.close();
        readline = undefined;
      }
    })();
  };
  const confirmations = async () => {
    if (!service) {
      const { ConfirmationService } = await import('../utils/confirmation-service.js');
      service = ConfirmationService.getInstance();
      if (process.stdin.isTTY && service.listenerCount('confirmation-requested') === 0) {
        service.on('confirmation-requested', onConfirmation);
        ownsListener = true;
      }
    }
    return service;
  };
  return {
    toolExecutor: async (name, args) => {
      await confirmations();
      if (!handler) {
        const [{ ToolHandler }, { CheckpointManager }, { HooksManager }, { PluginMarketplace }, { RepairCoordinator }] = await Promise.all([
          import('../agent/tool-handler.js'), import('../checkpoints/checkpoint-manager.js'),
          import('../hooks/lifecycle-hooks.js'), import('../plugins/marketplace.js'),
          import('../agent/execution/repair-coordinator.js'),
        ]);
        marketplace = new PluginMarketplace({ autoUpdate: false });
        repair = new RepairCoordinator({ enabled: false });
        handler = new ToolHandler({ checkpointManager: new CheckpointManager(),
          hooksManager: new HooksManager(process.cwd()), marketplace, repairCoordinator: repair });
        handler.setWorkingDirectory(process.cwd());
      }
      const { randomUUID } = await import('node:crypto');
      const result = await handler.executeTool({ id: `pipeline_${randomUUID()}`, type: 'function',
        function: { name, arguments: JSON.stringify(args) } }, { surface: 'cli', abortSignal: controller.signal });
      return { success: result.success, output: result.output ?? '', error: result.error };
    },
    approvalHandler: async (gate) => {
      const confirmation = await confirmations();
      const timer = setTimeout(() => {
        confirmation.rejectOperation('Pipeline approval timed out');
        readline?.close();
      }, gate.timeoutMs);
      try {
        const result = await confirmation.requestConfirmation({ operation: 'Approve pipeline step',
          filename: gate.message, toolName: 'pipeline_approval', forcePrompt: true }, 'tool');
        return { approved: result.confirmed, timestamp: new Date(), comment: result.feedback };
      } finally { clearTimeout(timer); }
    },
    dispose: async () => {
      controller.abort();
      if (ownsListener) service?.off('confirmation-requested', onConfirmation);
      readline?.close();
      repair?.dispose();
      await marketplace?.dispose();
    },
  };
}

/**
 * Pipeline definition loaded from a file (YAML/JSON)
 */
export interface PipelineFileDefinition {
  name: string;
  description?: string;
  version?: string;
  steps: Array<{
    name: string;
    type?: 'tool' | 'skill' | 'function' | 'transform' | 'approval';
    args?: Record<string, unknown>;
    timeout?: number;
    label?: string;
    approvalGate?: Pick<ApprovalGateConfig, 'message' | 'timeoutMs'>;
  }>;
  config?: {
    maxSteps?: number;
    defaultTimeout?: number;
    maxDurationMs?: number;
  };
}

/**
 * Validation result for a pipeline file
 */
export interface PipelineValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  stepCount: number;
  pipelineName: string;
}

/**
 * Load a pipeline definition from a YAML or JSON file.
 * Uses lazy imports for yaml parsing.
 */
export async function loadPipelineFile(filePath: string): Promise<PipelineFileDefinition> {
  const fsModule = await import('fs');
  const pathModule = await import('path');
  const fs = (fsModule as unknown as { default?: { default?: typeof import('fs') } & typeof import('fs') }).default?.default
    ?? (fsModule as unknown as { default?: typeof import('fs') }).default
    ?? fsModule;
  const path = (pathModule as unknown as { default?: { default?: typeof import('path') } & typeof import('path') }).default?.default
    ?? (pathModule as unknown as { default?: typeof import('path') }).default
    ?? pathModule;

  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Pipeline file not found: ${resolvedPath}`);
  }

  const content = fs.readFileSync(resolvedPath, 'utf-8');
  const ext = path.extname(resolvedPath).toLowerCase();

  let definition: PipelineFileDefinition;

  if (ext === '.json') {
    try {
      definition = JSON.parse(content) as PipelineFileDefinition;
    } catch (err) {
      throw new Error(`Invalid JSON in pipeline file: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (ext === '.yaml' || ext === '.yml') {
    try {
      // Lazy import yaml parser
      const yaml = await import('js-yaml');
      definition = yaml.default.load(content) as PipelineFileDefinition;
    } catch (err) {
      throw new Error(`Invalid YAML in pipeline file: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    throw new Error(`Unsupported pipeline file format: ${ext} (use .json, .yaml, or .yml)`);
  }

  return definition;
}

/**
 * Validate a pipeline definition and return structured results.
 */
export function validatePipelineDefinition(definition: PipelineFileDefinition): PipelineValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!definition) {
    return { valid: false, errors: ['Pipeline definition is empty or null'], warnings: [], stepCount: 0, pipelineName: '' };
  }

  if (!definition.name || typeof definition.name !== 'string') {
    errors.push('Pipeline must have a "name" field (string)');
  }

  if (!definition.steps || !Array.isArray(definition.steps)) {
    errors.push('Pipeline must have a "steps" field (array)');
    return { valid: false, errors, warnings, stepCount: 0, pipelineName: definition.name || '' };
  }

  if (definition.steps.length === 0) {
    errors.push('Pipeline must have at least one step');
  }

  const maxSteps = definition.config?.maxSteps || 20;
  if (definition.steps.length > maxSteps) {
    errors.push(`Pipeline exceeds maximum of ${maxSteps} steps (has ${definition.steps.length})`);
  }

  const stepNames = new Set<string>();
  for (let i = 0; i < definition.steps.length; i++) {
    const step = definition.steps[i];
    if (!step) {
      continue;
    }

    if (!step.name || typeof step.name !== 'string') {
      errors.push(`Step ${i + 1}: must have a "name" field (string)`);
      continue;
    }

    if (stepNames.has(step.name)) {
      warnings.push(`Step ${i + 1}: duplicate step name "${step.name}"`);
    }
    stepNames.add(step.name);

    if (step.type && !['tool', 'skill', 'function', 'transform', 'approval'].includes(step.type)) {
      errors.push(`Step ${i + 1} ("${step.name}"): invalid type "${step.type}" (must be tool, skill, function, transform, or approval)`);
    }
    if (step.approvalGate && (typeof step.approvalGate.message !== 'string' ||
      !Number.isFinite(step.approvalGate.timeoutMs) || step.approvalGate.timeoutMs <= 0)) {
      errors.push(`Step ${i + 1}: approvalGate requires a message and positive timeoutMs`);
    }

    if (step.timeout !== undefined && (typeof step.timeout !== 'number' || step.timeout <= 0)) {
      warnings.push(`Step ${i + 1} ("${step.name}"): timeout should be a positive number`);
    }
  }

  if (!definition.description) {
    warnings.push('Pipeline has no description');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stepCount: definition.steps.length,
    pipelineName: definition.name || '',
  };
}

/**
 * Create the pipeline Commander.js command.
 */
export function createPipelineCommand(): Command {
  const pipelineCommand = new Command('pipeline');
  pipelineCommand.description('Manage and run pipeline workflows');

  // Run a pipeline from a file
  pipelineCommand
    .command('run <file>')
    .description('Run a pipeline from a YAML/JSON file')
    .option('-t, --timeout <ms>', 'Override default step timeout in milliseconds')
    .option('--dry-run', 'Validate and show steps without executing')
    .action(async (file: string, options: { timeout?: string; dryRun?: boolean }) => {
      let runtime: ReturnType<typeof createPipelineRuntime> | undefined;
      let compositor: import('../workflows/pipeline.js').PipelineCompositor | undefined;
      try {
        console.log(`Loading pipeline from: ${file}`);
        const definition = await loadPipelineFile(file);
        const validation = validatePipelineDefinition(definition);

        if (!validation.valid) {
          console.error('Pipeline validation failed:');
          for (const error of validation.errors) {
            console.error(`  - ${error}`);
          }
          process.exit(1);
        }

        if (validation.warnings.length > 0) {
          for (const warning of validation.warnings) {
            console.warn(`  Warning: ${warning}`);
          }
        }

        if (options.dryRun) {
          console.log(`\nPipeline: ${definition.name}`);
          if (definition.description) {
            console.log(`Description: ${definition.description}`);
          }
          console.log(`Steps (${definition.steps.length}):`);
          for (let i = 0; i < definition.steps.length; i++) {
            const step = definition.steps[i];
            if (!step) {
              continue;
            }
            console.log(`  ${i + 1}. ${step.name} (${step.type || 'tool'})`);
          }
          console.log('\nDry run complete. No steps were executed.');
          return;
        }

        // Lazy import the pipeline compositor
        const { PipelineCompositor } = await import('../workflows/pipeline.js');

        const config: Record<string, unknown> = {};
        if (options.timeout) {
          config.defaultTimeout = parseInt(options.timeout, 10);
        }
        if (definition.config?.maxSteps) {
          config.maxSteps = definition.config.maxSteps;
        }
        if (definition.config?.defaultTimeout && !options.timeout) {
          config.defaultTimeout = definition.config.defaultTimeout;
        }
        if (definition.config?.maxDurationMs) {
          config.maxDurationMs = definition.config.maxDurationMs;
        }

        runtime = createPipelineRuntime();
        compositor = new PipelineCompositor({ ...config, toolExecutor: runtime.toolExecutor,
          approvalHandler: runtime.approvalHandler });

        // Set up event listeners for progress
        compositor.on('step:start', (step: { name: string }, index: number) => {
          console.log(`  [${index + 1}/${definition.steps.length}] Running: ${step.name}...`);
        });

        compositor.on('step:complete', (result: { step: { name: string }; success: boolean; durationMs: number }) => {
          const status = result.success ? 'done' : 'FAILED';
          console.log(`    ${status} (${result.durationMs}ms)`);
        });

        // Convert file definition steps to PipelineStep format
        const steps = definition.steps.map(step => ({
          type: step.type || 'tool' as const,
          name: step.name,
          args: step.args || {},
          timeout: step.timeout,
          label: step.label,
          approvalGate: step.type === 'approval' ? { message: step.approvalGate?.message ?? step.name,
            timeoutMs: step.approvalGate?.timeoutMs ?? 300000, requireExplicit: true } : undefined,
        }));

        console.log(`\nRunning pipeline: ${definition.name} (${steps.length} steps)`);
        const result = await compositor.execute(steps);

        if (result.success) {
          console.log(`\nPipeline completed successfully in ${result.totalDurationMs}ms`);
          if (result.output) {
            console.log(`\nOutput:\n${result.output}`);
          }
        } else {
          console.error(`\nPipeline failed: ${result.error || 'Unknown error'}`);
          process.exitCode = 1;
        }

      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(`Pipeline error: ${msg}`);
        process.exitCode = 1;
      } finally {
        compositor?.dispose();
        await runtime?.dispose();
      }
    });

  // List available pipeline definitions
  pipelineCommand
    .command('list')
    .alias('ls')
    .description('List available pipeline definitions')
    .option('-d, --dir <directory>', 'Directory to search for pipeline files', '.')
    .action(async (options: { dir: string }) => {
      try {
        const fsModule = await import('fs');
        const pathModule = await import('path');
        const fs = (fsModule as unknown as { default?: { default?: typeof import('fs') } & typeof import('fs') }).default?.default
          ?? (fsModule as unknown as { default?: typeof import('fs') }).default
          ?? fsModule;
        const path = (pathModule as unknown as { default?: { default?: typeof import('path') } & typeof import('path') }).default?.default
          ?? (pathModule as unknown as { default?: typeof import('path') }).default
          ?? pathModule;

        const dir = path.resolve(options.dir);

        if (!fs.existsSync(dir)) {
          console.error(`Directory not found: ${dir}`);
          process.exit(1);
        }

        const files = fs.readdirSync(dir).filter((f: string) => {
          const ext = path.extname(f).toLowerCase();
          return ext === '.json' || ext === '.yaml' || ext === '.yml';
        });

        // Also check for pipeline-specific files
        const pipelineFiles: Array<{ file: string; name: string; steps: number; description: string }> = [];

        for (const file of files) {
          try {
            const filePath = path.join(dir, file);
            const definition = await loadPipelineFile(filePath);
            if (definition.steps && Array.isArray(definition.steps)) {
              pipelineFiles.push({
                file,
                name: definition.name || file,
                steps: definition.steps.length,
                description: definition.description || '',
              });
            }
          } catch {
            // Skip files that aren't valid pipeline definitions
          }
        }

        if (pipelineFiles.length === 0) {
          console.log('No pipeline definitions found in the current directory.');
          console.log('Pipeline files should be .json or .yaml/.yml files with "name" and "steps" fields.');
          return;
        }

        console.log('Available Pipelines:\n');
        for (const pipeline of pipelineFiles) {
          console.log(`  ${pipeline.name} (${pipeline.file})`);
          if (pipeline.description) {
            console.log(`    ${pipeline.description}`);
          }
          console.log(`    Steps: ${pipeline.steps}`);
          console.log('');
        }
        console.log(`Total: ${pipelineFiles.length} pipeline(s)`);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(`Error listing pipelines: ${msg}`);
        process.exit(1);
      }
    });

  // Validate a pipeline file
  pipelineCommand
    .command('validate <file>')
    .description('Validate a pipeline definition file')
    .action(async (file: string) => {
      try {
        const definition = await loadPipelineFile(file);
        const result = validatePipelineDefinition(definition);

        console.log(`Pipeline: ${result.pipelineName || '(unnamed)'}`);
        console.log(`Steps: ${result.stepCount}`);

        if (result.errors.length > 0) {
          console.error('\nErrors:');
          for (const error of result.errors) {
            console.error(`  - ${error}`);
          }
        }

        if (result.warnings.length > 0) {
          console.warn('\nWarnings:');
          for (const warning of result.warnings) {
            console.warn(`  - ${warning}`);
          }
        }

        if (result.valid) {
          console.log('\nValidation: PASSED');
        } else {
          console.error('\nValidation: FAILED');
          process.exit(1);
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Validation error: ${msg}`);
        process.exit(1);
      }
    });

  // Show status of running pipelines
  pipelineCommand
    .command('status')
    .description('Show status of pipeline system and available transforms')
    .action(async () => {
      try {
        // Lazy import
        const { getPipelineCompositor } = await import('../workflows/pipeline.js');
        const compositor = getPipelineCompositor();

        const transforms = compositor.listTransforms();

        console.log('Pipeline System Status\n');
        console.log('Available transforms:');
        for (const transform of transforms) {
          console.log(`  - ${transform}`);
        }
        console.log(`\nTotal transforms: ${transforms.length}`);

        // Show workflow engine status if available
        try {
          const { getWorkflowEngine } = await import('../workflows/index.js');
          const engine = getWorkflowEngine();
          const stats = engine.getStats();
          const workflows = engine.getWorkflows();

          console.log('\nWorkflow Engine:');
          console.log(`  Registered workflows: ${workflows.length}`);
          console.log(`  Running: ${stats.running}`);
          console.log(`  Completed: ${stats.completed}`);
          console.log(`  Failed: ${stats.failed}`);
          console.log(`  Pending: ${stats.pending}`);
        } catch {
          // Workflow engine not available
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(`Status error: ${msg}`);
        process.exit(1);
      }
    });

  return pipelineCommand;
}

export default createPipelineCommand;
