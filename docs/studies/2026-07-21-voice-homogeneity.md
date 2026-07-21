# Étude — Homogénéité de la voix de l'assistant (2026-07-21)

**Symptôme (Patrice)** : « la voix n'est pas homogène ». Audit code complet +
recherche SOTA. Causes identifiées, classées, toutes localisées.

## Causes (audit, fichier:ligne)

1. **Gain recalculé par clause sur 100 ms de tête** (`voice-loop.ts:2088` :
   une `Pcm16WavStreamGain` NEUVE par segment ; `tts-volume.ts:341` : mesure
   `STREAM_HEAD_MS=100`) → sauts de volume entre clauses. Cause n°1.
2. **Synthèse indépendante par clause, coupée même sur les virgules**
   (`voice-stream.ts:130-147` : coupe sur `,;:` dès 24 chars) → prosodie qui
   « repart à zéro » en milieu de phrase (Pocket : état continu PAR requête
   seulement ; Piper : stochastique par appel — noise_scale/noise_w). Cause n°2.
3. **Trois lois de gain selon le chemin** : flux = RMS 100 ms ; sayNow/
   Telegram/cache/fallback = RMS clip entier (`tts-volume.ts:229` vs `:341`),
   et `defaultPlay` RE-normalise (`voice-loop.ts:2213`).
4. **Bascule stream→WAV en cours de tour** (`voice-stream.ts:429-461`) =
   changement de loi de gain au milieu d'une réponse.
5. Préfixe/backchannel servi du cache avec un traitement différent du corps.
6. Limiteur tanh appliqué seulement si gain > 1 (`tts-volume.ts:132`).
7. Concaténations brutes sans trim/fade aux frontières (clics).

## Parades (recherche, sourcées)

- **Un gain par ÉNONCÉ** : tête de mesure 300-500 ms, gain gelé pour le tour,
  mesure pseudo-gatée (ignorer le quasi-silence) — principe EBU R128.
- **Découpage à la PHRASE** (pratique RealtimeTTS) : fragment court uniquement
  pour la latence de la première réponse ; ensuite phrases entières, jamais de
  coupe sur virgule.
- **Frontières propres** : trim silences tête/queue, fade 5 ms in/out, silence
  inter-phrases FIXE injecté par le pipeline (0,25-0,35 s).
- **Une seule chaîne pour tous les chemins** : même cible, même normalisation ;
  Telegram : `loudnorm I=-16:TP=-1.5` avant l'Opus.
- **Prétraitement texte unique** (ni Piper ni Pocket n'ont de SSML) : nombres/
  heures/sigles/emojis → français canonique dans le sanitizer, TOUS chemins.
- **Moteur** : Pocket `french_24l` confirmé meilleur choix local FR (état
  continu par requête, MIT, ~1,3× TR mesuré ; pocket-tts ≥2.1 + `--quantize`
  = +30 %). Piper FR plafonne à « medium » (aucune voix high n'existe) et
  rhasspy/piper est archivé (successeur : OHF-Voice/piper1-gpl). Kokoro écarté
  (FR grade B−). Veille : Supertonic 3 (ONNX, 31 langues, très rapide CPU).

## Décisions d'implémentation (vague sol)

1. Gain unique par tour (instance partagée, tête 400 ms, gating, gel).
2. Découpage : 1er fragment rapide conservé, ensuite phrases entières
   (plus de coupe `,;:` après le premier segment).
3. Trim + fades 5 ms + silence inter-phrases fixe pipeline.
4. Loi unique inter-chemins ; suppression de la double normalisation de
   `defaultPlay` ; fallback WAV réutilise le gain du tour ; Telegram loudnorm.
5. Limiteur symétrique. 6. Sanitizer étendu (nombres/heures/sigles FR).
7. Déploiement robot : maj pocket-tts + `--quantize`, rebuild dist, restart.
