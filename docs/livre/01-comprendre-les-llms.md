# 🧠 Chapitre 1 : Comprendre les Large Language Models

---

## 🎬 Scène d'ouverture : La Question Fondamentale

*Un mardi soir, dans un café près du campus universitaire...*

Lina fixait son écran, perplexe. Elle venait de passer trois heures à interagir avec ChatGPT, lui demandant d'expliquer du code, de générer des tests, de suggérer des refactorisations. Les résultats étaient tantôt brillants, tantôt absurdes. À un moment, le modèle avait produit une solution élégante à un problème de concurrence qu'elle n'arrivait pas à résoudre depuis des jours. L'instant d'après, il affirmait avec une assurance déconcertante qu'une bibliothèque inexistante était "la meilleure solution pour ce cas d'usage".

— "Comment ça peut être si intelligent et si stupide à la fois ?" murmura-t-elle en repoussant son ordinateur.

Son ami Marcus, doctorant en machine learning, s'assit à côté d'elle avec son café. Il avait entendu cette question des dizaines de fois — de la part d'étudiants, de collègues, même de professeurs chevronnés. C'était LA question que tout le monde se posait face aux LLMs.

— "Tu sais comment ça fonctionne, un LLM ?" demanda-t-il.

Lina haussa les épaules avec une moue frustrée.

— "Vaguement. Des réseaux de neurones, beaucoup de données, quelque chose avec l'attention... Mais honnêtement, ça ressemble à de la magie noire. Une magie noire qui ment parfois avec beaucoup d'aplomb."

Marcus sourit. Il connaissait ce sentiment d'émerveillement mêlé de méfiance. Pendant des mois, il avait lui aussi traité ces modèles comme des boîtes noires, acceptant leurs réponses sans vraiment comprendre d'où elles venaient. Puis il avait plongé dans les articles de recherche, les implémentations open-source, les visualisations d'attention. Et tout avait changé.

— "C'est un bon début. Mais si tu veux vraiment construire des outils qui utilisent ces modèles — pas juste les subir, mais les *maîtriser* — tu dois comprendre ce qu'ils sont *vraiment*. Pas la version marketing. La vraie mécanique. Les forces. Les faiblesses. Les raisons profondes de leurs comportements."

Il sortit un carnet et un stylo, dessina rapidement un schéma.

— "Laisse-moi te raconter une histoire. Elle commence en 2017, dans les bureaux de Google Brain, avec un article qui allait bouleverser tout le domaine de l'intelligence artificielle..."

---

## 📋 Table des Matières

| Section | Titre | Description |
|---------|-------|-------------|
| 1.1 | 📜 Histoire des Modèles de Langage | De n-grammes aux Transformers, l'évolution qui a tout changé |
| 1.2 | 🔬 Anatomie d'un Transformer | Tokenisation, embeddings, attention — les composants essentiels |
| 1.3 | 🎯 Le Mécanisme d'Attention | Query, Key, Value — comprendre le cœur du système |
| 1.4 | 🏗️ Architecture Complète | Encodeur, décodeur, et variations modernes |
| 1.5 | 📈 Scaling Laws | Pourquoi plus grand = meilleur (avec nuances) |
| 1.6 | ⚠️ Hallucinations | Comprendre pourquoi les LLMs "mentent" |
| 1.7 | 💻 Implications pour le Code | Ce que tout développeur doit savoir |
| 1.8 | 📝 Points Clés | Synthèse et concepts essentiels |

---

## 📜 1.1 Une Brève Histoire des Modèles de Langage

Pour comprendre pourquoi les LLMs actuels sont si puissants — et pourquoi ils ont des limitations spécifiques — il faut d'abord comprendre ce qui existait avant eux. L'histoire des modèles de langage est une histoire de compromis : entre expressivité et efficacité, entre mémoire et calcul, entre généralité et spécialisation. Chaque génération de modèles a résolu certains problèmes tout en en créant d'autres, jusqu'à ce qu'une innovation fondamentale — le Transformer — change les règles du jeu.

### 1.1.1 L'Ère Statistique : Les Modèles N-grammes

Pendant des décennies, le traitement automatique du langage naturel (NLP) reposait sur des approches purement statistiques. L'idée fondamentale était simple : si nous pouvons compter combien de fois certaines séquences de mots apparaissent ensemble dans un grand corpus de texte, nous pouvons prédire quel mot viendra probablement après une séquence donnée.

Les **modèles n-grammes** incarnaient cette philosophie. Un modèle bigramme (n=2) prédisait le mot suivant uniquement en fonction du mot précédent. Un modèle trigramme (n=3) utilisait les deux mots précédents. Et ainsi de suite.

Prenons un exemple concret. Supposons que nous ayons entraîné un modèle 5-grammes sur un corpus de textes français. Face à la séquence "le chat dort sur le", le modèle consulterait ses tables de fréquences :

- "le chat dort sur le **canapé**" : vu 1,247 fois dans le corpus
- "le chat dort sur le **tapis**" : vu 892 fois
- "le chat dort sur le **lit**" : vu 756 fois
- "le chat dort sur le **toit**" : vu 23 fois

Le modèle prédirait donc "canapé" avec une probabilité proportionnelle à ces fréquences. Simple, efficace... et profondément limité.

Le problème fondamental des n-grammes tient en un mot : **contexte**. Ces modèles ne peuvent "voir" qu'une fenêtre fixe de mots — typiquement 3 à 5. Or, le langage humain regorge de dépendances à longue distance. Considérez cette phrase :

> "Le développeur qui avait passé trois ans à travailler sur ce projet, malgré les difficultés rencontrées avec l'équipe de management et les contraintes budgétaires imposées par la direction, **était** finalement satisfait du résultat."

Le verbe "était" doit s'accorder avec "Le développeur" — un mot situé à plus de trente tokens de distance ! Aucun modèle n-gramme pratique ne pouvait capturer cette relation. C'était comme essayer de comprendre un roman en ne lisant que des phrases isolées, sans jamais voir les connexions entre les personnages et les événements.

| Aspect | Modèles N-grammes | Limitation |
|--------|-------------------|------------|
| **Mémoire** | Fenêtre fixe (3-5 mots) | Perte du contexte lointain |
| **Taille** | Croissance exponentielle | V^n entrées pour vocabulaire V |
| **Généralisation** | Aucune | Ne reconnaît que ce qu'il a vu exactement |
| **Données rares** | Problématique | "smoothing" nécessaire mais imparfait |

### 1.1.2 Les Réseaux Récurrents : Une Promesse Partiellement Tenue

Dans les années 2010, une nouvelle approche émergea : les réseaux de neurones récurrents (RNN). L'idée était élégante et biologiquement inspirée. Au lieu de regarder une fenêtre fixe de mots, le réseau maintiendrait un **état caché** — une sorte de "mémoire de travail" — qui se propagerait d'un mot au suivant.

Imaginez un lecteur humain parcourant un texte. À chaque mot, il ne repart pas de zéro : il accumule une compréhension du contexte, des personnages, du ton. Les RNN tentaient de reproduire ce mécanisme. L'état caché à l'étape t dépendait de l'entrée actuelle ET de l'état caché à l'étape t-1, créant une chaîne théoriquement capable de transporter l'information sur des distances arbitraires.

```
┌─────────────────────────────────────────────────────────────────────┐
│                    RÉSEAU RÉCURRENT (RNN)                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   Entrée:   x₁ ──→ x₂ ──→ x₃ ──→ x₄ ──→ x₅                         │
│              ↓      ↓      ↓      ↓      ↓                          │
│   États:    h₁ ──→ h₂ ──→ h₃ ──→ h₄ ──→ h₅                         │
│              ↓      ↓      ↓      ↓      ↓                          │
│   Sortie:   y₁     y₂     y₃     y₄     y₅                         │
│                                                                     │
│   hₜ = f(W_h × hₜ₋₁ + W_x × xₜ + b)                                 │
│                                                                     │
│   ⚠️ Problème : le signal s'affaiblit exponentiellement             │
│      quand il traverse de nombreuses étapes                         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

Les variantes comme LSTM (Long Short-Term Memory) et GRU (Gated Recurrent Unit) ajoutèrent des mécanismes de "portes" pour mieux contrôler le flux d'information. Ces architectures connurent un succès considérable et dominèrent le NLP pendant plusieurs années.

Cependant, deux problèmes fondamentaux persistaient :

**Le gradient évanescent** : Lors de l'entraînement, les signaux d'erreur doivent se propager à travers la chaîne de récurrence. À chaque étape, ils sont multipliés par des poids, et si ces poids sont inférieurs à 1 (ce qui est souvent le cas), le signal diminue exponentiellement. Après 50 ou 100 étapes, il devient pratiquement imperceptible. Le réseau "oublie" donc ce qu'il a vu au début de la séquence.

**La séquentialité imposée** : Par construction, un RNN doit traiter les mots un par un, dans l'ordre. Il est impossible de calculer h₃ avant d'avoir calculé h₂, qui lui-même dépend de h₁. Cette dépendance séquentielle empêche toute parallélisation efficace. Sur les GPU modernes, conçus pour exécuter des milliers d'opérations simultanément, cette limitation était catastrophique pour les temps d'entraînement.

| Critère | N-grammes | RNN/LSTM | Impact pratique |
|---------|-----------|----------|-----------------|
| **Contexte** | ~5 mots | ~100-500 mots (théorique) | LSTM meilleur mais imparfait |
| **Parallélisation** | Excellente | Impossible | Entraînement 10-100x plus lent |
| **Mémoire GPU** | Faible | Modérée | LSTM plus gourmand |
| **Dépendances longues** | Aucune | Difficiles | Gradient vanishing persiste |

### 1.1.3 Juin 2017 : "Attention Is All You Need"

Le 12 juin 2017, une équipe de huit chercheurs chez Google publia un article au titre provocateur : **"Attention Is All You Need"**. Parmi eux, des noms qui allaient devenir légendaires dans le domaine : Ashish Vaswani, Noam Shazeer, Niki Parmar, et Jakob Uszkoreit.

L'article proposait une architecture radicalement différente appelée **Transformer**. L'idée centrale tenait en une question audacieuse : et si on abandonnait complètement la récurrence ? Et si, au lieu de traiter les mots séquentiellement, on les traitait **tous en parallèle**, en utilisant uniquement des mécanismes d'attention pour capturer les relations entre eux ?

![Architecture Transformer](images/transformer-architecture.svg)

L'intuition derrière cette approche était profonde. Dans un RNN, l'information doit "voyager" à travers de nombreuses étapes pour connecter des mots éloignés. Chaque étape introduit du bruit et de l'atténuation. Mais que se passerait-il si chaque mot pouvait directement "regarder" tous les autres mots, sans intermédiaire ?

C'est exactement ce que fait le mécanisme d'attention : il permet à chaque position dans la séquence de calculer une connexion directe avec chaque autre position. La distance entre deux mots n'a plus d'importance — ils sont tous à "un saut d'attention" l'un de l'autre.

```
┌─────────────────────────────────────────────────────────────────────┐
│                   LA RÉVOLUTION TRANSFORMER                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   AVANT (RNN) :                                                     │
│                                                                     │
│   mot₁ ──→ mot₂ ──→ mot₃ ──→ mot₄ ──→ mot₅                         │
│   └──────────────────────────────────────────┘                      │
│           ⚠️ Information doit traverser toute la chaîne             │
│                                                                     │
│   APRÈS (Transformer) :                                             │
│                                                                     │
│            mot₁ ←──────────→ mot₂                                   │
│              ↕   ╲        ╱    ↕                                    │
│            mot₃ ←──╲────╱──→ mot₄                                   │
│              ↕      ╲╱       ↕                                      │
│            mot₅ ←────╳────→ mot₆                                    │
│                     ╱╲                                              │
│                    ╱  ╲                                             │
│                                                                     │
│   ✅ Chaque mot peut directement "voir" tous les autres             │
│   ✅ Calcul entièrement parallélisable sur GPU                      │
│   ✅ Distance = 1 pour toutes les paires de mots                    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

Les résultats furent spectaculaires. Sur la tâche de traduction anglais-allemand du benchmark WMT 2014, le Transformer atteignit un score BLEU de 28.4, surpassant tous les modèles précédents de plus de 2 points — une marge énorme dans ce domaine. Plus impressionnant encore : l'entraînement ne prenait que 3.5 jours sur 8 GPUs, contre des semaines pour les meilleurs modèles RNN.

| Métrique | LSTM (meilleur) | Transformer | Amélioration |
|----------|-----------------|-------------|--------------|
| BLEU (EN→DE) | 25.8 | 28.4 | +10% |
| BLEU (EN→FR) | 41.0 | 41.8 | +2% |
| Temps d'entraînement | ~3 semaines | 3.5 jours | **~6x plus rapide** |
| Paramètres | ~200M | 65M | 3x moins |

Un an plus tard, Google dévoilait **BERT** (Bidirectional Encoder Representations from Transformers) et OpenAI présentait **GPT** (Generative Pre-trained Transformer). L'ère des Large Language Models venait de commencer, et rien ne serait plus jamais pareil.

---

## 🔬 1.2 L'Anatomie d'un Transformer

Maintenant que nous comprenons le contexte historique, plongeons dans les détails techniques. Un Transformer est composé de plusieurs éléments interconnectés, chacun jouant un rôle précis dans la transformation du texte brut en représentations riches de sens.

### 1.2.1 La Tokenisation : Découper le Langage

Avant même d'entrer dans le réseau de neurones, le texte doit être converti en nombres. Cette étape, appelée **tokenisation**, est plus subtile et plus importante qu'il n'y paraît. Les choix faits à ce niveau ont des répercussions profondes sur les performances, les coûts, et même les biais du modèle.

![Processus de Tokenisation](images/tokenization-process.svg)

**Le problème du vocabulaire**

Une approche naïve consisterait à attribuer un identifiant unique à chaque mot du dictionnaire. Mais cette stratégie se heurte à plusieurs obstacles :

1. **La taille du vocabulaire** : Le français compte environ 100,000 mots courants, l'anglais environ 170,000. Mais avec les noms propres, les termes techniques, le jargon internet, les nouvelles créations... le vocabulaire effectif est pratiquement infini.

2. **Les mots rares** : Même avec un vocabulaire de 100,000 entrées, de nombreux mots ne seront vus qu'une ou deux fois pendant l'entraînement. Le modèle n'aura pas assez d'exemples pour apprendre leur signification.

3. **Les langues agglutinantes** : En allemand, finnois ou turc, les mots peuvent être composés de nombreux morphèmes. "Donaudampfschifffahrtsgesellschaftskapitän" (capitaine de la compagnie de navigation à vapeur du Danube) est un mot allemand parfaitement valide.

**La solution : Byte-Pair Encoding (BPE)**

La solution moderne est le **Byte-Pair Encoding**, un algorithme de compression adapté à la tokenisation. L'idée est de construire un vocabulaire de "sous-mots" — des fragments qui peuvent être combinés pour former n'importe quel mot.

L'algorithme fonctionne ainsi :
1. Commencer avec un vocabulaire contenant uniquement les caractères individuels
2. Compter toutes les paires de tokens adjacents dans le corpus
3. Fusionner la paire la plus fréquente en un nouveau token
4. Répéter jusqu'à atteindre la taille de vocabulaire désirée

Après entraînement sur un grand corpus, le vocabulaire contient :
- Des caractères individuels (pour gérer n'importe quelle entrée)
- Des morphèmes communs ("ing", "tion", "pré", "anti")
- Des mots fréquents entiers ("the", "is", "de", "le")
- Des fragments de mots moins courants

```
┌─────────────────────────────────────────────────────────────────────┐
│                 TOKENISATION BPE EN ACTION                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Entrée : "Le développeur implémente un algorithme"                 │
│                                                                     │
│  Tokenisation :                                                     │
│  ┌────┐┌────┐┌──────┐┌────┐┌──────┐┌────┐┌──────────┐              │
│  │ Le ││ dé ││velopp││ eur││implém││ente││algorithme│              │
│  └────┘└────┘└──────┘└────┘└──────┘└────┘└──────────┘              │
│    ↓     ↓      ↓      ↓      ↓      ↓       ↓                     │
│   453  8721  34502  2174   9821   3241    15678                    │
│                                                                     │
│  Total : 7 tokens (vs 5 mots)                                       │
│                                                                     │
│  Ratio tokens/mots :                                                │
│  • Anglais simple : ~1.1                                            │
│  • Français : ~1.3                                                  │
│  • Allemand : ~1.5                                                  │
│  • Code Python : ~1.8                                               │
│  • Japonais/Chinois : ~2.5                                          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Implications pratiques pour les développeurs**

Cette mécanique de tokenisation a des conséquences directes sur l'utilisation des LLMs :

| Impact | Description | Conseil pratique |
|--------|-------------|------------------|
| **Coût** | Les API facturent par token | Noms de variables courts = moins cher |
| **Limite de contexte** | 128K tokens ≠ 128K caractères | Un fichier de 10KB peut consommer 3-5K tokens |
| **Langues** | Non-anglais = plus de tokens | Budget 30-50% de tokens en plus pour le français |
| **Code** | Syntaxe verbale = plus de tokens | `calculateTotalAmountWithTax` = ~8 tokens |
| **Comptage** | LLMs comptent mal les caractères | "Combien de 'r' dans strawberry ?" → souvent faux |

Ce dernier point mérite une explication. Quand vous demandez à un LLM de compter les lettres dans un mot, il ne "voit" pas les caractères individuels — il voit des tokens. Le mot "strawberry" pourrait être tokenisé en ["straw", "berry"] ou même ["str", "aw", "berry"]. Le modèle n'a pas accès direct aux caractères 'r' et doit inférer leur nombre à partir de sa connaissance statistique des mots — une tâche où il échoue souvent.

### 1.2.2 Les Embeddings : Transformer les Symboles en Vecteurs de Sens

Une fois le texte tokenisé, chaque identifiant numérique doit être converti en une représentation que le réseau de neurones peut manipuler. Cette représentation prend la forme d'un **embedding** : un vecteur dense de nombres réels, typiquement de dimension 768 à 12,288 selon la taille du modèle.

![Espace des Embeddings](images/embedding-space.svg)

**La magie émergente des embeddings**

La propriété la plus remarquable des embeddings est qu'ils capturent des relations sémantiques de manière géométrique. Les mots ayant des significations similaires se retrouvent proches dans l'espace vectoriel. Plus étonnant encore : les **directions** dans cet espace encodent des relations abstraites.

L'exemple classique est l'analogie "roi - homme + femme ≈ reine". Mathématiquement :

```
embedding("roi") - embedding("homme") + embedding("femme") ≈ embedding("reine")
```

Cette propriété n'est pas programmée explicitement — elle **émerge** de l'entraînement. Le modèle découvre, à travers des milliards d'exemples, que les mots apparaissant dans des contextes similaires devraient avoir des représentations proches.

Pour le code, cette propriété est précieuse. Les embeddings permettent de capturer des équivalences sémantiques entre différents langages et paradigmes :

| Relation | Exemples |
|----------|----------|
| Équivalence cross-langage | `array.push` (JS) ≈ `list.append` (Python) ≈ `vec.push_back` (C++) |
| Patterns de conception | `async/await` ≈ `Promise` ≈ `.then().catch()` |
| Opérations similaires | `console.log` ≈ `print` ≈ `System.out.println` ≈ `fmt.Println` |

C'est grâce à cette propriété que les systèmes de RAG (Retrieval-Augmented Generation) peuvent trouver du code pertinent même quand les mots exacts diffèrent de la requête.

**Positional Encoding : Où suis-je dans la séquence ?**

Les embeddings seuls ont un problème : ils ne contiennent aucune information sur la **position** des tokens dans la séquence. Pour un Transformer qui traite tous les tokens en parallèle, "Le chat mange la souris" et "La souris mange le chat" auraient la même représentation !

La solution est d'ajouter des **positional encodings** — des vecteurs uniques pour chaque position qui sont additionnés aux embeddings. L'article original utilisait des fonctions sinusoïdales :

```
PE(pos, 2i) = sin(pos / 10000^(2i/d_model))
PE(pos, 2i+1) = cos(pos / 10000^(2i/d_model))
```

Cette formulation a une propriété élégante : les positions relatives peuvent être calculées par des opérations linéaires sur les embeddings positionnels. Les modèles modernes utilisent souvent des embeddings positionnels appris (RoPE, ALiBi) qui offrent une meilleure généralisation aux séquences longues.

---

## 🎯 1.3 Le Mécanisme d'Attention

Le mécanisme d'attention est le cœur battant du Transformer. C'est lui qui permet à chaque token de "communiquer" avec tous les autres, créant des représentations contextualisées riches.

### 1.3.1 L'Intuition : Une Base de Données Associative

Pour comprendre l'attention, une analogie avec les bases de données est utile. Imaginez une requête SQL :

```sql
SELECT value FROM memory WHERE key MATCHES query
```

Le mécanisme d'attention fait quelque chose de similaire, mais de manière "floue" (soft) plutôt que binaire :

- **Query (Q)** : "Que cherche-t-on ?" — Ce que le token actuel veut savoir
- **Key (K)** : "Qu'avons-nous ?" — Ce que chaque token peut offrir comme contexte
- **Value (V)** : "Quel contenu ?" — L'information effectivement transmise

![Mécanisme d'Attention](images/attention-mechanism.svg)

### 1.3.2 La Mécanique Mathématique

Pour chaque token, trois vecteurs sont calculés par des projections linéaires de l'embedding :

```
Q = X × W_Q    (query)
K = X × W_K    (key)
V = X × W_V    (value)
```

L'attention est ensuite calculée par la formule :

```
Attention(Q, K, V) = softmax(Q × K^T / √d_k) × V
```

Décomposons cette formule étape par étape :

**Étape 1 : Calcul des scores d'affinité (Q × K^T)**

Le produit scalaire entre une query et toutes les keys donne un score indiquant "à quel point ce token est pertinent pour moi". Si la query représente "que signifie 'il' ?", un score élevé avec le key de "développeur" indiquerait que "il" fait probablement référence à "développeur".

**Étape 2 : Mise à l'échelle (/ √d_k)**

La division par √d_k (racine de la dimension des keys) stabilise les gradients. Sans elle, les scores deviendraient trop grands en haute dimension, et le softmax produirait des distributions presque binaires (toute l'attention sur un seul token), perdant la nuance.

**Étape 3 : Normalisation (softmax)**

Le softmax convertit les scores bruts en une distribution de probabilité. Le token avec le score le plus élevé reçoit le plus de poids, mais les autres ne sont pas ignorés. C'est une attention "soft" — tous contribuent, mais certains plus que d'autres.

**Étape 4 : Agrégation pondérée (× V)**

Finalement, les values sont combinées selon ces poids. Le résultat est un vecteur qui "résume" l'information pertinente de toute la séquence, pondérée par l'importance contextuelle de chaque token.

```
┌─────────────────────────────────────────────────────────────────────┐
│                    EXEMPLE CONCRET D'ATTENTION                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Phrase : "Le développeur senior qui travaille sur ce projet        │
│            depuis trois ans était finalement satisfait"             │
│                                                                     │
│  Quand le modèle traite "était", il doit déterminer le sujet.       │
│                                                                     │
│  Poids d'attention pour "était" :                                   │
│                                                                     │
│  Token          │ Poids │ Interprétation                            │
│  ─────────────────────────────────────────────────────────          │
│  "Le"           │ 0.02  │ Article, peu informatif                   │
│  "développeur"  │ 0.45  │ ⭐ SUJET — attention maximale             │
│  "senior"       │ 0.12  │ Modificateur du sujet                     │
│  "qui"          │ 0.03  │ Pronom relatif                            │
│  "travaille"    │ 0.08  │ Verbe de la subordonnée                   │
│  ...            │ ...   │ ...                                       │
│  "était"        │ 0.15  │ Le token lui-même (self)                  │
│  "satisfait"    │ 0.10  │ Attribut du sujet                         │
│                                                                     │
│  Le modèle "comprend" que malgré 15 mots d'écart,                   │
│  "développeur" est le sujet de "était".                             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.3.3 Multi-Head Attention : Plusieurs Perspectives Simultanées

Une seule "tête" d'attention capture une seule façon de relier les tokens. Mais le langage est riche de relations multiples : syntaxe, coréférence, sémantique, relations temporelles, etc.

![Multi-Head Attention](images/multi-head-attention.svg)

La solution est d'utiliser plusieurs têtes d'attention en parallèle, chacune avec ses propres matrices de projection W_Q, W_K, W_V. Chaque tête peut ainsi apprendre à capturer un type différent de relation.

Empiriquement, les chercheurs ont observé des spécialisations émergentes :

| Tête | Spécialisation observée | Exemple |
|------|-------------------------|---------|
| Tête 1 | Dépendances syntaxiques | sujet → verbe |
| Tête 2 | Résolution de coréférences | "il" → "développeur" |
| Tête 3 | Relations sémantiques | "Python" → "code" |
| Tête 4 | Positions relatives | mot[i] → mot[i-1] |
| Tête 5 | Fin de phrase/poncuation | "." → début de phrase |
| ... | ... | ... |

GPT-4 utilise probablement 96 à 128 têtes d'attention, permettant de capturer une riche variété de relations simultanément.

---

## 🏗️ 1.4 Architecture Complète

Le Transformer original avait une structure encodeur-décodeur, conçue pour la traduction automatique. Les modèles modernes ont évolué vers des architectures plus spécialisées.

### 1.4.1 Encodeur vs Décodeur

L'**encodeur** traite l'entrée complète de manière bidirectionnelle : chaque token peut "voir" tous les autres, passés et futurs. C'est idéal pour comprendre le sens global d'un texte.

Le **décodeur** génère la sortie token par token, de manière autorégressive. Un masque d'attention empêche chaque position de voir les tokens futurs — on ne peut pas tricher en regardant la réponse avant de la générer !

| Architecture | Modèles représentatifs | Usage principal |
|--------------|------------------------|-----------------|
| **Encodeur seul** | BERT, RoBERTa, DeBERTa | Classification, NER, embeddings |
| **Décodeur seul** | GPT-3/4, Claude, LLaMA | Génération de texte, chat, code |
| **Encodeur-Décodeur** | T5, BART, Flan-T5 | Traduction, résumé, Q&A |

### 1.4.2 Les Blocs Transformer Empilés

Chaque bloc Transformer contient :
1. **Multi-Head Attention** (ou Masked Multi-Head pour le décodeur)
2. **Add & Normalize** — connexion résiduelle + normalisation
3. **Feed Forward Network** — deux couches denses avec activation
4. **Add & Normalize** — autre connexion résiduelle

Ces blocs sont empilés en profondeur. GPT-3 en a 96, GPT-4 probablement davantage. Chaque couche successif raffine la représentation, capturant des abstractions de plus en plus haut niveau.

```
┌─────────────────────────────────────────────────────────────────────┐
│                    BLOC TRANSFORMER (×N)                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│     Entrée                                                          │
│        ↓                                                            │
│   ┌────────────────────────────────┐                               │
│   │    Multi-Head Attention        │ ←── Contexte global           │
│   └────────────────────────────────┘                               │
│        ↓                                                            │
│   ┌────────────────────────────────┐                               │
│   │    Add & Layer Normalize       │ ←── Stabilise l'entraînement  │
│   └────────────────────────────────┘                               │
│        ↓                                                            │
│   ┌────────────────────────────────┐                               │
│   │    Feed Forward Network        │ ←── Transformation non-lin.   │
│   │    (Linear → GeLU → Linear)    │                               │
│   └────────────────────────────────┘                               │
│        ↓                                                            │
│   ┌────────────────────────────────┐                               │
│   │    Add & Layer Normalize       │                               │
│   └────────────────────────────────┘                               │
│        ↓                                                            │
│     Sortie                                                          │
│                                                                     │
│   Les connexions résiduelles (Add) permettent aux gradients         │
│   de traverser 96+ couches sans s'évanouir.                         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 📈 1.5 Scaling Laws : Quand Plus Grand = Meilleur

L'une des découvertes les plus influentes dans le domaine des LLMs est celle des **lois d'échelle** (scaling laws). Des chercheurs d'OpenAI et d'Anthropic ont montré que les performances des modèles suivent des relations mathématiques prévisibles avec trois facteurs clés.

### 1.5.1 Les Trois Axes du Scaling

| Axe | Description | Effet sur la performance |
|-----|-------------|--------------------------|
| **Paramètres (N)** | Nombre de poids du modèle | L ~ N^(-0.076) |
| **Données (D)** | Tokens d'entraînement | L ~ D^(-0.095) |
| **Compute (C)** | FLOPs d'entraînement | L ~ C^(-0.050) |

où L est la perte (loss) sur un ensemble de test. Ces relations sont des lois de puissance : chaque multiplication par 10 des ressources apporte une amélioration proportionnelle et prévisible.

### 1.5.2 Implications Pratiques

**Prédictibilité** : Avant de dépenser des millions en calcul, on peut estimer les performances du modèle final. C'est ce qui permet aux laboratoires de planifier des entraînements sur plusieurs mois.

**Trade-offs** : Un budget de calcul fixe peut être réparti différemment entre taille de modèle et quantité de données. Les travaux récents (Chinchilla) suggèrent qu'on sous-entraînait les gros modèles — il vaut mieux un modèle plus petit avec plus de données.

| Modèle | Paramètres | Tokens d'entraînement | Ratio Tokens/Params |
|--------|------------|----------------------|---------------------|
| GPT-3 | 175B | 300B | 1.7 |
| Chinchilla | 70B | 1.4T | 20 |
| LLaMA 2 | 70B | 2T | 29 |
| GPT-4 | ~1.8T (rumeur) | ~13T | ~7 |

### 1.5.3 Les Limites du Scaling

Le scaling n'est pas une solution miracle. Plusieurs limitations existent :

1. **Coûts croissants** : Entraîner GPT-4 aurait coûté ~$100M. La prochaine génération pourrait dépasser le milliard.

2. **Données de qualité** : Internet contient environ 10-15T tokens de texte de qualité. Nous approchons de cette limite.

3. **Rendements décroissants** : Les améliorations par facteur 10x diminuent progressivement.

4. **Capacités non-scalables** : Certaines capacités (raisonnement mathématique exact, planification à long terme) ne semblent pas émerger simplement avec plus de scale.

---

## ⚠️ 1.6 Les Hallucinations : Pourquoi les LLMs "Mentent"

Les hallucinations sont peut-être le problème le plus médiatisé des LLMs. Un modèle qui invente des faits, cite des sources inexistantes, ou affirme des absurdités avec une confiance totale — pourquoi cela arrive-t-il ?

### 1.6.1 La Nature du Problème

Il est crucial de comprendre ce que fait réellement un LLM : il prédit le token le plus probable étant donné le contexte. Il n'a pas de "base de connaissances" séparée qu'il consulte, pas de mécanisme pour vérifier la véracité de ses affirmations. Il génère du texte qui **ressemble** à du texte vrai, sans savoir ce que "vrai" signifie.

```
┌─────────────────────────────────────────────────────────────────────┐
│                    ANATOMIE D'UNE HALLUCINATION                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Prompt : "Cite les travaux du Professeur Jean Dupont sur les       │
│            algorithmes quantiques"                                  │
│                                                                     │
│  Processus interne du LLM :                                         │
│                                                                     │
│  1. Pattern reconnu : demande de citation académique                │
│  2. Éléments attendus : nom, année, titre, journal                  │
│  3. Génération statistique :                                        │
│     - "Dupont" + "algorithmes" → titre plausible                    │
│     - Format académique typique → "Journal of..."                   │
│     - Années probables → 2018-2023                                  │
│                                                                     │
│  Résultat : "Dupont, J. (2021). Quantum Algorithm Optimization      │
│              for Graph Problems. Journal of Computational           │
│              Quantum Science, 15(3), 234-251."                      │
│                                                                     │
│  ⚠️ Cette citation est ENTIÈREMENT INVENTÉE !                       │
│     Le journal, le titre, les pages — tout est fictif mais          │
│     statistiquement plausible.                                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.6.2 Causes Structurelles

| Cause | Explication | Exemple |
|-------|-------------|---------|
| **Pression de complétion** | Le modèle doit toujours produire quelque chose | Invente plutôt que de dire "je ne sais pas" |
| **Mélange de patterns** | Combine des informations de sources différentes | Attribue une citation à la mauvaise personne |
| **Généralisation excessive** | Extrapole au-delà des données vues | "Python 4.0 a introduit..." (n'existe pas) |
| **Manque de grounding** | Pas de connexion au monde réel | Ignore les événements post-training |
| **Confiance calibrée** | Même certitude pour faits et inventions | Pas de signal de fiabilité |

### 1.6.3 Stratégies de Mitigation

Pour construire des agents fiables, plusieurs stratégies existent :

1. **Retrieval-Augmented Generation (RAG)** : Ancrer les réponses dans des documents vérifiables
2. **Chain-of-Thought** : Forcer le raisonnement explicite, plus facile à auditer
3. **Self-Consistency** : Générer plusieurs réponses et vérifier la cohérence
4. **Tool Use** : Déléguer les recherches factuelles à des outils externes
5. **Human-in-the-Loop** : Validation humaine pour les décisions critiques

Ces stratégies seront explorées en détail dans les chapitres suivants.

---

## 💻 1.7 Implications pour le Développement Logiciel

Comprendre le fonctionnement des LLMs change fondamentalement la façon dont on les utilise pour le développement. Voici les leçons clés.

### 1.7.1 Ce que les LLMs Font Bien

| Tâche | Pourquoi ça marche | Exemple |
|-------|-------------------|---------|
| **Complétion de code** | Pattern matching sur millions d'exemples | Autocomplétion IDE |
| **Génération de boilerplate** | Patterns répétitifs bien mémorisés | CRUD, tests, configs |
| **Refactoring simple** | Transformations syntaxiques régulières | Renommage, extraction |
| **Explication de code** | Correspondance code ↔ langage naturel | Documentation |
| **Traduction de langages** | Équivalences sémantiques apprises | Python → JavaScript |

### 1.7.2 Ce que les LLMs Font Mal

| Tâche | Pourquoi c'est difficile | Risque |
|-------|-------------------------|--------|
| **Comptage précis** | Tokenisation masque les caractères | "Combien de lignes ?" → faux |
| **Logique complexe** | Raisonnement multi-étapes limité | Bugs subtils |
| **État mutable** | Pas de "mémoire de travail" réelle | Incohérences |
| **Nouvelles APIs** | Données post-training absentes | Hallucinations |
| **Code sécurisé** | Optimise la plausibilité, pas la sécurité | Vulnérabilités |

### 1.7.3 Bonnes Pratiques

```
┌─────────────────────────────────────────────────────────────────────┐
│                    GUIDE DU DÉVELOPPEUR LLM                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ✅ À FAIRE :                                                        │
│  • Fournir du contexte explicite (fichiers, types, imports)         │
│  • Valider toujours le code généré (tests, review)                  │
│  • Utiliser des exemples (few-shot prompting)                       │
│  • Décomposer les tâches complexes en étapes                        │
│  • Spécifier le langage, version, frameworks                        │
│                                                                     │
│  ❌ À ÉVITER :                                                       │
│  • Faire confiance aveuglément aux imports suggérés                 │
│  • Copier-coller sans comprendre                                    │
│  • Demander des algorithmes cryptographiques                        │
│  • Utiliser pour du code safety-critical sans audit                 │
│  • Supposer que le code est optimal ou idiomatique                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 📝 1.8 Points Clés du Chapitre

| Concept | Description | Importance |
|---------|-------------|------------|
| **Transformer** | Architecture basée sur l'attention, traitement parallèle | Fondation de tous les LLMs modernes |
| **Tokenisation** | Découpage en sous-mots (BPE), impact sur coûts et capacités | Comprendre les limites du modèle |
| **Embeddings** | Représentations vectorielles capturant le sens | Base du RAG et de la recherche sémantique |
| **Attention** | Mécanisme Q/K/V permettant le contexte global | Cœur du Transformer |
| **Multi-Head** | Plusieurs perspectives simultanées | Richesse des représentations |
| **Scaling Laws** | Plus grand = meilleur (avec limites) | Prédictibilité des performances |
| **Hallucinations** | Génération plausible mais fausse | Risque majeur à mitiger |

### Ce qu'il faut retenir

1. **Les LLMs sont des machines à patterns** : Ils excellent à reconnaître et reproduire des structures vues à l'entraînement, mais ne "comprennent" pas au sens humain.

2. **L'attention change tout** : La capacité de chaque token à "voir" directement tous les autres, sans intermédiaire, est ce qui permet les dépendances à longue distance.

3. **La tokenisation a des conséquences** : Le découpage en sous-mots affecte les coûts, les capacités multilingues, et même certaines limitations (comptage, caractères).

4. **Les hallucinations sont structurelles** : Elles ne sont pas des "bugs" mais une conséquence de la façon dont les modèles sont entraînés.

5. **Le scaling a des limites** : Plus de paramètres et de données aident, mais ne résolvent pas tous les problèmes.

---

## 🏋️ Exercices Pratiques

### Exercice 1 : Exploration de la Tokenisation
Utilisez un tokenizer (tiktoken pour OpenAI, transformers pour Hugging Face) pour analyser :
- Combien de tokens pour "Hello World" vs "Bonjour le monde" ?
- Quel mot anglais a le ratio tokens/caractères le plus élevé ?
- Comment un nom de fonction comme `calculateUserAuthenticationStatus` est-il tokenisé ?

### Exercice 2 : Visualisation de l'Attention
Avec la bibliothèque BertViz ou des outils similaires :
- Visualisez les poids d'attention pour la phrase "Le chat qui dort sur le canapé est gris"
- Identifiez quelle tête semble capturer la relation sujet-verbe
- Observez comment l'attention change entre les couches

### Exercice 3 : Provoquer une Hallucination
Construisez un prompt qui pousse un LLM à halluciner :
- Demandez des détails sur un événement fictif mais plausible
- Demandez une citation académique dans un domaine obscur
- Analysez pourquoi l'hallucination est convaincante

### Exercice 4 : Limites du Comptage
Testez les capacités de comptage d'un LLM :
- "Combien de 'e' dans 'développement' ?"
- "Combien de mots dans cette phrase ?"
- Comparez avec et sans chain-of-thought

---

## 📚 Références

| Source | Description |
|--------|-------------|
| Vaswani et al. (2017) | "Attention Is All You Need" — L'article fondateur |
| Kaplan et al. (2020) | "Scaling Laws for Neural Language Models" — Lois d'échelle OpenAI |
| Hoffmann et al. (2022) | "Training Compute-Optimal LLMs" (Chinchilla) — Scaling optimal |
| Wei et al. (2022) | "Emergent Abilities of Large Language Models" — Capacités émergentes |
| Ji et al. (2023) | "Survey of Hallucination in NLG" — Panorama des hallucinations |

---

## 🌅 Épilogue

Marcus referma son carnet. Deux heures s'étaient écoulées sans qu'ils s'en rendent compte. La nuit était tombée sur le campus, mais Lina avait le regard illuminé de quelqu'un qui venait de comprendre quelque chose d'important.

— "Donc quand ChatGPT invente une bibliothèque qui n'existe pas..." commença-t-elle.

— "Il génère le token le plus probable étant donné le contexte," compléta Marcus. "Il a vu des milliers de réponses mentionnant des bibliothèques, il sait à quoi 'ressemble' une bonne réponse. Il ne sait pas si la bibliothèque existe vraiment."

Lina hocha la tête lentement.

— "Et quand il résout un bug compliqué ?"

— "Il a vu des patterns similaires dans son entraînement. Plus le pattern est commun, plus il sera précis. Les cas originaux, les bugs vraiment nouveaux... c'est là qu'il peut se tromper."

Elle regarda son écran différemment maintenant. ChatGPT n'était plus une boîte noire mystérieuse. C'était une machine sophistiquée avec des forces et des faiblesses prévisibles.

— "Je vais avoir besoin de beaucoup plus de café," dit-elle. "Parce que maintenant, je veux construire quelque chose avec ça. Pas juste l'utiliser — vraiment le comprendre et l'exploiter."

Marcus sourit.

— "C'est exactement ce qu'on va faire dans les prochains chapitres. Bienvenue dans le monde des agents."

---

[📚 Table des Matières](README.md) | [➡️ Chapitre 2 : Le Rôle des Agents](02-role-des-agents.md)
