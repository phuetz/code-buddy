# Mistral Vibe vs Grok CLI - Analyse Comparative

## Résumé Exécutif

Cette analyse compare mistral-vibe (CLI de Mistral AI) avec grok-cli pour identifier les fonctionnalités manquantes et les problèmes d'implémentation.

---

## 1. Architecture Comparée

### Mistral Vibe (Python)
```
vibe/
├── core/
│   ├── agent.py          # Agent principal (35KB)
│   ├── config.py         # Configuration TOML (18KB)
│   ├── middleware.py     # Pipeline middleware
│   ├── system_prompt.py  # Gestion prompts (14KB)
│   ├── interaction_logger.py
│   ├── tools/
│   │   ├── base.py       # Classe base outils
│   │   ├── manager.py    # Gestionnaire outils
│   │   ├── mcp.py        # Intégration MCP
│   │   └── builtins/     # bash, grep, read_file, etc.
│   └── llm/              # Abstraction LLM
├── cli/
│   ├── textual_ui/       # UI Textual (40KB)
│   └── autocompletion/
└── setup/
```

### Grok CLI (TypeScript)
```
src/
├── agent/
│   ├── grok-agent.ts     # Agent principal
│   ├── tool-executor.ts
│   └── agent-state.ts
├── tools/                 # 36+ outils
├── prompts/
├── mcp/
├── ui/                    # React/Ink UI
└── providers/             # Multi-provider
```

---

## 2. Fonctionnalités MANQUANTES dans Grok CLI

### 2.1 Système de Middleware (CRITIQUE)

**Mistral Vibe a:**
```python
class MiddlewarePipeline:
    - TurnLimitMiddleware      # Limite tours de conversation
    - PriceLimitMiddleware     # Limite coût session
    - AutoCompactMiddleware    # Compaction automatique contexte
    - ContextWarningMiddleware # Avertissement contexte plein
```

**Grok CLI:** Pas de système middleware formalisé. Les limites sont codées en dur dans l'agent.

**Impact:** Impossible d'ajouter facilement des contrôles de conversation (limites, warnings, actions automatiques).

---

### 2.2 Interaction Logger avec Replay (IMPORTANT)

**Mistral Vibe:**
```python
class InteractionLogger:
    - Sauvegarde JSON complète (messages, tools, metadata)
    - Session tracking avec UUID
    - Replay de sessions passées
    - Recherche par ID partiel
```

**Grok CLI:**
- `SessionStore` existe mais limité
- Pas de replay de sessions
- Pas de recherche par ID

**Impact:** Impossible de rejouer/analyser les sessions passées pour debug.

---

### 2.3 Configuration TOML Hierarchique (IMPORTANT)

**Mistral Vibe:**
```toml
# ~/.vibe/config.toml
active_model = "devstral-2"
vim_keybindings = true
auto_compact_threshold = 50000

[providers.mistral]
api_key_env = "MISTRAL_API_KEY"

[models.devstral-2]
provider = "mistral"
price_per_m_input = 0.0

[tool_config.bash]
permission = "ask"
timeout = 30
```

**Grok CLI:**
- JSON uniquement (settings.json)
- Pas de configuration par outil
- Pas de hiérarchie provider/model claire

---

### 2.4 Permission par Outil avec Patterns (IMPORTANT)

**Mistral Vibe:**
```python
class BaseToolConfig:
    permission: Permission  # ALWAYS, ASK, NEVER
    allowlist: list[str]    # Patterns regex autorisés
    denylist: list[str]     # Patterns regex bloqués

# Dans config.toml:
[tool_config.bash]
permission = "ask"
allowlist = ["git *", "npm *", "cargo *"]
denylist = ["rm -rf *", "sudo *"]
```

**Grok CLI:**
- ConfirmationService global
- Pas de configuration par outil
- Patterns de sécurité codés en dur

---

### 2.5 Context Compaction Automatique (MODÉRÉ)

**Mistral Vibe:**
```python
class AutoCompactMiddleware:
    - Détecte quand tokens > threshold
    - Génère résumé automatique
    - Remplace historique par résumé
    - Préserve contexte essentiel
```

**Grok CLI:**
- Commande `/compact` manuelle
- Pas d'auto-compaction
- Pas de détection de dépassement

---

### 2.6 Agents Personnalisés (MODÉRÉ)

**Mistral Vibe:**
```
~/.vibe/agents/
├── code_reviewer.md
├── security_auditor.md
└── documentation_writer.md
```

Chaque agent a son propre system prompt et configuration.

**Grok CLI:**
- Modes prédéfinis (AgentMode)
- Pas de personnalisation utilisateur simple
- Pas de fichiers .md pour agents

---

### 2.7 Autocompletion Fichiers avec @ (MODÉRÉ)

**Mistral Vibe:**
- `@` pour référencer fichiers
- Autocompletion contextuelle
- Insertion automatique du contenu

**Grok CLI:**
- Pas d'autocompletion `@`
- Commande `/add` existe mais différente

---

### 2.8 Update Notifier (MINEUR)

**Mistral Vibe:**
- Vérifie nouvelles versions automatiquement
- Notifie l'utilisateur
- Configurable on/off

**Grok CLI:**
- Pas de vérification de mise à jour

---

## 3. Problèmes d'IMPLÉMENTATION dans Grok CLI

### 3.1 Pas de Séparation Provider/Model Claire

**Problème:** `GrokClient` mélange logique client et configuration model.

**Mistral Vibe:**
```python
providers:
  mistral:
    base_url: "https://api.mistral.ai/v1"
    api_key_env: "MISTRAL_API_KEY"

models:
  devstral-2:
    provider: "mistral"
    price_per_m_input: 0.0
```

**Solution:** Créer une vraie abstraction `ProviderConfig` + `ModelConfig`.

---

### 3.2 Tool Manager Incomplet

**Problème:** Pas de gestionnaire centralisé pour:
- Découverte dynamique d'outils
- Configuration par outil
- Lazy instantiation avec cache

**Mistral Vibe:**
```python
class ToolManager:
    def _iter_tool_classes()   # Découverte fichiers
    def _integrate_mcp_async() # Intégration MCP
    def get()                  # Lazy instantiation
    def get_tool_config()      # Config par outil
```

---

### 3.3 Bash Tool Moins Robuste

**Mistral Vibe:**
```python
# Isolation process group (Unix)
start_new_session=True

# Kill tree complet avec timeout
os.killpg(process.pid, signal.SIGKILL)

# Encoding intelligent par plateforme
encoding = locale.getpreferredencoding() if windows else 'utf-8'

# Variables environnement contrôlées
env = {"CI": "true", "NO_TTY": "1", "NO_COLOR": "1"}
```

**Grok CLI:**
- Isolation moins stricte
- Pas de kill process group
- Encoding moins robuste

---

### 3.4 Grep/Search Sans Limite Intelligente

**Mistral Vibe:**
```python
class GrepTool:
    max_matches: int = 100
    max_output_bytes: int = 64000
    was_truncated: bool  # Indique si tronqué
```

**Grok CLI:**
- Limites moins configurables
- Pas d'indication de troncature claire

---

### 3.5 System Prompt Moins Modulaire

**Mistral Vibe:**
```python
def get_universal_system_prompt():
    sections = []
    sections.append(base_prompt)

    if config.include_model_info:
        sections.append(f"Model: {model}")

    if config.include_project_context:
        sections.append(project_context)

    for tool in active_tools:
        sections.append(tool.get_prompt())

    return "\n\n".join(sections)
```

**Grok CLI:**
- Prompt plus monolithique
- Moins de sections conditionnelles

---

## 4. Ce que Grok CLI fait MIEUX

### 4.1 Plus d'Outils Spécialisés
- 36+ outils vs 6 dans Mistral Vibe
- Outils multimodaux (image, video, audio, OCR)
- Outils spécialisés (diagram, QR, SQL, notebook)

### 4.2 UI Plus Riche (React/Ink)
- Composants réutilisables
- Themes multiples
- Accessibilité complète (WCAG)
- Vim mode

### 4.3 Système de Mémoire Avancé
- 4 types de mémoire (episodic, semantic, procedural, prospective)
- RAG avec reranking LLM
- Embeddings locaux

### 4.4 Multi-Provider
- Grok, Claude, OpenAI, Gemini
- Provider switching facile

### 4.5 Features Avancées
- Tree of Thought reasoning
- Multi-agent system
- Self-healing engine
- Parallel tool execution

---

## 5. Recommandations Prioritaires

### Haute Priorité (P0)

1. **Implémenter Middleware Pipeline**
   ```typescript
   interface Middleware {
     beforeTurn(ctx: ConversationContext): MiddlewareResult;
     afterTurn(ctx: ConversationContext): MiddlewareResult;
     reset(): void;
   }

   class MiddlewarePipeline {
     add(middleware: Middleware): this;
     runBefore(ctx: ConversationContext): MiddlewareResult;
     runAfter(ctx: ConversationContext): MiddlewareResult;
   }
   ```

2. **Configuration TOML**
   - Migrer de JSON vers TOML
   - Hiérarchie provider/model/tool
   - Permissions par outil

3. **Interaction Logger avec Replay**
   ```typescript
   class InteractionLogger {
     async save(session: SessionData): Promise<string>;
     async load(sessionId: string): Promise<SessionData>;
     async getLatest(): Promise<SessionData | null>;
     async search(partialId: string): Promise<SessionData[]>;
   }
   ```

### Priorité Moyenne (P1)

4. **Auto-Compaction**
   - Détecter dépassement token threshold
   - Générer résumé automatique
   - Remplacer historique

5. **Tool Manager Centralisé**
   - Découverte dynamique
   - Config par outil
   - Lazy instantiation

6. **Améliorer Bash Tool**
   - Process group isolation
   - Kill tree complet
   - Encoding intelligent

### Priorité Basse (P2)

7. **Autocompletion `@` pour fichiers**
8. **Update notifier**
9. **Agents personnalisés (.md files)**

---

## 6. Estimation Effort

| Feature | Complexité | Jours estimés |
|---------|------------|---------------|
| Middleware Pipeline | Haute | 3-5 |
| Config TOML | Moyenne | 2-3 |
| Interaction Logger | Moyenne | 2-3 |
| Auto-Compaction | Moyenne | 2 |
| Tool Manager | Moyenne | 2-3 |
| Bash Tool Improvements | Basse | 1 |
| @ Autocompletion | Moyenne | 2 |
| Update Notifier | Basse | 0.5 |
| Custom Agents | Basse | 1 |

**Total estimé:** 15-20 jours de développement

---

## Conclusion

Mistral Vibe est plus **simple et élégant** avec une architecture bien pensée (middleware, config TOML, separation of concerns). Grok CLI est plus **riche en features** mais avec une architecture moins clean.

Les priorités d'amélioration devraient être:
1. Middleware pipeline pour contrôle conversation
2. Configuration TOML hiérarchique
3. Interaction logger avec replay
4. Amélioration isolation bash

Ces améliorations rendraient grok-cli aussi robuste que mistral-vibe tout en conservant ses avantages (plus d'outils, UI riche, multi-provider).
