# Étude — Convergences MySoulmate ↔ mode vocal Code Buddy (2026-07-21)

**Intuition Patrice** : le mode vocal de l'assistant et MySoulmate sont deux
faces du même système (Lisa qui parle). Audit read-only des deux territoires.
Périmètre : couche compagnon/vocale non explicite uniquement ; le volet NSFW de
MySoulmate reste hors de ce lot.

## Constat central : la voix a l'information pour être vivante, elle ne l'utilise pas

La couche relationnelle de Code Buddy possède déjà : émotion (`reply-augment.detectEmotion`),
humeur (`relationship-state.moodBand`), rapport, mémoire de dialogue (`episode:recent` avec
commitments/openLoops/corrections) et vie intérieure. Avant ce lot, la voix restait plate pour
trois raisons mécaniques, réparables sans réécriture du moteur.

## Convergences retenues

### Émotion et humeur vers la prosodie

`deriveVoiceDeliveryProfile()` ne calculait le débit et les pauses que depuis le WPM du dernier
tour humain. Le port ajoute une modulation bornée : tristesse/fatigue ralentissent, joie accélère
légèrement et frustration installe des pauses réfléchies. Le profil humain reste toujours la base.

### Contexte relationnel explicitement opt-in

Les faits, épisodes et bandes d'humeur restent derrière
`CODEBUDDY_COMPANION_RELATIONAL=true`. Sans ce réglage, le comportement vocal nu reste inchangé.

### Dérive d'humeur partagée

Le chemin hybride faisait déjà évoluer les traits relationnels. Un helper commun couvre désormais
le chemin vocal direct et un marqueur interne empêche une double application quand l'hybride appelle
la boucle vocale.

### Journal épisodique vers des rappels bornés

La voix peut proposer occasionnellement un rappel fondé exclusivement sur une boucle ouverte, un
engagement ou le dernier point utilisateur déjà consolidé. Le rappel est nettoyé, limité à 240
caractères, dédupliqué par hash et espacé de deux heures par défaut.

## Hors lot

- Détection émotionnelle acoustique et nouveaux sidecars STT.
- Moteur TTS, gain PCM, lissage audio et voix ElevenLabs.
- Avatar, selfie, LoRA et pipeline vidéo.
- Toute modification des garde-fous relationnels de `main`.
