import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { CodeBuddyClient, CodeBuddyMessage } from '../../codebuddy/client.js';
import { createAuxiliaryClient } from '../../providers/auxiliary-llm.js';
import { AgenticCodingTaskContract } from './agentic-coding-contract.js';
import { extractJson } from './edit-proposal-producer.js';

export interface DecomposedSubTask {
  title: string;
  task: string;
  allowedPaths: string[];
  verification: string[];
}

export function shouldDecompose(contract: AgenticCodingTaskContract): boolean {
  if (contract.allowedPaths.length > 2) {
    return true;
  }
  const taskLower = contract.task.toLowerCase();
  if (
    taskLower.includes('step 1') ||
    taskLower.includes('step 2') ||
    taskLower.includes('then ') ||
    taskLower.includes('firstly') ||
    taskLower.includes('secondly')
  ) {
    return true;
  }
  return false;
}

export async function decomposeTask(
  contract: AgenticCodingTaskContract,
  customClient?: CodeBuddyClient
): Promise<AgenticCodingTaskContract[]> {
  let client: CodeBuddyClient;
  if (customClient) {
    client = customClient;
  } else {
    const resolved = createAuxiliaryClient('decompose');
    if (!resolved) {
      throw new Error('No LLM provider configuration found in environment.');
    }
    client = resolved;
  }

  const systemPrompt = `You are a Senior software architect who decomposes large, complex coding tasks into a sequence of smaller, independent, and verifiable sub-tasks.
Each sub-task will be executed as an autonomous coding run.
The output MUST be a JSON object conforming to the following structure:
{
  "summary": "High-level summary of the decomposition plan",
  "subtasks": [
    {
      "title": "Sub-task title",
      "task": "Clear instructions for this specific sub-task",
      "allowedPaths": ["subset/path/to/file.ts"],
      "verification": ["verification command to run for this sub-task"]
    }
  ]
}

Constraints:
1. "allowedPaths" for each sub-task MUST be a subset of the original task's allowedPaths: ${JSON.stringify(contract.allowedPaths)}.
2. The verification commands should be relevant to the sub-task. They can be a subset of the original verification commands: ${JSON.stringify(contract.verification)}.
3. Sub-tasks must be ordered sequentially such that executing them one by one achieves the goal of the original task.`;

  const userPrompt = `Original Task description:
${contract.task}

Please decompose this task into a sequential list of sub-tasks.`;

  const messages: CodeBuddyMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  const response = await client.chat(messages);
  const choice = response.choices?.[0];
  if (!choice || !choice.message?.content) {
    throw new Error('Failed to get decomposition from LLM client');
  }

  const jsonText = extractJson(choice.message.content);
  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`Failed to parse decomposition JSON: ${err instanceof Error ? err.message : String(err)}\nRaw content: ${choice.message.content}`);
  }

  if (!parsed.subtasks || !Array.isArray(parsed.subtasks) || parsed.subtasks.length === 0) {
    return [contract];
  }

  const subContracts: AgenticCodingTaskContract[] = [];
  for (const sub of parsed.subtasks) {
    const filteredAllowedPaths = (sub.allowedPaths || []).filter((p: string) =>
      contract.allowedPaths.includes(p)
    );

    subContracts.push({
      ...contract,
      task: `${sub.title}: ${sub.task}`,
      allowedPaths: filteredAllowedPaths.length > 0 ? filteredAllowedPaths : contract.allowedPaths,
      verification: sub.verification && Array.isArray(sub.verification) && sub.verification.length > 0 ? sub.verification : contract.verification,
      edits: [],
    });
  }

  return subContracts;
}
