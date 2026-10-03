import type { CodeBuddyTool } from './client.js';
import type { ToolSchema } from '../tools/registry/types.js';
export const COLAB_RUN_TOOL_DEF = {
  type: 'function', function: {
    name: 'colab_run',
    description: 'Run a project Python script on an ephemeral Google Colab GPU (L4 default, A100 on request, H100 falls back to A100 on allocation refusal). Spends compute units and requires confirmation. Opt-in CODEBUDDY_COLAB=true. Only explicitly listed project files without secrets are uploaded. No Drive mount or local environment forwarding. Always stops the VM. Inputs are under inputs/<project-relative path>; write results under CODEBUDDY_COLAB_OUTPUT_DIR. Output directory must be new and inside the project.',
    parameters: { type: 'object', properties: {
      script: { type: 'string', description: 'Project-relative Python .py script.' },
      gpu: { type: 'string', enum: ['L4', 'A100', 'H100'] },
      inputs: { type: 'array', items: { type: 'string' }, description: 'Explicit project files to upload, at most 32.' },
      dependencies: { type: 'array', items: { type: 'string' }, description: 'PyPI names or name==version only; no URLs or requirements files.' },
      outputDir: { type: 'string', description: 'New project-relative output directory.' },
      timeoutSeconds: { type: 'number', minimum: 1, maximum: 3600, description: 'Whole job deadline; default 600 seconds.' },
    }, required: ['script'], additionalProperties: false },
  },
} satisfies CodeBuddyTool & { function: ToolSchema };
