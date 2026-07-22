# Étude — Voix compagnon « vivante » : état de l'art 2026 (2026-07-21)

Complément de l'audit convergence. Leçon Sesame : **le TTS brut est résolu ;
la présence vient de la prosodie CONTEXTUELLE** (sans contexte leur voix =
humaine en CMOS ; avec contexte l'humain gagne encore). Notre trou n°1 exactement.

## Ingrédients de la présence (par impact)

1. **Prosodie contextuelle** (le ton dépend de ce qui vient d'être dit) — le
   vrai front de l'uncanny valley.
2. **Turn-taking** : ne pas couper les pauses de réflexion, réagir vite à la
   vraie fin de tour (VAD seul se trompe). Latence cible modulaire < 500-800 ms.
3. **Adaptation émotionnelle** : émotion utilisateur MESURÉE (pas devinée du
   texte) → modulation différenciée (Hume : excuse ≠ sympathie ≠ enthousiasme).
4. **Imperfections** bien placées (interjections, pauses, rires).
5. **Full-duplex** (backchannels pendant que l'user parle) — Moshi, hors CPU.
6. **Callbacks mémoriels** + disponibilité + effet miroir (Replika/Nature).

## Faisabilité locale (Ministar CPU AMD)

| Brique | Option | CPU ? |
|---|---|---|
| End-of-turn sémantique | **smart-turn** (Pipecat, 8M/8 Mo int8, BSD-2, FR) | OUI trivial |
| SER émotion user | **emotion2vec+ base** (~90M, MIT, FR) — PAS audeering (CC-BY-NC) | OUI (fenêtre 2-3 s) |
| Backchannels | heuristique VAD + « mmh » pré-synthétisé ; VAP (MIT) en v2 | OUI heuristique |
| TTS émotionnel | Orpheus 3B / Chatterbox 500M — trop lourds CPU temps réel | LOURD |
| Notre TTS Pocket | levier = TEXTE + choix de voix (pas de tags/silences) | OUI (déjà là) |
| Full-duplex Moshi | 7B, Unmute exige 16 Go VRAM | NON (veille) |
| Prosodie CSM | aucun open < 1B CPU | NON (approximer par texte) |

## Le texte = notre canal de contrôle (Pocket autorégressif)

- Ponctuation module la prosodie (virgules = micro-pauses, ? montée, ! énergie,
  … suspension) — documenté Parler-TTS, vaut pour toute la famille autorégressive.
- Longueur de phrase = rythme ; interjections écrites (« Ah ! », « Hmm. ») =
  substitut $0 des tags Orpheus.
- **Multi-presets Pocket** : même voix Lisa clonée en 3-4 états (neutre/enjouée/
  douce/complice), routés par émotion cible = proxy d'émotion réel.
- Mapping émotion→consigne d'écriture dans le prompt du reply (le Hume version
  texte).

## Plan priorisé (aligné sur les convergences)

**Quick wins ($0, jours)** — c'est la phase 2A :
1. Prosodie par le texte dans le prompt vocal (interjections, ponctuation
   expressive, phrases courtes) + garde-fou sanitizer.
2. Émotion/humeur → `deriveVoiceDeliveryProfile` (le trou n°1 de l'audit
   convergence : pace/wpm/pauses modulés par emotion+moodBand).
3. Callbacks vocaux depuis `episodic-journal` (ouverture « au fait, hier… »,
   fréquence contrôlée) + activer proprement le contexte relationnel sur la voix.

**SER léger (1-2 sem)** : 4. emotion2vec+ en sidecar sur la fenêtre STT →
émotion mesurée injectée dans relational-context (remplace la détection
texte-seul par un vrai signal acoustique).

**Turn-taking (2-3 sem, gros gain perçu)** : 5. smart-turn int8 entre VAD et
déclenchement (ne coupe plus les pauses, répond plus vite) ; 6. backchannels v1
heuristiques (« mmh » pré-synthétisé via le canal duplex du barge-in AEC).

**Veille** : full-duplex Moshi (non CPU), Orpheus 150/400M à surveiller.

## Implémenté phase 2A (2026-07-22)

- L’entrainment humain reste la base du profil vocal ; émotion utilisateur et bande d’humeur
  relationnelle modulent désormais débit, WPM borné et style de pauses quand
  `CODEBUDDY_COMPANION_RELATIONAL=true`.
- La consigne de prosodie par le texte (ponctuation respirée, ellipse, interjections naturelles,
  phrases courtes) est activable avec `CODEBUDDY_VOICE_EXPRESSIVE_TEXT`. Sans valeur explicite,
  elle suit le gate relationnel ; le défaut nu reste inchangé. Le sanitizer préserve `…` et les
  interjections destinées à Pocket TTS.
- Les rappels vocaux occasionnels proviennent exclusivement de `episode:recent` (boucles ouvertes,
  engagements ou dernier point utilisateur), avec hash de déduplication et une fenêtre par défaut
  de deux heures (`CODEBUDDY_VOICE_CALLBACK_GAP_MS`).
- La dérive d’humeur utilise un helper partagé dans les chemins hybride et vocal par défaut, sans
  double application quand l’un enveloppe l’autre.

## Note de périmètre
Toutes ces améliorations sont non-explicites (présence émotionnelle, mémoire,
turn-taking). Le volet NSFW de MySoulmate reste hors périmètre.

## Addendum — page kyutai.org/tts (lien Patrice, 21/07)
- **Kyutai TTS 1.6B a des voix émotionnelles nommées** (Calming, Angry, Sad,
  Confused, Desire, Fearful, Whisper, Sarcastic, Narration…) — Kyutai fait donc
  l'émotion par des VOIX distinctes, PAS par des tags. Confirme notre stratégie
  phase 2 (multi-presets Pocket routés par émotion). ⚠️ le 1.6B est GPU (serveur
  Rust/candle) → probablement pas temps réel sur Ministar CPU ; à valider.
- **Pocket TTS actif** : italien ajouté 04/2026, voix FR supplémentaires (Estelle
  + CML 1406/2154/4724). Mettre à jour pocket-tts (≥2.1 + --quantize) sur le robot.
- Voix : huggingface.co/kyutai/tts-voices. Démo : unmute.sh.

## Addendum — carte des intégrations Kyutai dans code-buddy (21/07)
**Câblé actif** : Pocket TTS 100M (moteur TTS défaut, serveur résident + streaming
24 kHz, voix estelle FR) — `pocket-tts.ts` + `local-tts.ts`. **STT = Parakeet
NVIDIA via sherpa-onnx (PAS Kyutai)** — `buddy-sense/stt.rs`, `speech-reaction.ts`.
**Câblé mais OFF par défaut** : KyutaiBridge Cowork → moshi-server STT+TTS
(`cowork/.../kyutai-bridge.ts`, gated `COWORK_*_PROVIDER=kyutai`) — séquentiel,
PAS full-duplex, exige serveur externe.
**Absents (leviers phase 2)** : Moshi full-duplex (~200 ms barge-in natif, GPU),
Kyutai TTS 1.6B émotionnel (meilleures voix + variantes Calming/Sad/Whisper — notre
voix plafonne au Pocket 100M ; le KyutaiBridge TTS pointe DÉJÀ vers moshi-server
/api/tts_streaming, il suffirait de servir le 1.6B), Unmute pipeline, Mimi, Helium,
Hibiki, MoshiVis (pertinent vu buddy-vision).
**Décision phase 2** : soit pousser Pocket CPU avec multi-presets émotionnels
(local, $0), soit monter au TTS 1.6B/Moshi si GPU accepté (Ministar CPU = non
temps réel pour le 1.6B/Moshi). Le KyutaiBridge est le point d'accroche existant.
