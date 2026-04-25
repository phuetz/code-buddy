# Brief nuit 25→26 avril — gitnexus-rs

> Directives pour la session Claude active dans `C:\Users\patri\CascadeProjects\gitnexus-rs`
> pendant que Patrice dort. Préparer `feat/semantic-search` au merge sans
> faire le merge ni le push (réservé au matin, supervision humaine).
>
> **Garde-fous absolus :**
> - ❌ Pas de merge vers master
> - ❌ Pas de `git push`
> - ❌ Pas de modification de fichier qui n'est pas listé ci-dessous
> - ✅ Tout reste local sur la branche `feat/semantic-search`
> - ✅ Si doute sur une étape, stop et écris la question dans `next-steps.md`
>   au lieu de deviner

## Étape 1 — Nettoyage pollution Git (zéro risque)

```bash
git checkout feat/semantic-search
git rm -r --cached target-codex .codex-target .omx .playwright-mcp
git status   # vérifier qu'il reste les 21 fichiers réels en modification
             # + ~13900 dans staged-deletion
git commit -m "chore: untrack build artifacts and tool state files

target-codex/, .codex-target/, .omx/, .playwright-mcp/ are already in
.gitignore but were tracked by accident. Untracking them brings the
real diff from 13922 to 21 files.

No code changes."
```

**Critère de réussite :** `git diff master --stat` montre ~21 fichiers code,
plus rien dans target-codex/.codex-target/.omx/.playwright-mcp.

## Étape 2 — Sortir les fichiers hors scope

Deux fichiers hors scope sur la branche :
- `docs/inject-architecture.md` (314 lignes)
- `livre/Le_Compagnon_de_Silicone/07-le-lab.md` (21 lignes)

**Procédure prudente :**

```bash
# 1. Vérifier s'ils existent déjà sur master
git show master:docs/inject-architecture.md > /dev/null 2>&1 && echo "EXISTE sur master" || echo "ABSENT de master"
git show master:livre/Le_Compagnon_de_Silicone/07-le-lab.md > /dev/null 2>&1 && echo "EXISTE sur master" || echo "ABSENT de master"
```

**Si ABSENT de master pour les deux** (cas attendu) :
```bash
# Préserver les contenus dans une branche dédiée pour ne rien perdre
git branch chore/inject-architecture-doc feat/semantic-search
# Sur feat/semantic-search, retirer les fichiers
git rm docs/inject-architecture.md livre/Le_Compagnon_de_Silicone/07-le-lab.md
git commit -m "chore: move out-of-scope files (inject-architecture, livre/07-le-lab)

These commits drifted onto feat/semantic-search but belong elsewhere.
Preserved on branch chore/inject-architecture-doc — to be cherry-picked
or rebased to the right destination later.

This branch (feat/semantic-search) now contains only semantic search work."
```

**Si EXISTE sur master en version différente** : stop, n'écris rien dans
`next-steps.md` la question : "fichier X présent sur master en version
différente, comment résoudre ?".

**Critère de réussite :** `git log feat/semantic-search --oneline | head -3`
montre les commits étape 1 et 2 propres. La branche `chore/inject-architecture-doc`
existe et porte le contenu des fichiers retirés.

## Étape 3 — Update README.md et README.fr.md

Ajouter les sections manquantes pour la livraison :

**Reranker LLM** (nouveau composant, à mentionner clairement) :
- Activation via feature flag `reranker-llm`
- Configuration dans `gitnexus-mcp/src/llm_config.rs`
- Fallback robuste si le modèle ne répond pas (cf. `reranker/llm.rs`)

**Nouvelles commandes CLI :**
```bash
# Construire les embeddings (ONNX MiniLM-L6-v2)
gitnexus embed [--model <path>] [--batch <size>]

# Recherche hybride BM25 + RRF semantic
gitnexus query "<query>" --hybrid

# Recherche avec reranker LLM en post-processing
gitnexus query "<query>" --rerank
```

**Pour la version française** (README.fr.md) : traduire le même contenu
en gardant le ton existant. Ne pas mécaniser — garder le style de Patrice.

```bash
# Après les éditions
git add README.md README.fr.md
git commit -m "docs: README — reranker-llm + commands embed/--hybrid/--rerank

Documents the semantic search delivery before merge. Mentions:
- New 'reranker-llm' feature flag and llm_config.rs
- New CLI commands: gitnexus embed, gitnexus query --hybrid, --rerank
- Robust fallback when LLM reranker fails (cf. reranker/llm.rs)

No API or behavior change."
```

**Critère de réussite :**
- Les deux README mentionnent reranker-llm
- Les 3 commandes (embed, --hybrid, --rerank) sont documentées avec exemple
- Le style match le reste du fichier
- Build doc OK : `cargo doc --no-deps --features embeddings,reranker-llm`

## Étape 4 — Verification finale (ne rien commiter à cette étape)

```bash
git log feat/semantic-search ^master --oneline | wc -l   # devrait être 18-19
git diff master --stat | tail -1                          # devrait montrer ~23-24 fichiers
cargo build --features embeddings,reranker-llm 2>&1 | tail -20
cargo test --features embeddings,reranker-llm 2>&1 | tail -20
```

**Critère final :**
- Build clean
- Tests verts
- Diff ~23-24 fichiers (21 code initial + 2 README)
- Branche prête à être mergée demain matin par Patrice

## Si quelque chose patine

Écrire la question dans `next-steps.md` à la racine du repo (pas commiter ce
fichier — `.gitignore` ou simple message stop) avec :
- L'étape qui patine
- Le message d'erreur exact
- Ce qui a été tenté
- L'état du repo (`git status`, `git log -3 --oneline`)

## Au réveil de Patrice

Récap attendu (à coller dans la session du matin) :
- Combien d'étapes faites sur 4
- Liste des nouveaux commits sur feat/semantic-search
- Output de `cargo test --features embeddings,reranker-llm`
- Pointage : "prêt pour merge sur master ?" oui/non + raison

**Le merge et le push sont pour Patrice au matin. Pas avant.**
