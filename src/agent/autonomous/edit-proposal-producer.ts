import * as fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { getRipgrepPath } from '../../utils/ripgrep-path.js';

import { CodeBuddyClient, CodeBuddyMessage, CodeBuddyTool } from '../../codebuddy/client.js';
import { detectProviderFromEnv } from '../../utils/provider-detector.js';
import {
  isPathAllowedByContract,
  resolveRepoPath,
} from './agentic-coding-paths.js';
import {
  AgenticCodingEditProposal,
  validateAgenticCodingEditProposal,
} from './agentic-coding-contract.js';
import type { AgenticCodingEditProposalProducerDispatch } from './agentic-coding-runner.js';
import { executePeerChain } from '../../tools/peer-chain-tool.js';
import { executeRoutePeer } from '../../tools/route-peer-tool.js';

export interface AgenticCodingEditProposalProducerToolTrace {
  allowed: boolean;
  args: Record<string, unknown>;
  error?: string;
  index: number;
  name: string;
  resultSummary: string;
  success: boolean;
}

export interface AgenticCodingEditProposalProducerFleetTrace {
  attemptedPeerChainCalls: number;
  attemptedRoutePeerCalls: number;
  completedPeerChainCalls: number;
  completedRoutePeerCalls: number;
  expectedCollaboration: boolean;
  mode: string;
  policy: string;
  state: 'disabled' | 'missing' | 'attempted' | 'completed';
}

export interface AgenticCodingEditProposalProducerTrace {
  fleet: AgenticCodingEditProposalProducerFleetTrace;
  generatedAt: string;
  kind: 'agentic-coding-edit-proposal-producer-trace';
  maxToolRounds: number;
  messageRounds: number;
  schemaVersion: 1;
  source: {
    repo: string;
    taskFile: string;
  };
  toolCalls: AgenticCodingEditProposalProducerToolTrace[];
}

export interface AgenticCodingGeneratedEditProposal {
  proposal: AgenticCodingEditProposal;
  trace: AgenticCodingEditProposalProducerTrace;
}

export function extractJson(text: string): string {
  // First look for json code blocks
  const blockMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (blockMatch && blockMatch[1]) {
    return blockMatch[1].trim();
  }
  const genericBlockMatch = text.match(/```\s*([\s\S]*?)\s*```/);
  if (genericBlockMatch && genericBlockMatch[1]) {
    try {
      JSON.parse(genericBlockMatch[1].trim());
      return genericBlockMatch[1].trim();
    } catch {
      // not JSON, fall through
    }
  }

  // Find the first '{' and last '}'
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return text.substring(start, end + 1);
  }

  return text.trim();
}

function buildProducerTools(allowedToolNames: Set<string>): CodeBuddyTool[] {
  const tools: CodeBuddyTool[] = [];

  if (allowedToolNames.has('file_read')) {
    tools.push({
      type: 'function',
      function: {
        name: 'file_read',
        description: 'Read the contents of a file in the repository (relative path inside allowedPaths).',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'The relative path of the file to read (must be inside allowedPaths).'
            }
          },
          required: ['path']
        }
      }
    });
  }

  if (allowedToolNames.has('rg')) {
    tools.push({
      type: 'function',
      function: {
        name: 'rg',
        description: 'Run ripgrep (rg) to search for a query or regex pattern in the repository files.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The query string or regex pattern to search for.'
            }
          },
          required: ['query']
        }
      }
    });
  }

  if (allowedToolNames.has('git_status')) {
    tools.push({
      type: 'function',
      function: {
        name: 'git_status',
        description: 'Get the current status of the git repository (running git status --short --branch).',
        parameters: {
          type: 'object',
          properties: {},
          required: []
        }
      }
    });
  }

  if (allowedToolNames.has('route_peer')) {
    tools.push({
      type: 'function',
      function: {
        name: 'route_peer',
        description: 'Route an advisory Fleet peer collaboration request. Does not modify repository files.',
        parameters: {
          type: 'object',
          properties: {
            prompt: { type: 'string' },
            chainRoles: {
              type: 'array',
              items: { type: 'string' },
            },
            dispatchProfile: { type: 'string' },
            privacyTag: { type: 'string', enum: ['sensitive', 'public'] },
            estimatedTokens: { type: 'number' },
          },
          required: ['prompt']
        }
      }
    });
  }

  if (allowedToolNames.has('peer_chain')) {
    tools.push({
      type: 'function',
      function: {
        name: 'peer_chain',
        description: 'Execute an ordered advisory Fleet collaboration chain. Peers return guidance only; the local runner still owns edits.',
        parameters: {
          type: 'object',
          properties: {
            prompt: { type: 'string' },
            chainRoles: {
              type: 'array',
              items: { type: 'string' },
            },
            privacyTag: { type: 'string', enum: ['sensitive', 'public'] },
            stageTimeoutMs: { type: 'number' },
          },
          required: ['prompt', 'chainRoles']
        }
      }
    });
  }

  return tools;
}

function parseToolArguments(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw || '{}');
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

function summarizeToolArgs(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  if (toolName === 'file_read') {
    return typeof args.path === 'string' ? { path: args.path } : {};
  }

  if (toolName === 'rg') {
    return typeof args.query === 'string'
      ? { queryLength: args.query.length }
      : {};
  }

  if (toolName === 'route_peer') {
    return {
      ...(Array.isArray(args.chainRoles) ? { chainRoles: args.chainRoles } : {}),
      ...(typeof args.dispatchProfile === 'string' ? { dispatchProfile: args.dispatchProfile } : {}),
      ...(typeof args.estimatedTokens === 'number' ? { estimatedTokens: args.estimatedTokens } : {}),
      privacyTag: args.privacyTag === 'public' ? 'public' : 'sensitive',
      promptLength: typeof args.prompt === 'string' ? args.prompt.length : 0,
    };
  }

  if (toolName === 'peer_chain') {
    return {
      ...(Array.isArray(args.chainRoles) ? { chainRoles: args.chainRoles } : {}),
      privacyTag: args.privacyTag === 'public' ? 'public' : 'sensitive',
      promptLength: typeof args.prompt === 'string' ? args.prompt.length : 0,
      ...(typeof args.stageTimeoutMs === 'number' ? { stageTimeoutMs: args.stageTimeoutMs } : {}),
    };
  }

  return {};
}

function summarizeToolResult(result: string): string {
  return result.startsWith('Error')
    ? result.slice(0, 500)
    : `returned ${result.length} chars`;
}

function buildFleetTrace(
  dispatch: AgenticCodingEditProposalProducerDispatch,
  toolCalls: AgenticCodingEditProposalProducerToolTrace[],
): AgenticCodingEditProposalProducerFleetTrace {
  const expectedCollaboration = Boolean(dispatch.fleet && dispatch.fleet.mode !== 'disabled');
  const attemptedPeerChainCalls = toolCalls.filter((call) => call.name === 'peer_chain').length;
  const attemptedRoutePeerCalls = toolCalls.filter((call) => call.name === 'route_peer').length;
  const completedPeerChainCalls = toolCalls
    .filter((call) => call.name === 'peer_chain' && call.success).length;
  const completedRoutePeerCalls = toolCalls
    .filter((call) => call.name === 'route_peer' && call.success).length;
  const attempted = attemptedPeerChainCalls + attemptedRoutePeerCalls > 0;
  const completed = completedPeerChainCalls + completedRoutePeerCalls > 0;

  return {
    attemptedPeerChainCalls,
    attemptedRoutePeerCalls,
    completedPeerChainCalls,
    completedRoutePeerCalls,
    expectedCollaboration,
    mode: dispatch.fleet?.mode ?? 'disabled',
    policy: dispatch.fleet?.policy ?? 'none',
    state: expectedCollaboration
      ? completed
        ? 'completed'
        : attempted
          ? 'attempted'
          : 'missing'
      : 'disabled',
  };
}

function toolResultToText(result: {
  data?: unknown;
  error?: string;
  output?: string;
  success: boolean;
}): string {
  const text = JSON.stringify({
    success: result.success,
    ...(result.error ? { error: result.error } : {}),
    ...(result.output ? { output: result.output } : {}),
    ...(result.data !== undefined ? { data: result.data } : {}),
  }, null, 2);

  return text.length > 100_000 ? `${text.slice(0, 100_000)}\n...[truncated]` : text;
}

export async function generateEditProposalWithTrace(
  dispatch: AgenticCodingEditProposalProducerDispatch,
  customClient?: CodeBuddyClient
): Promise<AgenticCodingGeneratedEditProposal> {
  const repo = dispatch.input.repo;
  let allowedPaths: string[] = [];
  try {
    const taskContent = await fs.readFile(dispatch.input.taskFile, 'utf8');
    const parsedTask = JSON.parse(taskContent);
    allowedPaths = parsedTask.allowedPaths || [];
  } catch (err) {
    throw new Error(`Failed to read allowedPaths from taskFile: ${err instanceof Error ? err.message : String(err)}`);
  }
  const maxToolRounds = dispatch.runPolicy.maxToolRounds ?? 50;

  // 1. Setup client
  let client: CodeBuddyClient;
  if (customClient) {
    client = customClient;
  } else {
    const detected = detectProviderFromEnv();
    if (!detected) {
      throw new Error('No LLM provider configuration found in environment.');
    }
    client = new CodeBuddyClient(detected.apiKey, detected.defaultModel, detected.baseURL);
  }

  // 2. Expose only the data-only tools authorized by the dispatch artifact.
  const allowedToolNames = new Set(dispatch.allowedTools);
  const tools = buildProducerTools(allowedToolNames);

  const messages: CodeBuddyMessage[] = [...dispatch.messages];
  const toolTraces: AgenticCodingEditProposalProducerToolTrace[] = [];
  let rounds = 0;

  while (rounds < maxToolRounds) {
    const response = await client.chat(messages, tools);
    const choice = response.choices?.[0];
    if (!choice) {
      throw new Error('No choices returned from Code Buddy client');
    }

    const message = choice.message;
    messages.push(message as CodeBuddyMessage);

    if (message.tool_calls && message.tool_calls.length > 0) {
      for (const toolCall of message.tool_calls) {
        const toolName = toolCall.function.name;
        let argsForTrace: Record<string, unknown> = {};
        let resultStr = '';
        let toolError: string | undefined;
        let toolSuccess = false;
        try {
          if (!allowedToolNames.has(toolName)) {
            resultStr = `Error: Tool "${toolName}" is not allowed by this producer dispatch.`;
            toolError = resultStr;
          } else if (toolName === 'file_read') {
            const args = parseToolArguments(toolCall.function.arguments);
            argsForTrace = args;
            const filePath = args.path;
            if (typeof filePath !== 'string' || !isPathAllowedByContract(filePath, allowedPaths)) {
              resultStr = `Error: Path "${filePath}" is outside the allowed contract paths: ${allowedPaths.join(', ')}`;
              toolError = resultStr;
            } else {
              const resolved = resolveRepoPath(repo, filePath);
              if (resolved.reason || !resolved.path) {
                resultStr = `Error: Cannot resolve path "${filePath}": ${resolved.reason || 'Unknown error'}`;
                toolError = resultStr;
              } else {
                resultStr = await fs.readFile(resolved.path, 'utf8');
                toolSuccess = true;
              }
            }
          } else if (toolName === 'rg') {
            const args = parseToolArguments(toolCall.function.arguments);
            argsForTrace = args;
            const query = args.query;
            if (typeof query !== 'string' || query.length === 0) {
              resultStr = 'Error: rg requires a non-empty string query.';
              toolError = resultStr;
            } else {
              const rgArgs = [
                '--json',
                '--no-require-git',
                '--follow',
                '--glob',
                '!.git/**',
                '--glob',
                '!node_modules/**',
                '--glob',
                '!*.log',
                query,
                '.'
              ];
              const rgBinary = getRipgrepPath().replace(/\.asar([\\/])/, '.asar.unpacked$1');
              const rgProcResult = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve) => {
                const proc = spawn(rgBinary, rgArgs, { cwd: repo });
                let stdout = '';
                let stderr = '';
                proc.stdout.on('data', (d) => { if (stdout.length < 2_000_000) stdout += d.toString(); });
                proc.stderr.on('data', (d) => { if (stderr.length < 100_000) stderr += d.toString(); });
                proc.on('close', (code) => resolve({ stdout, stderr, code }));
                proc.on('error', (err) => resolve({ stdout: '', stderr: err.message, code: -1 }));
              });

              if (rgProcResult.code === 0 || rgProcResult.code === 1) {
                const parsedResults = [];
                const lines = rgProcResult.stdout.split('\n').filter((l) => l.trim().length > 0);
                for (const line of lines) {
                  try {
                    const parsed = JSON.parse(line);
                    if (parsed.type === 'match') {
                      const data = parsed.data;
                      parsedResults.push({
                        file: data.path.text,
                        line: data.line_number,
                        content: data.lines.text.trim(),
                      });
                      if (parsedResults.length >= 50) {
                        break;
                      }
                    }
                  } catch {
                    // skip
                  }
                }
                resultStr = JSON.stringify(parsedResults, null, 2);
                toolSuccess = true;
              } else {
                resultStr = `Error running ripgrep: ${rgProcResult.stderr}`;
                toolError = resultStr;
              }
            }
          } else if (toolName === 'git_status') {
            argsForTrace = parseToolArguments(toolCall.function.arguments);
            const gitResult = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve) => {
              const proc = spawn('git', ['status', '--short', '--branch'], { cwd: repo });
              let stdout = '';
              let stderr = '';
              proc.stdout.on('data', (d) => { stdout += d.toString(); });
              proc.stderr.on('data', (d) => { stderr += d.toString(); });
              proc.on('close', (code) => resolve({ stdout, stderr, code }));
              proc.on('error', (err) => resolve({ stdout: '', stderr: err.message, code: -1 }));
            });
            resultStr = gitResult.code === 0 ? gitResult.stdout : `Error: ${gitResult.stderr}`;
            toolSuccess = gitResult.code === 0;
            if (!toolSuccess) {
              toolError = resultStr;
            }
          } else if (toolName === 'route_peer') {
            const args = parseToolArguments(toolCall.function.arguments);
            argsForTrace = args;
            const prompt = typeof args.prompt === 'string' ? args.prompt : dispatch.fleet?.invocation?.args.prompt;
            if (!prompt) {
              resultStr = 'Error: route_peer requires a prompt.';
              toolError = resultStr;
            } else {
              const toolResult = await executeRoutePeer({
                prompt,
                chainRoles: args.chainRoles,
                privacyTag: args.privacyTag === 'public' ? 'public' : 'sensitive',
                ...(typeof args.dispatchProfile === 'string' ? { dispatchProfile: args.dispatchProfile } : {}),
                ...(typeof args.estimatedTokens === 'number' ? { estimatedTokens: args.estimatedTokens } : {}),
              });
              resultStr = toolResultToText(toolResult);
              toolSuccess = toolResult.success;
              toolError = toolResult.error;
            }
          } else if (toolName === 'peer_chain') {
            const args = parseToolArguments(toolCall.function.arguments);
            argsForTrace = args;
            const prompt = typeof args.prompt === 'string' ? args.prompt : dispatch.fleet?.invocation?.args.prompt;
            const chainRoles = Array.isArray(args.chainRoles)
              ? args.chainRoles
              : dispatch.fleet?.invocation?.args.chainRoles;
            if (!prompt || !chainRoles) {
              resultStr = 'Error: peer_chain requires prompt and chainRoles.';
              toolError = resultStr;
            } else {
              const toolResult = await executePeerChain({
                prompt,
                chainRoles,
                privacyTag: args.privacyTag === 'public' ? 'public' : 'sensitive',
                ...(typeof args.stageTimeoutMs === 'number'
                  ? { stageTimeoutMs: args.stageTimeoutMs }
                  : dispatch.fleet?.invocation?.args.stageTimeoutMs
                    ? { stageTimeoutMs: dispatch.fleet.invocation.args.stageTimeoutMs }
                    : {}),
              });
              resultStr = toolResultToText(toolResult);
              toolSuccess = toolResult.success;
              toolError = toolResult.error;
            }
          } else {
            resultStr = `Error: Tool "${toolName}" is not supported by the producer.`;
            toolError = resultStr;
          }
        } catch (err) {
          resultStr = `Error executing tool: ${err instanceof Error ? err.message : String(err)}`;
          toolError = resultStr;
        }

        toolTraces.push({
          allowed: allowedToolNames.has(toolName),
          args: summarizeToolArgs(toolName, argsForTrace),
          ...(toolError ? { error: toolError.slice(0, 500) } : {}),
          index: toolTraces.length + 1,
          name: toolName,
          resultSummary: summarizeToolResult(resultStr),
          success: toolSuccess,
        });

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: resultStr,
        });
      }
      rounds++;
    } else {
      break;
    }
  }

  const finalMessage = messages[messages.length - 1];
  if (!finalMessage || finalMessage.role !== 'assistant' || typeof finalMessage.content !== 'string') {
    throw new Error('LLM did not return a final response containing text');
  }

  const jsonText = extractJson(finalMessage.content);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`Failed to parse LLM response as JSON: ${err instanceof Error ? err.message : String(err)}\nRaw content: ${finalMessage.content}`);
  }

  const validation = validateAgenticCodingEditProposal(parsed);
  if (!validation.success) {
    throw new Error(`Edit proposal validation failed: ${validation.errors.join(' | ')}`);
  }

  return {
    proposal: validation.proposal,
    trace: {
      fleet: buildFleetTrace(dispatch, toolTraces),
      generatedAt: new Date().toISOString(),
      kind: 'agentic-coding-edit-proposal-producer-trace',
      maxToolRounds,
      messageRounds: rounds,
      schemaVersion: 1,
      source: {
        repo,
        taskFile: dispatch.input.taskFile,
      },
      toolCalls: toolTraces,
    },
  };
}

export async function generateEditProposal(
  dispatch: AgenticCodingEditProposalProducerDispatch,
  customClient?: CodeBuddyClient
): Promise<AgenticCodingEditProposal> {
  const generated = await generateEditProposalWithTrace(dispatch, customClient);
  return generated.proposal;
}
