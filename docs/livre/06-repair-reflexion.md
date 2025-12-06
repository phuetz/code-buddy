# Chapitre 6 — Repair, Réflexion et Auto-Amélioration

---

> **Scène**
>
> *Lina regarde son agent échouer pour la cinquième fois sur le même bug.*
>
> *"Il fait exactement la même erreur à chaque fois," dit-elle, exaspérée. "Il génère du code, ça échoue, il régénère... le même code."*
>
> *Elle réfléchit à comment elle-même corrige un bug. Elle ne réessaie pas aveuglément — elle lit le message d'erreur, comprend ce qui a échoué, et adapte son approche.*
>
> *"Il lui manque la boucle de feedback," réalise-t-elle. "Il génère, mais il n'apprend pas de ses échecs."*
>
> *Elle ouvre le papier "ChatRepair" sur son écran. C'est exactement ce qu'il lui faut.*

---

## Introduction

Les LLMs échouent souvent au premier essai. C'est normal — même les développeurs expérimentés ne résolvent pas tous les bugs du premier coup. La différence, c'est que les humains apprennent de leurs erreurs et adaptent leur approche.

Ce chapitre présente les techniques de **réparation itérative** : comment faire en sorte qu'un agent apprenne de ses échecs, localise précisément les fautes, et converge vers une solution.

---

## 6.1 Le Problème de la Réparation Single-Shot

### 6.1.1 Pourquoi le premier essai échoue souvent

```
Statistiques typiques sur SWE-bench :

Single-shot (un seul essai) :
├─ Taux de succès : ~15%
├─ Erreurs communes :
│   ├─ Mauvais fichier modifié (30%)
│   ├─ Solution partielle (25%)
│   ├─ Régression introduite (20%)
│   └─ Hallucination de code (25%)

Avec réparation itérative :
├─ Taux de succès : ~40% (+167%)
├─ Moyenne d'itérations : 2.3
└─ Max utile : 5 itérations
```

### 6.1.2 Pourquoi réessayer ne suffit pas

Le problème n'est pas de réessayer, c'est de réessayer **intelligemment** :

```
Mauvaise approche (regenerate) :
─────────────────────────────────
Essai 1 : Génère solution A → Échoue
Essai 2 : Génère solution A' → Échoue (souvent similaire)
Essai 3 : Génère solution A'' → Échoue

Le modèle n'a pas de feedback, il explore aléatoirement.


Bonne approche (repair) :
─────────────────────────
Essai 1 : Génère solution A → Échoue avec erreur E
Essai 2 : Analyse E, génère solution B → Échoue avec erreur E'
Essai 3 : Analyse E', corrige précisément → Succès

Le modèle apprend de chaque échec.
```

---

## 6.2 L'Architecture ChatRepair

### 6.2.1 Vue d'ensemble

ChatRepair (ISSTA 2024) propose une boucle de réparation guidée par les tests :

```
┌─────────────────────────────────────────────────────────────────────┐
│                      CHATREPAIR LOOP                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   Bug Report / Failing Test                                         │
│            │                                                         │
│            ▼                                                         │
│   ┌────────────────────┐                                            │
│   │  FAULT LOCALIZATION │ ◄── Où est le problème ?                  │
│   └─────────┬──────────┘                                            │
│             │                                                        │
│             ▼                                                        │
│   ┌────────────────────┐                                            │
│   │  PATCH GENERATION  │ ◄── Générer un correctif                   │
│   └─────────┬──────────┘                                            │
│             │                                                        │
│             ▼                                                        │
│   ┌────────────────────┐                                            │
│   │  TEST EXECUTION    │ ◄── Vérifier le correctif                  │
│   └─────────┬──────────┘                                            │
│             │                                                        │
│        ┌────┴────┐                                                  │
│        │ Succès? │                                                  │
│        └────┬────┘                                                  │
│         Non │  Oui                                                  │
│             │   │                                                   │
│             ▼   ▼                                                   │
│   ┌──────────────┐  ┌──────────────┐                               │
│   │   FEEDBACK   │  │   TERMINÉ    │                               │
│   │ Analyser     │  │   ✓          │                               │
│   │ l'erreur     │  └──────────────┘                               │
│   └──────┬───────┘                                                  │
│          │                                                          │
│          └────────────────────────────────▶ (retour à GENERATION)   │
│                                                                      │
│   Max 5 itérations (au-delà, rendements décroissants)               │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.2.2 Les trois composants clés

| Composant | Rôle | Technique |
|-----------|------|-----------|
| **Fault Localization** | Trouver où est le bug | Ochiai, DStar, coverage |
| **Patch Generation** | Proposer un correctif | LLM avec contexte ciblé |
| **Test Validation** | Vérifier le correctif | Exécution des tests |

---

## 6.3 Fault Localization : Trouver le Bug

### 6.3.1 Pourquoi c'est crucial

Donner au LLM tout le code et lui demander de trouver le bug est inefficace :

```
Mauvais prompt :
───────────────
"Voici les 50 fichiers du projet. Trouve et corrige le bug."
→ Le modèle est noyé, hallucine souvent

Bon prompt :
───────────
"Le bug est probablement dans calculateTotal() (fichier math.ts, ligne 45).
Le test échoue avec 'expected 100, got NaN'. Corrige."
→ Le modèle a un focus précis
```

### 6.3.2 Techniques de localisation

**1. Spectrum-Based Fault Localization (SBFL)**

Utilise la couverture des tests pour identifier les lignes suspectes :

```
┌─────────────────────────────────────────────────────────────────────┐
│                  SPECTRUM-BASED FAULT LOCALIZATION                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   Tests :    T1(pass)  T2(fail)  T3(pass)  T4(fail)                │
│                                                                      │
│   Ligne 10:    ✓         ✓         ✓         ✓                      │
│   Ligne 11:    ✓         ✓         ✗         ✓                      │
│   Ligne 12:    ✗         ✓         ✗         ✓    ← Suspecte !      │
│   Ligne 13:    ✓         ✓         ✓         ✗                      │
│                                                                      │
│   Ligne 12 : Exécutée par TOUS les tests qui échouent              │
│              PAS exécutée par les tests qui passent                 │
│              → Très probablement le bug !                           │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**2. Formules de suspicion**

| Formule | Calcul | Caractéristique |
|---------|--------|-----------------|
| **Ochiai** | `failed / √((failed+passed) × totalFailed)` | Bon équilibre |
| **DStar** | `failed² / (passed + (totalFailed - failed))` | Haute précision |
| **Tarantula** | `(failed/totalFailed) / ((failed/totalFailed) + (passed/totalPassed))` | Équilibré |

```typescript
// src/agent/repair/fault-localization.ts
interface LineSuspicion {
  file: string;
  line: number;
  suspicion: number;  // 0-1
  formula: string;
}

function ochiai(
  executedByFailed: number,  // Fois exécutée par tests échoués
  executedByPassed: number,  // Fois exécutée par tests passés
  totalFailed: number        // Nombre total de tests échoués
): number {
  const failed = executedByFailed;
  const passed = executedByPassed;

  if (failed === 0) return 0;

  return failed / Math.sqrt((failed + passed) * totalFailed);
}

function dstar(
  executedByFailed: number,
  executedByPassed: number,
  totalFailed: number,
  star: number = 2  // Exposant, typiquement 2
): number {
  const failed = executedByFailed;
  const passed = executedByPassed;
  const notFailed = totalFailed - failed;

  const denominator = passed + notFailed;
  if (denominator === 0) return 0;

  return Math.pow(failed, star) / denominator;
}
```

### 6.3.3 Localisation par LLM

Quand on n'a pas de coverage, le LLM peut localiser :

```typescript
async function llmLocalize(
  error: string,
  stackTrace: string,
  relevantFiles: string[]
): Promise<LineSuspicion[]> {
  const prompt = `
    Erreur : ${error}

    Stack trace :
    ${stackTrace}

    Fichiers potentiellement concernés :
    ${relevantFiles.map(f => `- ${f}`).join('\n')}

    Identifie les 3 endroits les plus probables du bug.

    Format JSON :
    [
      { "file": "...", "line": ..., "reason": "..." },
      ...
    ]
  `;

  const response = await llm.complete(prompt, { temperature: 0 });
  return JSON.parse(response);
}
```

### 6.3.4 Combinaison des techniques

```typescript
// src/agent/repair/fault-localization.ts
export class FaultLocalizer {
  async localize(
    error: TestError,
    context: CodeContext
  ): Promise<LineSuspicion[]> {
    const suspicions: LineSuspicion[] = [];

    // 1. Stack trace (si disponible)
    if (error.stackTrace) {
      const stackSuspicions = this.parseStackTrace(error.stackTrace);
      suspicions.push(...stackSuspicions.map(s => ({ ...s, weight: 0.9 })));
    }

    // 2. SBFL (si coverage disponible)
    if (context.coverage) {
      const sbflSuspicions = this.computeSBFL(error, context.coverage);
      suspicions.push(...sbflSuspicions.map(s => ({ ...s, weight: 0.8 })));
    }

    // 3. LLM (toujours)
    const llmSuspicions = await this.llmLocalize(error, context);
    suspicions.push(...llmSuspicions.map(s => ({ ...s, weight: 0.7 })));

    // Combiner et dédupliquer
    return this.mergeSuspicions(suspicions);
  }

  private mergeSuspicions(suspicions: LineSuspicion[]): LineSuspicion[] {
    const byLocation = new Map<string, LineSuspicion[]>();

    for (const s of suspicions) {
      const key = `${s.file}:${s.line}`;
      if (!byLocation.has(key)) {
        byLocation.set(key, []);
      }
      byLocation.get(key)!.push(s);
    }

    // Combiner les scores pour chaque location
    return Array.from(byLocation.entries())
      .map(([key, items]) => {
        const [file, line] = key.split(':');
        // Score combiné pondéré
        const totalWeight = items.reduce((sum, i) => sum + i.weight, 0);
        const weightedScore = items.reduce(
          (sum, i) => sum + i.suspicion * i.weight,
          0
        ) / totalWeight;

        return {
          file,
          line: parseInt(line),
          suspicion: weightedScore,
          formula: 'combined'
        };
      })
      .sort((a, b) => b.suspicion - a.suspicion);
  }
}
```

---

## 6.4 Patch Generation : Générer le Correctif

### 6.4.1 Contexte minimal mais suffisant

Le secret d'une bonne génération : donner au LLM exactement ce dont il a besoin.

```typescript
function buildRepairContext(
  suspicion: LineSuspicion,
  error: TestError,
  codebase: Codebase
): RepairContext {
  // Le code suspect avec contexte
  const suspiciousCode = codebase.getLines(
    suspicion.file,
    suspicion.line - 10,  // 10 lignes avant
    suspicion.line + 10   // 10 lignes après
  );

  // Les types et imports pertinents
  const imports = codebase.getImports(suspicion.file);
  const types = codebase.getReferencedTypes(suspiciousCode);

  // Le test qui échoue
  const failingTest = error.testCode;

  // L'erreur exacte
  const errorMessage = error.message;

  return {
    suspiciousCode,
    lineNumber: suspicion.line,
    imports,
    types,
    failingTest,
    errorMessage,
    previousAttempts: [] // Sera rempli lors des itérations
  };
}
```

### 6.4.2 Prompt de réparation

```typescript
async function generatePatch(context: RepairContext): Promise<Patch> {
  const prompt = `
Tu es un expert en correction de bugs. Corrige le bug suivant.

## Code suspect (autour de la ligne ${context.lineNumber})
\`\`\`typescript
${context.suspiciousCode}
\`\`\`

## Erreur
${context.errorMessage}

## Test qui échoue
\`\`\`typescript
${context.failingTest}
\`\`\`

${context.previousAttempts.length > 0 ? `
## Tentatives précédentes (ont échoué)
${context.previousAttempts.map((a, i) => `
Tentative ${i + 1}:
${a.patch}
Erreur: ${a.error}
`).join('\n')}

Ne répète PAS ces erreurs. Essaie une approche différente.
` : ''}

## Instructions
1. Analyse la cause root du bug
2. Propose un correctif MINIMAL
3. Ne change que ce qui est nécessaire
4. Préserve le comportement pour les autres cas

## Format de réponse
\`\`\`diff
- ligne à supprimer
+ ligne à ajouter
\`\`\`

Explication courte du correctif :
`;

  const response = await llm.complete(prompt, { temperature: 0.3 });
  return parsePatch(response);
}
```

### 6.4.3 Templates de réparation

Certains patterns de bugs sont récurrents. Grok-CLI maintient une bibliothèque de templates :

```typescript
// src/agent/repair/repair-templates.ts
export const REPAIR_TEMPLATES: RepairTemplate[] = [
  // Null/undefined check
  {
    pattern: /cannot read propert.*of (undefined|null)/i,
    template: (match, context) => `
      // Ajouter une vérification null avant l'accès
      if (${context.variable} == null) {
        return ${context.defaultValue ?? 'null'};
      }
    `,
    confidence: 0.85
  },

  // Division by zero
  {
    pattern: /division by zero|NaN|Infinity/i,
    template: (match, context) => `
      // Ajouter une garde contre division par zéro
      if (${context.divisor} === 0) {
        throw new Error('Division by zero');
        // Ou: return 0;
      }
    `,
    confidence: 0.90
  },

  // Array index out of bounds
  {
    pattern: /index out of (bounds|range)|undefined is not an object/i,
    template: (match, context) => `
      // Vérifier les bornes du tableau
      if (${context.index} < 0 || ${context.index} >= ${context.array}.length) {
        throw new RangeError('Index out of bounds');
      }
    `,
    confidence: 0.80
  },

  // Async/await missing
  {
    pattern: /is not a function.*then|promise.*undefined/i,
    template: (match, context) => `
      // Ajouter await sur l'appel asynchrone
      const result = await ${context.asyncCall};
    `,
    confidence: 0.75
  },

  // Type mismatch
  {
    pattern: /cannot.*string.*number|expected.*got/i,
    template: (match, context) => `
      // Convertir le type
      const converted = ${context.conversion}(${context.value});
    `,
    confidence: 0.70
  }
];

export function findMatchingTemplate(error: string): RepairTemplate | null {
  for (const template of REPAIR_TEMPLATES) {
    if (template.pattern.test(error)) {
      return template;
    }
  }
  return null;
}
```

---

## 6.5 La Boucle de Réparation Complète

### 6.5.1 Implémentation Grok-CLI

```typescript
// src/agent/repair/iterative-repair.ts
export class IterativeRepairEngine {
  private localizer: FaultLocalizer;
  private generator: PatchGenerator;
  private validator: TestValidator;
  private learning: RepairLearning;

  private maxIterations = 5;

  async repair(
    error: TestError,
    context: CodeContext
  ): Promise<RepairResult> {
    const attempts: RepairAttempt[] = [];
    let currentError = error;

    for (let i = 0; i < this.maxIterations; i++) {
      console.log(`\n--- Repair iteration ${i + 1}/${this.maxIterations} ---`);

      // Phase 1 : Localisation
      const suspicions = await this.localizer.localize(currentError, context);

      if (suspicions.length === 0) {
        return { success: false, reason: 'Cannot localize fault', attempts };
      }

      const topSuspicion = suspicions[0];
      console.log(`Suspect: ${topSuspicion.file}:${topSuspicion.line} (${(topSuspicion.suspicion * 100).toFixed(0)}%)`);

      // Phase 2 : Génération
      const repairContext = this.buildContext(topSuspicion, currentError, context, attempts);

      // Vérifier si on a un template qui matche
      const template = findMatchingTemplate(currentError.message);
      let patch: Patch;

      if (template && template.confidence > 0.8 && i === 0) {
        // Utiliser le template pour la première tentative
        patch = this.applyTemplate(template, repairContext);
        console.log(`Using repair template (${(template.confidence * 100).toFixed(0)}% confidence)`);
      } else {
        // Génération LLM
        patch = await this.generator.generate(repairContext);
      }

      console.log(`Generated patch:\n${patch.diff}`);

      // Phase 3 : Application et validation
      const applied = await this.applyPatch(patch, context);

      if (!applied.success) {
        attempts.push({
          patch,
          error: applied.error,
          iteration: i + 1
        });
        continue;
      }

      // Phase 4 : Exécution des tests
      const testResult = await this.validator.runTests(context.testFile);

      if (testResult.allPassed) {
        // Succès !
        console.log(`✓ All tests pass after ${i + 1} iterations`);

        // Apprendre de ce succès
        await this.learning.recordSuccess(currentError, patch);

        return {
          success: true,
          patch,
          iterations: i + 1,
          attempts
        };
      }

      // Échec - préparer la prochaine itération
      attempts.push({
        patch,
        error: testResult.error,
        iteration: i + 1
      });

      // Mettre à jour l'erreur courante
      currentError = testResult.error;

      // Vérifier si on progresse
      if (i > 0 && this.isSameError(currentError, attempts[i - 1].error)) {
        console.log('Same error as previous iteration, trying different approach');
        // Forcer une approche différente
        repairContext.forceDifferentApproach = true;
      }
    }

    // Max iterations atteint
    return {
      success: false,
      reason: `Max iterations (${this.maxIterations}) reached`,
      attempts
    };
  }

  private isSameError(e1: TestError, e2: TestError): boolean {
    // Comparer les messages d'erreur (normalisés)
    const normalize = (msg: string) =>
      msg.toLowerCase().replace(/\d+/g, 'N').replace(/\s+/g, ' ');

    return normalize(e1.message) === normalize(e2.message);
  }

  private buildContext(
    suspicion: LineSuspicion,
    error: TestError,
    context: CodeContext,
    attempts: RepairAttempt[]
  ): RepairContext {
    return {
      ...buildRepairContext(suspicion, error, context.codebase),
      previousAttempts: attempts,
      relatedFixes: this.learning.findSimilarFixes(error)
    };
  }
}
```

### 6.5.2 Gestion des tentatives précédentes

Le feedback des tentatives précédentes est crucial :

```typescript
interface RepairAttempt {
  patch: Patch;
  error: TestError;
  iteration: number;
  analysis?: string;  // Pourquoi ça n'a pas marché
}

function formatPreviousAttempts(attempts: RepairAttempt[]): string {
  if (attempts.length === 0) return '';

  return `
## Tentatives précédentes (ont échoué)

${attempts.map((a, i) => `
### Tentative ${i + 1}
**Patch appliqué:**
\`\`\`diff
${a.patch.diff}
\`\`\`

**Résultat:** ${a.error.message}

**Analyse:** ${a.analysis ?? 'Le correctif était insuffisant ou incorrect'}
`).join('\n---\n')}

⚠️ Important: Ne répète PAS les mêmes erreurs.
Essaie une approche DIFFÉRENTE.
`;
}
```

---

## 6.6 Apprentissage des Patterns de Réparation

### 6.6.1 Mémoriser ce qui fonctionne

```typescript
// src/learning/repair-learning.ts
export class RepairLearning {
  private db: Database;

  async recordSuccess(error: TestError, patch: Patch): Promise<void> {
    const errorPattern = this.extractPattern(error.message);
    const solutionPattern = this.extractSolutionPattern(patch);

    // Chercher si on connaît déjà ce pattern
    const existing = await this.db.get(`
      SELECT * FROM repair_learning
      WHERE error_pattern = ?
    `, [errorPattern]);

    if (existing) {
      // Incrémenter le compteur de succès
      await this.db.run(`
        UPDATE repair_learning
        SET success_count = success_count + 1,
            last_used = datetime('now')
        WHERE id = ?
      `, [existing.id]);
    } else {
      // Nouveau pattern
      await this.db.run(`
        INSERT INTO repair_learning
        (error_pattern, solution_pattern, success_count, created_at)
        VALUES (?, ?, 1, datetime('now'))
      `, [errorPattern, solutionPattern]);
    }
  }

  async findSimilarFixes(error: TestError): Promise<SimilarFix[]> {
    const errorPattern = this.extractPattern(error.message);

    // Recherche par similarité
    const fixes = await this.db.all(`
      SELECT solution_pattern, success_count, failure_count,
             (success_count * 1.0 / (success_count + failure_count + 1)) as confidence
      FROM repair_learning
      WHERE error_pattern LIKE ?
      ORDER BY confidence DESC
      LIMIT 5
    `, [`%${errorPattern}%`]);

    return fixes.map(f => ({
      solution: f.solution_pattern,
      confidence: f.confidence,
      timesUsed: f.success_count + f.failure_count
    }));
  }

  private extractPattern(errorMessage: string): string {
    // Normaliser le message d'erreur
    return errorMessage
      .toLowerCase()
      // Remplacer les valeurs spécifiques par des placeholders
      .replace(/['"][^'"]+['"]/g, '"VALUE"')
      .replace(/\d+/g, 'N')
      .replace(/0x[a-f0-9]+/gi, 'ADDR')
      .replace(/at\s+\S+:\d+:\d+/g, 'at LOCATION')
      .trim();
  }

  private extractSolutionPattern(patch: Patch): string {
    // Extraire le type de correction
    const patterns = [];

    if (patch.diff.includes('if') && patch.diff.includes('null')) {
      patterns.push('null_check');
    }
    if (patch.diff.includes('try') && patch.diff.includes('catch')) {
      patterns.push('try_catch');
    }
    if (patch.diff.includes('await')) {
      patterns.push('add_await');
    }
    if (patch.diff.includes('?.')) {
      patterns.push('optional_chaining');
    }
    if (patch.diff.includes('??')) {
      patterns.push('nullish_coalescing');
    }

    return patterns.join(',') || 'custom';
  }
}
```

### 6.6.2 Utiliser les patterns appris

```typescript
async function generatePatchWithLearning(
  context: RepairContext,
  learning: RepairLearning
): Promise<Patch> {
  // Chercher des patterns similaires
  const similarFixes = await learning.findSimilarFixes(context.error);

  let prompt = buildBasePrompt(context);

  if (similarFixes.length > 0) {
    prompt += `

## Patterns qui ont fonctionné pour des erreurs similaires

${similarFixes.slice(0, 3).map((fix, i) => `
${i + 1}. **${fix.solution}** (${(fix.confidence * 100).toFixed(0)}% succès, utilisé ${fix.timesUsed} fois)
`).join('')}

Considère ces patterns dans ta solution, mais adapte-les au contexte actuel.
`;
  }

  return generatePatch(prompt);
}
```

---

## 6.7 Réflexion et Self-Improvement

### 6.7.1 Auto-analyse des échecs

Quand la réparation échoue complètement, l'agent peut analyser pourquoi :

```typescript
async function analyzeRepairFailure(
  attempts: RepairAttempt[],
  context: CodeContext
): Promise<FailureAnalysis> {
  const prompt = `
    Tu es un expert en debugging. Analyse pourquoi ces tentatives de réparation ont échoué.

    ## Bug original
    ${context.originalError}

    ## Tentatives de réparation
    ${attempts.map((a, i) => `
    Tentative ${i + 1}:
    Patch: ${a.patch.diff}
    Résultat: ${a.error.message}
    `).join('\n---\n')}

    ## Questions à analyser
    1. Quel est le vrai problème sous-jacent ?
    2. Pourquoi chaque tentative a-t-elle échoué ?
    3. Qu'est-ce qui aurait dû être fait différemment ?
    4. Y a-t-il un pattern commun dans les échecs ?

    ## Format de réponse (JSON)
    {
      "rootCause": "...",
      "attemptAnalysis": [
        { "attempt": 1, "whyFailed": "..." },
        ...
      ],
      "betterApproach": "...",
      "lessonsLearned": ["...", "..."]
    }
  `;

  const response = await llm.complete(prompt, { temperature: 0 });
  return JSON.parse(response);
}
```

### 6.7.2 Amélioration du prompt engineering

L'agent peut améliorer ses propres prompts :

```typescript
async function improveRepairPrompt(
  currentPrompt: string,
  failures: FailureAnalysis[]
): Promise<string> {
  // Analyser les patterns d'échec
  const commonIssues = analyzeCommonIssues(failures);

  const prompt = `
    Ce prompt de réparation a eu des problèmes :

    ${currentPrompt}

    Problèmes identifiés :
    ${commonIssues.map(i => `- ${i}`).join('\n')}

    Réécris le prompt pour éviter ces problèmes.
    Garde le même format général mais améliore :
    1. La clarté des instructions
    2. Les exemples donnés
    3. Les garde-fous contre les erreurs courantes
  `;

  return llm.complete(prompt);
}
```

### 6.7.3 Méta-apprentissage

L'agent peut apprendre quelles stratégies fonctionnent le mieux :

```typescript
// src/learning/meta-learning.ts
interface StrategyStats {
  strategy: string;
  successRate: number;
  avgIterations: number;
  bestFor: string[];  // Types de bugs
}

export class MetaLearning {
  async updateStrategyStats(
    strategy: string,
    bugType: string,
    success: boolean,
    iterations: number
  ): Promise<void> {
    await this.db.run(`
      INSERT INTO strategy_stats (strategy, bug_type, success, iterations, timestamp)
      VALUES (?, ?, ?, ?, datetime('now'))
    `, [strategy, bugType, success ? 1 : 0, iterations]);
  }

  async getBestStrategy(bugType: string): Promise<StrategyStats | null> {
    const stats = await this.db.get(`
      SELECT strategy,
             AVG(success) as success_rate,
             AVG(iterations) as avg_iterations,
             COUNT(*) as sample_size
      FROM strategy_stats
      WHERE bug_type = ?
      GROUP BY strategy
      HAVING sample_size >= 5
      ORDER BY success_rate DESC, avg_iterations ASC
      LIMIT 1
    `, [bugType]);

    return stats;
  }
}
```

---

## 6.8 Cas Pratiques

### 6.8.1 Cas 1 : Null Pointer Exception

```
Bug : TypeError: Cannot read property 'name' of undefined

Itération 1 :
─────────────
Localisation : user.name (ligne 42)
Patch : if (user) return user.name;
Test : FAIL - user.name toujours undefined quand user = {}

Itération 2 :
─────────────
Feedback : user existe mais name peut être undefined
Patch : return user?.name ?? 'Unknown';
Test : PASS ✓

Apprentissage : "Cannot read property X of undefined" → "optional_chaining + default"
```

### 6.8.2 Cas 2 : Race Condition

```
Bug : Parfois counter devient négatif

Itération 1 :
─────────────
Localisation : counter-- (ligne 78)
Patch : counter = Math.max(0, counter - 1);
Test : FAIL - masque le problème mais ne le résout pas

Itération 2 :
─────────────
Feedback : Le vrai problème est la race condition
Patch : Ajout d'un mutex autour de counter
Test : FAIL - deadlock dans certains cas

Itération 3 :
─────────────
Feedback : Mutex trop agressif
Patch : Utiliser AtomicInteger ou compareAndSet
Test : PASS ✓

Apprentissage : "Race condition on counter" → "atomic_operations"
```

### 6.8.3 Cas 3 : Async/Await manquant

```
Bug : Promise { <pending> } instead of value

Itération 1 :
─────────────
Localisation : const result = fetchData() (ligne 23)
Patch : const result = await fetchData();
Test : FAIL - fonction appelante n'est pas async

Itération 2 :
─────────────
Feedback : Besoin de propager async
Patch : async function caller() { const result = await fetchData(); }
Test : FAIL - caller() pas await dans le test

Itération 3 :
─────────────
Feedback : Cascade d'async jusqu'au test
Patch : + await sur tous les appels de la chaîne
Test : PASS ✓

Apprentissage : "Promise pending" → "async_cascade"
```

---

## 6.9 Métriques et Évaluation

### 6.9.1 Métriques de réparation

```typescript
interface RepairMetrics {
  // Efficacité
  successRate: number;           // % de bugs corrigés
  avgIterations: number;         // Moyenne d'itérations
  firstTrySuccessRate: number;   // % corrigés du premier coup

  // Qualité
  regressionRate: number;        // % de correctifs qui cassent autre chose
  minimalPatchRate: number;      // % de patches minimaux (pas de bloat)

  // Efficience
  avgLocalizationTime: number;   // Temps moyen de localisation
  avgGenerationTime: number;     // Temps moyen de génération
  apiCallsPerRepair: number;     // Appels LLM par réparation
}
```

### 6.9.2 Dashboard de réparation

```typescript
function printRepairDashboard(metrics: RepairMetrics): void {
  console.log(`
┌─────────────────────────────────────────────────────────────┐
│                  REPAIR DASHBOARD                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  EFFICACITÉ                                                 │
│  ├─ Success Rate      : ${(metrics.successRate * 100).toFixed(1)}%                       │
│  ├─ First-try Success : ${(metrics.firstTrySuccessRate * 100).toFixed(1)}%                       │
│  └─ Avg Iterations    : ${metrics.avgIterations.toFixed(1)}                          │
│                                                              │
│  QUALITÉ                                                    │
│  ├─ Regression Rate   : ${(metrics.regressionRate * 100).toFixed(1)}%                        │
│  └─ Minimal Patches   : ${(metrics.minimalPatchRate * 100).toFixed(1)}%                       │
│                                                              │
│  EFFICIENCE                                                 │
│  ├─ Localization Time : ${metrics.avgLocalizationTime.toFixed(0)}ms                        │
│  ├─ Generation Time   : ${metrics.avgGenerationTime.toFixed(0)}ms                        │
│  └─ API Calls/Repair  : ${metrics.apiCallsPerRepair.toFixed(1)}                          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
  `);
}
```

---

## Résumé

Dans ce chapitre, nous avons vu :

| Concept | Point clé |
|---------|-----------|
| **Problème** | Single-shot échoue souvent |
| **ChatRepair** | Boucle : Localise → Génère → Teste → Feedback |
| **Localisation** | SBFL (Ochiai, DStar) + LLM |
| **Génération** | Contexte minimal + templates + historique |
| **Apprentissage** | Mémoriser les patterns qui fonctionnent |
| **Réflexion** | Analyser ses propres échecs |

---

## Exercices

1. **Localisation** : Implémentez la formule Tarantula et comparez avec Ochiai sur 10 bugs.

2. **Templates** : Ajoutez 5 nouveaux templates de réparation pour des erreurs courantes dans votre langage préféré.

3. **Métriques** : Instrumentez le repair engine pour collecter les métriques et générez un rapport.

4. **Apprentissage** : Analysez la table repair_learning après 50 réparations. Quels patterns émergent ?

---

## Pour aller plus loin

- Xia, C., et al. (2024). "ChatRepair: Autonomous Program Repair with ChatGPT." ISSTA 2024
- Wong, W. E., et al. (2016). "A Survey on Software Fault Localization"
- Grok-CLI : `src/agent/repair/`

---

*Fin de la Partie II — Reasoning & Planification*

*Prochainement : Partie III — Mémoire, RAG et Contexte*
*Chapitre 7 — RAG Moderne*

