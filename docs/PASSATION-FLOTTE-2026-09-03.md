# Passation d’orchestration de la flotte multi-IA

**Date & Heure** : 3 septembre 2026, 17:50 (Europe/Paris)  
**Rédacteur sortant** : Gemini AI Ultra (`agy` / Antigravity)  
**Destinataires** : Claude (Fable 5.1), Codex (Luna / Sol / Spark), Grok 4.6 ou tout agent prenant le quart  
**Branche active** : `codex/audit-systeme-nerveux-2026-09-01` sur `/home/patrice/code-buddy`  
**Dernier commit validé** : `d290c5947`  

---

## 1. État de santé du dépôt principal (`/home/patrice/code-buddy`)

- **Code TypeScript** : `npx tsc --noEmit -p .` sort avec le **code 0** (zéro erreur).
- **Tests unitaires ciblés** : 100 % passés sur toutes les nouveautés du jour.
- **Données personnelles** : `tests/security/donnees-personnelles.test.ts` vert (1/1).
- **Git status** : Propre. Aucun fichier temporaire polluant.

---

## 2. Synthèse des 3 chantiers intégrés pendant ce quart

### A. Mission MEM1 — Écritures d’état atomiques et anti-corruption
- **Problème résolu** : Fichiers d’état vidés à 0 octet lors d’un redémarrage brutal (`summaries.json`, sessions, mémoire).
- **Fichier central** : [`src/utils/atomic-write.ts`](file:///home/patrice/code-buddy/src/utils/atomic-write.ts) (fichiers temporaires dans le même dossier, `fsync`, renommage atomique, droits 0600 et restauration automatique depuis `.bak`).
- **Commit de merge** : `e61e8c758`.

### B. Mission MEMEXTRACT1 — Démon d’extraction de mémoire en arrière-plan
- **Problème résolu** : L’agent n’extrayait pas de compétences ni de faits en continu sans impacter la latence de la session utilisateur.
- **Fichier central** : [`src/memory/background-extractor.ts`](file:///home/patrice/code-buddy/src/memory/background-extractor.ts).
- **Mécanismes** : Verrou consultatif `.codebuddy/.extraction.lock` (stale 35 min), état persistant `.extraction-state.json` via `writeJsonAtomic`, throttling 30 min, filtrage des sessions inactives (>= 4 messages, >= 5 min d'inactivité) et émission d’événements sur le bus global (`memory:extraction_started`, `memory:extraction_completed`).
- **Auteur** : Codex Luna (`gpt-5.6-luna`), 6/6 tests verts.
- **Commit de merge** : `2f95aef99`.

### C. Mission LOOP1 — Détecteur proactif de boucles d’outils et de texte
- **Problème résolu** : Intercepter immédiatement les LLMs qui tournent en boucle stérile avant d’épuiser les 50 tours ou 400 tours en YOLO.
- **Fichier central** : [`src/agent/loop-detection-service.ts`](file:///home/patrice/code-buddy/src/agent/loop-detection-service.ts).
- **Mécanismes** :
  1. Tool calls consécutifs identiques ($k=1$, seuil $R=5$ appels avec hash SHA-256 canonique).
  2. Cycles multi-étapes alternés ($k=2..5$, e.g. A->B->A->B répété 5 fois).
  3. Psalmodie de texte (*content chanting*) sur chunks de 50 caractères répétés $\ge 10$ fois hors code fences markdown.
  4. Événement `agent:loop_detected` dans [`src/events/types.ts`](file:///home/patrice/code-buddy/src/events/types.ts).
- **Auteur** : Gemini AI Ultra (`agy`), 9/9 tests verts.
- **Commit de merge** : `6421b1e06`.

---

## 3. Chantier actuellement actif : HEADLESS1 (Grok 4.6)

- **Objectif** : Flags CLI `-o, --output-last-message <file>` et `--output-schema <file>` (inspirés de Codex CLI).
- **Clone dédié étanche** : `/home/patrice/DEV/cb-headless1-2026-09-03`
- **Branche** : `feat/headless1-output-schema-2026-09-03`
- **Cahier des charges** : [`MISSION-HEADLESS1-FLAGS.md`](file:///home/patrice/DEV/vitrine-drafts/vague-2026-09-03/MISSION-HEADLESS1-FLAGS.md)
- **Processus en cours** : Grok 4.6 actif (PID 2444827).
- **Suivi en direct** : `tail -f /home/patrice/DEV/cb-headless1-2026-09-03/HEADLESS1.console.log`
- **Consigne pour l'IA entrante** :
  1. Vérifier si le processus Grok a terminé (ou inspecter `HEADLESS1.console.log`).
  2. Vérifier `REPARATION-HEADLESS1.md` dans le clone.
  3. Lancer dans le clone : `npx vitest run tests/cli/headless-output-flags.test.ts`, `npx tsc --noEmit -p .`, `npx eslint` sur les fichiers touchés.
  4. Si tout est vert : merger dans `/home/patrice/code-buddy` (`codex/audit-systeme-nerveux-2026-09-01`) et mettre à jour `docs/FABLE5-CODEX-COORDINATION.md`.

---

## 4. État des quotas et de l'infrastructure

1. **ChatGPT Codex** :
   - **Codex Spark** : quota bloqué jusqu'à **19h56** (recharge automatique).
   - **Codex Sol / Luna** : quota glissant de 3h temporairement plafonné après une session intense de 200k tokens sur MEMEXTRACT1.
2. **xAI Build (Grok)** :
   - Pleinement fonctionnel via abonnement OAuth.
3. **Modèles locaux Ollama (Ministar)** :
   - Serveur `http://127.0.0.1:11434` actif.
   - Modèles disponibles : `qwen3:4b-instruct` (très rapide sur CPU), `qwen3.8:27b`, `devstral-small-2:24b`.
4. **Machine Darkstar (RTX 3090)** :
   - Joignable sur Tailscale (`http://100.73.222.64:17493/health`).
   - GPU 0 (24 Go VRAM) libre à 100 %.
   - Chantier **DARK3** (TTS Kyutai 280 ms) déjà présent dans le code ; prêt à être testé avec `CODEBUDDY_TTS_TWO_SPEED=true` dans `~/.codebuddy/vision.env` et script `darkstar/start.ps1`.
5. **Robot Lisa (Audio/Vision)** :
   - `buddy-vision-brain.service` actif et sain (3,3 Go RAM, PID 1394433 sur Ministar).
   - Anti-auto-écoute et filtre demi-duplex déployés et vérifiés sans aucun écho.

---

## 5. Règles cardinales de conduite

- **Aucune écriture directe dans `/home/patrice/code-buddy` pendant les développements** : toujours créer un clone dédié sous `/home/patrice/DEV/cb-<mission>-2026-09-03` avec un lien symbolique vers `node_modules`.
- **Méthode rouge d'abord** : créer `REPARATION-<MISSION>.md` avant d'inspecter le code, exécuter le test qui échoue d'abord, consigner la sortie rouge, coder la solution, puis prouver le vert.
- **Vérification systématique avant toute fusion** :
  - `npx vitest run <tests-touches>`
  - `npx vitest run tests/security/donnees-personnelles.test.ts`
  - `npx tsc --noEmit -p .` (doit sortir avec code 0)
  - `npx eslint <fichiers-modifies>`
  - `git diff --check`
- **Zéro push distant, zéro dépense, zéro modification de services de production** sans l'arbitrage direct de Patrice.
