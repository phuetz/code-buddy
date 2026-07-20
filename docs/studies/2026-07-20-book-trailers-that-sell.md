# Étude — Bandes-annonces de livres qui vendent (2026-07-20)

**Contexte** : commercialisation prochaine des livres de Patrice (`~/DEV/livres`,
tech-narratif : agents LLM, IA en entreprise), marché FR + EN. Étude web sourcée
menée dans le cadre du plan « très haute qualité ».

## Conclusions clés

1. **Un trailer ne vend presque jamais seul.** Seule donnée chiffrée existante
   (enquête 2012, 104 rép.) : 15,5 % d'achats directs attribués, 45,2 %
   d'influence partielle quand l'acheteur hésitait déjà. Le signal fort et
   récent est indirect : BookTok (~20 M de livres vendus en 2021) et les pubs
   vidéo Meta mesurées. Verdict : le trailer est une **créa publicitaire
   réutilisable et un outil de crédibilisation**, pas un canal de vente.
2. **Amazon est fermé à la vidéo auteur en 2026** : plus d'upload Author
   Central (~nov. 2023), pas de vidéo dans le A+ Content KDP. Le trailer vit sur
   les canaux de l'auteur et pousse vers Amazon.
3. **Pour un livre tech/business FR : LinkedIn + YouTube > BookTok** (BookTok FR
   dominé par la romance).
4. **Structure gagnante (non-fiction narrative)** : ouvrir comme une fiction,
   fermer comme un essai. 60 s en 16:9 : hook 0–3 s → scène/tension 3–20 s →
   promesse 20–40 s → crédibilité (1 blurb/fait) 40–50 s → cover + UN SEUL CTA
   50–60 s. Cut 20–25 s en 9:16 : hook + 1 beat + CTA.
5. **Production IA** : viable si l'IA reste sur l'**atmosphérique** (datacenters,
   écrans, réseaux, silhouettes) — **pas de visages humains réalistes en gros
   plan** (uncanny valley = « un plan off contamine la perception du livre »).
   Jamais de texte généré dans l'image : typographie en post-prod, calques
   séparés par langue.
6. **La voix est le point de non-négociation** : un TTS plat (type Piper brut)
   est perçu comme signal de « AI slop ». VF native soignée (la France est une
   culture de doublage) ; EN re-voicé seulement si le marché EN montre de la
   traction (démarrer EN sous-titré pour tester).
7. **Localisation** : un master visuel unique sans texte incrusté, décliné en
   versions natives par langue (`Trailer_FR_v1`, `Trailer_EN_v1`).
8. **Mesure ou rien** : un lien **Amazon Attribution** distinct par placement et
   par créa (gratuit via console KDP, fenêtre 14 j, montre les ventes), UTM vers
   la page de lancement, complétion vidéo > 50 % = hook validé, ~5 % de
   conversion sur trafic Meta = bon.

## Livrables cibles du pilote

| Livrable | Format | Durée | Canal | Mesure |
|---|---|---|---|---|
| Master FR 16:9 | 1920×1080 | 60 s | YouTube, site, newsletter, LinkedIn | Attribution `yt-fr`, `nl-fr`, `li-fr` |
| Cut FR 9:16 | 1080×1920 | 20–25 s | Reels, TikTok, Shorts | `sv-fr` |
| Master EN 16:9 | 1920×1080 | 60 s | YouTube EN, LinkedIn EN | `yt-en` |
| Cut EN 9:16 | 1080×1920 | 20–25 s | Shorts/Reels EN | `sv-en` |
| Créa pub | 9:16 + 1:1 | 15 s | Meta Ads (test 20–50 €) | 1 lien Attribution par créa |

## Exemples de référence étudiés

*Born a Crime* (Trevor Noah — le plus proche du cas : non-fiction narrative,
pitch auteur 30 s), *The Road to Character* (David Brooks), *Miss Peregrine's*
(Quirk Books), *Fall in Love with the Problem* (Uri Levine — trailer comme
invitation à une communauté), *The Scattering* (30 s suspense), *Suddenly Rural
Girl* (100 % IA + voix humaine pro = la réussite indé citée).

## Les 10 règles du pilote

1. Jamais publier sans plan de diffusion (pub Meta + LinkedIn + newsletter).
2. Hook en 3 s, émotion avant information, jamais de résumé.
3. ≤ 60 s en 16:9, ≤ 25 s en 9:16 ; dans le doute, couper.
4. 100 % lisible en muet (85 % des vues sociales sans son).
5. Un seul CTA, concret et mesurable (échantillon gratuit > « achetez »).
6. Aucun texte IA dans l'image ; typo post-prod, calques par langue.
7. IA = plans atmosphériques ; pas de visages gros plan ; revue humaine plan
   par plan.
8. Voix VF native soignée ; jamais de TTS plat.
9. Deux versions natives FR/EN, master visuel commun.
10. Un lien Attribution par placement/créa ; complétion > 50 % ou refaire le hook.

## Impact sur le plan d'exécution

- Le producteur `scripts/trailers/produce-book-trailer.ts` doit viser un master
  **sans texte incrusté** + overlays typographiques par langue (déjà le modèle
  `TrailerOverlay` du socle — burnedInText interdit, conforme).
- La stratégie voix du pilote doit prévoir mieux que Piper brut pour le rendu
  final (Veo 3.1 audio natif, voix dirigée, ou enregistrement humain).
- Les prompts Veo des plans doivent rester atmosphériques (datacenters, écrans,
  abstractions) — pas de personnages photoréalistes en gros plan.
- Ajouter au pilote la production des liens Amazon Attribution et de la page de
  lancement (hors pipeline vidéo, checklist opérateur).

*Sources détaillées : conservées dans le rapport d'agent de la session du
2026-07-20 (Film 14, ebookpbook, Kindlepreneur, ScribeCount, Rocket Expansion,
Alconost, Nicholas Erik/Amazon Attribution, etc.).*
