# Cahier des charges — Production média MySoulmate (influenceuses AI + bandes-annonces)

> Version 1 — 2026-07-22. Référence de production pour les prochains jours et au-delà.
> Complète `docs/mysoulmate-visual-quality-requirements.md` (qualité visuelle) et
> `docs/studies/2026-07-22-viral-shorts-music.md` (musique virale).

## 1. Vision & objectif

Bâtir un **écosystème de contenu média haut de gamme** — chaînes d'influenceuses AI
(Shorts) + bandes-annonces de romans (cinéma) — pour **financer le robot**. Qualité
**« sans concession »**. Deux moteurs complémentaires :

- **Local (darkstar 2×3090)** — LoRA d'identité stricte, **$0, illimité, sans urgence**.
- **Google Flow / Veo (Ultra)** — **audio natif + cohérence personnage**, crédits qui
  **expirent le 28/07** → à prioriser sur ce que le local ne fait PAS.

### Règle d'or budgétaire (crédits Ultra)
> **Les crédits Ultra qui expirent le 28 servent en PRIORITÉ aux bandes-annonces**
> (Veo = audio natif synchronisé + plans cinéma, irremplaçable) et aux **plans hero**
> d'influenceuses. Les **Shorts lookbook restent en LOCAL ($0)** — aucune raison de
> brûler des crédits dessus, ils ne périment pas.

## 2. Standards de qualité (le « sans concession »)

| Critère | Exigence |
|---|---|
| Résolution | Shorts 1080×1920 (9:16) ; trailers 1920×1080 (16:9) |
| Identité | Visage cohérent plan à plan (LoRA ArcFace ≥0,58 local ; personnage Flow Ingredients) |
| Artefacts | Zéro membre/objet fantôme, pas de morphing aux jonctions (crossfade), pas de doigts cassés |
| Fluidité | 30 fps (RIFE local ; natif Flow) |
| Audio | Masterisé **-14 LUFS / -1,5 dBTP** ; musique Content-ID-safe (Epidemic Pro) |
| Voix (trailers) | Premium (ElevenLabs/qualité ciné) — **jamais** de voix « slop » |
| Cohérence série | Même personnage, même grammaire visuelle par chaîne |

## 3. Pipeline de production (méthodologie validée 22/07)

**A. Personnage réutilisable** (une fois par influenceuse/héros) :
keyframe LoRA locale (identité verrouillée) → **Importer** dans Flow → personnage nommé.

**B. Génération** :
- *Shorts identité-stricte* → **local** : Krea2 keyframe + LoRA → Wan 2.2 i2v → SeedVR2 → RIFE.
- *Plans hero + trailers* → **Flow** : Scènes → Vidéo → Ingrédients (personnage) → Veo/Omni Flash → audio natif.

**C. Son** : sonorisation `add-sound.py` (musique mood Epidemic + ambiance + master -14 LUFS),
**beat-drop calé sur les cuts** ; trailers = audio natif Veo + voix + musique.

**D. Montage** : `assembleFilm` (xfade, ducking) → porte qualité.

## 4. Production A — Chaînes d'influenceuses AI (Shorts 9:16)

Grammaire commune : hook 1-2 s, **beat-drop = cut**, loop-friendly, No-vocals, 8-16 s,
publication privée d'abord + revue humaine. Cadence cible **3-5 Shorts/semaine/chaîne**.

| Chaîne | Persona | Thème / créneau | Décors signature | Musique | Statut |
|---|---|---|---|---|---|
| **Lisa** | Brune, élégante | **Luxe / mode** (lookbook) | Hôtel, opéra, rooftop, boutique, ville | elegant / phonk élégant | LoRA v3 ✅ + perso Flow ✅ |
| **Ambre** | Rousse | **Voyage / art de vivre** | Plage, lavande, terrasse méditerranéenne, marché | warm / amapiano / chill | LoRA v3 ✅ |
| **N°3 (à créer)** | Blonde | **À définir** (fitness ? beauté ? cosy/lifestyle ?) | selon thème | phonk / lofi | ⏳ à décider |

**Formats par Short** : plan unique 8-16 s OU montage 3-5 plans (transformation/reveal de
tenue sur le beat-drop). Variété éditoriale = survie YPP (jamais 2 fois le même plan).

## 5. Production B — Bandes-annonces de romans (16:9 cinéma, Flow/Veo)

Format : **~45-90 s**, 16:9, plans atmosphériques (SF/thriller), **héros cohérent** (personnage
Flow), voix premium + musique cinématique, **pas de gros plans de visage risqués**. FR + EN.

| # | Roman | Genre | Priorité | Notes |
|---|---|---|---|---|
| 1 | **L'Algorithme de Babel** | Thriller techno-économique | **HAUTE** | Plan de 12 plans déjà prêt → démarrage immédiat |
| 2 | Les Échos de Kepler-442 | SF spatiale | Haute | Fort potentiel visuel (espace, atmosphères) |
| 3 | Le Patient Zéro | (thriller ?) | Moyenne | à cadrer |
| 4 | Le Compagnon de Silicone | (à confirmer) | Moyenne | à cadrer |
| 5 | La Compagnie / Les Empereurs du Crime | Saga crime (10 tomes) | Moyenne | trailer de saga (volume) |
| 6 | Synchronisation Charnelle | Cyberpunk érotique | Basse | trailer **atmosphérique/suggestif uniquement** (pas d'explicite) |

## 6. Plan des prochains jours (avant reset Ultra 28/07 — 6 jours)

**Objectif : maximiser l'usage des crédits Ultra sur ce que seul Flow fait bien.**

| Jour | Flow (crédits Ultra) | Local ($0, parallèle) |
|---|---|---|
| J1 (22-23) | Héros Babel + 12 plans trailer Babel | Batch Shorts Lisa (5 plans) |
| J2 | Trailer Babel FR+EN monté + révisions | Batch Shorts Ambre (5 plans) |
| J3 | Héros Kepler-442 + plans trailer | Montage + sonorisation phonk des Shorts |
| J4 | Trailer Kepler monté | 3ᵉ influenceuse (LoRA) si thème validé |
| J5 | Plans hero Lisa/Ambre (Veo audio natif) | Shorts série 2 |
| J6 (avant 28) | Brûler le reste : plans hero + variantes trailers | Assemblage final |

**Garde-fous** : coût affiché avant chaque génération ; 1x/Omni Flash pour prototyper,
Veo Quality pour les plans hero validés ; jamais de publication auto ; revue Patrice.

## 7. Décisions à valider (Patrice)

1. **3ᵉ influenceuse blonde** : quel **thème/créneau** ? (fitness / beauté / cosy-lifestyle) et **prénom** ?
2. **Priorité trailers** : confirmer l'ordre (Babel → Kepler → …) ; quels romans on traite ces 6 jours ?
3. **Voix trailers** : on souscrit **ElevenLabs** maintenant (voix premium FR+EN) ou on démarre avec l'audio natif Veo seul ?
4. **Cadence Shorts** : 3-5/semaine/chaîne te convient, ou plus agressif ?
5. **Synchronisation Charnelle** : trailer atmosphérique OK, ou on l'écarte ?

---

*Ce cahier des charges est le référentiel de production. Il évolue à mesure qu'on valide
les décisions et qu'on livre les premiers lots.*
