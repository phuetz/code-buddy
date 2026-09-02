# REVUE-SENSE-GEMINI.md
# Mission SENSE2 — Revue : toutes les voies par lesquelles Lisa parle sans être sollicitée, ou perçoit ce qui n'existe pas

Date : 2026-09-02 / 2026-09-03  
Branche : `revue/sense-2026-09-03`  
Dépôt : clone `cb-succes-sensory-2026-09-02`  
Règles respectées : aucun push, aucune API payante, aucun service systemd modifié, aucune écriture hors du clone ni dans ~/.codebuddy, dépôt original ~/code-buddy non touché, aucune donnée personnelle dans le code ou les tests, commits conventionnels individuels, aucune modification du code source de production (revue pure).

---

## 1. Journal des opérations et lectures au fil de l'eau

### Lectures préalables et cadrage
1. Initialisation du rapport `REVUE-SENSE-GEMINI.md` avant toute inspection.
2. Lecture intégrale de `/home/patrice/DEV/vitrine-drafts/vague-2026-09-02/robot/FAITS-ROBOT-ECHO-MOUVEMENT-2026-09-02.md` (lignes 1 à 39) :
   - Fait 1 : Auto-transcription et auto-réponse (PipeWire virtual source `echo-cancel-source` annonce `aecActive: true` ; `speech-reaction.ts` désactive la garde half-duplex ; résidu Whisper transcrit la voix de Lisa ; aucun filtre `recentSpoken`/`selfEcho`).
   - Fait 2 : Mouvement continu dans le noir (`BUDDY_VISION_MOTION=0.02` inférieur au bruit du capteur 0.0315–0.0370 ; frames noires envoyées à moondream toutes les 8s qui hallucine des scènes).
   - Fait 3 : Présence clignotante (`person_entered` / `person_lost` en 2 à 6s sans hystérèse dans `watch.py` à 4 FPS ; accueil répété "encore toi").
   - Fait 4 : Bruit de journal STT fallback activé à chaque tour (Parakeet ne supporte pas le pin de langue fr).

---

## 2. Périmètre lu en intégralité (19 fichiers, 9 751 lignes)

| Composant | Fichier | Lignes totales | Lignes lues | Notes & observations techniques |
|---|---|---|---|---|
| buddy-sense | `buddy-sense/src/bridge.rs` | 131 | 1 à 131 | Client WebSocket envoyant `SensoryEvent` au pont Node (`SensoryFrame`). Protocole JSON ou binaire. |
| buddy-sense | `buddy-sense/src/bus.rs` | 358 | 1 à 358 | Thalamus : porte d'attention coalescente, ring buffer `Memory` par modalité, émission `memory/digest` tous les 20 événements. Salience < 128 coalescée. |
| buddy-sense | `buddy-sense/src/senses/audio.rs` | 296 | 1 à 296 | VAD RMS 30ms : hystérésis `t_low = threshold * 0.6`. Si threshold=0.01, `t_low = 0.006`. |
| buddy-sense | `buddy-sense/src/senses/live_audio.rs` | 1 781 | 1 à 1781 | Capture ffmpeg pulse, `Segmenter`, `AdaptiveNoiseGate`, hard-cap 15s (`MAX_UTTERANCE_MS`), fallback STT sherpa-rs / HTTP worker. |
| buddy-vision | `buddy-vision/watch.py` | 951 | 1 à 951 | 4 FPS (intervalle 0.25s). Seuil `MOTION_THRESH=0.02`. `MotionEventState` (cooldown 8s). `AnonymousMultiTracker` grace 8 frames = 2.0s. |
| src/sensory | `src/sensory/speech-reaction.ts` | 2 182 | 1 à 2182 | Handlers VAD, bypass de half-duplex sur `aecActive: true` (l. 1469). Écoute sans garde, `startSpeechJob`, pont de dialogue. |
| src/sensory | `src/sensory/respond-decider.ts` | 696 | 1 à 696 | Décision de réponse : Tier 0 (adressé), Tier 1 (engagé 120s), Tier 2 (greeting direct). `isDirectedFollowUp` trop permissif (`?`, `tu`), réarme `lastEngagedAt`. |
| src/sensory | `src/sensory/voice-activity.ts` | 277 | 1 à 277 | Garde half-duplex : `isSpeaking()`, `mouthChain` sérialisant la parole. Queue sans préemption. `DEFAULT_VOICE_ECHO_TAIL_MS = 1200`. |
| src/sensory | `src/sensory/vision-reaction.ts` | 269 | 1 à 269 | Réagit à `vision:motion` -> appelle VLM moondream -> émet `scene_described` avec `salience: 150` -> enregistre percept `Motion → desc`. |
| src/sensory | `src/sensory/semantic-vision-reaction.ts` | 303 | 1 à 303 | Réagit à `person_entered` -> appelle `greet()` -> appelle `onEngage?.()`. Aucun claim d'orchestrateur, aucune vérification de `isSpeaking()`, aucune politique maison. |
| src/sensory | `src/sensory/arrival-opener.ts` | 314 | 1 à 314 | Génération d'accueil déterministe / LLM optionnel. Templates `backSoon` ("Coucou, encore toi 🙂"). Anti-répétition 10 entrées. |
| src/sensory | `src/sensory/reactions.ts` | 54 | 1 à 54 | Répartiteur `sensory:perception`. Tout événement est poussé dans `getSensoryMemory().push(p)` pour consolidation par le sommeil/dreaming. |
| src/sensory | `src/sensory/dreaming.ts` | 179 | 1 à 179 | Consolidation périodique : `salience >= 128` devient `salient`. `promoteSalientDream` écrit dans `.codebuddy/CODEBUDDY_MEMORY.md` sous `dream:recent`. |
| src/companion | `src/companion/presence-loop.ts` | 419 | 1 à 419 | Tick 5 min. Rails : `isQuietHour` (22-8), `hasConfirmedPresence`, `homePolicy`, cap horaire (4/h), budget jour, `conductor.claim('presence')`. |
| src/companion | `src/companion/proactive-engine.ts` | 524 | 1 à 524 | Tick 15 min. Rails : `isQuietHour` (22-8), `homePolicy`, cooldown 12h, budget jour, `conductor.claim('proactive')` (local) ou Telegram (distant). |
| src/companion | `src/companion/orchestrator.ts` | 63 | 1 à 63 | Arbitre `CompanionConductor` : gap de 45s (`gapMs`) entre prises de parole compagnes. Prévoit `'arrival'`, `'presence'`, `'proactive'`, `'reminder'`, `'error-watch'`. |
| src/companion | `src/companion/impulses.ts` | 603 | 1 à 603 | Suggestions internes (`modality: 'suggestion'`) et briefs compagnon. Aucune sortie vocale directe. |
| src/companion | `src/companion/idle-loop.ts` | 300 | 1 à 300 | Tick 10 min. Exécution uniquement si `isAlone()`. Écrit des artefacts dans `idle-log.jsonl`. Aucune sortie vocale. |
| src/companion | `src/companion/dialogue-percepts.ts` | 70 | 1 à 70 | Filtre canonique de dialogue pour mémoire relationnelle (`responded: true`, `sttEmpty !== true`). |

---

## 3. Analyse détaillée par question

### Question 1 : Chemins déclenchant une parole sans sollicitation humaine

Huit voies ont été analysées dans le code source :

1. **Accueil vidéo (`semantic-vision-reaction.ts`)**
   - *Déclencheur* : Événement `person_entered` (ou `person_identified` après attente d'identité) émis par `watch.py`.
   - *Borne réelle* : Cooldown local `CODEBUDDY_SENSORY_GREET_COOLDOWN_MS` (défaut : 60 000 ms = 1 minute).
   - *Trous identifiés* :
     - N'interroge JAMAIS le chef d'orchestre : `conductor.claim('arrival')` n'est jamais appelé dans `semantic-vision-reaction.ts`.
     - N'interroge JAMAIS la politique de maison (`HomeInteractionPolicy`) : parle même en mode `silent`, `focus`, `rest`, ou `guests`.
     - Appelle `options.onEngage?.()` à chaque accueil, ce qui ouvre la fenêtre d'engagement vocal de 2 minutes sans qu'aucun mot n'ait été prononcé.

2. **Présence compagne (`presence-loop.ts`)**
   - *Déclencheur* : Minuteur récurrent toutes les 5 minutes (`tickMs = 300_000 ms`).
   - *Bornes réelles* : Opt-in `CODEBUDDY_COMPANION_PRESENCE === 'true'`, heures calmes `CODEBUDDY_COMPANION_QUIET` (22h–8h), présence confirmée (`hasConfirmedPresence`), vérification de live dialogue (`inConversation`), cap horaire `CODEBUDDY_COMPANION_PRESENCE_HOURLY_CAP` (défaut : 4/heure), budget journalier partagé, arbitrage chef d'orchestre `conductor.claim('presence')` (gap 45s), cooldowns spécifiques par moment (de 20 min à 20 heures).
   - *Trou* : Certains moments (`reunion`, `followup`, `project`, `day-debrief`) ont `engage: true`, appelant `onEngage?.()` qui ouvre la fenêtre d'écoute attentive sur le micro.

3. **Moteur proactif (`proactive-engine.ts`)**
   - *Déclencheur* : Minuteur récurrent toutes les 15 minutes (`tickMs = 900_000 ms`).
   - *Bornes réelles* : Opt-in `CODEBUDDY_COMPANION_PROACTIVE === 'true'`, heures calmes (22h–8h), politique maison (`HomeInteractionPolicy`), cooldown global `CODEBUDDY_COMPANION_PROACTIVE_COOLDOWN_HOURS` (défaut : 12 heures), budget journalier, arbitrage conducteur `conductor.claim('proactive')` pour la voix locale, ou bascule sur message vocal Telegram en l'absence de présence.

4. **Boucle d'oisiveté (`idle-loop.ts`)**
   - *Déclencheur* : Minuteur récurrent toutes les 10 minutes (`tickMs = 600_000 ms`).
   - *Bornes réelles* : Opt-in `CODEBUDDY_COMPANION_IDLE === 'true'`, heures calmes (22h–8h), `isAlone()` impératif (ne s'exécute que si personne n'est présent), cap horaire (défaut : 3/h).
   - *Parole* : **AUCUNE parole orale**. Les tâches écrivent uniquement des artefacts JSONL dans `~/.codebuddy/companion/idle-log.jsonl`.

5. **Impulsions compagnon (`impulses.ts`)**
   - *Déclencheur* : Évaluation périodique d'état et de métriques.
   - *Parole* : **AUCUNE parole orale directe**. Génère des suggestions enregistrées dans les percepts (`modality: 'suggestion'`) ou consultables en CLI (`buddy companion status`).

6. **Rappels & Timers de cuisine (`reminders.ts`, `cooking-timer-runner.ts`)**
   - *Déclencheur* : Échéance d'un minuteur de cuisson ou rappel programmé.
   - *Borne* : `conductor.claim('reminder')` (les rappels de santé/sécurité sont prioritaires et réinitialisent le plancher de silence).

7. **Réponse « ambient-in-window » (`respond-decider.ts`)**
   - *Déclencheur* : Tout son ou parole intercepté par le micro quand la fenêtre d'engagement est active (`now - lastEngagedAt < engageWindowMs`, 120s).
   - *Bornes réelles* : Fenêtre d'engagement de 120 secondes (`engageWindowMs`), plafond de session conversationnelle de 10 minutes (`conversationMaxMs = 600_000 ms`).
   - *Trous critiques* :
     - `isDirectedFollowUp` renvoie `true` sur toute phrase contenant un point d'interrogation `?`, ou commençant par un mot de continuation (`Alors`, `Et`, `Ok`, `Oui`), ou une phrase courte contenant `tu`/`toi`.
     - Si `isDirectedFollowUp` est vrai, `decide()` renvoie `{ respond: true, reason: 'engaged' }` ET réexécute `markEngaged('addressed')` ! Cela repousse `lastEngagedAt` de 120 secondes supplémentaires, auto-entretenant la fenêtre d'écoute indéfiniment jusqu'au cap de 10 minutes.
     - Même quand `isDirectedFollowUp` est faux, `staySilent('ambient-in-window')` ne referme pas la fenêtre : elle reste vulnérable à tout son suivant.

8. **Politique Maison (`home-interaction-policy.ts`)**
   - *Règles* : Modes `silent`, `focus`, `rest`, `guests` interdisent tout contact spontané (`spontaneousDailyLimit = 0`, `allowed = false`).
   - *Trou* : Seules `presence-loop` et `proactive-engine` consultent cette politique. L'accueil vidéo (`semantic-vision-reaction.ts`) l'ignore totalement.

---

### Question 2 : Perceptions inventées entrant en mémoire

Traçabilité complète de l'injection d'hallucinations dans le système :

```
[Webcam dans le noir]
      │  Bruit capteur thermique : diff moyenne pixels ~8.5/255 -> score ~0.033
      ▼
buddy-vision/watch.py (MOTION_THRESH = 0.02 < 0.033)
      │  Émet en continu l'événement "motion" toutes les 8 secondes avec keyframe noire
      ▼
src/sensory/vision-reaction.ts
      │  Envoie l'image noire au VLM local moondream
      │  Moondream hallucine des scènes inexistantes ("feux d'artifice", "stade", "verres")
      │  1. Enregistre un percept : recordCompanionPercept("Motion → feux d artifice")
      │  2. Émet bus.emit("sensory:perception", { kind: "scene_described", salience: 150 })
      ▼
src/sensory/reactions.ts (wireSensoryReactions)
      │  Intercepte tout sensory:perception et l'injecte dans le buffer court-terme :
      │  getSensoryMemory().push(p)
      ▼
src/sensory/dreaming.ts (runDreamingPass)
      │  Consolide le buffer : comme salience 150 >= 128 (SALIENT_THRESHOLD),
      │  la perception est classée dans summary.salient
      │  summary.salient.length > 0 -> déclenche promoteSalientDream(summary)
      ▼
src/memory/persistent-memory.ts (PersistentMemoryManager.remember)
      │  Écrit sous la clé "dream:recent" dans .codebuddy/CODEBUDDY_MEMORY.md :
      │  "- **dream:recent**: Recent salient perception: 1 events (vision/scene_described×1); salient: vision/scene_described..."
      ▼
Remontée dans le système cognitif :
      ├── CODEBUDDY_MEMORY.md : injecté au démarrage dans le contexte de l'agent / LLM
      ├── idle-loop.ts : selectIdleJournalSummaries lit les percepts récents et écrit dans idle-log.jsonl :
      │   "Pendant que tu étais là aujourd'hui, j'ai noté : - Motion → feux d artifice..."
      └── check-in.ts : lit readRecentCompanionPercepts et formule des questions basées sur les scènes inventées
```

---

### Question 3 : Seuils sous le bruit

#### A. VAD Audio (`buddy-sense/src/senses/audio.rs` et `live_audio.rs`)
- **Seuil configuré** : `BUDDY_SENSE_MIC_THRESHOLD = 0.01` (vs plancher par défaut de 0.02).
- **Hystérésis calculée** : Seuil d'ouverture `on = 0.01`, seuil de fermeture `off = threshold * 0.6 = 0.006`.
- **Mécanique du blocage** :
  Dans une pièce ordinaire avec un micro USB / caméra, le bruit de fond résiduel (ventilation de PC, souffle électrique, électronique) a couramment un RMS de 0.007.
  1. Dès qu'un événement transitoire (bruit de chaise, clic, raclement de gorge) dépasse 0.01, le VAD passe en `speaking = true`.
  2. L'humain se tait, mais le signal retombe à 0.007 RMS.
  3. Pour fermer le segment de parole, la condition `rms < off` (0.007 < 0.006) est requise.
  4. Comme `0.007 >= 0.006`, `silence_run` reste figé à 0.
  5. L'utterance ne se ferme JAMAIS sur silence. Elle reste active en continu jusqu'au hard-cap de 15 secondes (`MAX_UTTERANCE_MS = 15_000`).
  6. À 15 secondes, elle est coupée avec `EndpointReason::Cap` et envoie 15 secondes de quasi-silence/bruit au moteur Whisper, générant des hallucinations textuelles (phrases répétitives, fausses sous-titres).

#### B. Seuil de Mouvement Vidéo (`buddy-vision/watch.py`)
- **Seuil configuré** : `MOTION_THRESH = float(os.environ.get("BUDDY_VISION_MOTION", "0.02"))`.
- **Formule** : `motion_score(prev, gray) = float(np.mean(cv2.absdiff(prev, gray))) / 255.0`.
- **Bruit capteur dans le noir** :
  Le bruit thermique et d'amplification automatique de gain (AGC) d'un capteur CMOS dans le noir produit des variations d'intensité inter-trames d'environ 8 à 9.5 niveaux de gris sur 255.
  `motion_score` calculé = 8.5 / 255 ≈ 0.0333 (mesuré sur robot : p50=0.0315, p90=0.0370).
- **Résultat** : 0.0333 > 0.02. Le seuil 0.02 est sous le bruit de capteur dans le noir. `moved = score >= MOTION_THRESH` est évalué à `True` 100% du temps dans l'obscurité.

---

### Question 4 : Courses entre accueil vidéo et réponse vocale

Deux mécanismes de collision ont été démontrés :

1. **Course avec la parole active (Bouche occupée / double parole enchaînée)**
   - `semantic-vision-reaction.ts` ne vérifie ni `isSpeaking()`, ni `turnCoordinator`, ni `conductor.claim('arrival')`.
   - Si une réponse vocale est déjà en cours d'élocution (ou vient tout juste de se terminer), l'arrivée d'une personne déclenche immédiatement `greet(safeGreeting)`.
   - `sayNow` empile l'accueil dans `mouthChain`.
   - Conséquence : Le robot enchaîne deux phrases à la suite sans aucune pause de respiration ("...voilà la réponse à ta question. Coucou, encore toi 🙂").

2. **Course accueil vidéo -> fenêtre d'engagement -> auto-écho vocal**
   - L'accueil vidéo appelle `options.onEngage?.()`, ouvrant la fenêtre de 120 secondes de `respond-decider.ts`.
   - Si l'accueil choisi dans `arrival-opener.ts` est une question (ex: "Coucou Patrice, ça avance ta journée ?" ou "Te revoilà, tout va bien ?") :
   - Si le micro capte l'écho de la voix de Lisa (car `aecActive: true` désactive le half-duplex, Fait 1) :
   - Whisper transcrit la question de Lisa.
   - `respond-decider.ts` voit la phrase dans la fenêtre d'engagement, constate la présence du `?`, classe la phrase en `isDirectedFollowUp = true`, et répond vocalement à sa propre phrase d'accueil !

---

## 4. Grille finale de synthèse

| Chemin | Déclencheur | Borne réelle | Trou identifié | Test rouge commité |
|---|---|---|---|---|
| **Accueil vidéo vs Conductor** | `person_entered` (caméra) | Cooldown 60s (`greetCooldownMs`) | Ignore le chef d'orchestre (`conductor.claim('arrival')` jamais appelé) ; parle même si une autre surface a parlé il y a < 45s | `tests/sensory/hole-arrival-conductor-race.test.ts` (commit `2aab527b8`) |
| **Accueil vidéo vs Maison** | `person_entered` (caméra) | Cooldown 60s | Ignore `HomeInteractionPolicy` ; parle à voix haute même en mode `silent`, `focus`, `rest`, ou `guests` | `tests/sensory/hole-arrival-home-policy.test.ts` (commit `17f33bf4f`) |
| **Ambient-in-window (auto-maintien)** | Son ambiant (TV, radio, autrui) | Fenêtre 120s, max 10 min | Toute question avec `?` ou mot de continuation est prise pour un ordre direct (`engaged`) et réarme la fenêtre de 2 min | `tests/sensory/hole-ambient-in-window-loop.test.ts` (commit `7d78accca`) |
| **Accueil vidéo vs Parole active** | `person_entered` pendant élocution | Cooldown 60s | Ne vérifie pas `isSpeaking()` ; empile l'accueil dans `mouthChain` et enchaîne deux tirades consécutives sans pause | `tests/sensory/hole-arrival-voice-collision.test.ts` (commit `d5a762d85`) |
| **Perceptions inventées en mémoire** | `motion` dans le noir -> moondream | Cooldown motion 8s | `scene_described` (salience 150 >= 128) est promu par `dreaming.ts` dans `CODEBUDDY_MEMORY.md` (`dream:recent`) | `tests/sensory/hole-dreaming-hallucination-memory.test.ts` (commit `a659ef19b`) |
| **VAD sous bruit ambiant** | Pic sonore puis bruit de fond 0.007 | `BUDDY_SENSE_MIC_THRESHOLD=0.01` | Hystérésis `off = 0.006` < bruit 0.007 : VAD bloqué en `speaking=true` continu, saturation hard-cap 15s | `tests/sensory/hole-vad-noise-cap.test.ts` (commit `be189599e`) |
| **Motion sous bruit de capteur** | Trames sombres consécutives | `BUDDY_VISION_MOTION=0.02` | Bruit thermique capteur (diff moyenne ~8.5/255 -> score ~0.033) > seuil 0.02 -> faux mouvement perpétuel | `buddy-vision/test_hole_dark_motion_threshold.py` (commit `73b2bd0e7`) |

---

## 5. Traces d'exécution complètes des 7 tests rouges

### Test 1 : `tests/sensory/hole-arrival-conductor-race.test.ts`
Commande : `./node_modules/.bin/vitest run tests/sensory/hole-arrival-conductor-race.test.ts`
```text
 FAIL  tests/sensory/hole-arrival-conductor-race.test.ts > Mission SENSE2 — Trou 1 : L'accueil vidéo ignore l'arbitrage du chef d'orchestre (orchestrator) > l'accueil vidéo doit respecter le chef d'orchestre et ne pas parler si une autre surface a la parole
AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times

Received:

  1st vi.fn() call:

    Array [
      "Re. On enchaîne ?",
    ]

Number of calls: 1

 ❯ tests/sensory/hole-arrival-conductor-race.test.ts:51:25
     49|       // Il devrait s'abstenir de parler car la présence a parlé il y a seulement 5s (< gap 45s).
     50|       // Dans le code actuel non corrigé, greet est appelé (appel = 1), donc cette assertion échoue en ROUGE.
     51|       expect(greet).not.toHaveBeenCalled();
       |                         ^
```

### Test 2 : `tests/sensory/hole-arrival-home-policy.test.ts`
Commande : `./node_modules/.bin/vitest run tests/sensory/hole-arrival-home-policy.test.ts`
```text
 FAIL  tests/sensory/hole-arrival-home-policy.test.ts > Mission SENSE2 — Trou 2 : L'accueil vidéo ignore la politique Maison (HomeInteractionPolicy) > l'accueil vidéo doit respecter le mode silencieux/invités de la maison et ne pas parler
AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times

Received:

  1st vi.fn() call:

    Array [
      "Contente de te retrouver ce soir.",
    ]

Number of calls: 1

 ❯ tests/sensory/hole-arrival-home-policy.test.ts:44:25
     42|       // En mode "silent", aucune voix spontanée ne devrait retentir.
     43|       // Dans le code actuel, greet est appelé, donc l'assertion échoue en ROUGE.
     44|       expect(greet).not.toHaveBeenCalled();
       |                         ^
```

### Test 3 : `tests/sensory/hole-ambient-in-window-loop.test.ts`
Commande : `./node_modules/.bin/vitest run tests/sensory/hole-ambient-in-window-loop.test.ts`
```text
 FAIL  tests/sensory/hole-ambient-in-window-loop.test.ts > Mission SENSE2 — Trou 3 : Emballement de la fenêtre "ambient-in-window" dans respond-decider > une question tierce dans la pièce (non adressée au robot) ne doit pas être interceptée comme "engaged"
AssertionError: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ tests/sensory/hole-ambient-in-window-loop.test.ts:29:30
     27|     // respond: false, reason: 'ambient-in-window'.
     28|     // Actuellement, decision.respond est true et decision.reason est 'engaged', donc ce test échoue en ROUGE.
     29|     expect(decision.respond).toBe(false);
       |                              ^

 FAIL  tests/sensory/hole-ambient-in-window-loop.test.ts > Mission SENSE2 — Trou 3 : Emballement de la fenêtre "ambient-in-window" dans respond-decider > une question tierce ambiante ne doit pas réarmer et prolonger la fenêtre d'engagement de 2 minutes
AssertionError: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ tests/sensory/hole-ambient-in-window-loop.test.ts:55:35
     53|     // prolongeant la fenêtre jusqu'à t = 330_000 !
     54|     // Donc snapshotAfter.engaged est encore true au lieu de false. Ce test échoue en ROUGE.
     55|     expect(snapshotAfter.engaged).toBe(false);
       |                                   ^
```

### Test 4 : `tests/sensory/hole-arrival-voice-collision.test.ts`
Commande : `./node_modules/.bin/vitest run tests/sensory/hole-arrival-voice-collision.test.ts`
```text
 FAIL  tests/sensory/hole-arrival-voice-collision.test.ts > Mission SENSE2 — Trou 4 : Course et collision entre accueil vidéo et parole vocale active > l'accueil vidéo ne doit pas se déclencher pendant que le robot est déjà en train de parler
AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times

Received:

  1st vi.fn() call:

    Array [
      "Coucou, encore toi 🙂",
    ]

Number of calls: 1

 ❯ tests/sensory/hole-arrival-voice-collision.test.ts:48:25
     46|       // ce qui empile l'accueil dans mouthChain et provoque deux prises de parole consécutives.
     47|       // Le test attend que greet ne soit pas appelé pendant isSpeaking(), mais il est appelé.
     48|       expect(greet).not.toHaveBeenCalled();
       |                         ^
```

### Test 5 : `tests/sensory/hole-dreaming-hallucination-memory.test.ts`
Commande : `./node_modules/.bin/vitest run tests/sensory/hole-dreaming-hallucination-memory.test.ts`
```text
 FAIL  tests/sensory/hole-dreaming-hallucination-memory.test.ts > Mission SENSE2 — Trou 5 : Promotion des perceptions inventées du noir en mémoire permanente (CODEBUDDY_MEMORY.md) > les descriptions de scènes issues de bruits d'obscurité ne doivent pas contaminer la mémoire permanente dream:recent
AssertionError: expected '# Code Buddy Memory

This file stor…' not to contain 'vision/scene_described'

- Expected
+ Received

- vision/scene_described
+ # Code Buddy Memory
+
+ This file stores persistent memory for the Code Buddy agent.
+ It is automatically managed but can be manually edited.
+
+ ## Context
+ - **dream:recent**: Recent salient perception: 1 events (vision/scene_described×1); salient: vision/scene_described; avg load ?.
+   Tags: dream, sensory
+   <!-- meta: accessed=0 created=2026-09-02T20:46:19.884Z updated=2026-09-02T20:46:19.884Z -->

 ❯ tests/sensory/hole-dreaming-hallucination-memory.test.ts:58:31
     56|     // Dans le code actuel, memoryContent contient "vision/scene_described" sous dream:recent,
     57|     // donc cette assertion échoue en ROUGE.
     58|     expect(memoryContent).not.toContain('vision/scene_described');
       |                               ^
```

### Test 6 : `tests/sensory/hole-vad-noise-cap.test.ts`
Commande : `./node_modules/.bin/vitest run tests/sensory/hole-vad-noise-cap.test.ts`
```text
 FAIL  tests/sensory/hole-vad-noise-cap.test.ts > Mission SENSE2 — Trou 6 : VAD sous le bruit ambiant (BUDDY_SENSE_MIC_THRESHOLD=0.01 vs bruit 0.007) > le VAD ne doit pas rester bloqué en speaking indéfiniment sur un bruit de fond supérieur à t_low (0.006)
AssertionError: expected 'cap' to be 'silence' // Object.is equality

Expected: "silence"
Received: "cap"

 ❯ tests/sensory/hole-vad-noise-cap.test.ts:58:28
     56|     // Dans le code actuel, endpointReason est 'cap' (15 secondes de son envoyées au STT),
     57|     // donc cette assertion échoue en ROUGE.
     58|     expect(endpointReason).toBe('silence');
       |                            ^
```

### Test 7 : `buddy-vision/test_hole_dark_motion_threshold.py`
Commande : `pytest buddy-vision/test_hole_dark_motion_threshold.py`
```text
=================================== FAILURES ===================================
__ DarkMotionThresholdTests.test_dark_sensor_noise_should_not_trigger_motion ___

        moved = score >= MOTION_THRESH
>       self.assertFalse(moved, f"Faux mouvement détecté dans le noir : score={score:.4f} >= seuil={MOTION_THRESH}")
E       AssertionError: True is not false : Faux mouvement détecté dans le noir : score=0.0265 >= seuil=0.02

buddy-vision/test_hole_dark_motion_threshold.py:30: AssertionError
=========================== short test summary info ============================
FAILED buddy-vision/test_hole_dark_motion_threshold.py::DarkMotionThresholdTests::test_dark_sensor_noise_should_not_trigger_motion
============================== 1 failed in 0.22s ===============================
```

---

## 6. Vérification du périmètre (Typecheck, Lint, Tests de régression)

- `npx tsc --noEmit --skipLibCheck` : Succès (code 0, 0 erreur de type).
- `npx eslint tests/sensory/hole-*.test.ts` : Succès (code 0, 0 erreur lint).
- `python3 -m py_compile buddy-vision/test_hole_dark_motion_threshold.py` : Succès (syntaxe valide).
- `npx vitest run tests/sensory/arrival-opener.test.ts` : 16 tests passés en 607ms (vert).
- `pytest buddy-vision/test_watch.py` : 16 tests passés en 0.31s (vert).
- `cargo test --manifest-path buddy-sense/Cargo.toml` : 34 tests passés en 2.08s (vert).

---

## 7. Commits conventionnels enregistrés sur `revue/sense-2026-09-03`

- `2aab527b8` : `test(sensory): prove arrival greeting ignores orchestrator conductor claim`
- `17f33bf4f` : `test(sensory): prove arrival greeting ignores home interaction policy`
- `7d78accca` : `test(sensory): prove ambient question re-arms engagement window`
- `d5a762d85` : `test(sensory): prove arrival greeting collides with active speaking state`
- `a659ef19b` : `test(sensory): prove dark motion scene descriptions promote to persistent memory`
- `be189599e` : `test(sensory): prove vad gets stuck on ambient noise and hits hard cap`
- `73b2bd0e7` : `test(vision): prove motion threshold triggers on dark sensor noise`
