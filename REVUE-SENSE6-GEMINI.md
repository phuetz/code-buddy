# REVUE SENSE6 — Revue Gemini avant activation des briques opt-in de conversation

**Date** : 3 septembre 2026  
**Auteur** : Gemini (Antigravity)  
**Dépôt** : `/home/patrice/DEV/cb-succes-sensory-2026-09-02`  
**Branche** : `revue/sense6-activation-2026-09-03`  
**Commit des tests rouges** : `8bfbc78b9` (`test(sensory): prouver les 7 trous d'interaction SENSE6 par des tests rouges`)  
**Typecheck / Lint** : Vert (0 erreur, `npm run typecheck` code 0, eslint code 0)  

---

## 1. Contexte et Mandat

La mission SENSE6 consiste à auditer l'interaction entre les 8 briques conversationnelles opt-in développées dans les chantiers précédents (CONV1, CONV2, CONV3, PILE-C, DARK3) et les garde-fous de sûreté nocturne établis lors de SENSE1 et SENSE3.

Les variables opt-in examinées ensemble sont :
- `CODEBUDDY_SENSORY_BACKCHANNEL=true` (CONV1 : régulateurs "Mhm.", "Oui." à 120 ms)
- `CODEBUDDY_SENSORY_REPAIR=true` (CONV1 : relance "Pardon, tu disais ?" sur confiance faible ou entrée courte)
- `CODEBUDDY_SENSORY_BARGE_IN=true` (CONV2 : interruption audio et parole)
- `CODEBUDDY_SENSORY_SHORT_FIRST=true` (CONV3 : streaming court immédiat, libération premier segment)
- `CODEBUDDY_SENSORY_TURN_DETECTOR=livekit` (PILE-C : turn-detector v1-mini)
- `CODEBUDDY_TTS_TWO_SPEED=true` (DARK3 : Kyutai local 24k + ElevenLabs)
- `BUDDY_SENSE_END_SILENCE_MS=350` (CONV1 : silence de fin raccourci à 350 ms)
- `BUDDY_SENSE_AEC=auto` avec `CODEBUDDY_SENSORY_AEC_TRUST=false` (AEC présent côté matériel mais non approuvé)

### Question centrale
Si Patrice active conjointement ces briques sans précaution, quelles protections de nuit tombent face aux bruits ambiants (TV, conversations tierces) et aux retours haut-parleur (écho acoustique, demi-duplex, boucle d'auto-dialogue) ?

---

## 2. Analyse détaillée des 7 Trous d'Interaction

### Trou 1 — Backchannel joué pendant que Lisa parle ou sur un écho
- **Mécanisme** : 
  Dans `src/sensory/speech-reaction.ts` (ligne 2052), lorsque `decisionReason === 'addressed'`, `armBackchannel(turnId)` est appelé. Dans `src/sensory/conversation-cues.ts`, le backchannel arme un `setTimeout` de 120 ms qui appelle inconditionnellement `onConversationCue`.
  1. *Écho partiel* : Si Lisa prononce une phrase longue contenant son nom ("Bonjour Patrice, je suis Lisa et je suis là..."), un écho partiel capté par le micro tel que "Lisa et je suis" ne couvre que 28% des tokens. Le filtre d'écho SENSE1 (`classifyRecentVoiceEcho`, seuil à 60%) le classe comme `'distinct'`. L'adresse vocative ("Lisa") est détectée, le tour est qualifié `'addressed'`, et un backchannel ("Mhm.") est joué sur l'écho de Lisa !
  2. *Parole en cours* : Ni `armBackchannel` ni `conversation-cues.ts` ne vérifient `isSpeaking()`.
- **Fichier de test rouge** : `tests/sensory/hole-sense6-backchannel-during-speech-or-echo.test.ts`
- **Résultat Vitest** :
  ```text
  FAIL tests/sensory/hole-sense6-backchannel-during-speech-or-echo.test.ts
  AssertionError: expected [ { kind: 'backchannel', cue: 'mhm', text: 'Mhm.', ... } ] to deeply equal []
  ```

---

### Trou 2 — Réparation « Pardon ? » déclenchée par sa propre voix
- **Mécanisme** :
  1. *STT vide sur résidu de haut-parleur* : Dans `src/sensory/speech-reaction.ts` (lignes 1795-1811), le traitement `if (!text)` s'exécute **avant** toute vérification d'écho (`classifyRecentVoiceEcho`). Si une fenêtre d'engagement est ouverte (`attention.engaged === true && attention.source === 'addressed'`), `repairAddressed` devient immédiatement `true`. Lisa prononce alors « Pardon, tu disais ? » en réaction au silence/bruit blanc issu de sa propre extinction audio !
  2. *Fragment court d'écho* : Si un écho de 2 mots issu de Lisa ("Lisa écoute") est transcrit, il échappe au seuil de 60% de l'écho-buffer (classé `'distinct'`). À la ligne 2012, `shouldRepairTranscript("Lisa écoute")` est vrai car `wordCount <= 2`. Lisa déclenche `playRepair()` et demande pardon à son propre écho !
- **Fichier de test rouge** : `tests/sensory/hole-sense6-repair-own-voice.test.ts`
- **Résultat Vitest** :
  ```text
  FAIL tests/sensory/hole-sense6-repair-own-voice.test.ts
  AssertionError: expected [ { kind: 'repair', cue: 'repair', text: 'Pardon, tu disais ?' } ] to deeply equal []
  ```

---

### Trou 3 — Barge-in acoustique déclenché par la télévision
- **Mécanisme** :
  Dans `src/sensory/speech-reaction.ts` (lignes 2248 et 1555) :
  `shouldTriggerVoiceBargeInOnSpeechStart` renvoie `true` dès que `capturedSpeechMs(payload) >= 250`.
  Lorsqu'un son de télévision ou une voix ambiante dans la pièce dépasse 250 ms pendant une réplique de Lisa, `onBargeInStart` est appelé immédiatement. Cela coupe brutalement la parole de Lisa.
  Pire : `bargedSpeechTurnId` est enregistré. À la ligne 1629 de `speech-reaction.ts`, la condition demi-duplex :
  `if (isSpeaking(t) && !aecTrusted && !bargedIn)` est neutralisée par `bargedIn = true` ! La garde SENSE1 (qui imposait `CODEBUDDY_SENSORY_AEC_TRUST=true` pour écouter pendant la parole) est totalement contournée par du son TV.
- **Fichier de test rouge** : `tests/sensory/hole-sense6-barge-in-tv.test.ts`
- **Résultat Vitest** :
  ```text
  FAIL tests/sensory/hole-sense6-barge-in-tv.test.ts
  AssertionError: expected [ { interruptedTurnId: 'voice_100000_1', payload: { audioMs: 350, ... } } ] to deeply equal []
  ```

---

### Trou 4 — Première phrase CONV3 émise avant la décision de sûreté / révision
- **Mécanisme** :
  SENSE1/SENSE3 imposaient que la garde relationnelle (`RelationshipSafetyStreamGuard`) conserve une phrase d'avance afin de valider la sûreté combinée d'énoncés découpés aux frontières de streaming (ex: "J'ai une... conscience." ou déclarations d'attachement non sécurisées).
  Avec `CODEBUDDY_SENSORY_SHORT_FIRST=true` :
  1. `RelationshipSafetyStreamGuard` passe `releaseFirstImmediately = true`, libérant le premier segment dès sa réception sans attendre la suite.
  2. Le composant `streamSpeak` envoie immédiatement le premier segment à la voix synthétique.
  3. La revue sémantique (`reviewBeforeDelivery` / `shouldReviewPlan`) dans `hybrid-reply.ts` (ligne 1306) n'est exécutée qu'en post-traitement de flux : l'audio de la première phrase est donc **déjà audible sur le haut-parleur** avant même que le critique sémantique n'ait validé ou corrigé la réponse !
- **Fichier de test rouge** : `tests/sensory/hole-sense6-conv3-short-first-before-decision.test.ts`
- **Résultat Vitest** :
  ```text
  FAIL tests/sensory/hole-sense6-conv3-short-first-before-decision.test.ts
  AssertionError: expected [ 'J\'ai une... ' ] to deeply equal []
  AssertionError: expected true to be false (firstAudioPlayedBeforeReview)
  ```

---

### Trou 5 — Tour détecté fini par v1-mini alors que l'humain hésite
- **Mécanisme** :
  En français, les hésitations syntaxiques courantes ("Je voulais te demander si...", "Attends parce que...") sont détectées par `isLikelyIncompleteVoiceTurn(text)`, qui accorde normalement un hold de retenue (550 à 900 ms) pour laisser l'humain terminer sa pensée.
  Dans `src/sensory/speech-reaction.ts` (lignes 2365-2370) :
  ```typescript
  if (
    remainingIncompleteHoldMs > 0 &&
    (turnDecision?.endOfTurn === false || (
      turnDecision?.endOfTurn !== true &&
      !livePayload?.turnDetector &&
      isLikelyIncompleteVoiceTurn(text)
    ))
  )
  ```
  Si `CODEBUDDY_SENSORY_TURN_DETECTOR=livekit` est actif, le modèle LiveKit `turn-detector-v1-mini` applique son seuil agressif (0.285). Dès qu'il émet une probabilité >= 0.285, `turnDecision.endOfTurn` vaut `true`.
  L'heuristique syntaxique française est alors **totalement ignorée** (`!livePayload?.turnDetector` est faux). Le tour inachevé est envoyé immédiatement à la génération, coupant la parole de l'utilisateur en pleine hésitation.
- **Fichier de test rouge** : `tests/sensory/hole-sense6-turn-detector-hesitation.test.ts`
- **Résultat Vitest** :
  ```text
  FAIL tests/sensory/hole-sense6-turn-detector-hesitation.test.ts
  AssertionError: expected [ 'Lisa, je voulais te demander si' ] to deeply equal []
  ```

---

### Trou 6 — Voix locale et ElevenLabs : repli rejouant une phrase déjà dite
- **Mécanisme** :
  Dans `src/sensory/voice-loop.ts` (lignes 3014-3017), le routage deux vitesses gère l'échec de Kyutai par une cascade de repli :
  ```typescript
  if (await local?.(text, opts)) return true;
  if (opts.signal?.aborted) return false;
  logger.warn('[voice] Kyutai stream failed — falling back to ElevenLabs for this phrase');
  if (await cloud?.(text, opts)) return true;
  ```
  Si Kyutai commence à streamer et que la connexion coupe après avoir émis plusieurs trames PCM consommées par le lecteur audio (ex: 200 ms d'audio déjà diffusées dans la pièce), `local` renvoie `false`.
  Le code passe alors le texte **intégral et inchangé** à ElevenLabs (`cloud`).
  ElevenLabs synthétise et rejoue la phrase depuis le premier mot, produisant un bégaiement flagrant où l'utilisateur entend le début de la phrase deux fois de suite.
- **Fichier de test rouge** : `tests/sensory/hole-sense6-two-speed-overlap-replay.test.ts`
- **Résultat Vitest** :
  ```text
  FAIL tests/sensory/hole-sense6-two-speed-overlap-replay.test.ts
  AssertionError: expected 'Bonjour Patrice, je commence à t expl…' not to be 'Bonjour Patrice, je commence à t expl…'
  ```

---

### Trou 7 — Combinaison qui rouvre l'auto-dialogue
- **Mécanisme** :
  C'est le scénario catastrophe résultant de la confluence de toutes les briques sans garde AEC matérielle certifiée (`CODEBUDDY_SENSORY_AEC_TRUST=false`) :
  1. Lisa s'exprime dans la pièce (ex: accueil ou réponse).
  2. Le microphone capte la réverbération du haut-parleur.
  3. Avec `CODEBUDDY_SENSORY_BARGE_IN=true`, la fuite acoustique (durée >= 250 ms) déclenche le barge-in `onBargeInStart`. Lisa s'interrompt elle-même.
  4. L'interruption remet à zéro la garde demi-duplex (`isSpeaking()` devient faux) et positionne `bargedIn = true`.
  5. Le STT produit un résidu de sa propre parole (court fragment < 60% de couverture ou transcription vide).
  6. Le filtre d'écho SENSE1 est impuissant (< 60%).
  7. Si le texte est court, `CODEBUDDY_SENSORY_REPAIR=true` déclenche « Pardon, tu disais ? » ; si son nom a été prononcé, `CODEBUDDY_SENSORY_BACKCHANNEL=true` émet "Mhm." et une réponse démarre via CONV3 + Kyutai.
  8. La nouvelle émission audio est à nouveau captée par le micro, relançant la boucle sans fin.
- **Fichier de test rouge** : `tests/sensory/hole-sense6-auto-dialogue-loop.test.ts`
- **Résultat Vitest** :
  ```text
  FAIL tests/sensory/hole-sense6-auto-dialogue-loop.test.ts
  AssertionError: expected [ 'barge-in-start', 'cue:backchannel' ] to deeply equal []
  ```

---

## 3. Grille Synthétique « Combinaison → Risque → Test »

| Combinaison de drapeaux | Garde SENSE1/3 compromise | Risque concret en production | Test de preuve rouge |
| :--- | :--- | :--- | :--- |
| `BACKCHANNEL=true` + écho partiel / parole | Demi-duplex SENSE1 & Filtre écho 60% | Régulateur "Mhm." superposé à sa propre voix ou déclenché par son écho | `hole-sense6-backchannel-during-speech-or-echo.test.ts` |
| `REPAIR=true` + fenêtre engagée | Filtrage d'écho & Silence nocturne SENSE3 | Réplique "Pardon, tu disais ?" sur du bruit blanc ou son propre écho | `hole-sense6-repair-own-voice.test.ts` |
| `BARGE_IN=true` + `AEC_TRUST=false` | Demi-duplex strict SENSE1 | La télévision ou un son ambiant >= 250ms coupe la parole de Lisa | `hole-sense6-barge-in-tv.test.ts` |
| `SHORT_FIRST=true` | Rétention d'avance & Revue sémantique SENSE3 | Émission audio de segments partiels avant la décision de sûreté | `hole-sense6-conv3-short-first-before-decision.test.ts` |
| `TURN_DETECTOR=livekit` + `END_SILENCE=350` | Délai de grâce d'hésitation (550-900ms) | Lisa coupe l'utilisateur en pleine réflexion ("si...", "parce que...") | `hole-sense6-turn-detector-hesitation.test.ts` |
| `TTS_TWO_SPEED=true` | Intégrité du flux audio | Échec Kyutai rejouant toute la phrase depuis le début sur ElevenLabs | `hole-sense6-two-speed-overlap-replay.test.ts` |
| **Toutes ensemble** (`AEC_TRUST=false`) | Demi-duplex, Écho, Fenêtre d'engagement | Auto-interruption sur son haut-parleur et boucle infinie d'auto-dialogue | `hole-sense6-auto-dialogue-loop.test.ts` |

---

## 4. Matrice des Protections Nocturnes Compromises

| Protection établie | État sans les briques opt-in | État avec toutes les briques actives | Point de rupture exact |
| :--- | :--- | :--- | :--- |
| **Demi-duplex strict** | Garanti (micro coupé si `isSpeaking()`) | **ROM銜** | `bargedIn = true` dans `speech-reaction.ts` ligne 1629 contourne `!aecTrusted` |
| **Filtre propre phrase (écho)** | Rejet si >= 60% des tokens récents | **INSUFFISANT** | Fragments d'écho de 1 à 3 mots (< 60%) requalifiés en tours adressés |
| **Fenêtre fermée à l'ambiant** | Silencieux hors vocatif direct | **PERFORÉE** | Barge-in acoustique non adressé force l'admission dans `inFlight` |
| **Conducteur de parole** | Un seul émetteur à la bouche | **FRAGILISÉ** | Backchannel à 120ms joue sans vérifier `isSpeaking()` |
| **Politique Home & Nuit** | Zéro parole spontanée intempestive | **COMPROMISE** | Réparation « Pardon ? » sur STT vide relance la parole dans la maison |
| **Hystérésis de présence** | 20s validation / 300s expiration | Inchangé | Préservé au niveau vision/caméra |

---

## 5. Ordre d'Activation Sûr Recommandé

Pour éviter les régressions et les boucles intempestives, l'activation ne doit **JAMAIS** être globale. Elle doit suivre un déploiement progressif brique par brique, avec observation rigoureuse des logs.

### Étape 1 : `CODEBUDDY_SENSORY_SHORT_FIRST=true` (CONV3)
- **Pourquoi d'abord** : Améliore la réactivité perçue sans écouter le micro ni toucher au demi-duplex.
- **Ce qu'il faut observer dans les logs** :
  `[voice] short-first: firstContentMs=..., sentences=...`
  Vérifier qu'aucune phrase tronquée de plus de 20 mots n'est émise et que le streaming s'arrête au plafond configuré.

### Étape 2 : `CODEBUDDY_TTS_TWO_SPEED=true` (DARK3)
- **Pourquoi ensuite** : Réduit la latence locale via Kyutai pour la première phrase courte.
- **Ce qu'il faut observer dans les logs** :
  `[voice] route=local reason=conv3-first` puis `[voice] route=elevenlabs reason=continuation`
  Surveiller les logs d'avertissement : `[voice] Kyutai stream failed — falling back to ElevenLabs`. S'ils apparaissent, vérifier l'absence d'effet perroquet / répétition.

### Étape 3 : `BUDDY_SENSE_END_SILENCE_MS=450` (au lieu de 350 direct)
- **Pourquoi** : Raccourcit le temps de détection de fin de tour sans être trop agressif.
- **Ce qu'il faut observer dans les logs** :
  Vérifier que les fins de phrase naturelles ne sont pas coupées. Conserver `CODEBUDDY_SENSORY_TURN_DETECTOR` éteint tant que v1-mini n'intègre pas la pondération syntaxique française.

### Étape 4 : `CODEBUDDY_SENSORY_BACKCHANNEL=true` (avec prérequis de garde)
- **Attention impérative** : Ne doit être activé qu'après s'être assuré que `isSpeaking()` inhibe `armBackchannel` et que le filtre d'écho rejette les fragments contenant le nom du robot.
- **Ce qu'il faut observer dans les logs** :
  `[voice] armed backchannel` suivi de `[voice] cue: backchannel`. Vérifier qu'aucun cue n'apparaît immédiatement après une fin de parole de Lisa.

### Étape 5 : `CODEBUDDY_SENSORY_REPAIR=true`
- **Attention impérative** : Ne jamais activer tant que `!text` ne vérifie pas la proximité temporelle avec la dernière prise de parole (`Date.now() - lastSpokeTime < 2000`).
- **Ce qu'il faut observer dans les logs** :
  `[speech] repair prompt triggered`. Doit survenir UNIQUEMENT lorsqu'un humain a parlé de manière inaudible, jamais en chambre calme après une réponse du robot.

### Étape 6 : `CODEBUDDY_SENSORY_BARGE_IN=true`
- **STRICTEMENT CONDITIONNÉ** : Ne doit JAMAIS être activé tant que `CODEBUDDY_SENSORY_AEC_TRUST=false`.
- **Règle absolue** : Sans annulation d'écho certifiée au niveau matériel/driver ALSA, le barge-in acoustique transformera inévitablement la moindre réflexion du haut-parleur en auto-interruption.

---

## 6. Preuves d'Exécution et Commits

- **Commit conventionnel** : `8bfbc78b9` (`test(sensory): prouver les 7 trous d'interaction SENSE6 par des tests rouges`)
- **Exécution Vitest complète des 7 trous** :
  `./node_modules/.bin/vitest run tests/sensory/hole-sense6-*.test.ts`
  Sortie : 7 suites de tests, 9 échecs prouvant mathématiquement chacun des 7 trous d'interaction.
- **Contrôle de non-régression du dépôt** :
  - `npm run typecheck` : code 0 (TypeScript strict sans aucune erreur).
  - `npx eslint tests/sensory/hole-sense6-*.test.ts` : code 0 (0 erreur de linting).
  - Tests existants ciblés (`dark3`, `conv3`, `turn-detector`) : code 0 (12 passés).
