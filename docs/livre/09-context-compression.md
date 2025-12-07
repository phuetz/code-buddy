# Chapitre 9 — Context Compression & Masking 🗜️

---

## 🎬 Scène d'ouverture

*3h47 du matin. Le téléphone de Lina vibre. Un email de son service cloud : "Alerte budget : 90% de votre limite mensuelle atteinte."*

*Elle s'assoit dans son lit, le cœur battant. On n'est que le 12 du mois.*

*Le lendemain matin, elle ouvre sa facture API avec une boule au ventre.*

**Lina** *(blême)* : "847 dollars... en douze jours."

*Ses mains tremblent légèrement. C'est plus que son loyer. Elle plonge dans les logs, cherchant le coupable. Et elle le trouve : 50,000 tokens par requête en moyenne. Des fichiers entiers envoyés et renvoyés. Des outputs bash de 500 lignes reproduits dix fois. L'historique complet de chaque conversation, accumulé comme des couches géologiques.*

**Lina** *(la voix serrée)* : "Je paie pour envoyer les mêmes 500 lignes de logs npm à chaque requête. Le modèle n'en a besoin qu'une fois."

*Marc arrive avec deux cafés. Il jette un œil à l'écran et grimace.*

**Marc** : "Aïe. Le piège classique. Tu sais ce qui est ironique ?"

**Lina** : "Quoi ?"

**Marc** : "Les chercheurs de JetBrains ont découvert quelque chose de contre-intuitif l'année dernière. Ils pensaient qu'envoyer plus de contexte améliorerait les résultats de génération de code. Ils ont testé. Et ils ont trouvé l'inverse."

**Lina** *(levant les yeux)* : "L'inverse ?"

**Marc** : "Moins de contexte, mais mieux ciblé, donne de **meilleurs** résultats. Pas juste moins cher — plus précis. Le modèle se perd moins."

*Lina pose sa tasse. Une lueur d'espoir.*

**Lina** : "Donc si je compresse intelligemment... je peux économiser ET avoir de meilleures réponses ?"

**Marc** *(souriant)* : "Exactement. Ça s'appelle la **compression de contexte**. Et pour les résultats d'outils qui traînent dans l'historique, on utilise l'**observation masking** — on cache ce qui n'est plus pertinent, tout en gardant une trace qu'il existe."

*Lina ferme la facture. Dans ses yeux, la panique a cédé la place à la détermination.*

**Lina** : "Montre-moi. Chaque technique. Je veux diviser cette facture par trois."

**Marc** : "Par trois ? On va viser mieux que ça."

---

## 📋 Table des matières

| Section | Titre | Description |
|:-------:|-------|-------------|
| 9.1 | 💸 Le Problème du Coût | Pourquoi le contexte long est problématique |
| 9.2 | 🗜️ Techniques de Compression | Vue d'ensemble des approches |
| 9.3 | ⚖️ Compression Priority-Based | Garder le critique, supprimer le bruit |
| 9.4 | 📝 Summarization Intelligente | Résumer sans perdre l'essentiel |
| 9.5 | 🎭 Observation Masking | Cacher les outputs d'outils anciens |
| 9.6 | 🛠️ Implémentation | Le module dans Grok-CLI |
| 9.7 | 📊 Métriques et Monitoring | Mesurer l'efficacité |
| 9.8 | 💼 Cas Pratiques | Exemples concrets |

---

## 9.1 💸 Le Problème du Contexte Volumineux

### 9.1.1 Le coût réel du contexte

Chaque token envoyé à l'API coûte de l'argent. Quand votre agent envoie 50K tokens par requête, la facture grimpe vite.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       💰 COÛT PAR REQUÊTE                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │   Modèle           Input ($/1M)    Output ($/1M)               │    │
│  │   ─────────────────────────────────────────────────────        │    │
│  │   GPT-4             $30.00          $60.00                     │    │
│  │   GPT-4-turbo       $10.00          $30.00                     │    │
│  │   Claude 3 Opus     $15.00          $75.00                     │    │
│  │   Grok-3            $5.00           $15.00                     │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  📊 Exemple de calcul :                                                │
│  ═════════════════════                                                  │
│  50K tokens × 100 requêtes/jour × 30 jours                             │
│                                                                         │
│  Sans compression :                                                     │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │  GPT-4      : 150M tokens × $0.03/1K  = $4,500/mois            │    │
│  │  Grok-3     : 150M tokens × $0.005/1K = $750/mois              │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  Avec compression 60% :                                                │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │  GPT-4      : 60M tokens × $0.03/1K   = $1,800/mois  💚 -60%   │    │
│  │  Grok-3     : 60M tokens × $0.005/1K  = $300/mois    💚 -60%   │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 9.1.2 Lost in the Middle — La Découverte qui a Tout Changé

Le coût n'est pas le seul problème. Et ce qui suit est peut-être la découverte la plus importante sur les LLMs depuis les Transformers eux-mêmes.

**Été 2023, Stanford University.** Nelson Liu, un doctorant, pose une question simple à son équipe : "Est-ce que la position d'une information dans le contexte affecte sa probabilité d'être utilisée ?"

L'hypothèse semblait presque triviale. Après tout, les Transformers ont des mécanismes d'attention qui sont censés regarder partout dans le contexte, non ?

Pour tester, ils ont créé une expérience élégante : cacher un "fait clé" à différentes positions dans un contexte de 128K tokens, puis poser une question dont la réponse nécessite ce fait.

**Les résultats ont envoyé des ondes de choc dans la communauté IA.**

Quand le fait clé était au **début** du contexte : 98% de réponses correctes.
Quand il était à la **fin** : 95% de réponses correctes.
Quand il était **au milieu** : **45% de réponses correctes**.

Le modèle "oubliait" littéralement ce qu'il avait lu au milieu du contexte. Ce phénomène, qu'ils ont baptisé **"Lost in the Middle"**, affecte tous les LLMs — GPT-4, Claude, Llama, tous.

![Distribution de l'attention - Lost in the Middle](images/attention-distribution.svg)

| Problème | Impact | Solution |
|----------|--------|----------|
| 💸 **Coût** | Factures élevées | Compression |
| 🎯 **Attention** | Info perdue au milieu | Réorganisation |
| ⏱️ **Latence** | Réponses lentes | Moins de tokens |
| 🎭 **Dilution** | Modèle confus | Filtrage |

---

## 9.2 🗜️ Techniques de Compression

### 9.2.1 Vue d'ensemble

Il existe plusieurs techniques pour réduire la taille du contexte, chacune avec ses forces et faiblesses :

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    🗜️ TECHNIQUES DE COMPRESSION                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1️⃣ PRIORITY-BASED                                                     │
│     ├── Principe : Garder le critique, supprimer le bruit              │
│     ├── Réduction : 40-60%                                             │
│     └── Complexité : ⭐ Faible                                          │
│                                                                         │
│  2️⃣ SUMMARIZATION                                                       │
│     ├── Principe : Résumer les parties longues                         │
│     ├── Réduction : 60-80%                                             │
│     └── Complexité : ⭐⭐⭐ Élevée (requiert LLM)                        │
│                                                                         │
│  3️⃣ SEMANTIC DEDUPLICATION                                              │
│     ├── Principe : Éliminer les infos redondantes                      │
│     ├── Réduction : 20-30%                                             │
│     └── Complexité : ⭐⭐ Moyenne                                        │
│                                                                         │
│  4️⃣ TOKEN BUDGET                                                        │
│     ├── Principe : Respecter une limite stricte                        │
│     ├── Réduction : Variable                                           │
│     └── Complexité : ⭐ Faible                                          │
│                                                                         │
│  5️⃣ OBSERVATION MASKING                                                 │
│     ├── Principe : Masquer les outputs d'outils anciens                │
│     ├── Réduction : 30-50%                                             │
│     └── Complexité : ⭐⭐ Moyenne                                        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 9.2.2 La Découverte de JetBrains (2024) — L'Histoire

> *"On pensait que plus de contexte serait toujours mieux. On avait tort."*
> — Équipe JetBrains Research, 2024

**L'histoire commence à Saint-Pétersbourg**, dans les bureaux de JetBrains — les créateurs d'IntelliJ IDEA, PyCharm, et de Kotlin. Leur équipe de recherche en IA travaillait sur un problème apparemment simple : comment améliorer la génération de code assistée par LLM dans leurs IDE ?

L'hypothèse initiale semblait évidente : **plus de contexte = meilleures suggestions**. Après tout, un développeur qui voit tout le projet fait de meilleures suggestions qu'un qui ne voit qu'un fichier, non ?

Ils ont donc construit un système qui envoyait au LLM :
- Le fichier actuel complet
- Tous les fichiers importés
- L'historique de la session
- La documentation du projet
- Les tests associés

**Les résultats les ont stupéfiés.**

Non seulement les coûts avaient explosé, mais la **qualité des suggestions avait diminué**. Le modèle se perdait dans la masse d'information. Il ignorait parfois le code juste avant le curseur pour citer de la documentation non pertinente située 50,000 tokens plus tôt.

C'est alors qu'ils ont eu l'idée de **mesurer systématiquement** l'impact de chaque type de contexte. Ils ont créé un benchmark avec des centaines de tâches de complétion de code, et ont testé différentes stratégies de compression.

**Les résultats publiés en 2024 :**

| Technique | Réduction tokens | Impact succès | Coût relatif |
|-----------|:----------------:|:-------------:|:------------:|
| Sans compression | 0% | Baseline | 100% |
| Priority-based | -40% | +1.2% ✅ | 60% |
| + Summarization | -55% | +2.1% ✅ | 45% |
| + Semantic dedup | -62% | +2.6% ✅ | 38% |
| Observation masking | -35% | +1.8% ✅ | 65% |
| **Combiné** | **-70%** | **+2.6%** ✅ | **30%** |

> 💡 **La conclusion qui a choqué la communauté** : Envoyer 70% de contexte en moins améliore la qualité de 2.6%. Ce n'est pas un compromis — c'est un gain sur les deux tableaux.

**Pourquoi ?** L'étude identifie trois mécanismes :

1. **Attention focalisée** : Avec moins de contexte, chaque token a plus de poids dans le calcul d'attention
2. **Réduction du bruit** : Les informations non pertinentes ne peuvent plus "distraire" le modèle
3. **Cohérence améliorée** : Le modèle ne se contredit plus en citant des parties obsolètes du contexte

Cette découverte a depuis été confirmée par d'autres équipes (Google DeepMind, Anthropic), et a donné naissance à une nouvelle discipline : **l'ingénierie de contexte**.

---

## 9.3 ⚖️ Compression Priority-Based

### 9.3.1 Système de priorités

L'idée est simple : tout le contenu n'a pas la même importance. On définit des niveaux de priorité :

```typescript
// src/context/context-compressor.ts

enum Priority {
  CRITICAL = 4,   // 🔴 Toujours garder
  HIGH = 3,       // 🟠 Garder si possible
  MEDIUM = 2,     // 🟡 Peut être résumé
  LOW = 1,        // 🟢 Peut être supprimé
  NOISE = 0       // ⚫ Supprimer systématiquement
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

![Pyramide des priorités de contexte](images/priority-pyramid.svg)

### 9.3.2 Classification automatique

```typescript
// src/context/classifier.ts

/**
 * Classifie automatiquement le contenu par priorité.
 */
function classifyContent(content: PrioritizedContent): Priority {
  switch (content.type) {
    // ═════════════════════════════════════════════════
    // 🔴 CRITICAL : Toujours nécessaire
    // ═════════════════════════════════════════════════
    case 'system_prompt':
      return Priority.CRITICAL;
    case 'current_user_message':
      return Priority.CRITICAL;
    case 'tool_call_in_progress':
      return Priority.CRITICAL;

    // ═════════════════════════════════════════════════
    // 🟠 HIGH : Très important
    // ═════════════════════════════════════════════════
    case 'recent_code_context':
      return Priority.HIGH;
    case 'recent_tool_result':
      return Priority.HIGH;
    case 'error_message':
      return Priority.HIGH;

    // ═════════════════════════════════════════════════
    // 🟡 MEDIUM : Important mais compressible
    // ═════════════════════════════════════════════════
    case 'older_conversation':
      return Priority.MEDIUM;
    case 'documentation':
      return Priority.MEDIUM;
    case 'test_output':
      return Priority.MEDIUM;

    // ═════════════════════════════════════════════════
    // 🟢 LOW : Peut être supprimé si nécessaire
    // ═════════════════════════════════════════════════
    case 'verbose_logs':
      return Priority.LOW;
    case 'old_conversation':
      return Priority.LOW;

    // ═════════════════════════════════════════════════
    // ⚫ NOISE : Supprimer systématiquement
    // ═════════════════════════════════════════════════
    case 'progress_bars':
      return Priority.NOISE;
    case 'timestamps_repeated':
      return Priority.NOISE;
    case 'empty_lines':
      return Priority.NOISE;

    default:
      return Priority.MEDIUM;
  }
}
```

### 9.3.3 Algorithme de compression

```typescript
// src/context/context-compressor.ts

export class ContextCompressor {
  private tokenEncoder: TokenEncoder;
  private summarizer: Summarizer;

  /**
   * Compresse un ensemble de contenus pour respecter un budget tokens.
   * Algorithme :
   * 1. Trier par priorité (descending)
   * 2. Supprimer le NOISE
   * 3. Ajouter par ordre de priorité jusqu'au budget
   * 4. Résumer les MEDIUM si nécessaire
   * 5. Tronquer les HIGH si vraiment nécessaire
   */
  async compress(
    contents: PrioritizedContent[],
    maxTokens: number
  ): Promise<CompressedContext> {
    // 1️⃣ Classifier et trier par priorité
    const classified = contents.map(c => ({
      ...c,
      priority: classifyContent(c)
    }));
    classified.sort((a, b) => b.priority - a.priority);

    // 2️⃣ Supprimer le NOISE
    const withoutNoise = classified.filter(c => c.priority > Priority.NOISE);

    // 3️⃣ Calculer les tokens actuels
    const originalTokens = withoutNoise.reduce((sum, c) => sum + c.tokens, 0);

    // 4️⃣ Si sous la limite, retourner tel quel
    if (originalTokens <= maxTokens) {
      return {
        contents: withoutNoise,
        originalTokens,
        compressedTokens: originalTokens,
        compressionRatio: 1.0
      };
    }

    // 5️⃣ Compression itérative
    const result: PrioritizedContent[] = [];
    let usedTokens = 0;

    for (const content of classified) {
      if (content.priority === Priority.NOISE) continue;

      const remainingTokens = maxTokens - usedTokens;

      if (content.tokens <= remainingTokens) {
        // ✅ Ça rentre, ajouter tel quel
        result.push(content);
        usedTokens += content.tokens;

      } else if (content.priority >= Priority.HIGH) {
        // 🟠 Critique/High : tronquer plutôt que supprimer
        const truncated = await this.truncate(content, remainingTokens);
        result.push(truncated);
        usedTokens += truncated.tokens;

      } else if (content.priority === Priority.MEDIUM && remainingTokens > 100) {
        // 🟡 Medium : résumer
        const summarized = await this.summarize(content, remainingTokens);
        result.push(summarized);
        usedTokens += summarized.tokens;
      }
      // 🟢 LOW : skip si pas de place
    }

    return {
      contents: result,
      originalTokens,
      compressedTokens: usedTokens,
      compressionRatio: usedTokens / originalTokens
    };
  }

  private async truncate(
    content: PrioritizedContent,
    maxTokens: number
  ): Promise<PrioritizedContent> {
    const tokens = this.tokenEncoder.encode(content.content);
    const truncatedTokens = tokens.slice(0, maxTokens - 20);
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

## 9.4 📝 Summarization Intelligente

### 9.4.1 Résumer la conversation

Les conversations longues peuvent être résumées tout en préservant les informations clés :

```typescript
// src/context/summarizer.ts

/**
 * Résume une conversation longue.
 * Garde les N derniers messages intacts et résume le reste.
 */
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

  // Résumer les anciens messages avec un LLM
  const olderText = formatMessages(older);
  const summaryPrompt = `
Résume cette conversation en gardant UNIQUEMENT :
- Les décisions prises
- Les fichiers modifiés
- Les erreurs rencontrées
- Les tâches complétées

Conversation à résumer :
${olderText}

Résumé (max 200 mots) :
  `;

  const summary = await llm.complete(summaryPrompt, { maxTokens: 300 });

  return `
[📝 Résumé des ${older.length} messages précédents]
${summary}

[💬 Messages récents]
${formatMessages(recent)}
  `.trim();
}
```

### 9.4.2 Résumer les résultats d'outils

Chaque outil a des patterns spécifiques à résumer :

```typescript
// src/context/tool-summarizer.ts

/**
 * Résume intelligemment le résultat d'un outil.
 * Stratégies différentes selon le type d'outil.
 */
async function summarizeToolResult(
  toolName: string,
  result: string,
  maxTokens: number
): Promise<string> {
  const resultTokens = countTokens(result);

  if (resultTokens <= maxTokens) {
    return result;  // Pas besoin de résumer
  }

  // Stratégies spécifiques par outil
  switch (toolName) {
    case 'bash':
      return summarizeBashOutput(result, maxTokens);
    case 'read_file':
      return summarizeFileContent(result, maxTokens);
    case 'search':
      return summarizeSearchResults(result, maxTokens);
    case 'list_directory':
      return summarizeDirectoryListing(result, maxTokens);
    default:
      return genericSummarize(result, maxTokens);
  }
}

/**
 * Résume un output bash en gardant les erreurs et les dernières lignes.
 */
function summarizeBashOutput(output: string, maxTokens: number): string {
  const lines = output.split('\n');

  // Extraire par priorité
  const errorLines = lines.filter(l => l.match(/error|fail|exception/i));
  const warningLines = lines.filter(l => l.match(/warn/i));
  const lastLines = lines.slice(-20);

  // Combiner sans doublons
  const prioritized = [...new Set([
    ...errorLines.slice(0, 10),
    ...warningLines.slice(0, 5),
    ...lastLines
  ])];

  const result = prioritized.join('\n');

  if (countTokens(result) <= maxTokens) {
    return `[📊 Output: ${lines.length} lignes → ${prioritized.length} lignes]\n${result}`;
  }

  // Tronquer si encore trop long
  return truncateToTokens(result, maxTokens);
}
```

| Outil | Stratégie de résumé | Ce qu'on garde |
|-------|---------------------|----------------|
| `bash` | Priorité erreurs | Errors > Warnings > Last 20 lines |
| `read_file` | Structure + highlights | Imports, classes, fonctions clés |
| `search` | Top N matches | Premiers résultats pertinents |
| `list_directory` | Stats + structure | Nombre de fichiers, types |

---

## 9.5 🎭 Observation Masking

### 9.5.1 Le problème des outputs verbeux

Quand un outil retourne un gros résultat, ce résultat reste dans le contexte pour TOUTES les requêtes suivantes — même quand il n'est plus pertinent.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    🎭 OBSERVATION MASKING                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ❌ SANS MASKING                                                        │
│  ════════════════                                                       │
│                                                                         │
│  Message 1 : list_directory("/src")                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Result: 200 fichiers listés                                    │   │
│  │  [5000 tokens de listing complet]                               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Message 2 : "Quelle est la fonction main ?"                           │
│  → Les 5000 tokens de listing sont ENCORE envoyés 😱                   │
│  → Coût inutile, attention diluée                                      │
│                                                                         │
│  ════════════════════════════════════════════════════════════════════  │
│                                                                         │
│  ✅ AVEC MASKING                                                        │
│  ════════════════                                                       │
│                                                                         │
│  Message 1 : list_directory("/src")                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Result: 200 fichiers listés [5000 tokens]                      │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Message 2 : "Quelle est la fonction main ?"                           │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  [MASKED: list_directory - 200 files, see message #1]           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│  → Seulement ~20 tokens                                                │
│  → Le modèle sait que l'info existe si besoin                          │
│                                                                         │
│  💰 Économie : ~4980 tokens par requête suivante !                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 9.5.2 Critères de masquage

```typescript
// src/context/observation-masking.ts

interface MaskingCriteria {
  maxAge: number;              // Masquer après N messages
  minTokensToMask: number;     // Ne masquer que si > N tokens
  relevanceThreshold: number;  // Score de pertinence minimum
  toolSpecificRules: Record<string, ToolMaskingRule>;
}

interface ToolMaskingRule {
  alwaysMaskAfter?: number;    // Masquer après N messages
  keepSummary?: boolean;       // Garder un résumé
  keepMatches?: number;        // Garder les N premiers résultats
  keepIfReferenced?: boolean;  // Garder si référencé récemment
  maskProgressBars?: boolean;  // Masquer les barres de progression
  keepErrors?: boolean;        // Toujours garder les erreurs
}

const DEFAULT_CRITERIA: MaskingCriteria = {
  maxAge: 5,              // Masquer après 5 messages
  minTokensToMask: 500,   // Masquer si > 500 tokens
  relevanceThreshold: 0.3,

  toolSpecificRules: {
    'list_directory': {
      alwaysMaskAfter: 2,
      keepSummary: true
    },
    'search': {
      alwaysMaskAfter: 3,
      keepMatches: 5
    },
    'read_file': {
      alwaysMaskAfter: 5,
      keepIfReferenced: true
    },
    'bash': {
      maskProgressBars: true,
      keepErrors: true
    }
  }
};
```

### 9.5.3 Implémentation

```typescript
// src/context/observation-masking.ts

export class ObservationMasker {
  private criteria: MaskingCriteria;

  /**
   * Détermine si un résultat d'outil doit être masqué.
   */
  shouldMask(
    toolResult: ToolResult,
    currentMessageIndex: number,
    context: ConversationContext
  ): MaskDecision {
    const age = currentMessageIndex - toolResult.messageIndex;
    const tokens = countTokens(toolResult.output);

    // 📏 Règle 1 : Âge
    if (age > this.criteria.maxAge) {
      return { mask: true, reason: 'age', keepSummary: true };
    }

    // 📏 Règle 2 : Trop petit pour valoir la peine
    if (tokens < this.criteria.minTokensToMask) {
      return { mask: false };
    }

    // 📏 Règle 3 : Règles spécifiques à l'outil
    const toolRule = this.criteria.toolSpecificRules[toolResult.toolName];
    if (toolRule?.alwaysMaskAfter && age > toolRule.alwaysMaskAfter) {
      return {
        mask: true,
        reason: 'tool_rule',
        keepSummary: toolRule.keepSummary,
        keepMatches: toolRule.keepMatches
      };
    }

    // 📏 Règle 4 : Pertinence
    const relevance = this.computeRelevance(toolResult, context.currentMessage);
    if (relevance < this.criteria.relevanceThreshold) {
      return { mask: true, reason: 'low_relevance', keepSummary: true };
    }

    return { mask: false };
  }

  /**
   * Génère la version masquée d'un résultat.
   */
  mask(toolResult: ToolResult, decision: MaskDecision): string {
    if (!decision.mask) {
      return toolResult.output;
    }

    const summary = this.generateSummary(toolResult, decision);

    return `[🎭 MASKED: ${toolResult.toolName}]
${summary}
[Full output in message #${toolResult.messageIndex}]`;
  }

  private generateSummary(
    toolResult: ToolResult,
    decision: MaskDecision
  ): string {
    const output = toolResult.output;

    switch (toolResult.toolName) {
      case 'list_directory':
        const fileCount = (output.match(/\n/g) || []).length;
        return `📁 Listed ${fileCount} files/directories`;

      case 'search':
        const matchCount = (output.match(/:\d+:/g) || []).length;
        if (decision.keepMatches) {
          const firstMatches = output
            .split('\n')
            .slice(0, decision.keepMatches)
            .join('\n');
          return `🔍 Found ${matchCount} matches:\n${firstMatches}`;
        }
        return `🔍 Found ${matchCount} matches`;

      case 'bash':
        const lines = output.split('\n').length;
        const hasError = /error|fail/i.test(output);
        return `⚡ Executed (${lines} lines${hasError ? ', ❌ contains errors' : ''})`;

      case 'read_file':
        const lineCount = output.split('\n').length;
        return `📄 File content (${lineCount} lines)`;

      default:
        const tokens = countTokens(output);
        return `📋 Result (${tokens} tokens)`;
    }
  }
}
```

---

## 9.6 🛠️ Implémentation Grok-CLI

### 9.6.1 Architecture du module

```
┌─────────────────────────────────────────────────────────────────────────┐
│               📁 ARCHITECTURE COMPRESSION                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  src/context/                                                           │
│  │                                                                      │
│  ├── context-compressor.ts      # 🗜️ Compression principale            │
│  │   ├── PrioritizedContent     # Interface de contenu                 │
│  │   ├── classifyContent()      # Classification automatique           │
│  │   └── compress()             # Algorithme de compression            │
│  │                                                                      │
│  ├── observation-masking.ts     # 🎭 Masquage des observations         │
│  │   ├── MaskingCriteria        # Critères de masquage                 │
│  │   ├── shouldMask()           # Décision de masquage                 │
│  │   └── mask()                 # Génération du masque                 │
│  │                                                                      │
│  ├── summarizer.ts              # 📝 Résumés intelligents              │
│  │   ├── summarizeConversation  # Résumer l'historique                 │
│  │   └── summarizeToolResult    # Résumer les outputs                  │
│  │                                                                      │
│  └── token-budget.ts            # 📊 Gestion du budget tokens          │
│      ├── TokenBudget            # Classe de budget                     │
│      └── allocate()             # Allocation par priorité              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 9.6.2 Intégration dans l'agent

```typescript
// src/agent/grok-agent.ts

export class GrokAgent {
  private compressor: ContextCompressor;
  private masker: ObservationMasker;
  private tokenBudget: number = 100_000;

  /**
   * Construit le contexte optimisé pour une requête.
   */
  async buildContext(messages: Message[]): Promise<Context> {
    // 1️⃣ Classifier les messages
    const classified = messages.map(m => this.classifyMessage(m));

    // 2️⃣ Masquer les observations anciennes/non pertinentes
    const masked = this.applyMasking(classified);

    // 3️⃣ Compresser pour respecter le budget
    const compressed = await this.compressor.compress(
      masked,
      this.tokenBudget
    );

    // 4️⃣ Optimiser l'ordre (éviter "lost in the middle")
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

  /**
   * Réorganise le contenu pour maximiser l'attention.
   * Stratégie : CRITICAL au début, HIGH ensuite, reste intercalé.
   */
  private optimizeOrder(contents: PrioritizedContent[]): PrioritizedContent[] {
    const critical = contents.filter(c => c.priority === Priority.CRITICAL);
    const high = contents.filter(c => c.priority === Priority.HIGH);
    const rest = contents.filter(c => c.priority < Priority.HIGH);

    // Intercaler le reste pour éviter le "lost in the middle"
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
  // 📊 Budgets
  defaultTokenBudget: 100_000,
  maxTokenBudget: 128_000,

  // 🗜️ Compression
  enableCompression: true,
  compressionThreshold: 0.8,  // Compresser si > 80% du budget

  // 🎭 Masking
  enableMasking: true,
  maskingCriteria: {
    maxAge: 5,
    minTokensToMask: 500,
    relevanceThreshold: 0.3
  },

  // 📝 Summarization
  enableSummarization: true,
  summarizeConversationAfter: 10,  // messages
  maxSummaryTokens: 500,

  // ⚖️ Priorités par type
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

## 9.7 📊 Métriques et Monitoring

### 9.7.1 Dashboard de compression

```typescript
// src/context/metrics.ts

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
}

function printCompressionDashboard(metrics: CompressionMetrics): void {
  const savings = (1 - metrics.avgCompressionRatio) * 100;

  console.log(`
┌─────────────────────────────────────────────────────────────────────────┐
│                    📊 COMPRESSION DASHBOARD                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  🔢 TOKENS                                                             │
│  ├─ Original       : ${metrics.totalOriginalTokens.toLocaleString().padStart(12)}                              │
│  ├─ Compressed     : ${metrics.totalCompressedTokens.toLocaleString().padStart(12)}                              │
│  └─ Ratio          : ${(metrics.avgCompressionRatio * 100).toFixed(1)}% (💚 ${savings.toFixed(1)}% saved)              │
│                                                                         │
│  🔧 OPERATIONS                                                         │
│  ├─ Messages       : ${metrics.messagesProcessed}                                           │
│  ├─ Summarizations : ${metrics.summarizationsPerformed}                                           │
│  └─ Masked obs.    : ${metrics.totalMaskedObservations}                                           │
│                                                                         │
│  💰 ÉCONOMIES                                                          │
│  └─ Estimated      : $${metrics.estimatedCostSaved.toFixed(2)}                                    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
  `);
}
```

### 9.7.2 Alertes de santé

```typescript
function checkCompressionHealth(metrics: CompressionMetrics): Alert[] {
  const alerts: Alert[] = [];

  // ⚠️ Compression trop agressive
  if (metrics.avgCompressionRatio < 0.3) {
    alerts.push({
      level: 'warning',
      message: '⚠️ Compression très agressive (< 30%), risque de perte d\'info'
    });
  }

  // ℹ️ Pas assez de compression
  if (metrics.avgCompressionRatio > 0.95) {
    alerts.push({
      level: 'info',
      message: 'ℹ️ Compression minimale, budget peut-être trop élevé'
    });
  }

  // ⚠️ Trop de summarizations
  if (metrics.summarizationsPerformed > metrics.messagesProcessed * 0.5) {
    alerts.push({
      level: 'warning',
      message: '⚠️ Beaucoup de résumés, messages peut-être trop longs'
    });
  }

  return alerts;
}
```

---

## 9.8 💼 Cas Pratiques

### Cas 1 : Session longue

```
┌─────────────────────────────────────────────────────────────────────────┐
│  📝 Session de 50 messages, 150K tokens originaux                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ❌ SANS COMPRESSION :                                                  │
│     → Dépasse la limite de contexte (128K)                             │
│     → Erreur ou troncature brutale                                     │
│                                                                         │
│  ✅ AVEC COMPRESSION :                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Messages 1-40 :  Résumé             →  1,500 tokens            │   │
│  │  Messages 41-50 : Complets           → 15,000 tokens            │   │
│  │  Tool results :   Masqués            →  2,000 tokens            │   │
│  │  Code context :   Conservé           → 25,000 tokens            │   │
│  │  ─────────────────────────────────────────────────              │   │
│  │  Total :                               45,000 tokens            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  📊 Réduction : 70%                                                    │
│  ✨ Qualité : Préservée (info critique gardée)                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Cas 2 : Recherche massive

```
┌─────────────────────────────────────────────────────────────────────────┐
│  🔍 Tool: search("error handling")                                      │
│     Result: 2,847 matches (35,000 tokens)                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ❌ SANS MASKING :                                                      │
│     → 35K tokens dans CHAQUE message suivant                           │
│     → Coût × 10                                                        │
│                                                                         │
│  ✅ AVEC MASKING INTELLIGENT :                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Message actuel :                                                │   │
│  │  [Top 10 matches avec contexte]                    2,000 tokens │   │
│  │                                                                  │   │
│  │  Messages suivants :                                             │   │
│  │  [🎭 MASKED: search - 2,847 matches, see #5]          50 tokens │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  💰 Économie : ~33,000 tokens par message suivant                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Cas 3 : Logs verbeux

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ⚡ Tool: bash("npm install")                                           │
│     Result: 5,000 lignes de logs (25,000 tokens)                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Compression appliquée :                                               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  ❌ Supprimé :                                                   │   │
│  │     - Progress bars (███████░░░░)                               │   │
│  │     - Timestamps répétés                                        │   │
│  │     - Lignes vides                                              │   │
│  │                                                                  │   │
│  │  ✅ Conservé :                                                   │   │
│  │     - Erreurs et warnings                                       │   │
│  │     - Versions installées                                       │   │
│  │     - Résumé final                                              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Résultat compressé (500 tokens) :                                     │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  [📊 npm install - 5000 lines compressed]                       │   │
│  │  ✅ Installed 847 packages                                      │   │
│  │  ⚠️ Warnings: 3 deprecation notices                             │   │
│  │  ❌ No errors                                                    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  📊 Réduction : 98%                                                    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 📝 Points Clés

| Concept | Point clé |
|---------|-----------|
| 💸 **Problème** | Contexte long = cher, lent, imprécis |
| ⚖️ **Priority-based** | Garder le critique, compresser le reste |
| 📝 **Summarization** | Résumer les parties longues |
| 🎭 **Observation masking** | Cacher les outputs d'outils anciens |
| 📊 **Token budget** | Respecter une limite stricte |
| 🧠 **Lost in the Middle** | Placer l'important au début/fin |
| 📈 **Résultats** | -70% tokens, +2.6% succès |

---

## 🏋️ Exercices

### Exercice 1 : Système de priorités
**Objectif** : Définir vos priorités

| Type de contenu | Priorité | Justification |
|-----------------|:--------:|---------------|
| System prompt | | |
| Message utilisateur actuel | | |
| Résultat d'erreur | | |
| Logs npm | | |
| Conversation d'hier | | |

### Exercice 2 : Règles de masking
**Objectif** : Implémenter des règles pour votre workflow

```typescript
const myMaskingRules: Record<string, ToolMaskingRule> = {
  'my_custom_tool': {
    alwaysMaskAfter: ???,
    keepSummary: ???,
    keepErrors: ???
  }
};
```

### Exercice 3 : Benchmark qualité
**Objectif** : Mesurer l'impact sur la qualité

| Question | Sans compression | Avec compression | Différence |
|----------|:----------------:|:----------------:|:----------:|
| Q1 | | | |
| Q2 | | | |
| ... | | | |

### Exercice 4 : Trouver le ratio optimal
**Objectif** : Équilibre coût/qualité

| Compression | Coût | Qualité | Score |
|:-----------:|:----:|:-------:|:-----:|
| 0% | | | |
| 30% | | | |
| 50% | | | |
| 70% | | | |

---

## 📚 Références

| Type | Référence |
|------|-----------|
| 📄 Paper | JetBrains Research. (2024). "Context Compression for LLM-based Code Generation" |
| 📄 Paper | Liu, N., et al. (2023). "Lost in the Middle: How Language Models Use Long Contexts" |
| 💻 Code | Grok-CLI : `src/context/context-compressor.ts` |
| 💻 Code | Grok-CLI : `src/context/observation-masking.ts` |

---

## 🌅 Épilogue — Le Prix de l'Attention

*Un mois plus tard. 23h45. Lina fixe sa nouvelle facture API.*

**Lina** *(un sourire se dessinant)* : "253 dollars."

*Elle fait le calcul dans sa tête. 847 dollars le mois dernier. 253 maintenant. Presque 70% de moins.*

**Marc** *(levant les yeux de son écran)* : "Et les réponses ?"

**Lina** : "C'est ça le plus fou. Elles sont meilleures. Vraiment meilleures."

*Elle pivote son écran vers lui. Un log de session, annoté.*

**Lina** : "Regarde. Avant, quand je demandais de corriger un bug, l'agent citait parfois de la documentation obsolète qu'il avait lue 20 messages plus tôt. Maintenant, il va droit au code pertinent."

**Marc** : "Le paradoxe de JetBrains. Moins de contexte, mais mieux ciblé. Le modèle n'a plus à choisir où regarder parmi 150,000 tokens. On a fait ce choix pour lui."

*Un silence. Lina se mord la lèvre, pensive.*

**Lina** : "Marc... J'ai une question qui me trotte dans la tête depuis quelques jours."

**Marc** : "Hmm ?"

**Lina** : "On optimise le contexte. On optimise la mémoire. On a même un RAG avec dépendances. Mais... l'agent a 41 outils à sa disposition. 41. Comment il sait lequel utiliser ?"

*Marc pose son café. Son expression change — un mélange de satisfaction et d'anticipation, comme un professeur dont l'élève vient de poser exactement la bonne question.*

**Marc** : "Ah. Tu touches à quelque chose de fondamental là."

**Lina** : "C'est juste que... parfois je le vois hésiter. Ou pire, utiliser `bash` pour quelque chose que `read_file` ferait mieux. Ou faire trois appels séquentiels quand il pourrait paralléliser."

**Marc** : "Tu as remarqué ça ?"

**Lina** : "Difficile de ne pas le remarquer quand on regarde la facture en détail."

*Marc se lève, va au tableau blanc, et dessine un schéma.*

**Marc** : "Les outils sont le **système nerveux** de l'agent. Tout ce qu'on a construit — le reasoning, la mémoire, le contexte — tout ça converge vers un moment critique : le **tool call**."

*Il trace une flèche.*

**Marc** : "C'est là que l'intention devient action. Et c'est là que la plupart des agents échouent."

**Lina** *(intriguée)* : "Comment ça ?"

**Marc** : "Un outil mal choisi, c'est du temps perdu et de l'argent gaspillé. Un outil mal paramétré, c'est une erreur à corriger. Un outil exécuté sans validation... c'est un risque de sécurité."

*Il se retourne vers elle, une lueur dans les yeux.*

**Marc** : "Tu veux vraiment comprendre comment fonctionne un agent LLM ?"

**Lina** : "Évidemment."

**Marc** : "Alors il est temps de plonger dans le **Tool-Use**. Le vrai. Pas juste 'appeler une fonction'. On va parler de validation de schéma, de permissions, de confirmation utilisateur, d'exécution parallèle... et de ce qui se passe quand un outil échoue."

*Lina ferme la facture et ouvre un nouveau fichier.*

**Lina** : "Je suis prête."

**Marc** *(souriant)* : "Tu vas adorer. Et détester. Probablement les deux en même temps."

*Il écrit au tableau : "41 outils. 1 décision. 0 marge d'erreur."*

---

*Fin de la Partie III — Mémoire, RAG et Contexte*

*Dans le prochain chapitre : Comment transformer une intention en action — sans casser quoi que ce soit.*

---

<div align="center">

**← [Chapitre 8 : Dependency-Aware RAG](08-dependency-aware-rag.md)** | **[Sommaire](README.md)** | **[Chapitre 10 : Tool-Use](10-tool-use.md) →**

</div>
