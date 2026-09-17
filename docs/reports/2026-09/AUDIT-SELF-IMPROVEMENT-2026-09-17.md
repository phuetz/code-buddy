# Audit — boucle d'auto-apprentissage (self-improvement)

- Date : 2026-09-17
- Agent : Grok 4.6
- Session : 37f54956-31f7-411a-ad7d-71dddafb245e
- Branche : `audit/self-improvement-2026-09-17`
- Worktree : `/home/patrice/DEV/cb-selfimprove-2026-09-17`
- Base : `origin/main` `b5c50c189`
- Commit : aucun (lot de vérification)
- Livrable : `/home/patrice/Videos/Partage/20260917-cowork-comparaison/AUTO-APPRENTISSAGE.md`

## Objectif

Vérifier de bout en bout la boucle réelle (`src/agent/self-improvement/`) : écriture d'une compétence, stockage, rechargement, barrière empirique. Démonstration reproductible (Ollama local ou fixture déterministe). Correctif uniquement si un défaut est démontré.

## Zone

`src/agent/self-improvement/` et surfaces CLI `buddy improve`. HOME de recette sous `_qa/self-improve-2026-09-17/home` (gitignoré).

## Résultat

Livrable : `/home/patrice/Videos/Partage/20260917-cowork-comparaison/AUTO-APPRENTISSAGE.md`.

Boucle leçons CLI : `improve cycle --apply` 0/15 → 1/15. Boucle compétences fixture : échec puis succès du banc `git-bisect`, fichier `authored-git-bisect/SKILL.md`. Ollama `qwen3:4b-instruct` a rédigé une proposition couvrante (propose-only) ; la même requête sans/avec skill passe de « pas git bisect » à `git bisect start`.

Défaut démontré : compétences authored invisibles au `SkillRegistry.search` de la requête d’origine. Correctif `deriveAuthoredSkillTriggers` + test. Pas de commit.
