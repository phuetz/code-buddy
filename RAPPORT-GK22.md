# RAPPORT-GK22 — Skills en vrai : import, pare-feu, Skill Exchange signé, curation

Mission : exercer **pour de vrai** l'import d'une bibliothèque externe, le pare-feu, Skill Exchange signé (ed25519) et la curation (`pin` / `archive` / `restore` / `consolidate`).

- Clone autorisé : `/home/patrice/DEV/cb-repar-jumeaux-2-2026-09-02` uniquement
- Branche : `fix/gk22-skills-reel-2026-09-03`
- HEAD au départ : `4659bf343` (`Merge GK16 (buddy backup en vrai, cas méchants) into codex/audit-systeme-nerveux-2026-09-01`)
- Date de démarrage : 2026-09-03 (Europe/Paris)
- Agent : Grok 4.6
- Rapport créé **avant** toute inspection de `src/skills/`, `src/agent/self-improvement/skill-*.ts`, tests skills, ou doc Skills.

## Garde-fous (rappel)

- Aucun push, aucun `git prune` / `git reset --hard` / `rm -rf` / `git add -A` / `git commit -a`.
- Aucune API payante. Ollama local autorisé.
- Aucun service systemd. Ne pas toucher ComfyUI 8188/8189.
- HOME temporaire **dans le clone**. Aucune écriture dans le vrai `~/.codebuddy`.
- Dépôt original `~/code-buddy` interdit.
- Aucun téléchargement > 50 Mo. Dépôts Hermes/OpenClaw : copies locales si présentes, sinon mini-dépôt factice `_qa/gk22/` (skill sain, skill à script dangereux, skill jailbreak).
- Un commit conventionnel par lot / par défaut. Typecheck + lint + tests ciblés verts.

## Parcours imposé

1. `buddy skills import --dir …` sans `--apply`, puis avec `--apply`.
2. Le dangereux et le jailbreak sont mis en quarantaine (preuve).
3. `buddy skills imported`.
4. Un skill importé est réellement découvert par le moteur (déclencheurs dérivés : question qui doit le sélectionner).
5. `buddy skills exchange` : paquet signé ed25519 accepté ; paquet à mauvaise clé refusé (G6R) ; paquet re-scanné par le pare-feu.
6. `buddy improve skills-pin|archive|restore|consolidate` sur des skills `authored-*` factices : la consolidation refuse si elle perd la couverture.
7. Chaque défaut (import annoncé sans fichier, quarantaine contournable, skill importé invisible, doc fausse) : test rouge → correctif → vert, un commit.

## Journal

### 2026-09-03 — création du rapport (avant inspection)

Commandes :

```
git status -sb && git log -5 --oneline && git rev-parse HEAD
```

Sortie collée :

```
## fix/gk22-skills-reel-2026-09-03
4659bf343 Merge GK16 (buddy backup en vrai, cas méchants) into codex/audit-systeme-nerveux-2026-09-01
f67189c13 docs(gk16): consigner le backup réel et libérer le chantier
2cb4bb7b5 Merge GT2 (cinq trous de garde fermés, tests de mutation) into codex/audit-systeme-nerveux-2026-09-01
4bfba4d0c fix(backup): dire que l'archive est le .codebuddy du projet
0a797e0b5 fix(backup): tailles honnêtes et archives illisibles dites clairement
4659bf34324605791bb2b1aacdf98ba102154ef0
```

Arbre de travail propre au départ (aucun fichier modifié/non suivi). Chantier réservé dans `docs/FABLE5-CODEX-COORDINATION.md`. Aucun fichier source skills lu encore.

## Tableau final (scénario → attendu → obtenu → correctif → commit)

| Scénario | Attendu | Obtenu | Correctif | Commit |
|---|---|---|---|---|
| *(à remplir après exécution réelle)* | | | | |

## Bilan (≤ 10 lignes)

*(à remplir en fin de mission)*
