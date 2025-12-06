# Chapitre 9 — Context Compression & Masking

---

> **Scène**
>
> *Lina regarde sa facture API du mois. 847 dollars. Elle avale de travers son café.*
>
> *"Comment c'est possible ?" Elle ouvre les logs. Le problème est clair : son agent envoie en moyenne 50,000 tokens par requête. Des fichiers entiers, des historiques de conversation interminables, des résultats d'outils verbeux.*
>
> *"Je paie pour envoyer du bruit au modèle," réalise-t-elle. "Il n'a pas besoin des 500 lignes de logs — juste des 10 lignes pertinentes."*
>
> *Elle a besoin de deux choses : compresser le contexte intelligent, et masquer les outputs d'outils non pertinents.*

---

## Introduction

Plus de contexte n'est pas toujours mieux. Un contexte trop long :
- **Coûte cher** (facturation au token)
- **Dilue l'attention** (le modèle se perd)
- **Ralentit** (latence proportionnelle)

Ce chapitre présente les techniques de **compression de contexte** et de **masquage d'observations** pour optimiser ce qui est envoyé au modèle.

---

## 9.1 Le Problème du Contexte Volumineux

### 9.1.1 Coût du contexte

```
┌─────────────────────────────────────────────────────────────────────┐
│                    COÛT PAR REQUÊTE                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   Modèle          Input ($/1M)    Output ($/1M)                     │
│   ─────────────────────────────────────────────────────             │
│   GPT-4           $30.00          $60.00                            │
│   GPT-4-turbo     $10.00          $30.00                            │
│   Claude 3 Opus   $15.00          $75.00                            │
│   Grok-3          $5.00           $15.00                            │
│                                                                      │
│   Exemple : 50K tokens input × 100 requêtes/jour × 30 jours         │
│   ───────────────────────────────────────────────────────           │
│   GPT-4      : 50 × 100 × 30 × $0.03  = $4,500/mois                │
│   Grok-3     : 50 × 100 × 30 × $0.005 = $750/mois                  │
│                                                                      │
│   Avec compression 60% :                                            │
│   GPT-4      : 20 × 100 × 30 × $0.03  = $1,800/mois (-60%)         │
│   Grok-3     : 20 × 100 × 30 × $0.005 = $300/mois  (-60%)          │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 9.1.2 Lost in the Middle

Les LLMs ont du mal à utiliser l'information au milieu de longs contextes :

```
┌─────────────────────────────────────────────────────────────────────┐
│                ATTENTION DISTRIBUTION                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   Attention                                                         │
│      ▲                                                              │
│   1.0│ ████                                              ████      │
│      │ ████                                              ████      │
│   0.8│ ████                                              ████      │
│      │ ████ ████                                    ████ ████      │
│   0.6│ ████ ████                                    ████ ████      │
│      │ ████ ████ ████                          ████ ████ ████      │
│   0.4│ ████ ████ ████                          ████ ████ ████      │
│      │ ████ ████ ████ ████              ████ ████ ████ ████      │
│   0.2│ ████ ████ ████ ████ ████    ████ ████ ████ ████ ████      │
│      │ ████ ████ ████ ████ ████ ██ ████ ████ ████ ████ ████      │
│   0.0└─────────────────────────────────────────────────────▶       │
│          Début                Milieu                  Fin           │
│                                                                      │
│   Le modèle "oublie" ce qui est au milieu du contexte !            │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Implication** : Mettre les informations importantes au début et à la fin.

---

## 9.2 Techniques de Compression

### 9.2.1 Vue d'ensemble

```
┌─────────────────────────────────────────────────────────────────────┐
│                TECHNIQUES DE COMPRESSION                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. PRIORITY-BASED                                                  │
│     └─ Garder les éléments importants, supprimer les autres         │
│     └─ Réduction : 40-60%                                           │
│                                                                      │
│  2. SUMMARIZATION                                                   │
│     └─ Résumer les parties longues                                  │
│     └─ Réduction : 60-80%                                           │
│                                                                      │
│  3. SEMANTIC DEDUPLICATION                                          │
│     └─ Éliminer les informations redondantes                        │
│     └─ Réduction : 20-30%                                           │
│                                                                      │
│  4. TOKEN BUDGET                                                    │
│     └─ Respecter une limite stricte                                 │
│     └─ Réduction : Variable                                         │
│                                                                      │
│  5. OBSERVATION MASKING                                             │
│     └─ Masquer les outputs d'outils non pertinents                  │
│     └─ Réduction : 30-50%                                           │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 9.2.2 Résultats JetBrains Research (2024)

| Technique | Réduction tokens | Impact succès |
|-----------|------------------|---------------|
| Sans compression | 0% | Baseline |
| Priority-based | -40% | +1.2% |
| + Summarization | -55% | +2.1% |
| + Semantic dedup | -62% | +2.6% |
| Observation masking | -35% | +1.8% |
| **Combiné** | **-70%** | **+2.6%** |

**Conclusion** : Moins de contexte = meilleurs résultats ET moins cher.

---

## 9.3 Compression Priority-Based

### 9.3.1 Système de priorités

```typescript
// src/context/context-compressor.ts
enum Priority {
  CRITICAL = 4,   // Toujours garder
  HIGH = 3,       // Garder si possible
  MEDIUM = 2,     // Peut être résumé
  LOW = 1,        // Peut être supprimé
  NOISE = 0       // Supprimer
}

interface PrioritizedContent {
  content: string;
  type: ContentType;
  priority: Priority;
  tokens: number;
  timestamp?: Date;
  relevanceScore?: number;
}
```

### 9.3.2 Classification du contenu

```typescript
function classifyContent(content: PrioritizedContent): Priority {
  switch (content.type) {
    // CRITICAL : Toujours nécessaire
    case 'system_prompt':
      return Priority.CRITICAL;
    case 'current_user_message':
      return Priority.CRITICAL;
    case 'tool_call_in_progress':
      return Priority.CRITICAL;

    // HIGH : Très important
    case 'recent_code_context':
      return Priority.HIGH;
    case 'recent_tool_result':
      return Priority.HIGH;
    case 'error_message':
      return Priority.HIGH;

    // MEDIUM : Important mais compressible
    case 'older_conversation':
      return Priority.MEDIUM;
    case 'documentation':
      return Priority.MEDIUM;
    case 'test_output':
      return Priority.MEDIUM;

    // LOW : Peut être supprimé
    case 'verbose_logs':
      return Priority.LOW;
    case 'old_conversation':
      return Priority.LOW;

    // NOISE : Supprimer
    case 'progress_bars':
      return Priority.NOISE;
    case 'timestamps_repeated':
      return Priority.NOISE;

    default:
      return Priority.MEDIUM;
  }
}
```

### 9.3.3 Algorithme de compression

```typescript
export class ContextCompressor {
  private tokenEncoder: TokenEncoder;
  private summarizer: Summarizer;

  async compress(
    contents: PrioritizedContent[],
    maxTokens: number
  ): Promise<CompressedContext> {
    // 1. Classifier et trier par priorité
    const classified = contents.map(c => ({
      ...c,
      priority: classifyContent(c)
    }));

    classified.sort((a, b) => b.priority - a.priority);

    // 2. Supprimer le NOISE
    const withoutNoise = classified.filter(c => c.priority > Priority.NOISE);

    // 3. Calculer les tokens actuels
    let currentTokens = withoutNoise.reduce((sum, c) => sum + c.tokens, 0);

    // 4. Si sous la limite, retourner tel quel
    if (currentTokens <= maxTokens) {
      return {
        contents: withoutNoise,
        originalTokens: currentTokens,
        compressedTokens: currentTokens,
        compressionRatio: 1.0
      };
    }

    // 5. Compression itérative
    const result: PrioritizedContent[] = [];
    let usedTokens = 0;

    for (const content of classified) {
      if (content.priority === Priority.NOISE) continue;

      const remainingTokens = maxTokens - usedTokens;

      if (content.tokens <= remainingTokens) {
        // Ça rentre, ajouter tel quel
        result.push(content);
        usedTokens += content.tokens;
      } else if (content.priority >= Priority.HIGH) {
        // Critique/High : tronquer plutôt que supprimer
        const truncated = await this.truncate(content, remainingTokens);
        result.push(truncated);
        usedTokens += truncated.tokens;
      } else if (content.priority === Priority.MEDIUM && remainingTokens > 100) {
        // Medium : résumer
        const summarized = await this.summarize(content, remainingTokens);
        result.push(summarized);
        usedTokens += summarized.tokens;
      }
      // LOW : skip si pas de place
    }

    return {
      contents: result,
      originalTokens: currentTokens,
      compressedTokens: usedTokens,
      compressionRatio: usedTokens / currentTokens
    };
  }

  private async truncate(
    content: PrioritizedContent,
    maxTokens: number
  ): Promise<PrioritizedContent> {
    const tokens = this.tokenEncoder.encode(content.content);
    const truncatedTokens = tokens.slice(0, maxTokens - 20); // Marge pour "[truncated]"
    const truncatedText = this.tokenEncoder.decode(truncatedTokens);

    return {
      ...content,
      content: truncatedText + '\n[... truncated ...]',
      tokens: truncatedTokens.length + 5
    };
  }

  private async summarize(
    content: PrioritizedContent,
    maxTokens: number
  ): Promise<PrioritizedContent> {
    const summary = await this.summarizer.summarize(content.content, {
      maxLength: maxTokens - 10,
      preserveCode: content.type.includes('code'),
      preserveErrors: content.type.includes('error')
    });

    return {
      ...content,
      content: `[Summary] ${summary}`,
      tokens: this.tokenEncoder.encode(summary).length + 3
    };
  }
}
```

---

## 9.4 Summarization Intelligente

### 9.4.1 Résumer la conversation

```typescript
async function summarizeConversation(
  messages: Message[],
  maxTokens: number
): Promise<string> {
  // Garder les N derniers messages intacts
  const recentCount = 4;
  const recent = messages.slice(-recentCount);
  const older = messages.slice(0, -recentCount);

  if (older.length === 0) {
    return formatMessages(recent);
  }

  // Résumer les anciens
  const olderText = formatMessages(older);
  const summaryPrompt = `
    Résume cette conversation en gardant :
    - Les décisions prises
    - Les fichiers modifiés
    - Les erreurs rencontrées
    - Les tâches complétées

    Conversation :
    ${olderText}

    Résumé (max 200 mots) :
  `;

  const summary = await llm.complete(summaryPrompt, { maxTokens: 300 });

  return `[Résumé des messages précédents]\n${summary}\n\n[Messages récents]\n${formatMessages(recent)}`;
}
```

### 9.4.2 Résumer les résultats d'outils

```typescript
async function summarizeToolResult(
  toolName: string,
  result: string,
  maxTokens: number
): Promise<string> {
  const resultTokens = countTokens(result);

  if (resultTokens <= maxTokens) {
    return result;
  }

  // Stratégies spécifiques par outil
  switch (toolName) {
    case 'bash':
      return summarizeBashOutput(result, maxTokens);
    case 'read_file':
      return summarizeFileContent(result, maxTokens);
    case 'search':
      return summarizeSearchResults(result, maxTokens);
    default:
      return genericSummarize(result, maxTokens);
  }
}

function summarizeBashOutput(output: string, maxTokens: number): string {
  const lines = output.split('\n');

  // Priorités pour bash output
  const errorLines = lines.filter(l => l.match(/error|fail|exception/i));
  const warningLines = lines.filter(l => l.match(/warn/i));
  const lastLines = lines.slice(-20);

  const prioritized = [
    ...errorLines.slice(0, 10),
    ...warningLines.slice(0, 5),
    ...lastLines
  ];

  const result = [...new Set(prioritized)].join('\n');

  if (countTokens(result) <= maxTokens) {
    return `[Output summarized: ${lines.length} lines → ${prioritized.length} lines]\n${result}`;
  }

  // Tronquer si encore trop long
  return truncateToTokens(result, maxTokens);
}
```

---

## 9.5 Observation Masking

### 9.5.1 Le problème des outputs verbeux

```
┌─────────────────────────────────────────────────────────────────────┐
│                 OBSERVATION MASKING                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Sans masking :                                                     │
│  ─────────────                                                      │
│  Tool: list_directory("/src")                                       │
│  Result: 200 fichiers listés (5000 tokens)                          │
│  → Le modèle reçoit tout, même si non pertinent                     │
│                                                                      │
│  Question suivante : "Quelle est la fonction main ?"                │
│  → Les 5000 tokens de listing sont inutiles                         │
│                                                                      │
│  Avec masking :                                                     │
│  ──────────────                                                     │
│  Tool: list_directory("/src")                                       │
│  Result: [MASKED - 200 files, see previous output if needed]        │
│  → Le modèle sait que l'info existe mais n'est pas polluée          │
│                                                                      │
│  Économie : ~4000 tokens par requête suivante                       │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 9.5.2 Critères de masquage

```typescript
interface MaskingCriteria {
  // Âge du résultat
  maxAge: number;  // Messages depuis le résultat

  // Taille
  minTokensToMask: number;  // Ne masquer que si > N tokens

  // Pertinence
  relevanceThreshold: number;  // Score de pertinence minimum

  // Type d'outil
  toolSpecificRules: Record<string, ToolMaskingRule>;
}

const DEFAULT_CRITERIA: MaskingCriteria = {
  maxAge: 5,              // Masquer après 5 messages
  minTokensToMask: 500,   // Masquer si > 500 tokens
  relevanceThreshold: 0.3,
  toolSpecificRules: {
    'list_directory': { alwaysMaskAfter: 2, keepSummary: true },
    'search': { alwaysMaskAfter: 3, keepMatches: 5 },
    'read_file': { alwaysMaskAfter: 5, keepIfReferenced: true },
    'bash': { maskProgressBars: true, keepErrors: true }
  }
};
```

### 9.5.3 Implémentation

```typescript
// src/context/observation-masking.ts
export class ObservationMasker {
  private criteria: MaskingCriteria;

  shouldMask(
    toolResult: ToolResult,
    currentMessageIndex: number,
    context: ConversationContext
  ): MaskDecision {
    const age = currentMessageIndex - toolResult.messageIndex;
    const tokens = countTokens(toolResult.output);

    // Règle 1 : Trop vieux
    if (age > this.criteria.maxAge) {
      return { mask: true, reason: 'age', keepSummary: true };
    }

    // Règle 2 : Trop petit pour valoir la peine
    if (tokens < this.criteria.minTokensToMask) {
      return { mask: false };
    }

    // Règle 3 : Règles spécifiques à l'outil
    const toolRule = this.criteria.toolSpecificRules[toolResult.toolName];
    if (toolRule) {
      if (toolRule.alwaysMaskAfter && age > toolRule.alwaysMaskAfter) {
        return {
          mask: true,
          reason: 'tool_rule',
          keepSummary: toolRule.keepSummary,
          keepMatches: toolRule.keepMatches
        };
      }
    }

    // Règle 4 : Pertinence par rapport au message actuel
    const relevance = this.computeRelevance(toolResult, context.currentMessage);
    if (relevance < this.criteria.relevanceThreshold) {
      return { mask: true, reason: 'low_relevance', keepSummary: true };
    }

    return { mask: false };
  }

  mask(toolResult: ToolResult, decision: MaskDecision): string {
    if (!decision.mask) {
      return toolResult.output;
    }

    const summary = this.generateSummary(toolResult, decision);

    return `[MASKED: ${toolResult.toolName}]
${summary}
[Full output available in message #${toolResult.messageIndex}]`;
  }

  private generateSummary(
    toolResult: ToolResult,
    decision: MaskDecision
  ): string {
    const output = toolResult.output;

    switch (toolResult.toolName) {
      case 'list_directory':
        const fileCount = (output.match(/\n/g) || []).length;
        return `Listed ${fileCount} files/directories`;

      case 'search':
        const matchCount = (output.match(/:\d+:/g) || []).length;
        if (decision.keepMatches) {
          const firstMatches = output.split('\n').slice(0, decision.keepMatches).join('\n');
          return `Found ${matchCount} matches. First ${decision.keepMatches}:\n${firstMatches}`;
        }
        return `Found ${matchCount} matches`;

      case 'bash':
        const lines = output.split('\n').length;
        const hasError = /error|fail/i.test(output);
        return `Executed (${lines} lines output${hasError ? ', contains errors' : ''})`;

      case 'read_file':
        const lineCount = output.split('\n').length;
        return `File content (${lineCount} lines)`;

      default:
        const tokens = countTokens(output);
        return `Result (${tokens} tokens)`;
    }
  }

  private computeRelevance(
    toolResult: ToolResult,
    currentMessage: string
  ): number {
    // Vérifier si des mots clés du résultat sont mentionnés dans le message actuel
    const resultWords = new Set(
      toolResult.output.toLowerCase().split(/\s+/).filter(w => w.length > 3)
    );
    const messageWords = currentMessage.toLowerCase().split(/\s+/);

    const overlap = messageWords.filter(w => resultWords.has(w)).length;
    return overlap / Math.max(messageWords.length, 1);
  }
}
```

---

## 9.6 Implémentation Grok-CLI

### 9.6.1 Architecture

```
src/context/
├── context-compressor.ts      # Compression principale
├── observation-masking.ts     # Masquage des observations
├── summarizer.ts              # Résumés intelligents
└── token-budget.ts            # Gestion du budget tokens
```

### 9.6.2 Intégration dans l'agent

```typescript
// src/agent/grok-agent.ts
export class GrokAgent {
  private compressor: ContextCompressor;
  private masker: ObservationMasker;
  private tokenBudget: number = 100_000;

  async buildContext(messages: Message[]): Promise<Context> {
    // 1. Classifier les messages
    const classified = messages.map(m => this.classifyMessage(m));

    // 2. Masquer les observations anciennes/non pertinentes
    const masked = this.applyMasking(classified);

    // 3. Compresser pour respecter le budget
    const compressed = await this.compressor.compress(
      masked,
      this.tokenBudget
    );

    // 4. Optimiser l'ordre (important au début et à la fin)
    const optimized = this.optimizeOrder(compressed.contents);

    return {
      messages: optimized,
      stats: {
        originalTokens: compressed.originalTokens,
        compressedTokens: compressed.compressedTokens,
        compressionRatio: compressed.compressionRatio,
        maskedObservations: masked.filter(m => m.masked).length
      }
    };
  }

  private classifyMessage(message: Message): PrioritizedContent {
    let type: ContentType;
    let priority: Priority;

    if (message.role === 'system') {
      type = 'system_prompt';
      priority = Priority.CRITICAL;
    } else if (message.role === 'user') {
      type = message === this.currentMessage ? 'current_user_message' : 'older_conversation';
      priority = message === this.currentMessage ? Priority.CRITICAL : Priority.MEDIUM;
    } else if (message.role === 'tool') {
      type = this.categorizeToolResult(message);
      priority = this.prioritizeToolResult(message);
    } else {
      type = 'assistant_response';
      priority = Priority.MEDIUM;
    }

    return {
      content: message.content,
      type,
      priority,
      tokens: countTokens(message.content),
      timestamp: message.timestamp
    };
  }

  private optimizeOrder(contents: PrioritizedContent[]): PrioritizedContent[] {
    // Stratégie : CRITICAL au début, puis HIGH, puis le reste intercalé
    // pour éviter le "lost in the middle"

    const critical = contents.filter(c => c.priority === Priority.CRITICAL);
    const high = contents.filter(c => c.priority === Priority.HIGH);
    const rest = contents.filter(c => c.priority < Priority.HIGH);

    // Intercaler le reste pour maximiser l'attention
    const interleavedRest: PrioritizedContent[] = [];
    const mid = Math.floor(rest.length / 2);

    for (let i = 0; i < mid; i++) {
      interleavedRest.push(rest[i]);
      if (rest[mid + i]) {
        interleavedRest.push(rest[mid + i]);
      }
    }

    return [...critical, ...high, ...interleavedRest];
  }
}
```

### 9.6.3 Configuration

```typescript
// src/context/config.ts
export const COMPRESSION_CONFIG = {
  // Budgets par défaut
  defaultTokenBudget: 100_000,
  maxTokenBudget: 128_000,

  // Compression
  enableCompression: true,
  compressionThreshold: 0.8,  // Compresser si > 80% du budget

  // Masking
  enableMasking: true,
  maskingCriteria: {
    maxAge: 5,
    minTokensToMask: 500,
    relevanceThreshold: 0.3
  },

  // Summarization
  enableSummarization: true,
  summarizeConversationAfter: 10,  // messages
  maxSummaryTokens: 500,

  // Priorités par type
  priorities: {
    system_prompt: Priority.CRITICAL,
    current_user_message: Priority.CRITICAL,
    recent_tool_result: Priority.HIGH,
    error_message: Priority.HIGH,
    code_context: Priority.HIGH,
    older_conversation: Priority.MEDIUM,
    verbose_output: Priority.LOW
  }
};
```

---

## 9.7 Métriques et Monitoring

### 9.7.1 Dashboard de compression

```typescript
interface CompressionMetrics {
  // Par session
  totalOriginalTokens: number;
  totalCompressedTokens: number;
  avgCompressionRatio: number;
  totalMaskedObservations: number;

  // Par message
  messagesProcessed: number;
  summarizationsPerformed: number;

  // Économies
  estimatedCostSaved: number;
  tokensPerDollar: number;
}

function printCompressionDashboard(metrics: CompressionMetrics): void {
  const savings = (1 - metrics.avgCompressionRatio) * 100;

  console.log(`
┌─────────────────────────────────────────────────────────────┐
│              COMPRESSION DASHBOARD                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  TOKENS                                                     │
│  ├─ Original       : ${metrics.totalOriginalTokens.toLocaleString().padStart(12)}                   │
│  ├─ Compressed     : ${metrics.totalCompressedTokens.toLocaleString().padStart(12)}                   │
│  └─ Ratio          : ${(metrics.avgCompressionRatio * 100).toFixed(1)}% (${savings.toFixed(1)}% saved)                │
│                                                              │
│  OPERATIONS                                                 │
│  ├─ Messages       : ${metrics.messagesProcessed}                            │
│  ├─ Summarizations : ${metrics.summarizationsPerformed}                            │
│  └─ Masked obs.    : ${metrics.totalMaskedObservations}                            │
│                                                              │
│  ÉCONOMIES                                                  │
│  └─ Estimated      : $${metrics.estimatedCostSaved.toFixed(2)}                         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
  `);
}
```

### 9.7.2 Alertes

```typescript
function checkCompressionHealth(metrics: CompressionMetrics): Alert[] {
  const alerts: Alert[] = [];

  // Compression trop agressive
  if (metrics.avgCompressionRatio < 0.3) {
    alerts.push({
      level: 'warning',
      message: 'Compression très agressive, risque de perte d\'information'
    });
  }

  // Pas assez de compression
  if (metrics.avgCompressionRatio > 0.95) {
    alerts.push({
      level: 'info',
      message: 'Compression minimale, vérifier si le budget est adapté'
    });
  }

  // Beaucoup de summarizations
  if (metrics.summarizationsPerformed > metrics.messagesProcessed * 0.5) {
    alerts.push({
      level: 'warning',
      message: 'Beaucoup de summarizations, vérifier la taille des messages'
    });
  }

  return alerts;
}
```

---

## 9.8 Cas Pratiques

### 9.8.1 Cas 1 : Session longue

```
Session de 50 messages, 150K tokens originaux

Sans compression :
──────────────────
→ Dépasse la limite de contexte (128K)
→ Erreur ou troncature brutale

Avec compression :
──────────────────
Messages 1-40 : Résumé (1,500 tokens)
Messages 41-50 : Complets (15,000 tokens)
Tool results anciens : Masqués
Code context : Conservé

Total : 45,000 tokens (70% réduction)
Qualité : Préservée (info critique gardée)
```

### 9.8.2 Cas 2 : Recherche massive

```
Tool: search("error handling")
Result: 2,847 matches (35,000 tokens)

Sans masking :
──────────────
→ 35K tokens dans chaque message suivant
→ Coût × 10

Avec masking intelligent :
──────────────────────────
Message actuel : Top 10 matches (2,000 tokens)
Messages suivants : [MASKED: 2,847 matches, see message #5]

Économie : ~33,000 tokens par message
```

### 9.8.3 Cas 3 : Logs verbeux

```
Tool: bash("npm install")
Result: 5,000 lignes de logs (25,000 tokens)

Compression :
─────────────
Suppression : progress bars, timestamps répétés
Conservation : erreurs, warnings, versions
Résultat : 500 tokens

Message compressé :
[npm install output - 5000 lines compressed]
Installed 847 packages
Warnings: 3 deprecation notices
No errors
```

---

## Résumé

Dans ce chapitre, nous avons vu :

| Concept | Point clé |
|---------|-----------|
| **Problème** | Contexte long = cher, lent, moins précis |
| **Priority-based** | Garder le critique, compresser le reste |
| **Summarization** | Résumer les parties longues |
| **Observation masking** | Cacher les outputs d'outils anciens |
| **Token budget** | Respecter une limite stricte |
| **Résultats** | -70% tokens, +2.6% succès |

---

## Exercices

1. **Priorités** : Définissez un système de priorités pour votre cas d'usage. Quels types de contenu sont critiques ?

2. **Masking** : Implémentez des règles de masking pour un outil spécifique de votre workflow.

3. **Benchmark** : Mesurez l'impact de la compression sur la qualité des réponses (10 questions avec/sans).

4. **Optimisation** : Trouvez le ratio de compression optimal pour votre budget et vos besoins de qualité.

---

## Pour aller plus loin

- JetBrains Research. (2024). "Context Compression for LLM-based Code Generation"
- Liu, N., et al. (2023). "Lost in the Middle: How Language Models Use Long Contexts"
- Grok-CLI : `src/context/context-compressor.ts`, `src/context/observation-masking.ts`

---

*Fin de la Partie III — Mémoire, RAG et Contexte*

*Prochainement : Partie IV — Action et Outils*
*Chapitre 10 — Tool-Use et Tool-Calling*

