# Cahier de Tests - Grok CLI

## Table des Matières

1. [Introduction](#1-introduction)
2. [Stratégie de Tests](#2-stratégie-de-tests)
3. [Environnement de Tests](#3-environnement-de-tests)
4. [Tests Unitaires](#4-tests-unitaires)
5. [Tests d'Intégration](#5-tests-dintégration)
6. [Tests Fonctionnels](#6-tests-fonctionnels)
7. [Tests de Performance](#7-tests-de-performance)
8. [Tests de Sécurité](#8-tests-de-sécurité)
9. [Tests d'Interface Utilisateur](#9-tests-dinterface-utilisateur)
10. [Tests de Régression](#10-tests-de-régression)
11. [Critères d'Acceptation](#11-critères-dacceptation)
12. [Annexes](#12-annexes)

---

## 1. Introduction

### 1.1 Objectif du Document

Ce cahier de tests définit la stratégie complète de validation de Grok CLI, un outil d'assistance au développement alimenté par l'IA. Il couvre tous les aspects fonctionnels et non-fonctionnels du système.

### 1.2 Portée

| Élément | Inclus | Exclus |
|---------|--------|--------|
| Tests unitaires | ✓ | - |
| Tests d'intégration | ✓ | - |
| Tests fonctionnels | ✓ | - |
| Tests de performance | ✓ | - |
| Tests de sécurité | ✓ | - |
| Tests UI/UX | ✓ | - |
| Tests de charge | ✓ | Tests de stress extrême |
| Tests d'accessibilité | ✓ | - |

### 1.3 Références

- Architecture technique : `CLAUDE.md`
- Code source : `src/`
- Tests existants : `tests/`
- Documentation : `docs/`

### 1.4 Glossaire

| Terme | Définition |
|-------|------------|
| **Agent** | Composant autonome exécutant des tâches spécifiques |
| **RAG** | Retrieval-Augmented Generation |
| **MCP** | Model Context Protocol |
| **Sandbox** | Environnement d'exécution isolé |
| **Tool** | Outil disponible pour l'agent IA |

---

## 2. Stratégie de Tests

### 2.1 Niveaux de Tests

```
┌─────────────────────────────────────────────────────────────┐
│                    Tests E2E (End-to-End)                   │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Tests d'Intégration                      │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │              Tests Unitaires                    │  │  │
│  │  │  ┌───────────────────────────────────────────┐  │  │  │
│  │  │  │         Tests Statiques (Lint/Type)       │  │  │  │
│  │  │  └───────────────────────────────────────────┘  │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Couverture Cible

| Module | Couverture Cible | Priorité |
|--------|------------------|----------|
| `src/agent/` | 90% | Critique |
| `src/tools/` | 85% | Critique |
| `src/security/` | 95% | Critique |
| `src/sandbox/` | 95% | Critique |
| `src/context/` | 80% | Haute |
| `src/memory/` | 85% | Haute |
| `src/ui/` | 70% | Moyenne |
| `src/utils/` | 80% | Moyenne |

### 2.3 Critères de Sortie

- ✓ 100% des tests critiques passent
- ✓ Couverture globale ≥ 80%
- ✓ Aucun bug bloquant ou critique
- ✓ Performance dans les limites définies
- ✓ Aucune vulnérabilité de sécurité haute/critique

---

## 3. Environnement de Tests

### 3.1 Configuration Matérielle

| Composant | Minimum | Recommandé |
|-----------|---------|------------|
| CPU | 2 cores | 4+ cores |
| RAM | 4 GB | 8+ GB |
| Disque | 1 GB libre | 5+ GB libre |
| Réseau | Optionnel | Requis pour tests API |

### 3.2 Configuration Logicielle

```bash
# Prérequis
Node.js >= 18.0.0
npm >= 9.0.0
Git >= 2.30.0
Docker >= 20.0 (pour tests sandbox)

# Installation
npm install
npm run build

# Exécution des tests
npm test                 # Tous les tests
npm run test:watch       # Mode watch
npm run test:coverage    # Avec couverture
```

### 3.3 Variables d'Environnement

| Variable | Description | Requis pour |
|----------|-------------|-------------|
| `GROK_API_KEY` | Clé API Grok | Tests API |
| `MORPH_API_KEY` | Clé Morph | Tests édition rapide |
| `TEST_TIMEOUT` | Timeout tests (ms) | Configuration |
| `CI` | Mode CI | Tests automatisés |

### 3.4 Données de Test

```
tests/
├── fixtures/           # Données de test statiques
│   ├── code-samples/   # Exemples de code
│   ├── images/         # Images pour tests multimodaux
│   └── configs/        # Configurations de test
├── mocks/              # Mocks et stubs
└── helpers/            # Utilitaires de test
```

---

## 4. Tests Unitaires

### 4.1 Module Agent (`src/agent/`)

#### 4.1.1 GrokAgent

| ID | Cas de Test | Entrée | Résultat Attendu | Priorité |
|----|-------------|--------|------------------|----------|
| AG-001 | Initialisation agent | Config valide | Agent initialisé | Critique |
| AG-002 | Initialisation sans API key | Config sans clé | Erreur appropriée | Critique |
| AG-003 | Boucle agentique | Message utilisateur | Réponse générée | Critique |
| AG-004 | Limite de rounds | 31 rounds | Arrêt automatique | Haute |
| AG-005 | Gestion erreur API | Erreur réseau | Retry + fallback | Haute |
| AG-006 | Streaming réponse | Message long | Tokens en stream | Moyenne |
| AG-007 | Annulation requête | Signal abort | Arrêt propre | Moyenne |

```typescript
// Exemple de test AG-001
describe('GrokAgent', () => {
  it('should initialize with valid config', async () => {
    const agent = new GrokAgent({
      apiKey: 'test-key',
      model: 'grok-beta',
    });

    await agent.initialize();

    expect(agent.isInitialized()).toBe(true);
    expect(agent.getModel()).toBe('grok-beta');
  });
});
```

#### 4.1.2 Multi-Agent System

| ID | Cas de Test | Entrée | Résultat Attendu | Priorité |
|----|-------------|--------|------------------|----------|
| MA-001 | Coordination agents | Tâche complexe | Délégation correcte | Critique |
| MA-002 | Agent spécialisé PDF | Fichier PDF | Extraction contenu | Haute |
| MA-003 | Agent spécialisé Excel | Fichier XLSX | Parsing données | Haute |
| MA-004 | Agent spécialisé SQL | Requête SQL | Exécution sécurisée | Haute |
| MA-005 | Agent Security Review | Code source | Rapport vulnérabilités | Critique |
| MA-006 | Échec agent | Agent en erreur | Fallback autre agent | Moyenne |
| MA-007 | Parallélisation | Tâches indépendantes | Exécution parallèle | Moyenne |

#### 4.1.3 Repair Engine

| ID | Cas de Test | Entrée | Résultat Attendu | Priorité |
|----|-------------|--------|------------------|----------|
| RE-001 | Détection erreur null | NullPointerError | Stratégie null_check | Haute |
| RE-002 | Correction type | TypeError | Stratégie type_coercion | Haute |
| RE-003 | Fix import manquant | ImportError | Stratégie import_fix | Haute |
| RE-004 | Boucle feedback tests | Tests échouent | Itération jusqu'à succès | Critique |
| RE-005 | Limite itérations | 10 échecs | Arrêt + rapport | Moyenne |
| RE-006 | Apprentissage réparation | Réparation réussie | Sauvegarde en DB | Moyenne |

#### 4.1.4 Thinking Keywords

| ID | Cas de Test | Entrée | Résultat Attendu | Priorité |
|----|-------------|--------|------------------|----------|
| TK-001 | Détection "think" | "think about this" | Budget 4K tokens | Haute |
| TK-002 | Détection "megathink" | "megathink" | Budget 10K tokens | Haute |
| TK-003 | Détection "ultrathink" | "ultrathink" | Budget 32K tokens | Haute |
| TK-004 | Pas de keyword | Message normal | Budget par défaut | Moyenne |
| TK-005 | Multiple keywords | "think megathink" | Plus grand budget | Basse |

---

### 4.2 Module Tools (`src/tools/`)

#### 4.2.1 File Operations

| ID | Cas de Test | Entrée | Résultat Attendu | Priorité |
|----|-------------|--------|------------------|----------|
| FO-001 | Lecture fichier | Chemin valide | Contenu fichier | Critique |
| FO-002 | Lecture fichier inexistant | Chemin invalide | Erreur "not found" | Critique |
| FO-003 | Écriture fichier | Contenu + chemin | Fichier créé | Critique |
| FO-004 | Écriture répertoire protégé | /etc/passwd | Erreur permission | Critique |
| FO-005 | Édition fichier | old_string, new_string | Remplacement effectué | Critique |
| FO-006 | Édition string non unique | String dupliquée | Erreur ambiguïté | Haute |
| FO-007 | Multi-edit atomique | Plusieurs fichiers | Tout ou rien | Haute |
| FO-008 | Glob pattern | "**/*.ts" | Liste fichiers | Haute |
| FO-009 | Grep recherche | Pattern regex | Résultats matchés | Haute |

#### 4.2.2 Bash Execution

| ID | Cas de Test | Entrée | Résultat Attendu | Priorité |
|----|-------------|--------|------------------|----------|
| BE-001 | Commande simple | "ls -la" | Output + code 0 | Critique |
| BE-002 | Commande avec timeout | Commande longue | Timeout après délai | Haute |
| BE-003 | Commande dangereuse | "rm -rf /" | Blocage + alerte | Critique |
| BE-004 | Commande interactive | "vim" | Rejet ou sandbox | Haute |
| BE-005 | Variables environnement | "echo $HOME" | Valeur variable | Moyenne |
| BE-006 | Pipe et redirection | "cat file \| grep x" | Résultat pipeline | Moyenne |
| BE-007 | Exécution background | Commande longue | Task ID retourné | Moyenne |

#### 4.2.3 Enhanced Search

| ID | Cas de Test | Entrée | Résultat Attendu | Priorité |
|----|-------------|--------|------------------|----------|
| ES-001 | Recherche ripgrep | Pattern + path | Résultats formatés | Critique |
| ES-002 | Recherche symboles | Nom fonction | Définitions trouvées | Haute |
| ES-003 | Recherche références | Nom variable | Usages listés | Haute |
| ES-004 | Cache LRU | Même recherche 2x | 2e depuis cache | Moyenne |
| ES-005 | Recherche multilingue | Pattern en plusieurs langages | Résultats tous langages | Moyenne |

---

### 4.3 Module Security (`src/security/`)

#### 4.3.1 Approval Modes

| ID | Cas de Test | Entrée | Résultat Attendu | Priorité |
|----|-------------|--------|------------------|----------|
| AM-001 | Mode read-only | Commande écriture | Blocage | Critique |
| AM-002 | Mode auto | Commande safe | Exécution auto | Critique |
| AM-003 | Mode auto | Commande dangereuse | Demande confirmation | Critique |
| AM-004 | Mode full-access | Toute commande | Exécution directe | Haute |
| AM-005 | Changement mode | Switch mode | Persistance | Moyenne |
| AM-006 | Mode par défaut | Nouvelle session | Mode auto | Moyenne |

#### 4.3.2 Data Redaction

| ID | Cas de Test | Entrée | Résultat Attendu | Priorité |
|----|-------------|--------|------------------|----------|
| DR-001 | Redaction API key | "GROK_API_KEY=sk-xxx" | "GROK_API_KEY=***" | Critique |
| DR-002 | Redaction password | "password: secret123" | "password: ***" | Critique |
| DR-003 | Redaction email | "user@example.com" | Selon config | Haute |
| DR-004 | Redaction numéro carte | "4111111111111111" | "411111******1111" | Critique |
| DR-005 | Pas de faux positif | "public_key: xyz" | Pas de redaction | Haute |
| DR-006 | Redaction fichier .env | Contenu .env | Valeurs masquées | Critique |

#### 4.3.3 OS Sandbox

| ID | Cas de Test | Entrée | Résultat Attendu | Priorité |
|----|-------------|--------|------------------|----------|
| OS-001 | Détection bubblewrap | Linux avec bwrap | Backend détecté | Critique |
| OS-002 | Détection seatbelt | macOS | Backend détecté | Critique |
| OS-003 | Fallback Docker | Pas de sandbox OS | Docker utilisé | Haute |
| OS-004 | Exécution sandboxée | Commande quelconque | Isolation process | Critique |
| OS-005 | Accès fichier bloqué | Lecture /etc/shadow | Permission denied | Critique |
| OS-006 | Réseau désactivé | Commande réseau | Échec connexion | Haute |
| OS-007 | Timeout sandbox | Commande infinie | Kill après timeout | Haute |

#### 4.3.4 ExecPolicy

| ID | Cas de Test | Entrée | Résultat Attendu | Priorité |
|----|-------------|--------|------------------|----------|
| EP-001 | Commande safe | "ls", "cat", "echo" | Autorisé | Critique |
| EP-002 | Commande dangereuse | "rm -rf /" | Bloqué | Critique |
| EP-003 | Fork bomb | ":(){ :\|:& };:" | Bloqué | Critique |
| EP-004 | Règle personnalisée | Ajout règle | Application règle | Haute |
| EP-005 | Pattern wildcard | "rm -rf *" | Évaluation contexte | Haute |
| EP-006 | Commande inconnue | Binaire custom | Demande confirmation | Moyenne |

#### 4.3.5 Security Review Agent

| ID | Cas de Test | Entrée | Résultat Attendu | Priorité |
|----|-------------|--------|------------------|----------|
| SR-001 | Détection SQL injection | Code vulnérable | Alerte SQL injection | Critique |
| SR-002 | Détection XSS | Code innerHTML | Alerte XSS | Critique |
| SR-003 | Détection secrets | Clé API hardcodée | Alerte secret | Critique |
| SR-004 | Scan complet | Répertoire projet | Rapport SARIF | Haute |
| SR-005 | Quick scan | Fichier unique | Résultats rapides | Moyenne |
| SR-006 | Faux positifs | Code sécurisé | Pas d'alerte | Haute |

---

### 4.4 Module Context (`src/context/`)

#### 4.4.1 RAG System

| ID | Cas de Test | Entrée | Résultat Attendu | Priorité |
|----|-------------|--------|------------------|----------|
| RAG-001 | Indexation codebase | Répertoire projet | Index créé | Critique |
| RAG-002 | Recherche sémantique | Query naturelle | Documents pertinents | Critique |
| RAG-003 | Cross-encoder reranking | Résultats bruts | Résultats reordonnés | Haute |
| RAG-004 | Dependency-aware | Import statement | Fichiers liés inclus | Haute |
| RAG-005 | Mise à jour incrémentale | Fichier modifié | Index mis à jour | Moyenne |

#### 4.4.2 Context Compression

| ID | Cas de Test | Entrée | Résultat Attendu | Priorité |
|----|-------------|--------|------------------|----------|
| CC-001 | Compression basique | Contexte long | Contexte réduit | Haute |
| CC-002 | Préservation critique | Code important | Non supprimé | Critique |
| CC-003 | Ratio compression | 100K tokens | ~30K tokens | Moyenne |
| CC-004 | Priorité contenu | Différents types | Ordre correct | Moyenne |

#### 4.4.3 Web Search Grounding

| ID | Cas de Test | Entrée | Résultat Attendu | Priorité |
|----|-------------|--------|------------------|----------|
| WS-001 | Recherche DuckDuckGo | Query simple | Résultats retournés | Haute |
| WS-002 | Recherche Brave | Query + API key | Résultats Brave | Moyenne |
| WS-003 | Cache résultats | Même query 2x | 2e depuis cache | Moyenne |
| WS-004 | Timeout recherche | Serveur lent | Timeout + fallback | Haute |
| WS-005 | Grounding context | Query factuelle | Citations incluses | Haute |

---

### 4.5 Module Memory (`src/memory/`)

#### 4.5.1 Memory System

| ID | Cas de Test | Entrée | Résultat Attendu | Priorité |
|----|-------------|--------|------------------|----------|
| ME-001 | Création mémoire | Contenu + type | Mémoire stockée | Critique |
| ME-002 | Recherche sémantique | Query | Mémoires similaires | Haute |
| ME-003 | Mémoire épisodique | Événement session | Stockage chronologique | Haute |
| ME-004 | Mémoire procédurale | Pattern appris | Réutilisation future | Moyenne |
| ME-005 | Prospective memory | Tâche future | Rappel au trigger | Haute |
| ME-006 | Expiration mémoire | Mémoire ancienne | Suppression/archivage | Basse |

#### 4.5.2 Database Operations

| ID | Cas de Test | Entrée | Résultat Attendu | Priorité |
|----|-------------|--------|------------------|----------|
| DB-001 | Connexion SQLite | Config valide | Connexion établie | Critique |
| DB-002 | Mode WAL | Nouvelle DB | WAL activé | Haute |
| DB-003 | Migration | Ancien schéma | Mise à jour schéma | Critique |
| DB-004 | Requête concurrente | Multi-thread | Pas de corruption | Critique |
| DB-005 | Backup | Commande backup | Fichier créé | Moyenne |

---

### 4.6 Module Config (`src/config/`)

#### 4.6.1 GrokRules

| ID | Cas de Test | Entrée | Résultat Attendu | Priorité |
|----|-------------|--------|------------------|----------|
| GR-001 | Chargement YAML | .grokrules valide | Rules parsées | Critique |
| GR-002 | Chargement JSON | .grokrules.json | Rules parsées | Haute |
| GR-003 | Héritage parent | Répertoire enfant | Rules fusionnées | Haute |
| GR-004 | Validation commande | Commande + rules | Autorisé/Bloqué | Haute |
| GR-005 | Prompt additions | Rules avec instructions | System prompt modifié | Haute |
| GR-006 | Création défaut | Nouveau projet | Template créé | Moyenne |

---

### 4.7 Module Input (`src/input/`)

#### 4.7.1 Multimodal Input

| ID | Cas de Test | Entrée | Résultat Attendu | Priorité |
|----|-------------|--------|------------------|----------|
| MI-001 | Chargement image | Fichier PNG | Image en mémoire | Haute |
| MI-002 | Format non supporté | Fichier .xyz | Erreur format | Haute |
| MI-003 | Image trop grande | Fichier 50MB | Erreur taille | Haute |
| MI-004 | Screenshot | Capture écran | Image capturée | Moyenne |
| MI-005 | OCR | Image avec texte | Texte extrait | Moyenne |
| MI-006 | Préparation API | Image stockée | Base64 + MIME | Haute |

#### 4.7.2 Voice Input

| ID | Cas de Test | Entrée | Résultat Attendu | Priorité |
|----|-------------|--------|------------------|----------|
| VI-001 | Détection micro | Système avec micro | Capability true | Moyenne |
| VI-002 | Enregistrement | Commande vocale | Audio capturé | Moyenne |
| VI-003 | Transcription | Audio enregistré | Texte transcrit | Moyenne |
| VI-004 | Pas de micro | Système sans micro | Capability false | Moyenne |

---

### 4.8 Module Integrations (`src/integrations/`)

#### 4.8.1 GitHub Actions

| ID | Cas de Test | Entrée | Résultat Attendu | Priorité |
|----|-------------|--------|------------------|----------|
| GA-001 | Liste templates | - | Templates disponibles | Haute |
| GA-002 | Création workflow | Template node-ci | Fichier YAML créé | Haute |
| GA-003 | Validation workflow | Config valide | valid: true | Haute |
| GA-004 | Validation invalide | Config manquante | Erreurs listées | Haute |
| GA-005 | Analyse workflow | Workflow existant | Suggestions | Moyenne |
| GA-006 | Suppression workflow | Nom workflow | Fichier supprimé | Moyenne |

#### 4.8.2 IDE Extensions

| ID | Cas de Test | Entrée | Résultat Attendu | Priorité |
|----|-------------|--------|------------------|----------|
| IDE-001 | Démarrage serveur | Port disponible | Serveur actif | Haute |
| IDE-002 | Connexion client | Socket TCP | Connexion établie | Haute |
| IDE-003 | Requête JSON | Méthode valide | Réponse JSON | Haute |
| IDE-004 | Génération VS Code | - | Extension manifest | Moyenne |
| IDE-005 | Génération Neovim | - | Plugin Lua | Moyenne |

---

## 5. Tests d'Intégration

### 5.1 Agent + Tools

| ID | Cas de Test | Scénario | Résultat Attendu | Priorité |
|----|-------------|----------|------------------|----------|
| IT-001 | Agent lit fichier | "Lis le fichier X" | Contenu affiché | Critique |
| IT-002 | Agent édite fichier | "Modifie la ligne Y" | Fichier modifié | Critique |
| IT-003 | Agent exécute bash | "Lance npm test" | Tests exécutés | Critique |
| IT-004 | Agent recherche | "Trouve les TODO" | Résultats listés | Haute |
| IT-005 | Agent multi-tool | Tâche complexe | Séquence tools | Haute |

### 5.2 Agent + Security

| ID | Cas de Test | Scénario | Résultat Attendu | Priorité |
|----|-------------|----------|------------------|----------|
| IT-010 | Commande bloquée | "Supprime tout" | Confirmation requise | Critique |
| IT-011 | Mode sandbox | Commande risquée | Exécution isolée | Critique |
| IT-012 | Redaction output | Affichage secrets | Secrets masqués | Critique |
| IT-013 | ExecPolicy + Agent | Commande interdite | Blocage + message | Haute |

### 5.3 Agent + Memory

| ID | Cas de Test | Scénario | Résultat Attendu | Priorité |
|----|-------------|----------|------------------|----------|
| IT-020 | Mémorisation | "Souviens-toi que X" | Mémoire créée | Haute |
| IT-021 | Rappel | "Qu'est-ce que X?" | Mémoire retrouvée | Haute |
| IT-022 | Session persistence | Fermeture + ouverture | État restauré | Haute |

### 5.4 Agent + Context

| ID | Cas de Test | Scénario | Résultat Attendu | Priorité |
|----|-------------|----------|------------------|----------|
| IT-030 | RAG codebase | Question sur code | Contexte pertinent | Haute |
| IT-031 | Compression | Long contexte | Contexte optimisé | Moyenne |
| IT-032 | Web search | Question factuelle | Résultats web inclus | Moyenne |

### 5.5 Multi-Agent Coordination

| ID | Cas de Test | Scénario | Résultat Attendu | Priorité |
|----|-------------|----------|------------------|----------|
| IT-040 | PDF + Agent | "Analyse ce PDF" | Agent PDF activé | Haute |
| IT-041 | Security scan | "/security-review src/" | Rapport généré | Haute |
| IT-042 | Parallel agents | Tâches indépendantes | Exécution parallèle | Moyenne |

---

## 6. Tests Fonctionnels

### 6.1 Slash Commands

| ID | Commande | Action | Résultat Attendu | Priorité |
|----|----------|--------|------------------|----------|
| SC-001 | `/help` | Afficher aide | Liste commandes | Critique |
| SC-002 | `/model grok-beta` | Changer modèle | Modèle changé | Haute |
| SC-003 | `/mode plan` | Mode planification | Mode activé | Haute |
| SC-004 | `/commit` | Créer commit | Commit généré | Haute |
| SC-005 | `/review` | Review code | Analyse affichée | Haute |
| SC-006 | `/test` | Lancer tests | Tests exécutés | Haute |
| SC-007 | `/security-review` | Scan sécurité | Rapport généré | Haute |
| SC-008 | `/cost status` | Afficher coûts | Stats affichées | Moyenne |
| SC-009 | `/clear` | Effacer historique | Historique vidé | Moyenne |
| SC-010 | `/checkpoint` | Créer checkpoint | Snapshot créé | Moyenne |

### 6.2 Workflows Utilisateur

#### 6.2.1 Développement de Feature

```gherkin
Feature: Développement d'une nouvelle fonctionnalité

Scenario: Ajout d'une fonction avec tests
  Given un projet TypeScript existant
  When l'utilisateur demande "Ajoute une fonction de validation d'email"
  Then l'agent crée la fonction dans le bon fichier
  And l'agent crée les tests associés
  And les tests passent

Scenario: Correction de bug
  Given un test qui échoue
  When l'utilisateur demande "Corrige ce bug"
  Then l'agent identifie la cause
  And l'agent propose une correction
  And le test passe après correction
```

#### 6.2.2 Refactoring

```gherkin
Feature: Refactoring de code

Scenario: Extraction de fonction
  Given une fonction trop longue
  When l'utilisateur demande "Extrait cette logique en fonction séparée"
  Then l'agent crée la nouvelle fonction
  And l'agent met à jour les appels
  And les tests existants passent toujours
```

#### 6.2.3 Sécurité

```gherkin
Feature: Audit de sécurité

Scenario: Scan de vulnérabilités
  Given un projet avec des vulnérabilités potentielles
  When l'utilisateur exécute "/security-review src/"
  Then un rapport est généré
  And les vulnérabilités sont listées par sévérité
  And des recommandations sont fournies
```

### 6.3 Scénarios de Bout en Bout

| ID | Scénario | Étapes | Critère de Succès |
|----|----------|--------|-------------------|
| E2E-001 | Nouveau projet | Init → Code → Test → Commit | Projet fonctionnel |
| E2E-002 | Debug complet | Erreur → Analyse → Fix → Vérif | Bug corrigé |
| E2E-003 | Refactoring | Analyse → Plan → Exécution → Tests | Code amélioré |
| E2E-004 | Audit sécurité | Scan → Rapport → Fix → Rescan | 0 vulnérabilités |
| E2E-005 | Session longue | Multi-tâches → Checkpoints → Restore | État cohérent |

---

## 7. Tests de Performance

### 7.1 Benchmarks

| ID | Métrique | Cible | Méthode |
|----|----------|-------|---------|
| PF-001 | Temps démarrage | < 2s | Chrono cold start |
| PF-002 | Latence réponse | < 500ms | P95 premières réponses |
| PF-003 | Throughput tools | > 10/s | Tools simples/seconde |
| PF-004 | Mémoire idle | < 200MB | Mesure après init |
| PF-005 | Mémoire peak | < 1GB | Mesure sous charge |
| PF-006 | Indexation RAG | < 30s/1000 fichiers | Benchmark codebase |

### 7.2 Tests de Charge

| ID | Scénario | Charge | Critère |
|----|----------|--------|---------|
| LC-001 | Requêtes concurrentes | 10 requêtes parallèles | Pas d'erreur |
| LC-002 | Session longue | 1000 messages | Pas de memory leak |
| LC-003 | Gros fichiers | Fichier 10MB | Traitement < 5s |
| LC-004 | Grande codebase | 10000 fichiers | Indexation < 5min |

### 7.3 Tests Cache

| ID | Scénario | Métrique | Cible |
|----|----------|----------|-------|
| CA-001 | Hit rate sémantique | % requêtes cachées | > 60% |
| CA-002 | Invalidation | Après modification | Cache mis à jour |
| CA-003 | Taille cache | Croissance | Plafonné à config |

---

## 8. Tests de Sécurité

### 8.1 Tests de Pénétration

| ID | Vecteur d'Attaque | Test | Résultat Attendu |
|----|-------------------|------|------------------|
| SEC-001 | Injection commande | `; rm -rf /` dans input | Échappement correct |
| SEC-002 | Path traversal | `../../etc/passwd` | Accès bloqué |
| SEC-003 | Prompt injection | Instructions malveillantes | Ignorées par agent |
| SEC-004 | Exfiltration data | Tentative envoi secrets | Bloqué + alerte |
| SEC-005 | Déni de service | Requêtes massives | Rate limiting |
| SEC-006 | Escalade privilèges | Commande sudo | Confirmation requise |

### 8.2 Tests OWASP

| ID | Vulnérabilité OWASP | Test | Protection |
|----|---------------------|------|------------|
| OW-001 | A01 Broken Access Control | Accès fichiers hors scope | Sandbox |
| OW-002 | A02 Cryptographic Failures | Secrets en clair | Redaction |
| OW-003 | A03 Injection | SQL/Command injection | Validation input |
| OW-004 | A07 XSS | Script dans output | Échappement |

### 8.3 Tests Sandbox

| ID | Test | Commande | Résultat Attendu |
|----|------|----------|------------------|
| SB-001 | Isolation filesystem | Écriture /tmp externe | Échec |
| SB-002 | Isolation réseau | Connexion externe | Échec (si désactivé) |
| SB-003 | Isolation processus | Fork bomb | Limité + kill |
| SB-004 | Resource limits | CPU 100% | Throttling |

---

## 9. Tests d'Interface Utilisateur

### 9.1 Tests Terminal UI

| ID | Composant | Test | Résultat Attendu |
|----|-----------|------|------------------|
| UI-001 | Input prompt | Saisie texte | Affichage correct |
| UI-002 | Streaming | Réponse longue | Affichage progressif |
| UI-003 | Markdown | Code blocks | Syntax highlighting |
| UI-004 | Progress bar | Tâche longue | Animation fluide |
| UI-005 | Confirmation | Opération risquée | Modal affiché |
| UI-006 | Thèmes | Switch thème | Couleurs changées |
| UI-007 | Resize | Redimensionnement terminal | Adaptation layout |

### 9.2 Tests Accessibilité

| ID | Critère | Test | Résultat Attendu |
|----|---------|------|------------------|
| A11Y-001 | Screen reader | Output complet | Lecture possible |
| A11Y-002 | Contraste | Tous thèmes | Ratio ≥ 4.5:1 |
| A11Y-003 | Navigation clavier | Sans souris | Fonctionnel |

### 9.3 Tests Error Handling UI

| ID | Erreur | Affichage | Résultat Attendu |
|----|--------|-----------|------------------|
| ERR-001 | Erreur API | Message utilisateur | Message clair |
| ERR-002 | Crash composant | Error boundary | Récupération gracieuse |
| ERR-003 | Timeout | Indicateur | Message + retry option |

---

## 10. Tests de Régression

### 10.1 Suite de Régression

Exécuter avant chaque release :

```bash
# Tests critiques (bloquants)
npm run test:critical

# Tests complets
npm run test

# Tests de performance
npm run test:perf

# Tests de sécurité
npm run test:security
```

### 10.2 Tests Smoke

| ID | Fonctionnalité | Test Rapide | Temps Max |
|----|----------------|-------------|-----------|
| SM-001 | Démarrage | `grok --version` | 1s |
| SM-002 | Agent | Message simple | 5s |
| SM-003 | File read | Lecture README | 2s |
| SM-004 | Search | Grep simple | 2s |
| SM-005 | Commit | /commit (dry-run) | 5s |

### 10.3 Tests de Non-Régression

Après chaque modification majeure :

1. Exécuter tous les tests unitaires
2. Exécuter tests d'intégration impactés
3. Vérifier métriques de performance
4. Valider couverture de code

---

## 11. Critères d'Acceptation

### 11.1 Critères par Priorité

| Priorité | Critère | Seuil |
|----------|---------|-------|
| **Critique** | Tests passent | 100% |
| **Haute** | Tests passent | 100% |
| **Moyenne** | Tests passent | 95% |
| **Basse** | Tests passent | 90% |

### 11.2 Métriques Qualité

| Métrique | Seuil Minimum | Cible |
|----------|---------------|-------|
| Couverture code | 80% | 90% |
| Couverture branches | 70% | 85% |
| Duplication code | < 5% | < 3% |
| Complexité cyclomatique | < 20 | < 10 |
| Dette technique | < 2 jours | < 1 jour |

### 11.3 Critères de Release

- [ ] Tous tests critiques passent
- [ ] Couverture ≥ 80%
- [ ] Aucun bug critique/bloquant ouvert
- [ ] Performance dans les limites
- [ ] Scan sécurité sans vulnérabilité haute
- [ ] Documentation à jour
- [ ] Changelog complété

---

## 12. Annexes

### 12.1 Commandes de Test

```bash
# Tous les tests
npm test

# Tests avec couverture
npm run test:coverage

# Tests en mode watch
npm run test:watch

# Tests par module
npm test -- --testPathPattern="agent"
npm test -- --testPathPattern="security"
npm test -- --testPathPattern="tools"

# Tests avec verbose
npm test -- --verbose

# Tests spécifiques
npm test -- -t "GrokAgent"
npm test -- -t "should initialize"

# Générer rapport HTML
npm run test:coverage -- --coverageReporters=html
```

### 12.2 Structure des Tests

```
tests/
├── agent/
│   ├── grok-agent.test.ts
│   ├── multi-agent.test.ts
│   ├── repair-engine.test.ts
│   └── thinking-keywords.test.ts
├── tools/
│   ├── file-operations.test.ts
│   ├── bash-execution.test.ts
│   └── enhanced-search.test.ts
├── security/
│   ├── approval-modes.test.ts
│   ├── data-redaction.test.ts
│   ├── os-sandbox.test.ts
│   └── execpolicy.test.ts
├── context/
│   ├── rag-system.test.ts
│   ├── context-compression.test.ts
│   └── web-search.test.ts
├── memory/
│   ├── memory-system.test.ts
│   └── database.test.ts
├── config/
│   └── grokrules.test.ts
├── input/
│   ├── multimodal-input.test.ts
│   └── voice-input.test.ts
├── integrations/
│   ├── github-actions.test.ts
│   └── ide-extensions.test.ts
├── integration/
│   ├── agent-tools.test.ts
│   ├── agent-security.test.ts
│   └── agent-memory.test.ts
├── e2e/
│   ├── new-project.test.ts
│   ├── debug-workflow.test.ts
│   └── security-audit.test.ts
├── performance/
│   ├── benchmarks.test.ts
│   └── load-tests.test.ts
└── fixtures/
    ├── code-samples/
    ├── images/
    └── configs/
```

### 12.3 Mocks Disponibles

```typescript
// Mock API Grok
jest.mock('../src/grok/client', () => ({
  GrokClient: jest.fn().mockImplementation(() => ({
    chat: jest.fn().mockResolvedValue({ content: 'mocked response' }),
    stream: jest.fn().mockImplementation(async function* () {
      yield { content: 'chunk1' };
      yield { content: 'chunk2' };
    }),
  })),
}));

// Mock Filesystem
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  existsSync: jest.fn(),
}));

// Mock Child Process
jest.mock('child_process', () => ({
  exec: jest.fn(),
  spawn: jest.fn(),
}));
```

### 12.4 Fixtures de Test

```typescript
// fixtures/code-samples/vulnerable.ts
export const sqlInjectionSample = `
const query = "SELECT * FROM users WHERE id = " + userId;
db.query(query);
`;

// fixtures/code-samples/secure.ts
export const secureSample = `
const query = "SELECT * FROM users WHERE id = ?";
db.query(query, [userId]);
`;

// fixtures/configs/grokrules-sample.yaml
export const grokrulesSample = `
description: Test Project
languages:
  - typescript
instructions:
  - Use strict mode
security:
  allowedCommands:
    - npm
    - git
`;
```

### 12.5 Rapport de Test Exemple

```
Test Suites: 69 passed, 69 total
Tests:       2 skipped, 2055 passed, 2057 total
Snapshots:   0 total
Time:        24.215 s

Coverage Summary:
  Statements   : 82.5% (5234/6344)
  Branches     : 76.8% (1023/1332)
  Functions    : 85.2% (892/1047)
  Lines        : 83.1% (5102/6140)

Modules with coverage < 80%:
  - src/ui/components/ (72%)
  - src/plugins/marketplace.ts (68%)
```

---

## Historique des Versions

| Version | Date | Auteur | Modifications |
|---------|------|--------|---------------|
| 1.0.0 | 2025-12-11 | Grok CLI Team | Version initiale |

---

*Document généré pour Grok CLI v1.0.0*
