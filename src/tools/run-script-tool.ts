
import { BaseTool } from './base-tool.js';
import { DockerSandbox } from '../sandbox/docker-sandbox.js';
import { ToolResult } from '../types/index.js';
import { ParameterDefinition } from './base-tool.js';
import * as fs from 'fs-extra';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';
import { validateSyntax } from '../security/syntax-validator.js';

export class RunScriptTool extends BaseTool {
  readonly name = 'run_script';
  readonly description = 'Execute a Python, TypeScript, or JavaScript script in a secure sandboxed environment (Docker). Supports external dependencies.';
  
  private workspacePath: string;

  constructor(workspacePath?: string) {
    super();
    // Default to a temporary workspace if not provided
    this.workspacePath = workspacePath || path.join(process.cwd(), '.codebuddy', 'workspace');
    fs.ensureDirSync(this.workspacePath);
  }

  protected getParameters(): Record<string, ParameterDefinition> {
    return {
      script: {
        type: 'string',
        description: 'The source code to execute.',
        required: true,
      },
      language: {
        type: 'string',
        description: 'Programming language of the script.',
        enum: ['python', 'typescript', 'javascript', 'shell'],
        required: true,
      },
      dependencies: {
        type: 'array',
        description: 'List of external packages to install (e.g. "pandas", "axios").',
        items: {
          type: 'string',
          description: 'Package name',
        },
      },
      env: {
        type: 'object',
        description: 'Environment variables to set.',
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const script = input.script as string;
    const language = input.language as string;
    const dependencies = (input.dependencies as string[]) || [];
    const env = (input.env as Record<string, string>) || {};

    // Pre-flight syntax validation
    const syntaxCheck = validateSyntax(script, `script.${this.getExtension(language)}`);
    if (!syntaxCheck.valid) {
      return this.error(`Syntax validation failed (${syntaxCheck.language}): ${syntaxCheck.errors.join('; ')}`);
    }

    if (!DockerSandbox.isAvailable()) {
      return this.error('Docker is not available or not running. Please install Docker and ensure it is running to use the run_script tool.');
    }

    const runId = randomUUID().slice(0, 8);
    const filename = `script_${runId}.${this.getExtension(language)}`;
    const hostFilePath = path.join(this.workspacePath, filename);
    const containerFilePath = `/workspace/${filename}`;

    try {
      // 1. Write script to host workspace
      await fs.writeFile(hostFilePath, script);

      // 2. Select Docker Image
      const image = this.getDockerImage(language);

      // 3. Initialize Sandbox
      const sandbox = new DockerSandbox({
        image,
        workspaceMount: this.workspacePath,
        networkEnabled: true, // Needed for installing dependencies
        memoryLimit: '1g', // Give it some room
        timeout: 120000, // 2 minutes timeout for install + run
      });

      let setupCommand = '';
      let runCommand = '';

      // 4. Build Commands
      if (language === 'python') {
        if (dependencies.length > 0) {
          setupCommand = `pip install ${dependencies.join(' ')} && `;
        }
        runCommand = `python ${containerFilePath}`;
      } else if (language === 'typescript') {
        if (dependencies.length > 0) {
          setupCommand = `npm install ${dependencies.join(' ')} && `;
        }
        // Use tsx for direct execution without compilation
        runCommand = `npx tsx ${containerFilePath}`;
      } else if (language === 'javascript') {
        if (dependencies.length > 0) {
          setupCommand = `npm install ${dependencies.join(' ')} && `;
        }
        runCommand = `node ${containerFilePath}`;
      } else if (language === 'shell') {
        if (dependencies.length > 0) {
           // Basic apk add support for alpine based images, or apt-get for debian
           setupCommand = `(apk add --no-cache ${dependencies.join(' ')} || apt-get update && apt-get install -y ${dependencies.join(' ')}) && `;
        }
        runCommand = `sh ${containerFilePath}`;
      }

      const fullCommand = `${setupCommand}${runCommand}`;

      logger.info(`Executing script (${language}) in sandbox: ${filename}`);

      // 5. Execute
      const result = await sandbox.execute(fullCommand, {
        networkEnabled: true
      });

      // 6. Cleanup (Keep the file for debugging/history? No, strictly cleanup for now or let workspace management handle it)
      // For CodeAct/OpenManus, keeping the file is actually good for context history, 
      // but we might want to clean up if it's just a one-off. 
      // Let's keep it in the workspace for now so the agent can inspect it later if needed.

      if (!result.success) {
        return this.error(`Execution failed (Exit Code ${result.exitCode}):
${result.error || result.output}`, {
          stdout: result.output,
          stderr: result.error,
          exitCode: result.exitCode
        });
      }

      return this.success(result.output, {
        stderr: result.error,
        exitCode: result.exitCode,
        file: filename
      });

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.error(`Internal tool error: ${msg}`);
    }
  }

  private getExtension(language: string): string {
    switch (language) {
      case 'python': return 'py';
      case 'typescript': return 'ts';
      case 'javascript': return 'js';
      case 'shell': return 'sh';
      default: return 'txt';
    }
  }

  private getDockerImage(language: string): string {
    switch (language) {
      case 'python': return 'mcr.microsoft.com/playwright/python:v1.48.0-jammy'; // Includes python + browsers
      case 'typescript': return 'mcr.microsoft.com/playwright:v1.48.0-jammy'; // Includes node + browsers
      case 'javascript': return 'mcr.microsoft.com/playwright:v1.48.0-jammy';
      case 'shell': return 'alpine:latest';
      default: return 'ubuntu:latest';
    }
  }
}
