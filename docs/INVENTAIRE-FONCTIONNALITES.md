# Code Buddy — inventaire des fonctionnalités

> Document de travail interne, établi le 21/09/2026 à partir du code, pas de mémoire.
> **La colonne « Preuve » est la seule qui compte** : elle dit ce qui a été vérifié
> par exécution, ce qui n'est couvert que par des tests, et ce qui n'a jamais été
> éprouvé en usage réel. Rien ne doit être communiqué avant d'être passé en ✅.
>
> Légende — ✅ prouvé par exécution, avec la mesure · 🧪 couvert par des tests
> automatisés · ❓ jamais éprouvé en usage réel · 💤 présent mais éteint par défaut

## L'ampleur, en chiffres

| | |
|---|---|
| Lignes de TypeScript (hors tests) | **876 917** |
| Commandes CLI | **105** |
| Outils exposés à l'agent | **230** |
| Fournisseurs LLM | **15** + Gemini natif |
| Variables d'environnement documentées | **122** |
| Fichiers de test | **1 839** (~27 000 tests) |
| Composants Rust | 2 (`buddy-sense`, `buddy-memory`) |
| Sidecar Python | 1 (`buddy-vision`) |

---

## 1. Le socle : un agent qui exécute

| Fonctionnalité | Ce que c'est | Preuve |
|---|---|---|
| Boucle agentique | Le modèle appelle des outils en autonomie, jusqu'à 50 tours (400 en YOLO) | 🧪 |
| 230 outils | Fichiers, shell, navigateur, recherche, médias, mémoire… | 🧪 |
| 15 fournisseurs | Grok, Claude, GPT, Gemini, Ollama, LM Studio, Bedrock, Azure, Groq, Together, Fireworks, OpenRouter, vLLM, Copilot, Mistral | 🧪 |
| Sélection d'outils par RAG | Les outils sont filtrés par embeddings pour réduire le prompt | 🧪 |
| Bascule de fournisseur | Sur quota épuisé ou panne, passage au suivant sans perdre la session | 🧪 💤 |
| Modes d'autorisation | `default`, `plan`, `acceptEdits`, `dontAsk`, `bypassPermissions` | 🧪 |
| Bac à sable noyau | Bubblewrap, Landlock ou seatbelt pour `bash`, **fermeture en cas d'échec** | 🧪 💤 |

## 2. Mémoire — les cinq couches

Le modèle décrit par Anthropic en septembre 2026. **Les cinq existent ici.**

| Couche | Chez nous | Preuve |
|---|---|---|
| **Travail** — ce qu'il voit | `ContextManagerV2`, compression par fenêtre glissante | 🧪 |
| **Travail étendue** — compaction réversible | Un segment compacté se redéplie (`context_expand`) au lieu d'être perdu | ❓ activé le 21/09 |
| **Épisodique** — ce qui s'est passé | Journal des épisodes, chronologie par tour, rejouable | ❓ actif sur Lisa |
| **Sémantique** — ce qu'il sait | Graphe de connaissances collectif : nœuds typés, supersede bi-temporel, corroboration entre agents, moteur Rust + index HNSW | ✅ **4 119 entrées, rappel pertinent mesuré** |
| **Procédurale** — comment faire | L'agent écrit ses propres outils et savoir-faire, sous garde empirique | ❓ activé le 21/09 en `propose-only` |
| **Oubli** | Courbe d'Ebbinghaus, le rappel renforce, archivage avant suppression, restaurable | 🧪 actif sur Lisa |

## 3. Vérification — ne pas se croire sur parole

| Fonctionnalité | Ce que c'est | Preuve |
|---|---|---|
| Verifier indépendant | Un agent à contexte neuf juge le travail : CONFIRMÉ / À REVOIR | 🧪 |
| Porte de preuves sur les buts | Un « c'est fait » sans preuve est rétrogradé en « continue » | ✅ **réparé le 21/09** |
| `buddy loop` | plan → exécute → **vérifie** → juge, jusqu'à preuve ou budget épuisé | ❓ |
| Porte de revue de diff | Toute écriture passe par une revue ; un diff non revu est **refusé**, jamais appliqué en silence | 🧪 💤 |
| Espace de travail fantôme | Les écritures sont validées dans un clone avant de toucher les fichiers | ❓ 💤 |
| Registre d'intentions | Des spécifications falsifiables, avec détection de dérive | ❓ 💤 |

## 4. Plusieurs cerveaux

| Fonctionnalité | Ce que c'est | Preuve |
|---|---|---|
| Flotte (`peer.chat`) | Des instances s'observent et s'appellent en direct, par WebSocket | 🧪 |
| Outils distants | Un pair exécute un outil **en lecture seule**, derrière trois barrières | 🧪 |
| Conseil de modèles | Plusieurs modèles délibèrent, un juge arbitre, un tableau de bord entraîne le routage | 🧪 💤 |
| `/batch`, `/swarm`, `/team` | Décomposition en sous-agents parallèles | 🧪 |
| Fédération de graphes | Un pair tire les leçons d'un autre, en lecture seule | ❓ 💤 |

## 5. Auto-amélioration — bornée par l'expérience

Quatre surfaces apprenables. **Jamais `src/`** : c'est un invariant scanné.

| Surface | Ce que c'est | Preuve |
|---|---|---|
| Leçons | Score sur un banc → propose → **valide empiriquement** → garde ou annule | 🧪 💤 |
| Outils | L'agent écrit un outil, qui passe un scan statique, des cas visibles, puis des **cas cachés** — la défense contre le bachotage | 🧪 💤 |
| Savoir-faire | Il rédige ses propres SKILL.md, filtrés par un pare-feu anti-injection | 🧪 💤 |
| Stratégies | Comment exécuter : plafonds, niveau de raisonnement — **aucun champ ne peut désactiver un garde-fou, par construction** | 🧪 💤 |

## 6. Perception — le robot

| Fonctionnalité | Ce que c'est | Preuve |
|---|---|---|
| Système nerveux (Rust) | Cinq sens sur canaux bornés, thalamus qui coalesce, diffusion | 🧪 20 tests Rust |
| Yeux (Python/MediaPipe) | Détecteurs à états : une seule alerte par transition, pas de spam | ✅ en service 24/7 |
| Voix | Parole → transcription → pensée → parole, avec interruption possible | ✅ en usage quotidien |
| Rêve | Consolide le tampon court terme en journal, promeut le saillant en mémoire | 🧪 actif |
| Rappels | Annoncés à voix haute et par Telegram, acquittés à la voix | ✅ en usage |
| Règles sensorielles | Des règles déclenchent des actions ; une action dangereuse est **refusée à l'écriture** | 🧪 💤 |

## 7. Médias

| Fonctionnalité | Ce que c'est | Preuve |
|---|---|---|
| Film long | Enchaîne des clips avec transitions, musique duckée, narration Piper, porte de qualité | ✅ films produits |
| Prompt → vidéo | Un sujet, un plan de scènes, des clips 1080p avec sous-titres karaoké | ✅ |
| Images | ComfyUI local ou fournisseurs cloud, avec repli | ✅ |
| Entraînement de la perception | Scènes étiquetées → YOLO → points faibles classés | 🧪 |

## 8. Interfaces

| Fonctionnalité | Ce que c'est | Preuve |
|---|---|---|
| CLI (Ink/React) | 105 commandes, complétion, thèmes | ✅ usage quotidien |
| Cowork | Application de bureau Electron, ateliers visuels | 🧪 |
| PWA mobile | Compagnon sur téléphone, historique persistant, album photo | ✅ en usage |
| Serveur HTTP | Un port, API compatible OpenAI, A2A Google, WebSocket | ✅ |
| Serveur MCP | Code Buddy s'expose comme serveur MCP | ❓ |

## 9. Garde-fous

| Fonctionnalité | Ce que c'est | Preuve |
|---|---|---|
| Pare-feu de compétences | Scan anti-injection avec dé-obfuscation (zéro-largeur, homoglyphes, bidi) | 🧪 |
| Validateur de commandes | Analyse statique du shell avant exécution | 🧪 |
| Garde des secrets | Aucun secret en clair dans les fichiers suivis | 🧪 |
| Garde de déploiement | Les opérations sensibles exigent une confirmation | 🧪 |
| Nettoyage de sortie | Retire les fuites de modèle (`<think>`, `[INST]`, caractères invisibles) | 🧪 |
| Réparation de transcript | Répare les paires d'appels d'outils perdues à la compaction | 🧪 |

---

## Ce qu'il reste à prouver

Par ordre de valeur pour la communication :

1. **Les quatre couches de mémoire activées le 21/09** — la sémantique est prouvée ;
   il reste l'épisodique, la procédurale et la compaction réversible.
2. **`buddy loop`** — la boucle qui ne s'arrête que sur preuve. C'est l'argument le
   plus fort face à la concurrence, et il n'a jamais été mesuré de bout en bout.
3. **La porte de revue de diff** — « un diff non revu est refusé » est une promesse
   forte ; elle mérite une démonstration.
4. **L'espace de travail fantôme et le registre d'intentions** — jamais éprouvés.
5. **Les quatre surfaces d'auto-amélioration** — testées unitairement, jamais vues
   à l'œuvre sur une vraie session.

## Règle pour la suite

**Rien ne passe en communication tant que la ligne n'est pas en ✅.** Une
fonctionnalité annoncée qui ne tient pas est pire que pas d'annonce du tout : c'est
la façade qu'on refuse dans le produit, et elle n'est pas plus acceptable dans le
discours.
