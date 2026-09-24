import { CommandHandlerResult } from './core-handlers.js';
import { logger } from '../../utils/logger.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getWorkspaceIndexer } from '../../knowledge/workspace-indexer.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { failureFlag } from '../slash-failure.js';

const execAsync = promisify(exec);

export async function handleUltraplan(args: string[], onProgress?: (msg: string) => void): Promise<CommandHandlerResult> {
  const prompt = args.join(' ');
  if (!prompt) {
    return {
      handled: true,
...failureFlag('Please provide a prompt for Ultraplan. Example: /ultraplan create a robust auth system'),
      entry: { type: 'assistant', content: 'Please provide a prompt for Ultraplan. Example: /ultraplan create a robust auth system', timestamp: new Date() }
    };
  }

  const API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!API_KEY) {
    return {
      handled: true,
...failureFlag('API_KEY is missing. Please set GOOGLE_API_KEY or GEMINI_API_KEY.'),
      entry: { type: 'assistant', content: 'API_KEY is missing. Please set GOOGLE_API_KEY or GEMINI_API_KEY.', timestamp: new Date() }
    };
  }

  const genAI = new GoogleGenerativeAI(API_KEY);
  
  const logProgress = (msg: string) => {
      if (onProgress) {
          onProgress(msg);
      } else {
          process.stdout.write(msg);
      }
  };

  logProgress('\n🚀 \x1b[1mStarting Ultraplan (Parallel Best-of-N Execution)\x1b[0m\n');
  logProgress('Spawning 3 specialized sub-agents (Performance, Security, Simplicity)...\n\n');

  const tools = {
    read_file: async ({ file_path }: { file_path: string }) => {
      try {
        const content = await fs.readFile(file_path, 'utf8');
        return { content: content.slice(0, 10000) };
      } catch (error: any) {
        return { error: error.message };
      }
    },
    semantic_search: async ({ query }: { query: string }) => {
      try {
        const results = await getWorkspaceIndexer().search(query, 3);
        return { results: results.map(r => r.filePath) };
      } catch (error: any) {
        return { error: error.message };
      }
    }
  };

  const functionDeclarations = [
    {
      name: "read_file",
      description: "Reads the content of a file.",
      parameters: { type: "object", properties: { file_path: { type: "string" } }, required: ["file_path"] },
    },
    {
      name: "semantic_search",
      description: "Search the workspace semantically.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    }
  ];

  const specialties = ['performance', 'security', 'simplicity'];
  const parallelPromises = specialties.map(async (specialty) => {
      let specialtyFocus = "";
      if (specialty === "performance") specialtyFocus = "Your exclusive focus is highly optimized PERFORMANCE. Architecture must be blazingly fast and scalable.";
      if (specialty === "security") specialtyFocus = "Your exclusive focus is military-grade SECURITY. Architecture must be bulletproof against all attack vectors.";
      if (specialty === "simplicity") specialtyFocus = "Your exclusive focus is extreme SIMPLICITY. Architecture must be minimal, readable, and elegant.";

      const systemPrompt = `You are a Code Buddy sub-agent. ${specialtyFocus}\nUse read-only tools to explore the codebase, then create a detailed execution plan for the user's prompt.`;

      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        systemInstruction: systemPrompt,
        tools: [{ functionDeclarations }] as any,
      });

      const chat = model.startChat();
      let step = 0;
      let currentMsg: any = prompt;
      let finalPlan = "";
      
      while (step < 3) {
          step++;
          const result = await chat.sendMessage(currentMsg);
          const calls = result.response.functionCalls();
          if (!calls || calls.length === 0) {
              finalPlan = result.response.text();
              break;
          }
          const responses = [];
          for (const call of calls) {
              if ((tools as any)[call.name]) {
                  responses.push({ functionResponse: { name: call.name, response: await (tools as any)[call.name](call.args as any) } });
              } else {
                  responses.push({ functionResponse: { name: call.name, response: { error: "Tool not found" } } });
              }
          }
          currentMsg = responses as any;
      }
      
      if (!finalPlan) finalPlan = "Plan exploration timed out.";
      logProgress(`  ✅ Agent \x1b[32m${specialty}\x1b[0m completed its plan.\n`);
      return { specialty, plan: finalPlan };
  });

  const plans = await Promise.all(parallelPromises);
  
  logProgress('\n⚖️ \x1b[1mAll plans generated. The Judge model is evaluating the best path...\x1b[0m\n\n');
  
  const judgePrompt = `The user requested: "${prompt}".\n\nHere are 3 potential implementation plans generated by specialized sub-agents:\n\n${plans.map(p => `### Plan (${p.specialty.toUpperCase()}):\n${p.plan}\n`).join('\n')}\n\nPlease synthesize these into the single ultimate, safest, and most robust execution plan formatted as markdown.`;
  
  const judgeModel = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
  const judgeStream = await judgeModel.generateContentStream(judgePrompt);
  
  let finalText = "";
  for await (const chunk of judgeStream.stream) {
      const text = chunk.text();
      if (text) {
          finalText += text;
          logProgress(text);
      }
  }
  logProgress('\n');

  return {
    handled: true,
...failureFlag(finalText),
    entry: { type: 'assistant', content: finalText, timestamp: new Date() }
  };
}
