# Revue GF1 — Fusions du jour (2026-09-03) dans Code Buddy : interactions entre lanes, résolutions manuelles et régressions silencieuses

**Date de revue** : 2026-09-03  
**Dépôt** : `~/DEV/cb-succes-registry-2026-09-02`  
**Branche** : `revue/gf1-fusions-du-jour-2026-09-03`  
**Base analysée** : `4478d1ea1..HEAD` (34 commits de merge, ~40 branches intégrées)  
**Tests rouges commités** : commit `750083cc7` (`tests/fusion/revue-gf1-fusions.test.ts`)  

---

## 1. Contexte et Méthodologie

Entre le commit `4478d1ea1` (veille au soir) et `HEAD`, l'orchestrateur a intégré une quarantaine de branches produites par des lanes indépendantes (Codex, Grok, Gemini). Plusieurs dizaines de conflits ont été résolus à la main par l'orchestrateur.

Cette revue a analysé systématiquement :
1. Les 34 merges du graphe (`git log 4478d1ea1..HEAD --merges`).
2. Les résolutions de conflits effectives (`git show <merge> --cc`).
3. L'exécution de la suite globale des tests (1 932 suites, 36 498 tests).
4. La présence de doubles implémentations, de ruptures d'invariants, de tests désactivés/affaiblis et d'artefacts indésirables.
5. La reproduction sous forme de tests ROUGES commités nommément.

---

## 2. Inventaire des Résolutions de Conflits Manuelles Identifiées

| Merge | Sujet / Lanes | Fichiers résolus manuellement | Nature de la résolution |
|---|---|---|---|
| `c95464c20` | Merge CONV2 (barge-in opt-in) | `src/sensory/speech-reaction.ts`, `voice-loop.ts`, `server/index.ts` | Unification du paramètre `env`, ajout des hooks `onBargeInStart` et de la détection de fuite acoustique |
| `5a04f9e5e` | Merge SENSE1 (écho, fantôme, présence) | `src/sensory/speech-reaction.ts`, `CLAUDE.md`, tests | Réconciliation CONV2 × SENSE1 : exception demi-duplex si barge-in acoustique ; exigence de `CODEBUDDY_SENSORY_AEC_TRUST` |
| `eea1b1515` | Merge PILE-C (fin de tour v1-mini + Silero) | `src/sensory/speech-reaction.ts` | Intégration de `turnDecisionProvider` avec la retenue de tour incomplet de CONV1 |
| `0ec542f37` | Merge DOC1 (documentation vs réalité) | `src/sensory/speech-engine-config.ts`, `speech-reaction.ts` | Fusion des variables Parakeet v3 (CONV4) et des variables buddy-sense STT (DOC1) |
| `2cb4bb7b5` | Merge GT2 (trous de garde) | `src/sensory/voice-activity.ts`, `speech-reaction.ts` | Filtre d'écho : combinaison SENSE7 (sous-chaîne + overlap 60%) ET règle GT2 (chaque token appartient au robot) |
| `fb98c4ae2` | Merge GK17 (fleet réel) | `tests/fleet/peer-tool-bridge.test.ts` (via `92e832a39`), `src/fleet/peer-tool-bridge.ts` | Suppression du contrôle d'approbation humaine pour `peer.tool.invoke` en mode serveur headless |
| `6409b24e2` | Merge GK28 (observabilité & coûts) | `src/index.ts`, `docs/commands.md` | Fusion des options d'exécution CLI, initialisation de `RunStore` |
| `5848f42a8` | Merge GK29 (shadow & time-travel) | `src/index.ts`, `codebuddy-agent.ts`, `CLAUDE.md` | Reprise de session headless `--resume` (GK29) combinée au cwd du run (GK28) |
| `106462766` | Commit G3R / unitaire mémoire | `tests/unit/memory.test.ts` | Ajout d'un mock `fakeDisk` pour absorber la sauvegarde atomique et le verrou de session |

---

## 3. Analyse Détaillée des Anomalies et Régressions

### 3.1. Collision SENSE7 × GT2 : Faux positif d'écho sur réponses courtes de l'utilisateur (Thème 1)
- **Fichiers** : [`src/sensory/voice-activity.ts:222-236`](../../../src/sensory/voice-activity.ts#L222-L236)
- **Lanes en conflit** : SENSE7 (`887aaab8c` / `ef2a825c5`) × GT2 (`2cb4bb7b5` / `7495c6469`).
- **Mécanisme du bogue** :
  SENSE7 exigeait qu'une phrase entendue recouvre au moins 60 % des tokens du robot (`referenceOverlap / reference.tokens.length >= 0.6`) pour être qualifiée d'écho. GT2 a voulu interdire qu'un extrait de phrase du robot passe sans être vu, et a ajouté :
  ```ts
  const transcriptIsRobotFragment = transcriptTokens.every(token => referenceTokens.has(token));
  ```
  Lors de la fusion manuelle dans `2cb4bb7b5`, les deux conditions ont été liées par un simple opérateur `||` :
  ```ts
  if (transcriptIsRobotFragment || referenceOverlap / reference.tokens.length >= OWN_ECHO_MIN_COVERAGE) return 'echo';
  ```
- **Scénario de panne** :
  Si le robot dit par exemple : *« Bonjour, veux-tu continuer ? Dis oui ou non. »*, les tokens de référence contiennent notamment `"oui"` et `"non"`. Si l'utilisateur répond simplement *« Oui »*, `transcriptTokens` vaut `["oui"]`. L'expression `transcriptTokens.every(...)` est évaluée à `true`. La réponse légitime de l'utilisateur est classée comme un **écho du haut-parleur** (`'echo'`) et **totalement ignorée / supprimée** par le moteur audio ([`src/sensory/speech-reaction.ts:1889-1944`](../../../src/sensory/speech-reaction.ts#L1889-L1944)).
- **Preuve rouge** : Test 1 dans `tests/fusion/revue-gf1-fusions.test.ts` (`classifyRecentVoiceEcho('oui', 1500)` renvoie `'echo'`).

---

### 3.2. Collision SENSE1 × CONV2 : Réouverture du demi-duplex sans AEC de confiance (Thèmes 1 et 2)
- **Fichiers** : [`src/sensory/speech-reaction.ts:1543-1579`](../../../src/sensory/speech-reaction.ts#L1543-L1579), [`src/sensory/speech-reaction.ts:1648-1653`](../../../src/sensory/speech-reaction.ts#L1648-L1653), [`src/sensory/speech-reaction.ts:2284-2287`](../../../src/sensory/speech-reaction.ts#L2284-L2287).
- **Lanes en conflit** : SENSE1 (`5a04f9e5e` / `a9056300a`) × CONV2 (`c95464c20` / `6de905980`).
- **Mécanisme du bogue** :
  1. **Rupture d'invariant SENSE1** : SENSE1 a établi que la porte demi-duplex interdit l'écoute du micro pendant la parole du robot, sauf si l'AEC est **explicitement approuvée** via `CODEBUDDY_SENSORY_AEC_TRUST=true` (`isSensoryAecTrusted`). Or CONV2 a introduit le barge-in acoustique via `shouldTriggerAcousticBargeIn` qui teste uniquement `payload.aecActive !== true`, sans tester `isSensoryAecTrusted`. La résolution manuelle dans `5a04f9e5e` a ajouté une exception `bargedIn` :
     ```ts
     const bargedIn = job.turnId !== undefined && bargedSpeechTurnId === job.turnId;
     if (isSpeaking(t) && !aecTrusted && !bargedIn && !canDiscriminateEchoTail) return;
     ```
     Dès lors qu'un micro matériel annonce le drapeau `aecActive: true` (cas fréquent sous Linux même sans annulation réelle), un son fort émis par le haut-parleur déclenche `shouldTriggerAcousticBargeIn`, arme `bargedSpeechTurnId`, ce qui fait passer `bargedIn` à `true` et **rouvre la garde demi-duplex**, brisant l'isolation acoustique de SENSE1.
  2. **Double garde et court-circuit du filtre 250 ms** : Commit `6de905980` a créé `shouldTriggerVoiceBargeInOnSpeechStart` exigeant au moins 250 ms de signal (`DEFAULT_VOICE_BARGEIN_MIN_SPEECH_MS`) pour ne pas couper la voix sur un claquement ou bruit ambiant. Mais la fusion a conservé les deux fonctions en `||` à la ligne 2285-2286 :
     ```ts
     shouldTriggerVoiceBargeInOnSpeechStart(payload, env) || shouldTriggerAcousticBargeIn(payload, speechStartedAtMs)
     ```
     Comme `shouldTriggerAcousticBargeIn` renvoie `true` dès le premier bloc de 0 ms / 30 ms (lignes 1566-1568), la condition de 250 ms est intégralement court-circuitée.
  3. **Omission du passage d'environnement** : Aux lignes 1643 et 1896, `isSensoryAecTrusted` est appelé sans l'argument `env` optionnel, lisant `process.env` plutôt que `options.env`. De même, `shouldTriggerVoiceBargeIn` à la ligne 1884 omet `env`.
- **Preuve rouge** : Tests 2 et 3 dans `tests/fusion/revue-gf1-fusions.test.ts`.

---

### 3.3. Régression silencieuse GK28 : Plantage de `CodeBuddyAgent.saveCurrentSession` (Thème 1)
- **Fichiers** : [`src/agent/codebuddy-agent.ts:1650-1665`](../../../src/agent/codebuddy-agent.ts#L1650-L1665), [`src/analytics/cost-report.ts:390-395`](../../../src/analytics/cost-report.ts#L390-L395).
- **Lanes en conflit** : GK28 (`6409b24e2` / `986122b5d`) × Agent Core (`tests/unit/codebuddy-agent.test.ts`, `tests/grok-agent.test.ts`).
- **Mécanisme du bogue** :
  Dans le commit `986122b5d`, GK28 a ajouté une surcharge `saveCurrentSession()` dans `CodeBuddyAgent` :
  ```ts
  override saveCurrentSession(): Promise<void> | void {
    const report = this.costTracker.getReport();
    const model = this.getCurrentModel();
    const provider = process.env.CODEBUDDY_PROVIDER?.trim() || inferCostProvider(model);
    const turns = this.costTracker.getSessionUsage().map((row) => ({ ... }));
  ```
  Deux failles immédiates :
  1. Si `model` est `undefined` (ex. client mocké ou session neuve sans modèle actif), `inferCostProvider(model)` tente `model.trim()` et lève `TypeError: Cannot read properties of undefined (reading 'trim')`.
  2. Si `costTracker` ne fournit pas `getSessionUsage` (ex. mock partiel de test ou conteneur de test où `costs = {}`), l'appel lève `TypeError: this.costTracker.getSessionUsage is not a function`.
- **Impact** : Défaillance directe des suites officielles `tests/unit/codebuddy-agent.test.ts` et `tests/grok-agent.test.ts`.
- **Preuve rouge** : Tests 4 et 5 dans `tests/fusion/revue-gf1-fusions.test.ts`.

---

### 3.4. Régression de renommage non propagée GK1 (Thème 1 & 4)
- **Fichiers** : [`tests/docs/public-screenshots.test.ts:16, 219`](../../../tests/docs/public-screenshots.test.ts#L16)
- **Lanes en conflit** : GK1 (`8a2b55e0d` / `0f505045a`) × Tests Docs.
- **Mécanisme du bogue** :
  La lane GK1 a renommé `cowork/readme.md` en majuscules `cowork/README.md` pour compatibilité avec les systèmes de fichiers Linux sensibles à la casse. GK1 a mis à jour plusieurs références dans la documentation et dans `tests/docs/cowork-public-docs-privacy.test.ts`, mais a omis [`tests/docs/public-screenshots.test.ts`](../../../tests/docs/public-screenshots.test.ts) qui référence toujours en dur `path.join(repoRoot, 'cowork', 'readme.md')`.
- **Impact** : Échec systématique de la suite de test avec `ENOENT: no such file or directory, open '.../cowork/readme.md'`.
- **Preuve rouge** : Test 6 dans `tests/fusion/revue-gf1-fusions.test.ts`.

---

### 3.5. Affaiblissement / Inversion de tests de sécurité : GK17 & GT2 (Thème 4)
1. **Contournement d'approbation sur `peer.tool.invoke` (GK17)** :
   - Fichiers : [`src/fleet/peer-tool-bridge.ts:435-442`](../../../src/fleet/peer-tool-bridge.ts#L435-L442), [`tests/fleet/peer-tool-bridge.test.ts:323-370`](../../../tests/fleet/peer-tool-bridge.test.ts#L323-L370).
   - GK17 a supprimé la vérification de `needs_approval` de `PolicyEngine` pour éviter les auto-rejets en mode headless. En conséquence, les appels distants recevant `needs_approval` sont exécutés sans aucune validation humaine.
   - Pour que la CI passe, le commit `92e832a39` a inversé les assertions de test : `expect(confirmSpy).not.toHaveBeenCalled()`, supprimant la garantie de validation.
2. **Suppression du test de blocage VAD sous bruit ambiant (GT2)** :
   - Fichiers : [`tests/sensory/hole-vad-noise-cap.test.ts:1-6`](../../../tests/sensory/hole-vad-noise-cap.test.ts#L1-L6).
   - Commit `c08ab6d2e` a remplacé la simulation de fermeture du VAD sous bruit ambiant (50 lignes vérifiant l'hystérésis et la fermeture sur silence) par un simple marqueur `it.todo(...)`.
3. **Mock de disque partiel dans `tests/unit/memory.test.ts` (G3R)** :
   - Fichiers : [`tests/unit/memory.test.ts:43-75`](../../../tests/unit/memory.test.ts#L43-L75).
   - Le mock `fakeDisk` intercepte `readFile`, `writeFile`, `rename`, `remove`, mais `mockPathExists` est laissé à `false` par défaut (`mockPathExists: vi.fn().mockResolvedValue(false)`), créant une incohérence entre l'état de `fakeDisk` et la réponse de `fs.pathExists`.

---

### 3.6. Fichiers de QA, scripts résiduels et binaires volumineux entrés par erreur (Thème 5)
L'inspection de `4478d1ea1..HEAD` montre l'introduction non contrôlée de nombreux artefacts de travail :
1. **Dossier `_qa/` non ignoré (52 fichiers ajoutés)** :
   - Applications web complètes : `_qa/gk21-app/` (`server.mjs`, `index.html`, etc.).
   - Suites de test jouets : `_qa/gk28/toy/` (`ledger.js`, `package.json`, etc.).
   - Binaires et exécutables : `_qa/gk23/bin/aplay`, `_qa/gk20/run-path.mjs`, `_qa/gk28/buddy.sh`.
2. **Fichiers images supérieurs à 200 Ko dans `_qa/`** :
   - `_qa/gk4/fin.png` (202 Ko)
   - `_qa/gk4/karaoke-t0.6.png` (228 Ko)
   - `_qa/gk4/milieu.png` (340 Ko)
   - `_qa/gk4/replay/debut.png` (330 Ko)
   - `_qa/gk4/replay/fin.png` (341 Ko)
   - `_qa/gk4/replay/milieu.png` (326 Ko)
   - `_qa/gk4/replay/scene1-diagram.png` (347 Ko)
3. **18 fichiers de compte-rendu committés à la racine** :
   - `RAPPORT-GK1.md`, `RAPPORT-GK4.md`, `RAPPORT-GK5.md`, `RAPPORT-GK6.md`, `RAPPORT-GK10.md`, `RAPPORT-GK12.md`, `RAPPORT-GK14.md`, `RAPPORT-GK16.md`, `RAPPORT-GK17.md`, `RAPPORT-GK18.md`, `RAPPORT-GK20.md`, `RAPPORT-GK21.md`, `RAPPORT-GK22.md`, `RAPPORT-GK23.md`, `RAPPORT-GK25.md`, `RAPPORT-GK27.md`, `RAPPORT-GK28.md`, `RAPPORT-GK29.md`.
4. **Violation de sécurité des données d'infrastructure (test `donnees-personnelles.test.ts`)** :
   - Un identifiant désignant l'infrastructure privée de l'auteur a été commité dans `RAPPORT-GK5.md`, `docs/FABLE5-CODEX-COORDINATION.md` et `src/companion/assistant-config.ts`.

---

## 4. Tests Rouges Ajoutés

Fichier créé et commité : [`tests/fusion/revue-gf1-fusions.test.ts`](../../../tests/fusion/revue-gf1-fusions.test.ts) (commit `750083cc7`).

### Résultats d'exécution Vitest :
```bash
npx vitest run tests/fusion/revue-gf1-fusions.test.ts
```
- **6 tests ROUGES avérés** :
  1. `ne doit pas classer une réponse humaine normale ("oui", "non", "merci") comme un écho du robot` (SENSE7 × GT2)
  2. `shouldTriggerVoiceBargeInOnSpeechStart ne doit pas déclencher de barge-in si AEC est non-approuvée` (SENSE1 × CONV2)
  3. `inferCostProvider ne doit pas lever TypeError si model est undefined ou vide` (GK28)
  4. `saveCurrentSession ne doit pas lever TypeError si costTracker n a pas getSessionUsage` (GK28)
  5. `saveCurrentSession ne doit pas lever TypeError si getCurrentModel() retourne undefined` (GK28)
  6. `vérifie que les tests de documentation publique ne référencent pas l'ancien nom cowork/readme.md` (GK1)

---

## 5. Grille de Synthèse « Fusion → Risque → Test → Correctif Proposé »

| Fusion / Commit | Risque identifié | Test rouge prouvant le problème | Correctif proposé |
|---|---|---|---|
| `2cb4bb7b5` (GT2 × SENSE7) | Suppression silencieuse de réponses humaines courantes monosyllabiques ("oui", "non", "merci") confondues avec un écho | `tests/fusion/revue-gf1-fusions.test.ts` (Test 1) | Dans `src/sensory/voice-activity.ts`, n'appliquer `transcriptIsRobotFragment` que si `transcriptTokens.length >= 3` ou exiger une couverture minimale de tokens de la référence |
| `5a04f9e5e` (SENSE1 × CONV2) | Réouverture du demi-duplex par le barge-in acoustique alors que l'AEC n'est pas approuvée ; boucle d'écho | `tests/fusion/revue-gf1-fusions.test.ts` (Test 2) | Dans `src/sensory/speech-reaction.ts`, exiger `isSensoryAecTrusted(payload.aecActive === true, env)` dans `shouldTriggerVoiceBargeInOnSpeechStart` et `shouldTriggerAcousticBargeIn` ; ne pas ouvrir le demi-duplex sans trust |
| `6de905980` (CONV2) | Court-circuit de la garde de durée de 250 ms par `shouldTriggerAcousticBargeIn` dans l'opérateur `||` | `tests/fusion/revue-gf1-fusions.test.ts` (Test 3) | Supprimer le `|| shouldTriggerAcousticBargeIn(...)` redondant à la ligne 2286 de `speech-reaction.ts` ou lui faire respecter la condition de 250 ms |
| `6409b24e2` (GK28) | Crash `TypeError` au moment d'enregistrer la session si `costTracker` est partiel ou si `model` est indéfini | `tests/fusion/revue-gf1-fusions.test.ts` (Tests 4 & 5) | Dans `src/agent/codebuddy-agent.ts:1654`, utiliser `this.costTracker?.getSessionUsage?.() ?? []` et `inferCostProvider(model \|\| '')` ; dans `inferCostProvider`, vérifier `if (!model \|\| typeof model !== 'string')` |
| `8a2b55e0d` (GK1) | Échec de test par non-mise à jour de `cowork/readme.md` vers `cowork/README.md` | `tests/fusion/revue-gf1-fusions.test.ts` (Test 6) + `tests/docs/public-screenshots.test.ts` | Mettre à jour les lignes 16 et 219 de `tests/docs/public-screenshots.test.ts` pour viser `cowork/README.md` |
| `fb98c4ae2` (GK17) | Exécution non contrôlée d'outils distants en mode serveur headless (`needs_approval` ignoré) | `tests/fleet/peer-tool-bridge.test.ts` | En mode headless sans confirmation TTY, rejeter proprement (`failClosed`) les outils nécessitant une approbation plutôt que de les exécuter silencieusement |
| `2cb4bb7b5` (GT2) | Disparition de la couverture du VAD sous bruit ambiant | `tests/sensory/hole-vad-noise-cap.test.ts` | Rétablir le test d'hystérésis du VAD dans `hole-vad-noise-cap.test.ts` avec les nouvelles constantes adaptatives au lieu de `it.todo` |
| `0ec542f37` (DOC1) | 16 tests de documentation échouent en ENOENT car ils tentent d'exécuter `dist/index.js` absent | `tests/docs/revue-gemini-docs.test.ts` | Compiler `dist/` dans le script de test ou faire exécuter `runCli` via `tsx src/index.ts` |
| Multiples (`6409b24e2`, etc.) | 52 fichiers de travail `_qa/` et 18 `RAPPORT-GK*.md` polluent le dépôt | `git ls-files _qa/` | Déplacer les rapports dans un dossier dédié (ex. `docs/reports/`) et ajouter `_qa/` à `.gitignore` en nettoyant l'arbre git |
| `13f878cec` (GK5) | Fuite d'un identifiant d'infrastructure privée dans des documents commités | `tests/security/donnees-personnelles.test.ts` | Remplacer l'identifiant par un nom fictif neutre dans `RAPPORT-GK5.md`, `docs/FABLE5-CODEX-COORDINATION.md` et `src/companion/assistant-config.ts` |
