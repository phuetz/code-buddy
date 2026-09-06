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
    - `bundled` (8 skills : 7 fichiers `.skill.md`, 1 dossier de contrôle éditorial)
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
- **Point 4 — Preuves et clôture de la limite connue** :
  - `HOME=~/DEV/cb-firewall-2026-09-06/_qa/fw/home env -u FORCE_COLOR npx vitest run tests/security tests/skills` :
    - 78 fichiers passés, 1 ignoré (sandbox natif), 1371 tests passés, 3 ignorés, **0 échec**.
  - `npx tsc --noEmit -p tsconfig.json` : code 0, 0 erreur de type.
  - `npx eslint scripts/skill-firewall-campaign.ts src/security/skill-scanner.ts src/security/text-deobfuscation.ts tests/security/skill-firewall-deob-all.test.ts` : 0 erreur lint.
  - `git diff --check` : 0 erreur d'espacement / blanc.
  - `HOME=~/DEV/cb-firewall-2026-09-06/_qa/fw/home env -u FORCE_COLOR npx vitest run tests/security/donnees-personnelles.test.ts` : 40/40 passés (vert). Le corpus de travail et les artefacts de QA restent sous `_qa/fw/`, ignorés par git et non commités.
  - Mise à jour de la documentation :
    - `docs/RELEASE-NOTES-2.0.0.md` : mise à jour de la « Limite connue » désormais levée grâce à la déobfuscation sûre multi-classes.
    - `CHANGELOG.md` : mise à jour de la section Sécurité pour acter l'extension à toutes les classes via `deobfuscateSafeForScan` et la conservation du décodage agressif pour prompt-injection.

## 4. Suivi après contre-vérification Opus

La contre-vérification indépendante et adversariale menée par Claude Opus (`docs/reports/2026-09/VERIF-SKILL-FIREWALL-OPUS.md`) a validé la fermeture effective du trou B-4 et l'absence de régression sur corpus réel (191 skills, 0 flip de verdict). Elle a néanmoins identifié trois points à traiter en suivi :

1. **B-1 — Bourrage au-delà de 256 Ko (cas G03)** :
   - *Constat* : `deobfuscateSafeForScan` tronquait à `MAX_SCAN_CHARS = 256 * 1024` avant normalisation. Un document de 300 Ko contenant une charge obfusquée en fin de fichier (`r<U+200B>m -rf /`) échappait au scanner et obtenait `allow`.
   - *Résolution retenue* : Balayage fenêtré (fenêtres de 256 Ko avec recouvrement de 4 Ko, sur le texte brut et le texte normalisé). Cette approche évite les dénis de service liés à des allocations ou des expressions régulières sur documents géants tout en garantissant qu'aucune charge ne soit ignorée, y compris à la frontière entre fenêtres grâce au recouvrement de 4 Ko.
   - *Test rouge→vert* : Cas G03 (`quarantine`).

2. **B-2 — Kill-switch non byte-identique (cas D01)** :
   - *Constat* : `CODEBUDDY_SKILL_FIREWALL_DEOB_ALL=false` ne désactivait que la passe de déobfuscation étendue, mais le motif `dynamic-import` conservait son lookbehind négatif `(?<!\bfrom\s+[\w.]+\s+)` inconditionnellement. Sur le cas adverse D01 (`const m = await from lib import(nomModule);`), la base `f7c4eedde` donnait `quarantine` (score 76) alors que HEAD avec drapeau `false` donnait `allow` (score 100).
   - *Résolution* : Conditionner le lookbehind du motif `dynamic-import` à l'activation du drapeau `CODEBUDDY_SKILL_FIREWALL_DEOB_ALL`. Si le drapeau vaut `false` ou `0`, le motif d'origine de `f7c4eedde` est restauré exactement, garantissant une restauration byte-identique et verdict-identique du comportement d'origine.
   - *Test* : Cas D01 avec drapeau `false` ⇒ verdict identique à la base `f7c4eedde` (`quarantine`).

3. **C-2 — Aplatissement du document et faux positifs inter-paragraphes (cas F01)** :
   - *Constat* : `deobfuscateText` terminait par `.replace(/\s+/g, ' ')`, fusionnant tous les retours à la ligne du document. Les motifs utilisant `[^|\n]*` (comme `remote-download-pipe-shell`) ou `.*` pouvaient ainsi traverser des paragraphes entiers (ex. `curl` cité dans un paragraphe et `| bash` dans un autre à 3 paragraphes de distance).
   - *Résolution* : Conserver les retours à la ligne `\n` dans la couche « sûre » de `src/security/text-deobfuscation.ts` en ne repliant que les espaces horizontales (`[^\S\n]+` -> `' '`), tout en continuant de fusionner les césures mot-tiret-retour ligne (`(\w+)-[\r\n]+\s*(\w+)`).
   - *Test* : Cas F01 (`curl` dans un paragraphe, `| bash` dans un autre) ⇒ `allow`, et `curl ... | sh` sur une ligne ⇒ `quarantine`.

4. **Preuves et métriques de performance** :
   - Exécution de la campagne sur le corpus élargi (191 skills) : 0 flip attendu.
   - Validation de l'ensemble des suites `tests/security` et `tests/skills`.
   - Types (`tsc`), lint (`eslint`), espacements (`git diff --check`) et données personnelles (`donnees-personnelles.test.ts`).
   - Mesure des temps de scan corpus avant/après pour s'assurer du respect du plafond de 1,5 s.
