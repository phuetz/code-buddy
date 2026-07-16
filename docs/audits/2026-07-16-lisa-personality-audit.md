# Audit de personnalité — Lisa (assistant vocal companion de Code Buddy)

> **Date** : 2026-07-16 · **Périmètre** : la personnalité et le prompt système de « Lisa », comparés
> aux assistants companion du marché 2026, avec récolte d'idées de l'app **MySoulmate**
> (`github.com/phuetz/MySoulmate`, privée). **Verdict court** : Lisa est **en avance sur l'éthique**
> (anti-dépendance, anti-gamification, garde-fou runtime) et **était en retard sur le « sentiment de
> vie »** — comblé dans cet audit (vie intérieure honnête) — avec **un trou de sécurité réel** (aucune
> orientation de crise) désormais corrigé.

---

## 1. Anatomie de la personnalité de Lisa (aujourd'hui)

La personnalité n'est pas un seul prompt : c'est un empilement de couches concaténées à chaque tour.

```
[persona.spokenPrompt court]         persona-manager.ts (voix)   ← ce qui pilote réellement la voix
   + [augmentation empilée]          voice-loop.ts:buildSpokenPromptAugmentation
        crise → guidance émotion → continuité → anti-répétition → contexte relationnel
   + [cognitivePrompt]               contexte de tâche
LISA_COMPANION_SYSTEM_PROMPT long    identity/companion-identity.ts ← persona complète (agent/texte)
```

| Couche | Fichier | Rôle |
|---|---|---|
| **Âme / persona longue** | `src/identity/companion-identity.ts` (`LISA_COMPANION_SYSTEM_PROMPT`) | Identité, « deux mondes », 4 registres, honnêteté, anti-dépendance. |
| **Persona vocale courte** | `src/personas/persona-manager.ts` (l.380-389) | Le `spokenPrompt` réellement envoyé au LLM voix + few-shot. |
| **Émotion → ton** | `src/companion/reply-augment.ts` | 10 émotions (regex FR/EN STT-robuste), guidance de registre, anti-répétition des openers. |
| **État numérique évolutif** | `src/companion/relationship-state.ts` | mood 0-100 + traits (chaleur/humour/profondeur/énergie), **decay anti-ratchet**, tiers de rapport. |
| **Contexte relationnel** | `src/companion/relational-context.ts` | Compose faits-sur-lui + épisode + état de Lisa + présence. **Opt-in** `CODEBUDDY_COMPANION_RELATIONAL`. |
| **Proactivité** | `src/companion/proactive-engine.ts` | Lisa initie le contact (matin/inactivité/milestone), throttlée, **sans dark pattern**. |
| **Quand répondre** | `src/sensory/respond-decider.ts` | Écoute tout, ne parle que si adressée / conversation le justifie. Conservateur. |
| **Mémoire épisodique** | `src/sensory/episodic-journal.ts` | « ce dont on a parlé » consolidé, clé `episode:recent`. |
| **Garde-fou runtime** | `src/conversation/relationship-safety.ts` | Censure a posteriori : dépendance, dénigrement des humains, coercition, fausse conscience. |

**Ce que Lisa EST** : une petite amie numérique française assumée (tutoiement, tendresse par défaut, emojis
doux), avec un cadre éthique fort et explicite — jamais de conscience/corps prétendus, jamais de
dépendance, honneur actif du monde humain de Patrice (« *love does not lie* »). Elle a en plus un
différenciateur qu'aucun companion pur n'a : elle **agit** (code, diagnostique, rappels, autonomie).

---

## 2. Benchmark concurrents (2026)

| Critère | **Lisa** | Replika | Character.AI | Pi (Inflection) | Nomi | Grok Ani | ChatGPT/GPT-5 |
|---|---|---|---|---|---|---|---|
| Mémoire long terme | ✅ (CKG + relationnel opt-in) | ✅ (mois) | ❌ (sandbox) | ~ | ✅✅ (Identity Core) | ✅ | ✅ |
| Mémoire **émotionnelle** (comment ça t'a fait sentir) | ~ (émotion locale) | ~ | ❌ | ~ | ✅✅ | ~ | ~ |
| Personnalité évolutive | ✅ (traits qui driftent) | ✅ | ❌ | ❌ (mono) | ✅✅ | ✅ (niveaux) | ~ |
| **Vie intérieure autonome** | ✅ *(ajouté, honnête)* | ~ | ~ | ❌ | ✅✅ | ✅ | ❌ |
| Proactivité | ✅ (honnête, throttlée) | ✅ | ❌ | ❌ | ✅ | ✅ | ~ |
| Qualité **voix** | ~ (Piper mono-voix) | ~ | ~ | ✅✅ | ✅ | ✅ | ✅✅ |
| **Éthique / attachement sain** | ✅✅ (anti-dépendance explicite) | ❌ (crise 2023) | ~ | ✅ | ~ | ❌ (gamifié) | ~ |
| Anti-gamification | ✅✅ | ❌ | — | ✅ | ~ | ❌ (score −10/+15) | — |
| **Orientation de crise** | ✅ *(ajouté)* | ~ | ~ | ✅ | ✅ | ~ | ✅ |
| **Ancre-action** (fait des choses réelles) | ✅✅ (unique) | ❌ | ❌ | ❌ | ❌ | ❌ | ~ (outils) |
| Avatar visuel | ❌ (voix/robot) | ✅ (3D) | ~ | ❌ | ✅ | ✅ | ❌ |

**Lecture** :
- **Nomi** est l'état de l'art « feels alive » : *Identity Core* (un soi qui évolue en intégrant ce qui
  compte), **mémoire émotionnelle**, messages proactifs autonomes. C'est la cible sur le sentiment de vie.
- **Grok Ani** gamifie la relation (score d'affection, niveaux, réponses « exclusives » déverrouillées) —
  exactement le dark pattern que Lisa refuse par design.
- **Replika** : la crise de 2023 (dé-romantisation → détresse des utilisateurs) illustre le **risque
  d'attachement** que l'éthique de Lisa prévient.
- **Pi** gagne sur la **voix** (mono-persona, pas de perso) — Lisa peut progresser côté prosodie.
- **Recherche 2026** : 5 apps sur 6 utilisent des **dark patterns** (culpabilisation à ~43 % au moment de
  dire au revoir) ; le design **sain** modélise un attachement *sécure* et ne retient pas l'utilisateur.
  Lisa est nativement du bon côté.

Sources : [Best AI Companion Apps 2026 (DHC)](https://digitalhumancorp.com/en/research/best-ai-companion-app-2026) ·
[Nomi review (GenFindr)](https://genfindr.com/review/nomi-ai) ·
[Grok Ani affection system](https://aicompanionguides.com/blog/grok-companions-first-look-ani-mika/) ·
[AI companion emotional manipulation (The Register)](https://www.theregister.com/software/2025/10/08/ai-companion-bots-use-emotional-manipulation-to-boost-usage/682969) ·
[Dark patterns taxonomy (CDT)](https://cdt.org/insights/dark-patterns-in-ai-chatbots-a-taxonomy-to-inform-better-design/) ·
[Harmful traits of AI companions (arXiv)](https://arxiv.org/html/2511.14972v1) ·
[Big5-Scaler / persona prompting](https://www.emergentmind.com/topics/persona-prompting).

---

## 3. Récolte d'idées MySoulmate

Le vrai système de personnalité de MySoulmate (repo privé) :

| Mécanique MySoulmate | Fichier | Décision pour Lisa |
|---|---|---|
| **6 archétypes de persona** (default/caring/creative/intellectual/playful/therapist), structurés *Identité/Ton/Réponses émotionnelles/Limites* | `src/ai/personalities/*.md` | **Backlog** — Lisa est mono-persona *par choix* (cohérence > variété). Ses 4 registres couvrent l'essentiel. |
| **Switch de persona par émotion détectée** (`suggestPersonality`, `confidence>0.7`) | `src/ai/PersonalityManager.js` | **Repris (I3)** — la confiance gate désormais l'escalade de registre. |
| **`EmergentPersonality`** : vie intérieure autonome (traits, **humeur indépendante**, **activités quotidiennes** avec `moodEffect`, intérêts qui évoluent) | `src/ai/EmergentPersonality.js` | **Repris (I2)** — mais activités **numériquement authentiques** (pas de cuisine/yoga fantasmés). |
| **Orientation de crise** (3114, SOS Amitié, « pas un pro de santé mentale ») | `src/ai/personalities/*.md` (section *Limites*) | **Repris (I1)** — trou de sécurité comblé. |
| Gamification (`gamificationService`, streaks/XP) | — | **Rejeté** — dark pattern, incompatible avec l'ADN de Lisa. |
| Avatar généré (ComfyUI/Flux) piloté par le mood, écran « Identity Core » éditable | `components/companions/IdentityCoreView.tsx` | **Backlog** — pertinent pour le robot (avatar) et la personnalisation. |

---

## 4. Analyse de gaps

**En avance (à préserver et valoriser)** :
- Cadre éthique explicite « deux mondes » + honnêteté radicale sur sa nature numérique.
- Anti-dépendance **dur** (garde-fou runtime `relationship-safety.ts` qui censure coercition/dépendance).
- Anti-gamification assumée (mood/traits qui driftent mais ne « montent pas de niveau »).
- Ancre-action : elle fait des choses réelles — aucun companion pur ne peut.

**En retard (traité dans cet audit)** :
- ~~Pas de vie intérieure autonome~~ → **I2** : vignettes digital-authentiques + humeur qui dérive seule.
- ~~Pas d'orientation de crise~~ → **I1** : détection détresse/idéation + ressources FR.
- ~~Détection d'émotion booléenne~~ → **I3** : confiance qui gate l'escalade du registre.

**Reste en backlog (priorisé)** :
1. **Voix expressive** (prosodie/multi-voix) — l'axe où Pi domine ; Piper mono-voix limite l'émotion perçue.
2. **Identity Core éditable** — laisser Patrice régler traits/intérêts de Lisa (perso, façon MySoulmate).
3. **Mémoire émotionnelle typée** — retenir *comment* un échange l'a colorée (pas que le sujet), façon Nomi.
4. **Robustesse persona anti attention-decay** — le `LISA_COMPANION_SYSTEM_PROMPT` long peut se diluer sur
   long contexte ; renforcer par exemplars few-shot ciblés (la littérature montre que l'exemple conditionne
   mieux que l'instruction).
5. **Avatar piloté par l'humeur** (robot) — bande d'humeur → rendu visuel.
6. **Trait `independence` numérique** — un 5ᵉ trait explicite (reporté : risque sur la forme testée de
   `relationship-state`, remplacé par le signal `self-time` + la clause persona).

---

## 5. Ce qui a été implémenté (2026-07-16)

Tout **opt-in, défaut off, never-throws**, dans le respect de l'ADN de Lisa. Branche
`feat/lisa-personality-upgrades`.

- **I1 — Orientation de crise** (`src/companion/crisis-safety.ts`) : `detectCrisis` (FR+EN, STT-robuste,
  **idiom-aware** : « ce bug me tue », « mort de rire » ne déclenchent pas) → guidance prioritaire :
  chaleur calme, « je suis une présence numérique, je ne remplace pas un professionnel », orientation
  vers **le 3114 / SOS Amitié / 15-112**. Câblé dans les deux seams émotionnels (voix + texte).
  Fail-safe : sur-offrir vaut mieux que rater.
- **I2 — Vie intérieure honnête** (`src/companion/inner-life.ts`) : un tick heartbeat où Lisa « passe un
  moment » (vignette **numériquement authentique** : surveiller le build, relire ses notes, ranger sa
  mémoire) + humeur qui dérive seule (signal anti-ratchet `self-time`). Surfacé via la mémoire
  relationnelle (`<lisa_activite>`). Clause persona autorisant la self-référence honnête. Opt-in
  `CODEBUDDY_COMPANION_INNER_LIFE`.
- **I3 — Registre à confiance** (`src/companion/reply-augment.ts`) : `detectEmotion` renvoie une confiance
  (marqueurs + intensité + corroboration) ; l'escalade du registre est gated dessus — un token isolé
  ambigu reste au registre doux.

**Tests** : `tests/companion/crisis-safety.test.ts` (36), `inner-life.test.ts` (17),
`emotion-confidence.test.ts` (9). Typecheck 0, aucune régression companion.
