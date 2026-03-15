/**
 * Test the V2 generic docs pipeline on Code Buddy itself.
 * Usage: npx tsx scripts/run-docs-v2.ts [--with-llm]
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(projectRoot, '.env') });

const withLLM = process.argv.includes('--with-llm');

async function main() {
  console.log('=== Docs Pipeline V2 — Generic DeepWiki ===\n');

  // Populate graph
  console.log('[0] Populating code graph...');
  const { getKnowledgeGraph } = await import('../src/knowledge/knowledge-graph.js');
  const { populateDeepCodeGraph } = await import('../src/knowledge/code-graph-deep-populator.js');
  const graph = getKnowledgeGraph();
  const added = populateDeepCodeGraph(graph, projectRoot);
  console.log(`  → ${added} triples\n`);

  // Set up LLM if requested
  let llmCall: ((sys: string, user: string, thinking?: string) => Promise<string>) | undefined;
  if (withLLM) {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) { console.log('No GOOGLE_API_KEY — running without LLM'); }
    else {
      const model = 'gemini-3.1-flash-lite-preview';
      const baseURL = 'https://generativelanguage.googleapis.com/v1beta';
      console.log(`LLM: ${model}\n`);
      llmCall = async (sys: string, user: string): Promise<string> => {
        const res = await fetch(`${baseURL}/models/${model}:generateContent?key=${apiKey}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: user }] }],
            systemInstruction: { parts: [{ text: sys }] },
            generationConfig: { temperature: 0.2, maxOutputTokens: 8000, thinkingConfig: { thinkingLevel: 'high' } },
          }),
        });
        if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).substring(0, 300)}`);
        const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
        return data.candidates?.[0]?.content?.parts?.filter((p: { text?: string }) => p.text).map((p: { text?: string }) => p.text).join('') ?? '';
      };
    }
  }

  const { runDocsPipeline } = await import('../src/docs/docs-pipeline.js');
  const result = await runDocsPipeline(graph, {
    cwd: projectRoot,
    llmCall,
    onProgress: (phase, detail) => console.log(`  [${phase}] ${detail}`),
  });

  console.log(`\n=== Done in ${(result.durationMs / 1000).toFixed(1)}s ===`);
  console.log(`  Pages: ${result.pagesGenerated}`);
  console.log(`  Concepts linked: ${result.conceptsLinked}`);
  console.log(`  Files: ${result.files.join(', ')}`);
  if (result.errors.length > 0) console.log(`  Errors: ${result.errors.join('; ')}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
