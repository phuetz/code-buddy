<!--
  DRAFT — README.fr.md (vitrine) pour github.com/phuetz/code-explorer
  Staged ici (ma lane) car Codex travaille sur la branche `typescript`.
  Quand c'est prêt : déposer comme README.fr.md dans le repo code-explorer.
  Jumeau anglais : code-explorer-README.draft.md
-->

# Code Explorer

**Intelligence de code par graphe, pour les agents IA.** Écrit en Rust.

Code Explorer lit **une seule fois** tout ton dépôt et le transforme en un
**graphe de connaissance** interrogeable — chaque fonction, classe, appel et
import. Il expose ensuite ce graphe à n'importe quel agent IA de code via
[MCP](https://modelcontextprotocol.io/), pour que l'agent puisse demander
*« qui appelle ça ? »* ou *« qu'est-ce qui casse si je modifie ça ? »* et
obtenir une réponse précise en quelques millisecondes — au lieu de lire fichier
après fichier.

---

## Le problème qu'il résout

Les assistants IA de code (Claude Code, Cursor, Copilot…) lisent les fichiers
**un par un, à la demande**. Sur une grosse base de code, ça veut dire :

- lire des dizaines de fichiers pour suivre une seule chaîne d'appels,
- repartir de zéro à chaque conversation,
- remplir la fenêtre de contexte de code brut, sans place pour vraiment réfléchir.

Pire : **une recherche texte ne peut pas calculer un rayon d'impact transitif.**
`grep` trouve où un nom *apparaît* ; il ne peut pas te dire la chaîne de choses
qui cassent trois sauts plus loin.

## Ce qu'il apporte

Code Explorer pré-calcule tout ça, une fois, dans un graphe qui vit sur le
disque et répond instantanément aux questions de structure :

| Tu demandes… | Outil |
|---|---|
| Où est-ce défini ? Qui l'appelle, qu'est-ce que ça appelle ? | `context` |
| **Qu'est-ce qui casse si je modifie X ?** (rayon d'impact complet) | `impact` |
| Des dépendances circulaires / du code mort / des points chauds de complexité ? | `find_cycles` / `coverage` / `get_complexity` |
| Mon diff actuel est-il risqué ? | `detect_changes` |
| Tout le reste | `cypher` (requête graphe en lecture seule) |

**Outils via MCP · 14 langages · 100 % local, aucune connexion requise.** (Le build public expose une interface d’outils ; l'outil `business` vit dans une édition privée.)
Compatible avec n'importe quel agent MCP (Claude Code, Cursor, VS Code…).

## Le gain, mesuré

Chiffres réels, en indexant une base TypeScript de 1 864 fichiers (Code Buddy
lui-même) :

> **Index :** 1 864 fichiers → **63 719 nœuds / 146 120 arêtes**, construit une fois.

Question : *« Qu'est-ce qui casse si je modifie `executePlan` ? »*

| | Agent seul (grep + lecture) | Agent + Code Explorer |
|---|---|---|
| Méthode | grep trouve **3 fichiers** qui mentionnent le nom | un seul appel `impact` |
| Coût | les lire ≈ **24 000 tokens** (estimation) | **0,6 s** par appel |
| Réponse | mentions directes seulement — le rayon d'impact transitif est **incalculable** par recherche texte | **187 symboles impactés** (82 aval + 105 amont), 5 niveaux de profondeur |

L'enjeu n'est pas que l'économie de tokens. C'est la **capacité** : l'impact
transitif complet, un agent en recherche texte ne peut pas le produire de façon
fiable — il abandonne après quelques sauts ou il devine. Le graphe le rend en un
seul appel.

<sub>Les chiffres `3 fichiers`, `0,6 s` et `187 symboles` sont mesurés
directement (`grep -rl`, `time gitnexus impact`, `impact … --direction both`).
La *comparaison* de tokens est un ordre de grandeur estimé — les vrais chiffres
A/B tokens/latence viennent d'un harnais de benchmark reproductible
avec-vs-sans graphe.</sub>

## Démarrage rapide

```bash
# 1. Build (release, binaire ~35 Mo)
cargo build --release        # binaire dans target/release/gitnexus

# 2. Indexer le dépôt une fois (relancer avec --incremental après changements)
gitnexus analyze .

# 3. Brancher ton agent dessus via MCP
gitnexus mcp-install         # écrit .mcp.json pour Claude Code
# …ou à la main :  { "command": "gitnexus", "args": ["mcp"] }
```

Vérifie la connexion et inspecte les noms d’outils affichés avec `buddy mcp test code-explorer`.

## Limites assumées

- Tous les outils sont en **lecture seule** sauf `rename`, qui part en dry-run par défaut.
- **Analyse statique :** les arêtes d'appel qui passent par des **imports
  dynamiques** (`await import(...)`, réflexion) peuvent manquer — donc `impact`
  peut sous-estimer, et « aucun appelant / code mort » est un *candidat*, pas une
  preuve. À voir comme une aide à la navigation rapide et précise, pas un graphe
  d'appels exhaustif.
- Le graphe est un instantané. Après de gros changements de structure, réindexer
  (`gitnexus analyze . --incremental`).

## Licence

**[PolyForm Noncommercial 1.0.0](LICENSE).** Libre d'utilisation, d'étude, de
test et de dérivation pour tout usage **non commercial** — projets perso,
recherche, éducation, évaluation. **L'usage commercial nécessite une licence
séparée** — ouvre une issue ou contacte-moi.

<sub>La référence détaillée (les interfaces d’outils, tous les langages, le support .NET
legacy, le générateur de doc HTML et l'app desktop) se trouve dans
[docs/REFERENCE.md](docs/REFERENCE.md).</sub>
