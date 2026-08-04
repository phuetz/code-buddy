# Étude — Convergences MySoulmate ↔ mode vocal Code Buddy (2026-07-21)

**Intuition Patrice** : le mode vocal de l'assistant et MySoulmate sont deux
faces du même système (Lisa qui parle). Audit read-only des deux territoires.
Périmètre : couche compagnon/vocale NON-explicite uniquement (le volet NSFW de
MySoulmate est hors de mon périmètre — je travaille les chemins safe/sensual
couvert). Le tier `explicit` reste fermé.

## Constat central : la voix a l'info pour être vivante, elle ne l'utilise pas

La couche relationnelle de code-buddy possède DÉJÀ : émotion (`reply-augment.
detectEmotion`, 10 émotions + intensité + confidence), humeur (`relationship-
state.moodBand`), rapport (`rapportTier`), mémoire de dialogue (`episode:recent`
avec commitments/openLoops/corrections), vie intérieure (`inner-life`). La voix
reste « plate » pour 3 raisons mécaniques, toutes réparables sans réécriture.

## Convergences inexploitées (par impact)

### 🔴 Impact 1 — Émotion/humeur ne touchent jamais la prosodie
`deriveVoiceDeliveryProfile()` (`voice-entrainment.ts:78,98-104`) ne calcule
pace/targetWpm que depuis le WPM du dernier tour humain — AUCUN paramètre
emotion ni mood. L'émotion sert seulement de guidance texte (`voice-loop.ts:
1467`). Contraste : MySoulmate `VoiceCallManager.js:95-109` transmet déjà
`emotion` au TTS. Fix « wire, don't rewrite » : `emotionGuidance` + `moodBand`
→ moduler pace/targetWpm/pauseStyle (tristesse/fatigue → lent + WPM↓ ; joie →
vif ; frustration → posé) puis répercuter dans `voiceRendererDeliveryInstruction`.

### 🔴 Impact 2 — Contexte relationnel OFF par défaut sur la voix
Tout `relational-context` (facts + episode + <lisa_state> + inner-life) gaté
derrière `CODEBUDDY_COMPANION_RELATIONAL` défaut OFF (`voice-loop.ts:1478`,
`relational-context.ts:291`). Sans le flag : pas de callbacks mémoriels, pas
d'humeur dans le choix des mots.

### 🟠 Impact 3 — Dérive d'humeur seulement dans le chemin hybride
`evolveTraits(detectRelationalSignal(heard))` câblé seulement dans
`hybrid-reply.ts:661-665`, absent de `voice-loop.ts:1570 defaultReply` → Lisa
« ressent » selon le chemin.

### 🟠 Impact 4 — Journal épisodique ne nourrit ni rappels ni follow-ups
`episode:recent` (commitments/openLoops) lu seulement par relational-context +
arrival-opener ; `reminders.ts`/`event-followups.ts` n'y touchent pas (zéro
match) — or c'est la matière d'un « au fait, tu devais… » vocal.

### 🟠 Impact 5 — Proactive-engine en silo
`wireProactiveLoop` ne partage ni émotion ni episode avec le reply ; son
trigger `encouragement` (recentFrustration booléen) duplique `detectEmotion`.

### 🟡 Impact 6 — `immediateEmotionAcknowledgement` sous-exploité
`reply-augment.ts:66-72,264` (accusés instantanés par émotion, parfaits pour
parler pendant que le modèle réfléchit) absent du flux voice-loop principal.

## Duplications à unifier

1. Deux détecteurs d'émotion (MySoulmate EmotionDetector.js vs reply-augment) —
   code-buddy plus avancé = source unique, enrichie des poids emoji MySoulmate.
2. Deux modèles personnalité/mood (8 traits vs 4) — garder distincts (inner-life
   « digitalement honnête »), aligner le vocabulaire de traits.
3. Deux moteurs proactifs — port assumé ; réutiliser les templates FR MySoulmate.
4. Persona Lisa redéfinie à plusieurs endroits (`assistant-config.ts:195` vs
   `companion-voice-character.ts:21-29`) → une seule bible.
5. Assets Lisa dupliqués (banque images + WAV FR-FR + LoRA versionnée MySoulmate
   vs `lisa-selfie.ts` catalogue local) → source unique.

## Gisement MySoulmate réutilisable (non-explicite)
WAV voix Lisa FR-FR déjà générés, LoRA/bible d'identité versionnée, templates
proactifs FR, mapping emotion→TTS éprouvé (`VoiceCallManager.js`), méthodo
character-first (`docs/companion-character-methodology.md`).

## Suite
Phase 2 du chantier vocal (après l'homogénéité, vague sol en cours) : câbler
émotion/humeur → prosodie, activer proprement le contexte relationnel sur la
voix, brancher le journal aux rappels. Brief après l'étude SOTA « voix vivante ».
