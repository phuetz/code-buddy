# Plan d'Action - Corrections Prioritaires

## PHASE 1: CORRECTIONS CRITIQUES (Urgent - 1-2 jours)

### 1.1 Corriger les erreurs TypeScript (5 erreurs)

#### Action 1: Exporter ToolResult depuis tools/index.ts
**Fichier**: `/home/patrice/claude/grok-cli/src/tools/index.ts`

**Ajouter à la fin du fichier**:
```typescript
// Export types used by tools
export type { ToolResult } from '../types/index.js';
```

#### Action 2: Corriger l'import better-sqlite3
**Fichier**: `/home/patrice/claude/grok-cli/src/tools/sql-tool.ts`

**Ligne 75-77 - Remplacer**:
```typescript
// AVANT (incorrect)
let Database: typeof import('better-sqlite3').default;
try {
  Database = (await import('better-sqlite3')).default;
```

**Par**:
```typescript
// APRÈS (correct)
try {
  const { default: Database } = await import('better-sqlite3');
  // Ou alternative:
  const DatabaseModule = await import('better-sqlite3');
  const Database = DatabaseModule.default;
```

**Même correction pour**:
- `src/tools/env-tool.ts`
- `src/tools/fetch-tool.ts`
- `src/tools/notebook-tool.ts`

#### Vérification
```bash
npm run typecheck  # Doit passer sans erreur
npm run build      # Doit compiler
```

---

## PHASE 2: AMÉLIORATION QUALITÉ CODE (1 semaine)

### 2.1 Refactoring Complexité Cyclomatique

#### Fonction 1: parseDiffWithLineNumbers (complexité 37)
**Fichier**: `/home/patrice/claude/grok-cli/src/ui/components/diff-renderer.tsx`

**Stratégie**: Découper en sous-fonctions

```typescript
// AVANT (264 lignes, complexité 37)
function parseDiffWithLineNumbers(diff: string, ...): ParsedDiff {
  // 264 lignes de logique complexe
}

// APRÈS - Découper en 5 fonctions
function parseDiffWithLineNumbers(diff: string, ...): ParsedDiff {
  const sections = splitDiffSections(diff);
  const hunks = parseHunks(sections);
  const lines = processLines(hunks);
  return formatParsedDiff(lines);
}

function splitDiffSections(diff: string): string[] {
  // Logique de split (20 lignes)
}

function parseHunks(sections: string[]): Hunk[] {
  // Parse hunk headers (30 lignes)
}

function processLines(hunks: Hunk[]): Line[] {
  // Process individual lines (40 lignes)
}

function formatParsedDiff(lines: Line[]): ParsedDiff {
  // Format final result (20 lignes)
}
```

**Complexité cible**: <10 par fonction

#### Fonction 2: hasCycle (complexité 34)
**Fichier**: `/home/patrice/claude/grok-cli/src/services/plan-generator.ts`

**Même approche**: Extraire DFS, colorisation, détection en sous-fonctions

#### Fonction 3: handleSpecialKey (complexité 25)
**Fichier**: `/home/patrice/claude/grok-cli/src/hooks/use-input-handler.ts`

**Approche**: Switch case → Map de handlers

```typescript
// AVANT
function handleSpecialKey(key: string, ...): void {
  if (key === 'up') {
    // 15 lignes
  } else if (key === 'down') {
    // 12 lignes
  } else if (key === 'tab') {
    // 20 lignes
  }
  // ... 10+ conditions
}

// APRÈS
const KEY_HANDLERS = new Map<string, KeyHandler>([
  ['up', handleUpKey],
  ['down', handleDownKey],
  ['tab', handleTabKey],
  // ...
]);

function handleSpecialKey(key: string, ...): void {
  const handler = KEY_HANDLERS.get(key);
  if (handler) {
    handler(...);
  }
}

function handleUpKey(...): void {
  // 15 lignes isolées
}
// Etc.
```

### 2.2 Renommer Composants React en PascalCase

**Script de renommage automatique**:
```bash
#!/bin/bash
cd src/ui/components

# Liste des fichiers à renommer
declare -A RENAME_MAP=(
  ["fuzzy-picker.tsx"]="FuzzyPicker.tsx"
  ["chat-interface.tsx"]="ChatInterface.tsx"
  ["loading-spinner.tsx"]="LoadingSpinner.tsx"
  ["api-key-input.tsx"]="ApiKeyInput.tsx"
  ["confirmation-dialog.tsx"]="ConfirmationDialog.tsx"
  ["enhanced-spinners.tsx"]="EnhancedSpinners.tsx"
  ["multi-step-progress.tsx"]="MultiStepProgress.tsx"
  ["ink-table.tsx"]="InkTable.tsx"
  ["model-selection.tsx"]="ModelSelection.tsx"
  ["mcp-status.tsx"]="McpStatus.tsx"
  ["chat-input.tsx"]="ChatInput.tsx"
  ["accessible-output.tsx"]="AccessibleOutput.tsx"
  ["error-boundary.tsx"]="ErrorBoundary.tsx"
  ["enhanced-confirmation-dialog.tsx"]="EnhancedConfirmationDialog.tsx"
  ["chat-history.tsx"]="ChatHistory.tsx"
  ["enhanced-chat-input.tsx"]="EnhancedChatInput.tsx"
  ["diff-renderer.tsx"]="DiffRenderer.tsx"
  ["structured-output.tsx"]="StructuredOutput.tsx"
  ["help-system.tsx"]="HelpSystem.tsx"
  ["command-suggestions.tsx"]="CommandSuggestions.tsx"
)

for old in "${!RENAME_MAP[@]}"; do
  new="${RENAME_MAP[$old]}"
  if [ -f "$old" ]; then
    git mv "$old" "$new"
    echo "Renamed: $old → $new"
  fi
done

# Mettre à jour les imports
find ../.. -name "*.ts" -o -name "*.tsx" | xargs sed -i \
  -e "s|from './components/fuzzy-picker'|from './components/FuzzyPicker'|g" \
  -e "s|from './components/chat-interface'|from './components/ChatInterface'|g"
  # ... etc pour tous les fichiers
```

### 2.3 Remplacer `any` par types stricts

**Exemple 1**: `src/agent/multi-agent/base-agent.ts`

```typescript
// AVANT
function handleResult(result: any): void {
  // ...
}

// APRÈS
interface ToolCallResult {
  success: boolean;
  output?: string;
  error?: string;
  data?: unknown;
}

function handleResult(result: ToolCallResult): void {
  // ...
}
```

**Exemple 2**: `src/hooks/use-input-handler.ts`

```typescript
// AVANT
const commands: any = {
  // ...
};

// APRÈS
type CommandHandler = (args: string[]) => Promise<void>;

const commands: Record<string, CommandHandler> = {
  // ...
};
```

---

## PHASE 3: AUGMENTER COUVERTURE TESTS (2-3 semaines)

### Objectif: Passer de 19% → 70%+

### 3.1 Prioriser modules critiques (0% couverture)

**Priorité 1 - Security & Agent**:
- `src/agent/architect-mode.ts`
- `src/agent/thinking-keywords.ts`
- `src/security/approval-modes.ts`

**Template de test**:
```typescript
// tests/agent/thinking-keywords.test.ts
import { ThinkingKeywordsManager } from '../src/agent/thinking-keywords';

describe('ThinkingKeywordsManager', () => {
  let manager: ThinkingKeywordsManager;

  beforeEach(() => {
    manager = new ThinkingKeywordsManager();
  });

  describe('detectKeyword', () => {
    it('should detect "think" keyword', () => {
      const result = manager.detectKeyword('User said: think about it');
      expect(result).toEqual({
        keyword: 'think',
        tokenBudget: 4000,
        detected: true
      });
    });

    it('should detect "megathink" keyword', () => {
      const result = manager.detectKeyword('megathink carefully');
      expect(result.tokenBudget).toBe(10000);
    });

    it('should detect "ultrathink" keyword', () => {
      const result = manager.detectKeyword('ultrathink deeply');
      expect(result.tokenBudget).toBe(32000);
    });

    it('should return null for no keyword', () => {
      const result = manager.detectKeyword('normal message');
      expect(result.detected).toBe(false);
    });
  });

  describe('applyBudget', () => {
    it('should apply token budget to options', () => {
      const options = manager.applyBudget('think', {});
      expect(options.max_tokens).toBe(4000);
    });
  });
});
```

**Priorité 2 - Tools multimodaux** (13 tools à 0%):
```typescript
// tests/tools/audio-tool.test.ts
import { AudioTool } from '../src/tools/audio-tool';

describe('AudioTool', () => {
  let tool: AudioTool;

  beforeEach(() => {
    tool = new AudioTool();
  });

  it('should have correct name and description', () => {
    expect(tool.name).toBe('audio');
    expect(tool.description).toContain('audio');
  });

  describe('execute', () => {
    it('should return error for missing file', async () => {
      const result = await tool.execute({
        action: 'transcribe',
        file: '/non/existent/file.mp3'
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });
});
```

### 3.2 Métriques à surveiller

**Commandes de test**:
```bash
# Tests avec couverture
npm run test:coverage

# Voir rapport HTML
open coverage/lcov-report/index.html

# Suivre progression
grep -A 1 "All files" coverage/lcov-report/index.html
```

**Objectifs par module**:
- Modules critiques (agent/, security/): >80%
- Modules standard (tools/, utils/): >70%
- Modules UI (ui/): >50% (plus difficile à tester)

---

## PHASE 4: NETTOYAGE & MAINTENANCE (1 semaine)

### 4.1 Nettoyer variables/imports inutilisés

**Auto-fix ESLint**:
```bash
npm run lint:fix
```

**Vérification manuelle**:
```bash
npm run lint | grep "no-unused-vars"
```

### 4.2 Remplacer console.error par logger

**Script de remplacement**:
```bash
find src -name "*.ts" -o -name "*.tsx" | xargs sed -i \
  's/console\.error(/logger.error(/g'
```

**Ajouter imports manquants**:
```typescript
import { logger } from '../utils/logger.js';
```

### 4.3 Ajouter .catch() aux promesses

**Pattern à chercher**:
```bash
grep -rn "\.then(" src/ --include="*.ts" | grep -v "\.catch("
```

**Correction type**:
```typescript
// AVANT
somePromise.then(result => {
  // ...
});

// APRÈS
somePromise
  .then(result => {
    // ...
  })
  .catch(error => {
    logger.error('Operation failed:', error);
  });
```

---

## CHECKLIST DE VALIDATION

### Phase 1 (Critique)
- [ ] `npm run typecheck` passe sans erreur
- [ ] `npm run build` compile sans erreur
- [ ] `npm test` passe tous les tests

### Phase 2 (Qualité)
- [ ] Complexité max < 15 (ESLint complexity rule)
- [ ] Composants React en PascalCase
- [ ] Moins de 20 usages de `any`
- [ ] `npm run lint` < 50 warnings

### Phase 3 (Tests)
- [ ] Couverture globale > 70%
- [ ] Couverture branches > 50%
- [ ] Couverture modules critiques > 80%

### Phase 4 (Maintenance)
- [ ] 0 variables inutilisées
- [ ] 0 console.error
- [ ] Toutes promesses avec .catch()

---

## ESTIMATION TOTALE

| Phase | Durée | Priorité |
|-------|-------|----------|
| Phase 1 | 1-2 jours | CRITIQUE |
| Phase 2 | 1 semaine | IMPORTANT |
| Phase 3 | 2-3 semaines | IMPORTANT |
| Phase 4 | 1 semaine | MINEUR |
| **TOTAL** | **4-5 semaines** | |

**Recommandation**: Commencer par Phase 1 immédiatement, puis Phase 2 et 3 en parallèle.
