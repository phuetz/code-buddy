# DOCS-SOIR-VIBE — Mission changelog et tableaux d'environnement

Date : 2026-09-06 (Europe/Paris)
Agent : Mistral Vibe
Dépôt : `~/DEV/cb-docs-soir-2026-09-06`
Branche : `docs/changelog-soir-2026-09-06`
Worktree original : interdit (`~/code-buddy`, `~/.codebuddy`)

---

## Mission

Documenter dans CHANGELOG.md, CLAUDE.md, AGENTS.md les 8 lots fusionnés le 06/09 après-midi/soir selon la leçon A-2 : **aucune fusion sans note de version**.

Lots à traiter :
1. Selfie cache-first (router/ingest/refill, CODEBUDDY_LISA_SELFIE_REFILL, endpoint ComfyUI sain 5 min)
2. @phuetz/companion-core (workspace, CODEBUDDY_COMPANION_CORE)
3. Pont d'approbation PWA sécurisé (A-1/B-1/B-2, CODEBUDDY_MOBILE_PWA — corriger si PWA v1 dit encore "sans opt-in")
4. Chat mobile v2 (émojis, réactions, humeur companion.mood sous CODEBUDDY_COMPANION_RELATIONAL, quick replies, historique local, dictée)
5. Pare-feu de skills (déobfuscation toutes classes par couches, balayage fenêtré, CODEBUDDY_SKILL_FIREWALL_DEOB_ALL, catalogue +N motifs)
6. Audit de release (2 A / 7 B et leur état : tous fermés sauf ce qui reste)

Sources de vérité (à lire avant toute modification) :
- `git log --merges --since='2026-09-06 14:30' --format='%h %s'`
- Pour chaque fusion : `git show --stat <sha>`
- Rapports : SELFIE-CACHE-GROK.md + VERIF-SELFIE-CACHE-AGY.md
- COMPANION-CORE-OPUS.md + VERIF-COMPANION-CORE-AGY.md
- REPARATION-PWA-CONFIRMATION-GROK.md + VERIF-PWA-SECU-OPUS.md
- PWA-CHAT-V2-GROK.md + VERIF-PWA-CHAT-AGY.md
- REPARATION-SKILL-FIREWALL-DEOB.md + VERIF-SKILL-FIREWALL-OPUS.md
- REPARATION-SKILL-FIREWALL-CATALOGUE.md
- docs/audits/2026-09-06-audit-release-opus.md

---

## Garde-fous

- Ne modifier QUE CHANGELOG.md, CLAUDE.md, AGENTS.md, docs/*.md (aucun src/ ni tests/)
- git add fichier par fichier ; un commit par point
- Aucun push, aucun reset, aucun rm -rf
- Never-throws : rapports de données personnelles restent verts
- HOME isolé pour tests : HOME=~/DEV/cb-docs-soir-2026-09-06/_qa/docs/home env -u FORCE_COLOR

---

## À faire

1. Lister les merges du 06/09 après 14:30
2. Extraire pour chaque lot : titre, variables d'environnement, fichiers clés, preuves (hashs)
3. Vérifier les variables dans le code source pour CLAUDE.md
4. Mettre à jour CHANGELOG.md avec le format exact existant
5. Mettre à jour CLAUDE.md (tableau complet)
6. Mettre à jour AGENTS.md (6 variables les plus importantes)
7. Vérifier : git diff --check, hashs valides, tests de données personnelles verts

---

## État initial

Rapport créé AVANT toute modification. Analysis en cours.
