#!/usr/bin/env bash
# Correction des facultés de recherche de Code Buddy — détaché, survit au harnais.
LOG="$HOME/code-buddy/fix-research.log"
cd "$HOME/code-buddy" || exit 1
echo "=== [$(date +%H:%M)] début" >> "$LOG"

codex exec -c sandbox_mode=danger-full-access "MISSION CORRECTIVE sur les facultés de RECHERCHE de Code Buddy (~/code-buddy). Contexte : ces briques vont servir à de la recherche biomédicale sur la maladie de Parkinson (le père de Patrice en est atteint) — la fiabilité prime sur tout. Lis d'abord le diagnostic : ~/DEV/claude-et-patrice/RECHERCHE-PARKINSON-CODE-BUDDY.md (partie 1 : audit du code réel, chemins exacts et causes racines).

Trois défauts, par ordre de gravité :

1. CRITIQUE — repli silencieux des embeddings en mode simulé. Le fournisseur d'embeddings de PaperQA (src/research/paper-qa/) bascule sur un mode mock pseudo-aléatoire si le modèle local ne charge pas, SANS déclencher l'avertissement de repli BM25 : les réponses paraissent normales alors que la recherche sémantique est du bruit. Corrige : (a) le mode simulé réservé aux tests, inatteignable en exécution normale ; (b) avertissement explicite via le logger du repo ; (c) bascule en mode BM25-seul DÉCLARÉ (même chemin que le repli documenté) ; (d) exposition d'un indicateur de mode dégradé dans la réponse rendue. Écris un test qui échoue si un embedding simulé peut être utilisé silencieusement hors tests.

2. Index en mémoire reconstruit à chaque question, plafonné ~200 PDF — impossible d'indexer un corpus réel (45 809 articles Parkinson en accès libre). Rends l'index persistant et incrémental : réutilise disk-embedding-cache.ts, stocke l'index (chunks + vecteurs + métadonnées page/section) sous .codebuddy/, ne réindexe que les fichiers nouveaux ou modifiés (hash), chargement à la demande. API publique inchangée, comportement identique sur petits corpus. Si une passe propre est impossible, fais la persistance + l'incrémental et documente le reste.

3. CKG sans index (src/memory/collective-knowledge-graph.ts) : O(N) et cache d'embeddings non persisté, plafond ~1-2 000 nœuds. Au minimum : persistance du cache et index mémoire sur les clés de recall les plus utilisées. Le moteur Rust buddy-memory/ existe pour le passage à l'échelle — le signaler comme voie longue, ne pas le réécrire.

Contraintes : TypeScript strict, ESM (imports .js depuis .ts), logger de src/utils/logger.js (jamais console.*), tests Vitest dans tests/ uniquement, filtrer par chemin. VALIDATION OBLIGATOIRE avant de rendre la main : npm run lint, npm run typecheck, tests des modules touchés au vert. Commits Conventional Commits FR avec Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>, puis pousse.

Rapport : ce qui est corrigé, comment c'est prouvé, ce qui reste ouvert." < /dev/null >> "$LOG" 2>&1

echo "=== [$(date +%H:%M)] fin" >> "$LOG"
