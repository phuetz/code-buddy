/**
 * /docs slash command — Generate DeepWiki-style documentation
 *
 * Usage:
 *   /docs generate           — Generate full documentation
 *   /docs generate --no-diagrams  — Skip mermaid diagrams
 *   /docs generate --no-metrics   — Skip code quality metrics
 *   /docs status             — Show generation status
 */

import { logger } from '../../utils/logger.js';

export interface DocsCommandResult {
  output: string;
  success: boolean;
}

/**
 * Handle /docs command
 */
export async function handleDocsCommand(args: string): Promise<DocsCommandResult> {
  const parts = args.trim().split(/\s+/);
  const subcommand = parts[0] || 'generate';

  if (subcommand === 'status') {
    return handleStatus();
  }

  if (subcommand === 'generate') {
    const noDiagrams = parts.includes('--no-diagrams');
    const noMetrics = parts.includes('--no-metrics');
    const withLLM = parts.includes('--with-llm');
    const useV2 = parts.includes('--v2');

    // Parse --thinking level
    const thinkingIdx = parts.indexOf('--thinking');
    const thinkingLevel = thinkingIdx >= 0 ? parts[thinkingIdx + 1] as 'minimal' | 'low' | 'medium' | 'high' : undefined;

    // V2 pipeline — generic DeepWiki-style
    if (useV2) {
      return handleGenerateV2(withLLM, thinkingLevel);
    }

    if (withLLM) {
      return handleGenerateWithLLM(thinkingLevel);
    }
    return handleGenerate(noDiagrams, noMetrics);
  }

  return {
    output: 'Usage: /docs generate [--v2] [--with-llm] [--thinking level] [--no-diagrams] [--no-metrics] | /docs status',
    success: false,
  };
}

async function handleGenerate(noDiagrams: boolean, noMetrics: boolean): Promise<DocsCommandResult> {
  try {
    // Load and populate the graph
    const { getKnowledgeGraph } = await import('../../knowledge/knowledge-graph.js');
    const graph = getKnowledgeGraph();

    if (graph.getStats().tripleCount === 0) {
      // Try to populate the graph first
      try {
        const { populateDeepCodeGraph } = await import('../../knowledge/code-graph-deep-populator.js');
        const added = populateDeepCodeGraph(graph, process.cwd());
        logger.info(`Docs: populated code graph with ${added} triples`);
      } catch (e) {
        return {
          output: `Code graph is empty and could not be populated: ${e instanceof Error ? e.message : String(e)}. Run the code_graph tool first.`,
          success: false,
        };
      }
    }

    const { generateDocs } = await import('../../docs/docs-generator.js');
    const result = await generateDocs(graph, {
      includeDiagrams: !noDiagrams,
      includeMetrics: !noMetrics,
    });

    const output = [
      `Documentation generated in ${result.durationMs}ms:`,
      `  Files: ${result.files.join(', ')}`,
      `  Entities documented: ${result.entityCount}`,
      `  Output: .codebuddy/docs/`,
      result.errors.length > 0 ? `  Errors: ${result.errors.join('; ')}` : '',
    ].filter(Boolean).join('\n');

    return { output, success: true };
  } catch (err) {
    return {
      output: `Documentation generation failed: ${err instanceof Error ? err.message : String(err)}`,
      success: false,
    };
  }
}

async function handleGenerateWithLLM(thinkingLevelOverride?: 'minimal' | 'low' | 'medium' | 'high'): Promise<DocsCommandResult> {
  try {
    // Step 1: Generate raw docs first (fast, no LLM needed)
    const rawResult = await handleGenerate(false, false);
    if (!rawResult.success) return rawResult;

    // Step 2: Set up LLM client for enrichment (use OpenAI SDK directly for reliability)
    const apiKey = process.env.GROK_API_KEY || process.env.GOOGLE_API_KEY || process.env.OPENAI_API_KEY || '';
    if (!apiKey) {
      return {
        output: rawResult.output + '\n\n(LLM enrichment skipped — no API key. Set GROK_API_KEY, GOOGLE_API_KEY, or OPENAI_API_KEY.)',
        success: true,
      };
    }

    // Determine model and provider
    const isGemini = !!(process.env.GOOGLE_API_KEY && !process.env.GROK_API_KEY);
    const isOpenAI = !!(process.env.OPENAI_API_KEY && !process.env.GROK_API_KEY && !process.env.GOOGLE_API_KEY);

    let model = process.env.GROK_MODEL || 'grok-3-latest';
    if (isGemini) model = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite-preview';
    if (isOpenAI) model = 'gpt-4o-mini';

    let llmCall: (sys: string, user: string, thinking?: string) => Promise<string>;

    if (isGemini) {
      // Native Gemini API — supports thinkingLevel
      const geminiBaseURL = 'https://generativelanguage.googleapis.com/v1beta';
      llmCall = async (systemPrompt: string, userPrompt: string, thinkingLevel?: string): Promise<string> => {
        const generationConfig: Record<string, unknown> = {
          temperature: 0.2,
          maxOutputTokens: 5000,
        };
        if (thinkingLevel) {
          generationConfig.thinkingConfig = { thinkingLevel };
        }

        const res = await fetch(
          `${geminiBaseURL}/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
              systemInstruction: { parts: [{ text: systemPrompt }] },
              generationConfig,
            }),
          },
        );
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Gemini ${res.status}: ${errText.substring(0, 200)}`);
        }
        const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
        return data.candidates?.[0]?.content?.parts
          ?.filter((p: { text?: string }) => p.text)
          .map((p: { text?: string }) => p.text)
          .join('') ?? '';
      };
    } else {
      // OpenAI-compatible (Grok, OpenAI, LM Studio)
      let baseURL = process.env.GROK_BASE_URL || 'https://api.x.ai/v1';
      if (isOpenAI) baseURL = 'https://api.openai.com/v1';
      const OpenAI = (await import('openai')).default;
      const openaiClient = new OpenAI({ apiKey, baseURL });

      llmCall = async (systemPrompt: string, userPrompt: string): Promise<string> => {
        const response = await openaiClient.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 5000,
          temperature: 0.2,
        });
        return response.choices[0]?.message?.content ?? '';
      };
    }

    // Step 3: Build blueprint for verified entity context (improvement A + E)
    let blueprintContext: string | undefined;
    let verifiedEntities: Set<string> | undefined;
    try {
      const { getKnowledgeGraph } = await import('../../knowledge/knowledge-graph.js');
      const graph = getKnowledgeGraph();
      const { buildProjectBlueprint, serializeBlueprintForLLM } = await import('../../docs/blueprint-builder.js');
      const blueprint = buildProjectBlueprint(graph);
      blueprintContext = serializeBlueprintForLLM(blueprint);
      verifiedEntities = blueprint.allEntities;
      logger.info(`Blueprint: ${blueprint.moduleCount} modules, ${blueprint.functionCount} functions, ${blueprint.classCount} classes`);
    } catch (e) {
      logger.debug(`Blueprint build skipped: ${e}`);
    }

    // Step 4: Enrich raw docs with LLM prose
    const docsDir = require('path').join(process.cwd(), '.codebuddy', 'docs');
    const { enrichDocs } = await import('../../docs/llm-enricher.js');
    const result = await enrichDocs({
      docsDir,
      llmCall,
      thinkingLevel: thinkingLevelOverride,
      blueprintContext,
      verifiedEntities,
      onProgress: (file, current, total) => {
        logger.info(`Enriching [${current}/${total}] ${file}`);
      },
    });

    const output = [
      `Documentation generated and enriched with LLM:`,
      `  LLM enrichment: ${result.filesEnriched} files enriched in ${(result.durationMs / 1000).toFixed(1)}s`,
      `  Tokens used: ~${result.tokensUsed}`,
      `  Hallucinations fixed: ${result.hallucinationsFixed}`,
      `  Knowledge file: ${result.knowledgePath}`,
      `  Output: .codebuddy/docs/`,
      result.errors.length > 0 ? `  Errors: ${result.errors.join('; ')}` : '',
    ].filter(Boolean).join('\n');

    return { output, success: true };
  } catch (err) {
    return { output: `LLM docs generation failed: ${err instanceof Error ? err.message : String(err)}`, success: false };
  }
}

async function handleGenerateV2(withLLM: boolean, thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high'): Promise<DocsCommandResult> {
  try {
    // Populate graph
    const { getKnowledgeGraph } = await import('../../knowledge/knowledge-graph.js');
    const graph = getKnowledgeGraph();
    if (graph.getStats().tripleCount === 0) {
      try {
        const { populateDeepCodeGraph } = await import('../../knowledge/code-graph-deep-populator.js');
        populateDeepCodeGraph(graph, process.cwd());
      } catch (e) {
        return { output: `Code graph empty: ${e instanceof Error ? e.message : String(e)}`, success: false };
      }
    }

    // Set up LLM if requested
    let llmCall: ((sys: string, user: string, thinking?: string) => Promise<string>) | undefined;
    if (withLLM) {
      const apiKey = process.env.GROK_API_KEY || process.env.GOOGLE_API_KEY || process.env.OPENAI_API_KEY || '';
      if (apiKey) {
        const isGemini = !!(process.env.GOOGLE_API_KEY && !process.env.GROK_API_KEY);
        const isOpenAI = !!(process.env.OPENAI_API_KEY && !process.env.GROK_API_KEY && !process.env.GOOGLE_API_KEY);
        let model = process.env.GROK_MODEL || 'grok-3-latest';
        if (isGemini) model = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite-preview';
        if (isOpenAI) model = 'gpt-4o-mini';

        if (isGemini) {
          const baseURL = 'https://generativelanguage.googleapis.com/v1beta';
          llmCall = async (sys: string, user: string, _thinking?: string): Promise<string> => {
            const res = await fetch(`${baseURL}/models/${model}:generateContent?key=${apiKey}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: user }] }],
                systemInstruction: { parts: [{ text: sys }] },
                generationConfig: { temperature: 0.2, maxOutputTokens: 8000 },
              }),
            });
            if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).substring(0, 200)}`);
            const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
            return data.candidates?.[0]?.content?.parts?.filter((p: { text?: string }) => p.text).map((p: { text?: string }) => p.text).join('') ?? '';
          };
        } else {
          let baseURL = process.env.GROK_BASE_URL || 'https://api.x.ai/v1';
          if (isOpenAI) baseURL = 'https://api.openai.com/v1';
          const OpenAI = (await import('openai')).default;
          const client = new OpenAI({ apiKey, baseURL });
          llmCall = async (sys: string, user: string): Promise<string> => {
            const r = await client.chat.completions.create({
              model, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
              max_tokens: 8000, temperature: 0.2,
            });
            return r.choices[0]?.message?.content ?? '';
          };
        }
      }
    }

    // Run the V2 pipeline
    const { runDocsPipeline } = await import('../../docs/docs-pipeline.js');
    const result = await runDocsPipeline(graph, {
      cwd: process.cwd(),
      llmCall,
      config: thinkingLevel ? { thinkingLevel } : undefined,
      onProgress: (phase, detail) => {
        logger.info(`[${phase}] ${detail}`);
      },
    });

    const output = [
      `Documentation V2 generated:`,
      `  Pages: ${result.pagesGenerated}`,
      `  Concepts linked: ${result.conceptsLinked}`,
      `  Duration: ${(result.durationMs / 1000).toFixed(1)}s`,
      `  Output: .codebuddy/docs/`,
      result.errors.length > 0 ? `  Errors: ${result.errors.slice(0, 5).join('; ')}` : '',
    ].filter(Boolean).join('\n');

    return { output, success: true };
  } catch (err) {
    return { output: `V2 pipeline failed: ${err instanceof Error ? err.message : String(err)}`, success: false };
  }
}

async function handleStatus(): Promise<DocsCommandResult> {
  const fs = await import('fs');
  const path = await import('path');
  const docsDir = path.join(process.cwd(), '.codebuddy', 'docs');

  if (!fs.existsSync(docsDir)) {
    return {
      output: 'No documentation generated yet. Run /docs generate first.',
      success: true,
    };
  }

  const files = fs.readdirSync(docsDir).filter((f: string) => f.endsWith('.md'));
  const totalSize = files.reduce((sum: number, f: string) => {
    return sum + fs.statSync(path.join(docsDir, f)).size;
  }, 0);

  return {
    output: [
      `Documentation directory: .codebuddy/docs/`,
      `Files: ${files.length}`,
      `Total size: ${(totalSize / 1024).toFixed(1)} KB`,
      `Files: ${files.join(', ')}`,
    ].join('\n'),
    success: true,
  };
}
