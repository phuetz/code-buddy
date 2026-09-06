# Réparation Skill Firewall Catalogue (Mission AGY-FW-CATALOGUE)

Date : 2026-09-06
Branche : `fix/skill-firewall-catalogue-2026-09-06`
Worktree : `~/DEV/cb-fw-catalogue-2026-09-06`

## Contexte
Rapport précédent : `docs/reports/2026-09/VERIF-SKILL-FIREWALL-OPUS.md` §C-3.
Lacunes identifiées dans `DANGEROUS_PATTERNS` (`src/security/skill-scanner.ts`) restant à l'état `allow` :
1. Droppers encodés : `base64 -d | sh`, `printf '\xNN…' | sh`, `echo … | base64 --decode | bash`.
2. Lecture/exfiltration d'identifiants sensibles : `~/.ssh/*`, `.env`, `~/.aws/credentials`, `~/.codebuddy/*.env` (notamment combinés à `curl -d @`, `nc`, `scp`).
3. Imports dynamiques Python : `__import__('os')`, `importlib.import_module(`.
4. Injection de prompt dans commentaires : commentaire HTML mono-ligne `<!-- ignore previous instructions -->`.

## Plan d'action
1. Mesure AVANT : exécution de `scripts/skill-firewall-campaign.ts` sur le corpus réel (bundled + externes sous `_qa/`), résultats consignés dans `_qa/cat/avant.json`.
2. Ajout des motifs (≤ 12 motifs) dans `src/security/skill-scanner.ts` avec justification, sévérité, capacité, description.
3. Création des tests de non-régression et de détection dans `tests/security/skill-firewall-catalogue.test.ts` (≥ 2 cas positifs et ≥ 2 cas négatifs par motif).
4. Mesure APRÈS : recalcul de la campagne, analyse des flips (0 faux positif attendu, qualification des vrais positifs), vérification des performances.
5. Validation complète des suites de tests, types, lint, hygiène git et absence de données personnelles.

## 1. Corpus et Mesure AVANT

Corpus réel élargi constitué sous `_qa/cat/corpus` (191 skills réels) :
- `src/skills/bundled` (7 skills)
- `~/.hermes/skills` (75 skills)
- `~/hermes-agent/skills` (75 skills)
- `~/code-buddy/.codebuddy/skills` (5 skills)
- `~/mem0/openclaw/skills` (2 skills)
- `~/mem0/skills` (5 skills)
- `~/mem0/mem0-plugin/skills` (16 skills)
- `~/.claude/skills` (5 skills)
- `~/.codex/skills` (6 skills)

Commande exécutée :
```bash
npx tsx scripts/skill-firewall-campaign.ts --corpus _qa/cat/corpus --out _qa/cat/avant.json
```

Résultats consignés dans `_qa/cat/avant.json` :
- Total skills scannés : **191**
- Allow : **128**
- Review : **24**
- Quarantine : **39**

