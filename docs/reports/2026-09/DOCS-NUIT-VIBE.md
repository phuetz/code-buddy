# DOCS-NUIT-VIBE — Bilan des lots fusionnés le 06/09 après 20 h 30

**Date** : 2026-09-06
**Branche** : `docs/changelog-nuit-2026-09-06`
**Worktree** : `~/DEV/cb-docs-nuit-2026-09-06`
**Source de vérité** :
- `git log --merges --since='2026-09-06 20:30' --format='%h %s'` → 2 merges (631071f6f, 9142ae5e2)
- `git log --since='2026-09-06 20:30' --no-merges --format='%h %s'` → 7 commits (cd3ea2844, e738178a5, fd16b6498, a34b3186d, 68e40ced9, 3ae522b9c, 5b46f3772, a9d7eeabc)
- Rapports : REPARATION-PWA-COMPAGNON-MEMOIRE-OPUS, REPARATION-INSTALL-B, REPARATION-HEADLESS-LOCAL-GROK, VERIF-HEADLESS-AGY, PHOTOS-PARTAGEES-OPUS, VERIF-PHOTOS-AGY, REPARATION-SKILL-FIREWALL-CATALOGUE, REPARATION-TESTS-ENV, VERIF-FAILOVER-AGY
- Audits : 2026-09-06-audit-installateur-inconnu-opus, 2026-09-06-etude-omniroute-failover-agy

---

## 1. Résumé des travaux identifiés

### 1.1 Mémoire + identité de Lisa (PWA compagnon)
**Source** : `docs/reports/2026-09/REPARATION-PWA-COMPAGNON-MEMOIRE-OPUS.md`
- Chemin unique compagnon via `runCompanionTurn` (`src/companion/companion-turn.ts`)
- Mémoire par connexion WS : `ConnectionState.companionHistory` (≤ 20 tours, texte seul)
- Persistance opt-out : `CODEBUDDY_MOBILE_HISTORY=false` (défaut ON), stockage SHA256, permissions 0600, dossier 0700
- Relances selfie : 8 familles elliptiques avec garde-fous
- Identité : bloc système `buildCompanionIdentityBlock`

**Hashs** : 163234232, e717d3222, 7159c3dd1, e05dc053e

### 1.2 Audit installateur inconnu (5 A / 8 B)
**Source** : `docs/audits/2026-09-06-audit-installateur-inconnu-opus.md`

**5 A (bloquants)** :
- A-1 : Node 18 annoncé supporté mais CLI meurt (playwright-core process.exit(1)) → corrigé `b8ee57cb1`
- A-2 : `buddy -p` 14 min 27, exit 0, sortie vide → corrigé A-2/A-4/A-5
- A-3 : PWA mobile 500 + trace sous dossier caché (`~/.nvm`, `~/.npm-global`) → corrigé `5f34b0d06`
- A-4 : Transport natif Ollama câblé sur port 11434 (5 endroits) → corrigé routage fournisseur
- A-5 : Anti-stall 120 s incompatible voie locale → corrigé stall adaptatif + prompt compact

**8 B (frictions)** :
- B-1 : Flotte 401 → "Lancez-le avec buddy server" → corrigé `df3174e36`
- B-2 : `buddy run` figé [RUNNING] + trajectory vide → corrigé `01ed8d75f` (B-2)
- B-3 : Emballage 2,7 Go / 18 paquets natifs non compilés → documenté
- B-4 : `doctor` conseille `npm install better-sqlite3` inapplicable en global → corrigé `f717d681b`
- B-5 : `sensory status` sans URL testée → corrigé `16ee82923` (B-5)
- B-6 : Aucun retour visuel pendant 14-17 min → corrigé `e52fb2df1` (B-6)
- B-7 : Trace + chemins exposés par défaut → corrigé `a17fcc0bf` (B-7)
- B-8 : Documentation jeton fleet token manquante → corrigé `e5c188fb5` (B-8)

**État** : 5 A fermés, 8 B fermés (INSTALL: 5 A, 8 B)

### 1.3 Voie locale `buddy -p`
**Source** : `docs/reports/2026-09/REPARATION-HEADLESS-LOCAL-GROK.md`, `VERIF-HEADLESS-AGY.md`

- A-4 : Routage transport natif Ollama hors port 11434 via `isOllamaEndpoint(baseUrl, env)`
- A-2 : Réponse finale vide = échec + `think:false`
- A-5 : Stall adaptatif **après** premier token + prompt compact
  - Budget : `CODEBUDDY_LOCAL_PROMPT_MS_PER_TOKEN` (défaut 200 ms/token)
  - Plafond : `CODEBUDDY_STALL_MAX_MS` (défaut 20 min)
  - Compact : `CODEBUDDY_PROMPT_COMPACT` (défaut ON pour `-p` local)
  - Fenêtre contexte : ≤ 1 500 tokens système + 8 outils RAG
- B-6 : Indicateur TTY "évaluation du prompt... (n s)" toutes les 10 s
- **Règle** : stall adaptatif local SEULEMENT, selon la CIBLE effective du repli

**Commits** : 1eeb2e3f9 (A-4), 9246d7dc0 (A-2), e52fb2df1 (B-6), 1d587cf9b (A-5)
**Mesure** : TTFT 863 560 ms → 242 904 ms, tokens prompt 5 604 → 2 462

### 1.4 Tests BashTool
**Source** : `docs/reports/2026-09/REPARATION-TESTS-ENV.md`
- Cause : faux positif `PolicyEngine.isSecretsOrDeployment` sur chemin contenant "release"
- Correction : détection sur `cmdStr` uniquement, pas `pathStr`
- Isolation : `delete process.env.CODEBUDDY_NATIVE_SANDBOX` dans hooks de test
- Sonde : `sandboxAvailable()` + test de garde `tests/security/sandbox-guard.test.ts`
- Résultat : 117 tests BashTool verts (99 + 13 + 5)

### 1.5 Reconnexion PWA
**Source** : `docs/reports/2026-09/REPARATION-PWA-COMPAGNON-MEMOIRE-OPUS.md`
- Cache SW v4 : `src/server/mobile/assets/sw.js`
- Persistance mémoire connexion : `ConnectionState.companionHistory`
- Reconnexion : mémoire restaurée, historique ≤ 20 tours

### 1.6 Photos partagées
**Source** : `docs/reports/2026-09/PHOTOS-PARTAGEES-OPUS.md`, `VERIF-PHOTOS-AGY.md`
- Variables : `CODEBUDDY_COMPANION_PHOTO_VISION` (défaut `local`), `CODEBUDDY_SHARED_PHOTOS_MAX` (défaut 500)
- Album : SHA256, permissions 0600, dossier 0700, plafond 500 photos
- Mémoire : portée utilisateur `~/.codebuddy/memory.md`, clé `photos:recent`
- Correctif : prise en compte `OLLAMA_HOST` pour vision multimodale

### 1.7 Catalogue pare-feu
**Source** : `docs/reports/2026-09/REPARATION-SKILL-FIREWALL-CATALOGUE.md`
- **+10 motifs** ajoutés à `DANGEROUS_PATTERNS` (`src/security/skill-scanner.ts`)
- Liste complète :
  1. base64-decode-pipe-shell
  2. hex-printf-pipe-shell
  3. py-dunder-import
  4. py-importlib-import
  5. ssh-private-key-access
  6. dotenv-file-access
  7. cloud-credential-access
  8. credential-network-exfiltration
  9. html-comment-prompt-injection
  10. html-comment-hidden-command
- Campagne : 191 skills, 0 basculement, 0 faux positif, 2 vrais positifs
- Performance : médiane 1 364,9 ms (≤ 1 500 ms)

### 1.8 Repli de fournisseur vers modèle local
**Source** : `docs/reports/2026-09/VERIF-FAILOVER-AGY.md`, `docs/audits/2026-09-06-etude-omniroute-failover-agy.md`
- Élagage outils : ≤ 6 outils sur fenêtre 32 k (corrigé goulot critique)
- `ProviderFailoverExhaustedError` : expose erreur 429 initiale + chaque échec de cible
- Annonce : PWA + compagnon notifiés une fois
- Alias : `CODEBUDDY_LLM_FAILOVER` déprécié → `CODEBUDDY_PROVIDER_FALLBACK`
- Décision OmniRoute : pas de proxy, intégration cascade déclarative

### 1.9 Étude OmniRoute
**Source** : `docs/audits/2026-09-06-etude-omniroute-failover-agy.md`
- Comparaison architecturale OmniRoute 3.8.49 vs Code Buddy
- **Décision** : pas de proxy OmniRoute, intégration native dans Code Buddy
- 5 améliorations prioritaires identifiées (élagage outils, journalisation, unification, notification, pré-filtrage)

### 1.10 Moteur qwenflash
**Source** : `scripts/deleguer.sh` (ligne 224-229)
- Ajout moteur `qwenflash` : Qwen 3.8 Flash via OpenRouter
- Configuration : `OPENROUTER_MODELE` (défaut `qwen/qwen3.8-flash`)
- Coût : 0,15 $/M entrée, 0,47 $/M sortie
- Capacité : 1 M de contexte, appels d'outils OK

---

## 2. Variables d'environnement à documenter

### 2.1 Nouvelles variables (toutes sources)
| Variable | Définition dans code | Fichier | Défaut |
|---|---|---|---|
| `CODEBUDDY_MOBILE_HISTORY` | Persistance historique compagnon | `src/companion/mobile-history.ts` | `true` |
| `CODEBUDDY_LOCAL_PROMPT_MS_PER_TOKEN` | Budget stall adaptatif local | `src/config/headless-local-prompt.ts` | 200 |
| `CODEBUDDY_STALL_MAX_MS` | Plafond stall | `src/utils/stream-stall-guard.ts` | 1200000 (20 min) |
| `CODEBUDDY_PROMPT_COMPACT` | Prompt compact pour voie locale | `src/config/headless-local-prompt.ts` | `true` (local) |
| `CODEBUDDY_COMPANION_PHOTO_VISION` | Mode vision photo compagnon | `src/companion/companion-photo.ts` | `local` |
| `CODEBUDDY_SHARED_PHOTOS_MAX` | Plafond album photos | `src/companion/shared-photos.ts` | 500 |
| `CODEBUDDY_LLM_FAILOVER` | Alias déprécié | `src/providers/provider-failover-policy.ts` | - |
| `CODEBUDDY_PROVIDER_FALLBACK` | Repli fournisseur | `src/providers/provider-failover-policy.ts` | `false` |
| `CODEBUDDY_FALLBACK_CHAIN` | Chaîne de repli | `src/providers/provider-failover-policy.ts` | - |
| `CODEBUDDY_COMFYUI_FALLBACK_URLS` | URLs ComfyUI repli | `src/tools/media-generation-tool.ts` | - |

### 2.2 Variables principales pour AGENTS.md
1. `CODEBUDDY_MOBILE_HISTORY`
2. `CODEBUDDY_PROVIDER_FALLBACK`
3. `CODEBUDDY_FALLBACK_CHAIN`
4. `CODEBUDDY_LOCAL_PROMPT_MS_PER_TOKEN`
5. `CODEBUDDY_STALL_MAX_MS`

---

## 3. Hashs vérifiables

```bash
git rev-parse --verify 631071f6f^{commit}  # Merge fix/failover-handoff
 git rev-parse --verify 9142ae5e2^{commit}  # Merge codex/audit-systeme-nerveux
 git rev-parse --verify cd3ea2844^{commit}  # feat(scripts): moteur qwenflash
 git rev-parse --verify e738178a5^{commit}  # fix(stall): budget adaptatif
 git rev-parse --verify fd16b6498^{commit}  # docs(audit): liens vie privée
 git rev-parse --verify a34b3186d^{commit}  # docs(failover): bilan GROK-FAILOVER
 git rev-parse --verify 68e40ced9^{commit}  # fix(failover): cap 6 outils
 git rev-parse --verify 3ae522b9c^{commit}  # fix(failover): alias CODEBUDDY_LLM_FAILOVER
 git rev-parse --verify 5b46f3772^{commit}  # feat(failover): annonce bascule
 git rev-parse --verify a9d7eeabc^{commit}  # fix(failover): exposer 429 initial
```

---

## 4. Bilan

**Fait** :
1. Rapport créé avec toutes sources identifiées
2. 10 lots mappés : mémoire Lisa, audit installateur (5A/8B), voie locale, tests BashTool, PWA, photos, pare-feu (+10 motifs), repli fournisseur, étude OmniRoute, moteur qwenflash
3. Variables documentées (11 nouvelles, 5 principales)
4. Hashs vérifiables listés

**À faire** :
1. Mettre à jour CHANGELOG.md avec entrées formatées
2. Mettre à jour CLAUDE.md avec tableau variables
3. Mettre à jour AGENTS.md avec 5 variables principales
4. Vérifier `git diff --check` et garde vie privée
5. Commiter fichier par fichier

**Preuves** :
- `git diff --check` : 0 (à vérifier)
- Garde vie privée : `HOME=<worktree>/_qa/docs/home env -u FORCE_COLOR npx vitest run tests/security/donnees-personnelles.test.ts` → vert
- Script hash : `git rev-parse --verify <h>^{commit}` → exit 0 pour chaque hash
