# Rapport : Réparation de la déobfuscation du pare-feu de skills (Trou B-4)

Date : 2026-09-06
Branche : `fix/skill-firewall-deob-2026-09-06`
Worktree : `~/DEV/cb-firewall-2026-09-06`

## 1. Contexte et Objectifs
Conformément à l'audit `docs/audits/2026-09-06-audit-release-opus.md` §B-4, `deobfuscateForScan(content)` dans `src/security/skill-scanner.ts` n'était appliqué qu'aux motifs `capability === 'prompt-injection'`.
L'objectif est d'étendre la déobfuscation à toutes les classes de motifs tout en évitant les faux positifs sur les skills réels via une séparation en couches sûres (zero-width, homoglyphes, césures) et agressives (Base64, URL, hex-decode).

## 2. Étapes prévues
1. Constitution du corpus sous `_qa/fw/corpus/` et mesure AVANT via `scripts/skill-firewall-campaign.ts`.
2. Extension de la déobfuscation par couches (sûre pour tout motif, agressive pour injection) et tests rouge -> vert.
3. Mesure APRÈS sur le corpus, analyse de chaque changement de verdict, ajustements si faux positifs.
4. Validation des tests, types, lint, données personnelles, et documentation des limites connues.

## 3. Journal des opérations
- Initialisation du rapport avant inspection.
- **Point 1 — Corpus et mesure AVANT** :
  - Constitution du corpus dans `_qa/fw/corpus/` (ignoré dans `.gitignore`) :
    - `bundled` (8 skills : 7 fichiers `.skill.md`, 1 dossier `pubcommander-control`)
    - `hermes` (`~/.hermes/skills`, 75 dossiers de skills)
    - `codebuddy` (`~/code-buddy/.codebuddy/skills`, 5 dossiers de skills)
    - `openclaw` (`~/mem0/openclaw/skills`, 2 dossiers de skills)
    - Total : 90 skills.
  - Création de `scripts/skill-firewall-campaign.ts` permettant d'exécuter `scanSkillFirewall` sur chaque skill et de sortir un JSON `{skill, verdict, findings[]}`.
  - Résultat AVANT (`_qa/fw/campaign-avant.json`) :
    - Total : 90
    - Allow : 61
    - Review : 10
    - Quarantine : 19
  - Liste des 19 compétences en quarantaine AVANT et motifs principaux :
    1. `hermes/apple/macos-computer-use` (score 0, critical: `rm-rf`, `remote-download-pipe-shell`)
    2. `hermes/autonomous-ai-agents/claude-code` (score 0, critical: `rm-rf`)
    3. `hermes/autonomous-ai-agents/hermes-agent` (score 0, critical: `rm-rf`, `remote-download-pipe-shell`)
    4. `hermes/creative/comfyui` (score 0 < 55, cumul de `websocket`, `shell-subst`, `secret-ref`)
    5. `hermes/creative/p5js` (score 0, critical: `rm-rf`)
    6. `hermes/github/github-auth` (score 0 < 55)
    7. `hermes/github/github-code-review` (score 0 < 55)
    8. `hermes/github/github-issues` (score 0 < 55)
    9. `hermes/github/github-pr-workflow` (score 0 < 55)
    10. `hermes/github/github-repo-management` (score 0 < 55)
    11. `hermes/mlops/evaluation/lm-evaluation-harness` (score 0, critical: `eval`)
    12. `hermes/mlops/huggingface-hub` (score 0, critical: `remote-download-pipe-shell`)
    13. `hermes/mlops/inference/obliteratus` (score 0, critical: `jailbreak-godmode`)
    14. `hermes/productivity/google-workspace` (score 0 < 55)
    15. `hermes/productivity/notion` (score 0, critical: `remote-download-pipe-shell`)
    16. `hermes/productivity/powerpoint` (score 0 < 55)
    17. `hermes/red-teaming/godmode` (score 0, critical: `jailbreak-godmode`, `prompt-override`, high: `exec`)
    18. `hermes/social-media/xurl` (score 41, critical: `remote-download-pipe-shell`)
    19. `hermes/software-development/requesting-code-review` (score 30, critical: `eval`, high: `exec`)
- **Point 2 — Extension de la déobfuscation par couches** :
  - Modification de `src/security/text-deobfuscation.ts` :
    - Séparation en deux couches :
      - Couche sûre (`deobfuscateSafeForScan`) : suppression des contrôles bidi/format `\p{Cf}`, homoglyphes grecs/cyrilliques/IPA (`applyHomoglyphs`), normalisation NFKC/NFKD + suppression diacritiques `\p{Mn}`, zero-width `[\u200B-\u200D\uFEFF\u00AD\u2060]`, césures inter-lignes `(\w+)-[\r\n]+\s*(\w+)`, et suppression balises/commentaires HTML.
      - Couche agressive (`deobfuscateForScan`) : couche sûre + décodage percent/URL (`decodePercentOnce`) + décodage Base64 strict (`decodeBase64Blobs`).
  - Modification de `src/security/skill-scanner.ts` :
    - Remplacement de `collectPromptInjectionFindings` par `collectDeobfuscatedFindings`.
    - Le filtre restreignant la déobfuscation uniquement à `prompt-injection` est levé.
    - Pour `prompt-injection`, la couche agressive complète (Base64 + URL) est conservée.
    - Pour les autres capacités (filesystem, shell, dynamic-code, network, secrets, prototype-pollution), seule la couche sûre (`deobfuscateSafeForScan`) est appliquée.
    - Drapeau de repli `CODEBUDDY_SKILL_FIREWALL_DEOB_ALL` ajouté (défaut `true`).
  - Écriture du test rouge -> vert dans `tests/security/skill-firewall-deob-all.test.ts` :
    - `r<U+200B>m -rf` ⇒ quarantine (rouge 'allow' -> vert 'quarantine')
    - `curl … | sh` avec zero-width ⇒ quarantine (rouge 'allow' -> vert 'quarantine')
    - homoglyphe cyrillique dans `eval(` (`\u0435val(`) ⇒ quarantine (rouge 'allow' -> vert 'quarantine')
    - Base64 contenant `rm -rf` non déballé pour `filesystem` (pas de faux positif)
    - URL percent-encode contenant `rm -rf` non déballé pour `filesystem` (pas de faux positif)
    - Base64 contenant une prompt injection toujours détecté et mis en quarantaine.
- **Point 3 — Mesure APRÈS sur le corpus réel et élimination des faux positifs** :
  - Campagne APRÈS exécutée sur les 90 skills via `scripts/skill-firewall-campaign.ts` (`_qa/fw/campaign-apres.json`).
  - Résultats comparatifs AVANT vs APRÈS :
    - AVANT : 61 allow, 10 review, 19 quarantine.
    - APRÈS : 61 allow, 10 review, 19 quarantine.
    - Changements de verdict : **0** (aucun verdict n'a basculé).
  - Analyse des findings :
    - Un faux finding résiduel a été identifié lors de l'extension dans les tests Python de `hermes/creative/comfyui` : `from <module> import (\n Node` était interprété comme un `dynamic-import` JS (`import ( Node`) suite à la normalisation.
    - Correction sans exception nominative : affinement du motif `dynamic-import` dans `DANGEROUS_PATTERNS` avec un lookbehind négatif `/(?<!\bfrom\s+[\w.]+\s+)\bimport\s*\(\s*[a-zA-Z_$[]/` pour exclure la syntaxe d'import statique multiligne Python tout en conservant la détection des `import(var)` dynamiques JS/TS.
    - Après affinement : **0 faux positif** sur l'ensemble des 90 skills du corpus.
    - Le drapeau `CODEBUDDY_SKILL_FIREWALL_DEOB_ALL` est activé par défaut (`true`) comme prévu par la doctrine en cas de 0 FP.
