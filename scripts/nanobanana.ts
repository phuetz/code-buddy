import fs from 'fs';
import path from 'path';

// This script simulates "Nanobanana", the tool requested to generate images.
// It generates SVG diagrams based on descriptions.

const IMAGES_DIR = path.join(process.cwd(), 'docs/livre/images');

if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

interface DiagramSpec {
  name: string;
  type: 'box' | 'tree' | 'timeline' | 'pyramid' | 'spectrum' | 'flow' | 'chart' | 'matrix';
  title: string;
  data: any;
}

const specs: DiagramSpec[] = [
  // Chapter 2
  {
    name: 'pyramide_ia',
    type: 'pyramid',
    title: 'Pyramide de l\'IA Appliquée',
    data: [
      { label: 'NIVEAU 4 : MULTI-AGENTS', detail: 'Collaboration', color: '#FF6B6B' },
      { label: 'NIVEAU 3 : AGENT AUTONOME', detail: 'Boucle autonome', color: '#4ECDC4' },
      { label: 'NIVEAU 2 : ASSISTANT AUGMENTÉ', detail: 'Aide l\'humain', color: '#45B7D1' },
      { label: 'NIVEAU 1 : CHATBOT', detail: 'Conversation simple', color: '#96CEB4' }
    ]
  },
  {
    name: 'spectre_autonomie',
    type: 'spectrum',
    title: 'Spectre de l\'Autonomie',
    data: {
      left: 'Aucune autonomie',
      right: 'Autonomie totale',
      steps: [
        { label: 'Chatbot', desc: 'L\'humain décide tout', x: 10 },
        { label: 'Assistant', desc: 'L\'humain guide', x: 35 },
        { label: 'Agent', desc: 'L\'humain supervise', x: 65 },
        { label: 'AGI?', desc: 'Autonomie complète', x: 90 }
      ]
    }
  },
  {
    name: 'chronologie_ia',
    type: 'timeline',
    title: 'Chronologie des Innovations 2020-2025',
    data: [
      { year: '2020', label: 'GPT-3', desc: 'Fondations' },
      { year: '2022', label: 'ChatGPT', desc: 'Grand Public' },
      { year: '2023', label: 'GPT-4 / AutoGPT', desc: 'Outils & Agents' },
      { year: '2024', label: 'Claude 3 / MCP', desc: 'Contexte & Standards' },
      { year: '2025', label: 'Grok-CLI', desc: 'Maturité Open Source' }
    ]
  },
  // Chapter 3
  {
    name: 'architecture_globale',
    type: 'box',
    title: 'Architecture Agent Cognitif',
    data: {
      nodes: [
        { id: 'UI', label: 'INTERFACE UTILISATEUR', x: 300, y: 50, w: 400, h: 60, type: 'input' },
        { id: 'ORCH', label: 'ORCHESTRATEUR', x: 300, y: 150, w: 400, h: 60, type: 'core' },
        { id: 'REAS', label: 'REASONING', x: 100, y: 300, w: 120, h: 80, type: 'component' },
        { id: 'MEM', label: 'MEMORY', x: 230, y: 300, w: 120, h: 80, type: 'component' },
        { id: 'ACT', label: 'ACTION', x: 360, y: 300, w: 120, h: 80, type: 'component' },
        { id: 'LEARN', label: 'LEARNING', x: 490, y: 300, w: 120, h: 80, type: 'component' },
        { id: 'SEC', label: 'SECURITY', x: 620, y: 300, w: 120, h: 80, type: 'component' },
        { id: 'PERS', label: 'PERSISTANCE', x: 300, y: 450, w: 600, h: 60, type: 'storage' }
      ],
      edges: [
        { from: 'UI', to: 'ORCH' },
        { from: 'ORCH', to: 'REAS' },
        { from: 'ORCH', to: 'MEM' },
        { from: 'ORCH', to: 'ACT' },
        { from: 'ORCH', to: 'LEARN' },
        { from: 'ORCH', to: 'SEC' },
        { from: 'REAS', to: 'PERS' },
        { from: 'MEM', to: 'PERS' },
        { from: 'ACT', to: 'PERS' },
        { from: 'LEARN', to: 'PERS' },
        { from: 'SEC', to: 'PERS' }
      ]
    }
  },
  {
    name: 'boucle_react',
    type: 'flow',
    title: 'Boucle Agentique ReAct',
    data: {
      steps: ['PERCEIVE', 'THINK', 'DECIDE', 'ACT', 'OBSERVE'],
      loop: true
    }
  },
  {
    name: 'pipeline_rag',
    type: 'flow',
    title: 'Pipeline RAG Moderne',
    data: {
      steps: ['QUERY', 'EMBED', 'SEARCH', 'EXPAND', 'RERANK', 'CONTEXT'],
      loop: false
    }
  },
    {
    name: 'flux_execution_outil',
    type: 'flow',
    title: 'Flux Execution Outil',
    data: {
      steps: ['REQUEST', 'VALIDATE', 'SECURITY CHECK', 'CONFIRMATION', 'EXECUTE', 'RESULT'],
      loop: false
    }
  },
  // Chapter 4
  {
    name: 'tot_vs_cot',
    type: 'tree',
    title: 'Tree-of-Thought vs Linear',
    data: {
      root: 'Problème',
      children: [
        { label: 'Piste A (0.3)', children: [{ label: 'Échec', color: 'red' }] },
        { label: 'Piste B (0.7)', children: [
            { label: 'B.1 (0.4)', color: 'red' },
            { label: 'B.2 (0.9)', color: 'green', children: [{label: 'Solution', color: 'green'}] }
        ] }
      ]
    }
  },
  // Chapter 5: MCTS
  {
    name: 'mcts_cycle',
    type: 'flow',
    title: 'Cycle MCTS: 4 Phases',
    data: {
      steps: ['SELECT', 'EXPAND', 'SIMULATE', 'BACKPROP'],
      loop: true
    }
  },
  {
    name: 'limit_eval_locale',
    type: 'tree',
    title: 'Limite Evaluation Locale',
    data: {
      root: 'Problème',
      children: [
        { label: 'Piste A (0.8)', color: 'green', children: [{ label: 'Impasse (0.1)', color: 'red' }] },
        { label: 'Piste B (0.5)', color: 'orange', children: [{ label: 'Succès (1.0)', color: 'green' }] }
      ]
    }
  },
  {
    name: 'hybrid_pipeline',
    type: 'box',
    title: 'Pipeline Hybride ToT + MCTS',
    data: {
      nodes: [
        { id: 'TOT', label: 'ToT Exploration', x: 300, y: 50, w: 200, h: 60, type: 'core' },
        { id: 'CANDS', label: 'Top 3 Candidats', x: 300, y: 150, w: 200, h: 60, type: 'storage' },
        { id: 'MCTS1', label: 'MCTS A', x: 100, y: 300, w: 100, h: 60, type: 'component' },
        { id: 'MCTS2', label: 'MCTS B', x: 350, y: 300, w: 100, h: 60, type: 'component' },
        { id: 'MCTS3', label: 'MCTS C', x: 600, y: 300, w: 100, h: 60, type: 'component' },
        { id: 'BEST', label: 'Meilleure Solution', x: 300, y: 450, w: 200, h: 60, type: 'core' }
      ],
      edges: [
        { from: 'TOT', to: 'CANDS' },
        { from: 'CANDS', to: 'MCTS1' },
        { from: 'CANDS', to: 'MCTS2' },
        { from: 'CANDS', to: 'MCTS3' },
        { from: 'MCTS1', to: 'BEST' },
        { from: 'MCTS2', to: 'BEST' },
        { from: 'MCTS3', to: 'BEST' }
      ]
    }
  },
  // Chapter 6: Repair
  {
    name: 'single_shot_vs_iterative',
    type: 'chart',
    title: 'Single-Shot vs Iterative Success',
    data: {
      labels: ['Single-Shot', 'Iterative (ChatRepair)'],
      values: [15, 40],
      colors: ['#FF6B6B', '#4ECDC4']
    }
  },
  {
    name: 'chatrepair_loop',
    type: 'flow',
    title: 'Boucle ChatRepair',
    data: {
      steps: ['LOCALIZE', 'GENERATE', 'VALIDATE', 'FEEDBACK'],
      loop: true
    }
  },
  {
    name: 'sbfl_matrix',
    type: 'matrix',
    title: 'SBFL: Suspicion Matrix',
    data: {
      rows: ['Line 10', 'Line 11', 'Line 12 (Bug)', 'Line 13'],
      cols: ['Test 1 (Pass)', 'Test 2 (Fail)', 'Test 3 (Pass)', 'Test 4 (Fail)', 'Suspicion'],
      cells: [
        ['✓', '✓', '✓', '✓', '0.25'],
        ['✓', '✓', '', '✓', '0.45'],
        ['', '✓', '', '✓', '0.90'],
        ['✓', '✓', '✓', '', '0.30']
      ]
    }
  },
  // Chapter 7: RAG
  {
    name: 'llm_limits',
    type: 'box',
    title: 'Limites du LLM Seul',
    data: {
      nodes: [
        { id: 'LLM', label: 'LLM (Training Data)', x: 300, y: 200, w: 200, h: 80, type: 'core' },
        { id: 'OLD', label: '⚠️ Connaissance Figée', x: 50, y: 50, w: 200, h: 60, type: 'component' },
        { id: 'PRIV', label: '⚠️ Pas de Code Privé', x: 550, y: 50, w: 200, h: 60, type: 'component' },
        { id: 'CTX', label: '⚠️ Contexte Limité', x: 50, y: 350, w: 200, h: 60, type: 'component' },
        { id: 'COST', label: '⚠️ Coût Token', x: 550, y: 350, w: 200, h: 60, type: 'component' }
      ],
      edges: [
        { from: 'LLM', to: 'OLD' },
        { from: 'LLM', to: 'PRIV' },
        { from: 'LLM', to: 'CTX' },
        { from: 'LLM', to: 'COST' }
      ]
    }
  },
  {
    name: 'embeddings_viz',
    type: 'box',
    title: 'Visualisation Embeddings',
    data: {
      nodes: [
        { id: 'Q', label: 'Query: calculateTotal', x: 100, y: 200, w: 150, h: 40, type: 'input' },
        { id: 'A', label: 'computeSum', x: 400, y: 150, w: 120, h: 40, type: 'component' },
        { id: 'B', label: 'sumPrices', x: 400, y: 200, w: 120, h: 40, type: 'component' },
        { id: 'C', label: 'sendEmail', x: 600, y: 300, w: 120, h: 40, type: 'component' }
      ],
      edges: [
        { from: 'Q', to: 'A', label: '0.85' },
        { from: 'Q', to: 'B', label: '0.82' },
        { from: 'Q', to: 'C', label: '0.12' }
      ]
    }
  },
  {
    name: 'rag_pipeline_detail',
    type: 'flow',
    title: 'Pipeline RAG Complet',
    data: {
      steps: ['PARSE AST', 'CHUNK', 'EMBED', 'INDEX', 'RETRIEVE', 'RERANK', 'AUGMENT', 'GENERATE'],
      loop: false
    }
  },
  {
    name: 'hybrid_retrieval',
    type: 'box',
    title: 'Retrieval Hybride',
    data: {
       nodes: [
        { id: 'Q', label: 'Query', x: 300, y: 50, w: 100, h: 40, type: 'input' },
        { id: 'SEM', label: 'Semantic (Vector)', x: 150, y: 150, w: 150, h: 60, type: 'component' },
        { id: 'KEY', label: 'Keyword (BM25)', x: 450, y: 150, w: 150, h: 60, type: 'component' },
        { id: 'FUSE', label: 'RRF Fusion', x: 300, y: 300, w: 200, h: 60, type: 'core' },
        { id: 'RES', label: 'Final Results', x: 300, y: 400, w: 200, h: 60, type: 'storage' }
       ],
       edges: [
         { from: 'Q', to: 'SEM' },
         { from: 'Q', to: 'KEY' },
         { from: 'SEM', to: 'FUSE' },
         { from: 'KEY', to: 'FUSE' },
         { from: 'FUSE', to: 'RES' }
       ]
    }
  }
];

function generateSVG(spec: DiagramSpec): string {
  const width = 800;
  const height = spec.type === 'box' || spec.type === 'matrix' ? 500 : 400;

  let content = '';

  const style = `
    <style>
      .text { font-family: sans-serif; fill: #eee; }
      .title { font-size: 24px; font-weight: bold; text-anchor: middle; fill: #fff; }
      .label { font-size: 14px; text-anchor: middle; }
      .desc { font-size: 10px; fill: #aaa; text-anchor: middle; }
      .box { fill: #2d2d2d; stroke: #4ECDC4; stroke-width: 2; }
      .line { stroke: #666; stroke-width: 2; }
    </style>
  `;

  if (spec.type === 'pyramid') {
    const levels = spec.data.length;
    content = spec.data.map((item: any, i: number) => {
      const y = 50 + i * (300 / levels);
      const w = 200 + i * 100;
      const x = (width - w) / 2;
      const h = 300 / levels;
      return `
        <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${item.color}" opacity="0.8" />
        <text x="${width/2}" y="${y + h/2}" class="text label" fill="black" style="fill: black; font-weight: bold;">${item.label}</text>
        <text x="${width/2}" y="${y + h/2 + 15}" class="text desc" fill="#333" style="fill: #333;">${item.detail}</text>
      `;
    }).join('');
  } else if (spec.type === 'spectrum') {
    content = `
      <line x1="50" y1="200" x2="750" y2="200" stroke="#fff" stroke-width="4" />
      <text x="50" y="230" class="text" text-anchor="start">${spec.data.left}</text>
      <text x="750" y="230" class="text" text-anchor="end">${spec.data.right}</text>
      ${spec.data.steps.map((step: any) => `
        <circle cx="${50 + (step.x/100)*700}" cy="200" r="10" fill="#4ECDC4" />
        <text x="${50 + (step.x/100)*700}" y="180" class="text label">${step.label}</text>
        <text x="${50 + (step.x/100)*700}" y="250" class="text desc">${step.desc}</text>
      `).join('')}
    `;
  } else if (spec.type === 'timeline') {
    content = `
      <line x1="50" y1="200" x2="750" y2="200" stroke="#666" stroke-width="4" />
      ${spec.data.map((item: any, i: number) => {
        const x = 50 + i * (700 / (spec.data.length - 1));
        return `
          <circle cx="${x}" cy="200" r="8" fill="#FF6B6B" />
          <text x="${x}" y="170" class="text label" style="font-weight: bold;">${item.year}</text>
          <text x="${x}" y="190" class="text label">${item.label}</text>
          <text x="${x}" y="230" class="text desc">${item.desc}</text>
        `;
      }).join('')}
    `;
  } else if (spec.type === 'box') {
     content = `
       ${spec.data.edges.map((edge: any) => {
         const fromNode = spec.data.nodes.find((n: any) => n.id === edge.from);
         const toNode = spec.data.nodes.find((n: any) => n.id === edge.to);
         if (!fromNode || !toNode) return '';
         const x1 = fromNode.x + fromNode.w/2;
         const y1 = fromNode.y + fromNode.h/2;
         const x2 = toNode.x + toNode.w/2;
         const y2 = toNode.y + toNode.h/2;
         return `
           <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="line" marker-end="url(#arrowhead)" />
           ${edge.label ? `<text x="${(x1+x2)/2}" y="${(y1+y2)/2 - 5}" class="text desc">${edge.label}</text>` : ''}
         `;
       }).join('')}
       ${spec.data.nodes.map((node: any) => `
         <rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" class="box" rx="5" />
         <text x="${node.x + node.w/2}" y="${node.y + node.h/2 + 5}" class="text label">${node.label}</text>
       `).join('')}
     `;
  } else if (spec.type === 'flow') {
    const stepWidth = spec.data.steps.length > 5 ? 80 : 120;
    const gap = 30;
    const startX = (width - (spec.data.steps.length * (stepWidth + gap))) / 2;

    content = spec.data.steps.map((step: string, i: number) => {
       const x = startX + i * (stepWidth + gap);
       return `
         <rect x="${x}" y="150" width="${stepWidth}" height="60" class="box" fill="#333" />
         <text x="${x + stepWidth/2}" y="185" class="text label" font-size="${spec.data.steps.length > 5 ? '10px' : '14px'}">${step}</text>
         ${i < spec.data.steps.length - 1 ?
           `<line x1="${x + stepWidth}" y1="180" x2="${x + stepWidth + gap}" y2="180" class="line" marker-end="url(#arrowhead)" />` : ''}
       `;
    }).join('');

    if (spec.data.loop) {
        const endX = startX + spec.data.steps.length * (stepWidth + gap) - gap;
        content += `
            <path d="M ${endX} 210 Q ${endX} 280, ${width/2} 280 Q ${startX} 280, ${startX + stepWidth/2} 210" fill="none" stroke="#666" stroke-width="2" marker-end="url(#arrowhead)" />
        `;
    }
  } else if (spec.type === 'tree') {
      content = `
        <rect x="350" y="50" width="100" height="40" class="box" />
        <text x="400" y="75" class="text label">${spec.data.root}</text>

        <line x1="400" y1="90" x2="200" y2="150" class="line" />
        <line x1="400" y1="90" x2="600" y2="150" class="line" />

        <rect x="150" y="150" width="100" height="40" class="box" stroke="${spec.data.children[0].color || '#4ECDC4'}" />
        <text x="200" y="175" class="text label">${spec.data.children[0].label}</text>

        <rect x="550" y="150" width="100" height="40" class="box" stroke="${spec.data.children[1].color || '#4ECDC4'}" />
        <text x="600" y="175" class="text label">${spec.data.children[1].label}</text>

        ${spec.data.children[0].children ? `
            <line x1="200" y1="190" x2="200" y2="250" class="line" />
            <rect x="150" y="250" width="100" height="40" class="box" stroke="${spec.data.children[0].children[0].color || '#4ECDC4'}" />
            <text x="200" y="275" class="text label">${spec.data.children[0].children[0].label}</text>
        ` : ''}

        ${spec.data.children[1].children ? `
            <line x1="600" y1="190" x2="600" y2="250" class="line" />
            <rect x="550" y="250" width="100" height="40" class="box" stroke="${spec.data.children[1].children[0].color || '#4ECDC4'}" />
            <text x="600" y="275" class="text label">${spec.data.children[1].children[0].label}</text>
        ` : ''}
      `;
  } else if (spec.type === 'chart') {
     const maxVal = Math.max(...spec.data.values);
     const barWidth = 100;
     const gap = 50;
     const startX = (width - (spec.data.values.length * (barWidth + gap))) / 2;

     content = spec.data.values.map((val: number, i: number) => {
         const h = (val / maxVal) * 250;
         const x = startX + i * (barWidth + gap);
         const y = 350 - h;
         return `
            <rect x="${x}" y="${y}" width="${barWidth}" height="${h}" fill="${spec.data.colors[i]}" />
            <text x="${x + barWidth/2}" y="${y - 10}" class="text label">${val}%</text>
            <text x="${x + barWidth/2}" y="370" class="text label">${spec.data.labels[i]}</text>
         `;
     }).join('');

     content += `<line x1="50" y1="350" x2="750" y2="350" stroke="#666" stroke-width="2" />`;
  } else if (spec.type === 'matrix') {
      const rows = spec.data.rows.length;
      const cols = spec.data.cols.length;
      const cellW = 120;
      const cellH = 40;
      const startX = (width - cols * cellW) / 2;
      const startY = 100;

      // Header
      content += spec.data.cols.map((col: string, i: number) =>
          `<text x="${startX + i*cellW + cellW/2}" y="${startY - 10}" class="text label" font-weight="bold">${col}</text>`
      ).join('');

      // Rows
      spec.data.rows.forEach((row: string, i: number) => {
          content += `<text x="${startX - 10}" y="${startY + i*cellH + cellH/2}" class="text label" text-anchor="end">${row}</text>`;
          spec.data.cells[i].forEach((cell: string, j: number) => {
              const x = startX + j * cellW;
              const y = startY + i * cellH;
              const isHighlight = i === 2; // Bug line
              content += `
                <rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" fill="${isHighlight ? '#333' : '#222'}" stroke="#444" />
                <text x="${x + cellW/2}" y="${y + cellH/2 + 5}" class="text label">${cell}</text>
              `;
          });
      });
  }

  return `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="#666" />
    </marker>
  </defs>
  <rect width="100%" height="100%" fill="#1a1a1a" />
  ${style}
  <text x="${width/2}" y="30" class="title">${spec.title}</text>
  ${content}
</svg>
  `.trim();
}

console.log(`Generating ${specs.length} images...`);

specs.forEach(spec => {
  const svg = generateSVG(spec);
  const filepath = path.join(IMAGES_DIR, `${spec.name}.svg`);
  fs.writeFileSync(filepath, svg);
  console.log(`Generated ${filepath}`);
});

console.log('Done!');
