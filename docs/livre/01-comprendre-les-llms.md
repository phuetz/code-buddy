# Chapitre 1 — Comprendre les LLMs Aujourd'hui

---

> **Scène d'ouverture**
>
> *Lina fixe son écran, les sourcils froncés. Son chatbot "intelligent" vient encore de s'emmêler les pinceaux.*
>
> « Peux-tu modifier le fichier `config.ts` pour ajouter le nouveau paramètre ? »
>
> *Le modèle répond avec assurance :*
>
> « Bien sûr ! J'ai modifié le fichier `src/config.ts` pour ajouter le paramètre `maxRetries`. Voici les changements... »
>
> *Lina vérifie. Le fichier s'appelle `configuration.ts`, pas `config.ts`. Et il n'y a aucun paramètre `maxRetries` dedans. Le modèle a tout inventé.*
>
> *Elle soupire. C'est la troisième hallucination de la journée. Il doit y avoir un meilleur moyen.*

---

## Introduction

Avant de construire un agent, il faut comprendre son cerveau : le Large Language Model (LLM). Ce chapitre démystifie le fonctionnement interne des LLMs, explique pourquoi ils hallucinent, et pose les bases de ce qui différencie un simple chatbot d'un agent véritable.

---

## 1.1 L'Architecture Transformer

### 1.1.1 Une révolution née en 2017

Tout a commencé avec un article de Google intitulé "Attention Is All You Need". Les auteurs — Vaswani et ses collègues — ont proposé une architecture radicalement différente des réseaux de neurones récurrents (RNN) qui dominaient alors le traitement du langage.

L'idée centrale ? **L'attention**.

Plutôt que de traiter les mots un par un de manière séquentielle, le Transformer peut regarder tous les mots d'une phrase simultanément et décider lesquels sont importants pour comprendre chaque mot.

```
Phrase : "Le chat qui dort sur le canapé est noir"

Pour comprendre "noir" :
- "chat" → très important (c'est lui qui est noir)
- "dort" → peu important
- "canapé" → peu important
- "est" → important (lien syntaxique)
```

### 1.1.2 Le mécanisme d'attention

Techniquement, l'attention fonctionne avec trois vecteurs pour chaque token :

| Vecteur | Rôle | Analogie |
|---------|------|----------|
| **Query (Q)** | "Que cherche ce token ?" | Une question |
| **Key (K)** | "Que contient ce token ?" | Une étiquette |
| **Value (V)** | "Quelle information transmettre ?" | La réponse |

La formule magique :

```
Attention(Q, K, V) = softmax(QK^T / √d_k) × V
```

En français : pour chaque token, on calcule à quel point il "matche" avec tous les autres tokens (Q × K), on normalise ces scores (softmax), puis on utilise ces scores pour pondérer les informations (× V).

### 1.1.3 Multi-Head Attention

Un seul mécanisme d'attention ne suffit pas. Les Transformers utilisent plusieurs "têtes" d'attention en parallèle, chacune spécialisée dans un type de relation :

```
┌─────────────────────────────────────────────────────────┐
│                  MULTI-HEAD ATTENTION                    │
├─────────────────────────────────────────────────────────┤
│                                                          │
│   ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐       │
│   │ Head 1 │  │ Head 2 │  │ Head 3 │  │ Head 4 │ ...   │
│   │Syntaxe │  │Sémantiq│  │Position│  │Coréfér.│       │
│   └────┬───┘  └────┬───┘  └────┬───┘  └────┬───┘       │
│        │           │           │           │            │
│        └───────────┴───────────┴───────────┘            │
│                         │                               │
│                   ┌─────▼─────┐                         │
│                   │  Concat   │                         │
│                   │ + Linear  │                         │
│                   └───────────┘                         │
└─────────────────────────────────────────────────────────┘
```

GPT-4, par exemple, utilise probablement 96 têtes d'attention sur 96 couches — des milliers de perspectives différentes sur chaque token.

### 1.1.4 L'architecture complète

Un Transformer moderne (comme GPT-4 ou Claude) empile des dizaines de blocs identiques :

```
┌─────────────────────────────────────────────────────────┐
│                    TRANSFORMER BLOCK                     │
├─────────────────────────────────────────────────────────┤
│                                                          │
│   Input ──▶ ┌──────────────────────┐                    │
│             │  Layer Normalization │                     │
│             └──────────┬───────────┘                    │
│                        ▼                                 │
│             ┌──────────────────────┐                    │
│             │  Multi-Head Attention │                    │
│             └──────────┬───────────┘                    │
│                        │                                 │
│             ┌──────────▼───────────┐                    │
│             │  + Residual Connection│                    │
│             └──────────┬───────────┘                    │
│                        ▼                                 │
│             ┌──────────────────────┐                    │
│             │  Layer Normalization │                     │
│             └──────────┬───────────┘                    │
│                        ▼                                 │
│             ┌──────────────────────┐                    │
│             │    Feed Forward NN   │                     │
│             └──────────┬───────────┘                    │
│                        │                                 │
│             ┌──────────▼───────────┐                    │
│             │  + Residual Connection│                    │
│             └──────────┬───────────┘                    │
│                        ▼                                 │
│                     Output                               │
│                                                          │
└─────────────────────────────────────────────────────────┘

         × N couches (N = 32 à 96+)
```

---

## 1.2 Tokenization et Embeddings

### 1.2.1 Le problème des mots

Les ordinateurs ne comprennent pas les mots. Ils comprennent les nombres. Comment passer de "Bonjour, comment allez-vous ?" à quelque chose qu'un réseau de neurones peut traiter ?

La première étape est la **tokenization** : découper le texte en unités manipulables.

### 1.2.2 BPE : Byte Pair Encoding

Les LLMs modernes utilisent BPE (ou ses variantes comme SentencePiece). L'idée est de trouver les paires de caractères les plus fréquentes et de les fusionner itérativement.

```
Vocabulaire initial : a, b, c, d, e, f, ...

Texte : "aaaaabbbbb"

Étape 1 : "aa" fréquent → nouveau token "X"
          "XXXXXbbbbb" → "XXabbbbb"

Étape 2 : "bb" fréquent → nouveau token "Y"
          "XXaYYYb" → "XXaYYb"

Etc.
```

Résultat : un vocabulaire de 30 000 à 100 000 tokens qui capture :
- Les mots courants entiers ("the", "est", "function")
- Les sous-mots ("un", "##able", "##tion")
- Les caractères individuels pour les cas rares

### 1.2.3 Exemple concret

```
Texte : "Développement d'applications"

Tokens GPT-4 : ["Dé", "velopp", "ement", " d", "'", "applications"]

Token IDs : [5765, 19927, 1671, 294, 6, 31783]
```

Chaque token devient ensuite un **embedding** : un vecteur de haute dimension (typiquement 4096 à 12288 dimensions) qui capture son sens.

### 1.2.4 Embeddings positionnels

Un problème : l'attention traite tous les tokens simultanément, sans notion d'ordre. Comment savoir que "Le chat mange la souris" est différent de "La souris mange le chat" ?

Solution : ajouter des **embeddings positionnels** qui encodent la position de chaque token.

```
Embedding final = Embedding du token + Embedding de position

Position 1 : [0.1, -0.2, 0.5, ...]
Position 2 : [0.2, -0.1, 0.4, ...]
Position 3 : [0.3, 0.0, 0.3, ...]
```

Les modèles récents utilisent des embeddings positionnels rotatifs (RoPE) qui permettent de généraliser à des séquences plus longues que celles vues à l'entraînement.

---

## 1.3 Génération Autorégressive

### 1.3.1 Prédire le prochain token

Les LLMs sont fondamentalement des **machines à prédire le prochain token**. Ils ne "comprennent" pas au sens humain — ils calculent des probabilités.

```
Input  : "Le ciel est"
Output : P("bleu") = 0.35
         P("gris") = 0.20
         P("nuageux") = 0.15
         P("beau") = 0.10
         ...
```

Le modèle sélectionne ensuite un token (souvent par échantillonnage pondéré par les probabilités), l'ajoute à l'input, et recommence.

### 1.3.2 Température et échantillonnage

La **température** contrôle la "créativité" du modèle :

| Température | Comportement | Usage |
|-------------|--------------|-------|
| 0.0 | Déterministe (toujours le token le plus probable) | Code, maths |
| 0.7 | Équilibré | Conversation |
| 1.0+ | Créatif/aléatoire | Fiction, brainstorming |

```typescript
// Grok-CLI utilise température 0.7 par défaut
const response = await client.chat.completions.create({
  model: 'grok-3',
  messages: [...],
  temperature: 0.7,
  top_p: 0.95
});
```

### 1.3.3 Top-p (nucleus sampling)

Plutôt que de considérer tous les tokens possibles, **top-p** ne garde que les tokens dont les probabilités cumulées atteignent p (typiquement 0.9 ou 0.95).

```
Probabilités : bleu(0.35), gris(0.20), nuageux(0.15),
               beau(0.10), sombre(0.08), ...

Top-p = 0.9 → Garde : bleu, gris, nuageux, beau, sombre
               Ignore : les centaines d'autres tokens improbables
```

---

## 1.4 Scaling Laws et Émergence

### 1.4.1 Plus gros = plus intelligent ?

Une découverte surprenante : les performances des LLMs suivent des **lois de puissance** prévisibles par rapport à trois facteurs :

1. **Taille du modèle** (nombre de paramètres)
2. **Taille du dataset** (tokens d'entraînement)
3. **Compute** (FLOPs d'entraînement)

```
Performance ∝ (Paramètres)^α × (Données)^β × (Compute)^γ

Avec α ≈ 0.076, β ≈ 0.095, γ ≈ 0.050
```

### 1.4.2 Capacités émergentes

Certaines capacités apparaissent **soudainement** quand le modèle atteint une certaine taille :

| Capacité | Seuil approximatif |
|----------|-------------------|
| Arithmetic à 3 chiffres | ~1B paramètres |
| Chain-of-thought | ~10B paramètres |
| Raisonnement multi-étapes | ~50B paramètres |
| In-context learning complexe | ~100B+ paramètres |

Ces "sauts" qualitatifs expliquent pourquoi GPT-4 semble si différent de GPT-3 : ce n'est pas juste "un peu meilleur", certaines capacités sont apparues.

### 1.4.3 Les limites du scaling

Mais le scaling a ses limites :
- **Coût** : GPT-4 a coûté ~$100M à entraîner
- **Données** : On épuise le texte de qualité disponible
- **Énergie** : Empreinte carbone croissante
- **Rendements décroissants** : Chaque doublement de taille donne moins de gains

D'où l'importance des techniques que nous verrons : comment obtenir plus avec moins.

---

## 1.5 Les Limites Fondamentales des LLMs

> *Lina a passé une heure à débugger un problème. Le LLM lui a suggéré une solution élégante... qui utilisait une fonction inexistante dans la bibliothèque.*
>
> *"Comment peut-il être si confiant sur quelque chose de complètement faux ?" se demande-t-elle.*

### 1.5.1 Hallucinations

Les LLMs **inventent**. Pas par malveillance, mais parce qu'ils optimisent pour produire du texte plausible, pas du texte vrai.

**Causes des hallucinations :**

1. **Données d'entraînement contradictoires** : Le modèle a vu des informations conflictuelles et "moyenne"

2. **Pression de complétion** : Le modèle préfère répondre (même faux) plutôt que dire "je ne sais pas"

3. **Patterns statistiques** : Si "Python 3.12 ajoute" est suivi de diverses features dans les données, le modèle peut inventer une feature plausible

4. **Absence de grounding** : Le modèle n'a pas accès à la réalité pour vérifier ses affirmations

**Types d'hallucinations :**

| Type | Exemple | Dangerosité |
|------|---------|-------------|
| **Factuelle** | "La Tour Eiffel mesure 450m" | Modérée |
| **Référentielle** | "Selon l'article de Smith (2023)..." (n'existe pas) | Haute |
| **Code** | "Utilisez `array.flatten()` en JavaScript" (n'existe pas) | Haute |
| **Confabulation** | Inventer des détails sur un fichier non lu | Très haute |

### 1.5.2 Fenêtre de contexte

Les LLMs ont une **mémoire limitée** : la fenêtre de contexte.

```
┌─────────────────────────────────────────────────────────┐
│                  CONTEXT WINDOW                          │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │ System prompt │ Historique │ User message │ ...  │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  GPT-3.5  : 4K tokens   (~3 000 mots)                   │
│  GPT-4    : 8K-128K tokens                              │
│  Claude 3 : 200K tokens (~150 000 mots)                 │
│  Grok-3   : 128K tokens                                 │
│                                                          │
│  ⚠️ Au-delà de la fenêtre : le modèle OUBLIE            │
└─────────────────────────────────────────────────────────┘
```

**Implications :**
- Une conversation longue "pousse" les anciens messages hors de la fenêtre
- Les fichiers volumineux ne peuvent pas être traités en une fois
- Le modèle peut se contredire s'il a oublié ce qu'il a dit

### 1.5.3 Absence de mémoire persistante

Un LLM vanilla n'a **aucune mémoire entre les sessions**. Chaque requête est indépendante.

```
Session 1 : "Je m'appelle Lina, je travaille sur Grok-CLI"
Session 2 : "Comment je m'appelle ?" → "Je ne sais pas"
```

C'est pourquoi les agents ont besoin de systèmes de mémoire externes (bases de données, embeddings).

### 1.5.4 Incapacité d'action directe

Un LLM **ne peut rien faire** par lui-même. Il ne peut que générer du texte.

```
User : "Crée un fichier test.txt"
LLM  : "Voici comment créer un fichier : ..."  (mais ne le fait pas)
```

Pour agir, le LLM doit être augmenté avec des **outils** — exactement ce que fait un agent.

### 1.5.5 Biais et limitations

Les LLMs héritent des biais de leurs données d'entraînement :
- Biais culturels (surreprésentation de l'anglais et de la culture occidentale)
- Biais temporels (connaissances figées à la date de cutoff)
- Biais de fréquence (solutions populaires favorisées même si pas optimales)

---

## 1.6 Pourquoi un Agent > un Simple Modèle

> *Lina réfléchit. Le problème n'est pas que le LLM est "bête" — il est incroyablement capable. Le problème est qu'il est isolé : pas d'accès au code réel, pas de mémoire, pas de feedback.*
>
> *"Et si je lui donnais des yeux et des mains ?" pense-t-elle.*

### 1.6.1 Le paradigme ReAct

En 2022, des chercheurs de Princeton et Google ont formalisé le paradigme **ReAct** (Reasoning + Acting) :

```
┌─────────────────────────────────────────────────────────┐
│                    REACT LOOP                            │
├─────────────────────────────────────────────────────────┤
│                                                          │
│   ┌─────────┐     ┌─────────┐     ┌─────────┐          │
│   │ THOUGHT │────▶│ ACTION  │────▶│OBSERVAT.│          │
│   │(Reason) │     │  (Act)  │     │(Perceive)│          │
│   └─────────┘     └─────────┘     └────┬────┘          │
│        ▲                               │                │
│        └───────────────────────────────┘                │
│                   (loop)                                │
└─────────────────────────────────────────────────────────┘
```

1. **Thought** : Le modèle raisonne sur ce qu'il doit faire
2. **Action** : Il exécute une action (outil)
3. **Observation** : Il observe le résultat
4. **Répéter** jusqu'à résolution

### 1.6.2 Augmentation par outils

Un LLM augmenté d'outils peut :

| Sans outils | Avec outils |
|-------------|-------------|
| "Le fichier contient probablement..." | Lire le fichier réel |
| "La commande devrait retourner..." | Exécuter la commande |
| "L'API répond généralement..." | Appeler l'API |
| "Le test devrait passer..." | Lancer le test |

C'est la différence entre **supposer** et **savoir**.

### 1.6.3 Boucle de feedback

Les outils permettent un **feedback loop** crucial :

```
┌─────────────────────────────────────────────────────────┐
│                   FEEDBACK LOOP                          │
├─────────────────────────────────────────────────────────┤
│                                                          │
│   Génère du code                                        │
│        │                                                 │
│        ▼                                                 │
│   Exécute le code (outil)                               │
│        │                                                 │
│        ▼                                                 │
│   Observe le résultat                                   │
│        │                                                 │
│   ┌────┴────┐                                           │
│   │ Erreur? │                                           │
│   └────┬────┘                                           │
│    Oui │    Non                                         │
│        │     │                                          │
│        ▼     ▼                                          │
│   Corrige  Terminé                                      │
│        │                                                 │
│        └──────▶ (répète)                                │
└─────────────────────────────────────────────────────────┘
```

Sans feedback, un LLM génère du code et espère qu'il fonctionne. Avec feedback, il peut itérer jusqu'à ce que ça marche.

### 1.6.4 Autonomie contrôlée

Un agent bien conçu est **autonome mais contrôlé** :

| Aspect | Autonomie | Contrôle |
|--------|-----------|----------|
| Décisions | Choisit les outils à utiliser | Outils limités et validés |
| Exécution | Lance les commandes | Sandbox, confirmations |
| Itération | Boucle jusqu'à succès | Limite de rounds |
| Apprentissage | Mémorise les patterns | Données filtrées |

---

## 1.7 Le Pont vers les Agents

> *Lina esquisse une architecture sur son carnet :*
>
> ```
> LLM brut + Outils + Mémoire + Reasoning = Agent
> ```
>
> *"C'est simple en théorie," pense-t-elle. "Voyons si ça l'est en pratique."*

### 1.7.1 Ce qu'un agent ajoute au LLM

```
┌─────────────────────────────────────────────────────────┐
│                    LLM vs AGENT                          │
├─────────────────────────────────────────────────────────┤
│                                                          │
│   LLM BRUT                    AGENT                      │
│   ────────                    ─────                      │
│   • Génère du texte           • Génère + Agit            │
│   • Stateless                 • Mémoire persistante      │
│   • Monologue                 • Dialogue avec le monde   │
│   • Confiant mais faillible   • Vérifie ses actions      │
│   • Isolé                     • Connecté (outils)        │
│   • Linéaire                  • Raisonnement complexe    │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 1.7.2 Les composants que nous allons construire

Dans les prochains chapitres, nous verrons :

1. **Reasoning** (Parties II)
   - Tree-of-Thought pour l'exploration
   - MCTS pour l'optimisation
   - Réparation automatique

2. **Mémoire** (Partie III)
   - RAG moderne
   - Compression de contexte
   - Dependency-aware retrieval

3. **Action** (Partie IV)
   - 41 outils spécialisés
   - Plugins et MCP
   - Sandbox et sécurité

4. **Optimisation** (Partie V)
   - Model routing
   - Exécution parallèle
   - Caching sémantique

5. **Apprentissage** (Partie VI)
   - Patterns de réparation
   - Conventions apprises
   - Amélioration continue

---

## 1.8 Référence Grok-CLI

Le wrapper client de Grok-CLI illustre comment interfacer proprement avec l'API :

```typescript
// src/grok/client.ts (simplifié)
import OpenAI from 'openai';

export class GrokClient {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://api.x.ai/v1'
    });
  }

  async chat(messages: Message[], options?: ChatOptions) {
    const response = await this.client.chat.completions.create({
      model: options?.model ?? 'grok-3',
      messages,
      temperature: options?.temperature ?? 0.7,
      tools: options?.tools,
      stream: true
    });

    return response;
  }
}
```

Ce wrapper abstrait les détails de l'API et fournit une interface propre que l'agent utilise.

---

## Résumé

Dans ce chapitre, nous avons vu :

| Concept | Point clé |
|---------|-----------|
| **Transformers** | Architecture basée sur l'attention multi-tête |
| **Tokenization** | BPE convertit le texte en IDs numériques |
| **Génération** | Autorégressive, contrôlée par température |
| **Scaling** | Plus gros = plus capable, mais rendements décroissants |
| **Limitations** | Hallucinations, contexte limité, pas de mémoire |
| **Agents** | LLM + Outils + Mémoire + Reasoning |

---

## Exercices

1. **Tokenization** : Utilisez le tokenizer de tiktoken pour compter les tokens d'un fichier de votre projet. Combien de tokens pour 1000 lignes de code ?

2. **Hallucinations** : Demandez à un LLM de décrire une fonction inexistante de votre langage préféré. Analysez comment il confabule.

3. **Contexte** : Calculez combien de fichiers de votre projet tiendraient dans une fenêtre de 128K tokens.

---

## Pour aller plus loin

- Vaswani et al. (2017). "Attention Is All You Need"
- Kaplan et al. (2020). "Scaling Laws for Neural Language Models"
- Yao et al. (2022). "ReAct: Synergizing Reasoning and Acting in Language Models"

---

*Prochainement : Chapitre 2 — Le Rôle des Agents dans l'Écosystème IA*

