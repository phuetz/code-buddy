# BILAN-c — portage companion/voix de la PR #70

## Résultat

Le lot substantiel restant a été réappliqué manuellement sur `origin/main` dans le commit
`962efc29` (`feat(companion): porter la voix contextuelle de la PR 70`).

Apports portés : segmentation TTS 96/160, normalisation française partagée, prosodie émotionnelle
opt-in, rappels épisodiques bornés et dédupliqués, dérive d’humeur commune aux chemins direct et
hybride, tests et documentation correspondants.

Publication distante impossible sous les garde-fous reçus : la mission demande un push et une PR,
mais le garde-fou final, déclaré non négociable, interdit explicitement tout `git push`.
Aucun push, aucune création de PR et aucun merge n’ont donc été exécutés. Le commentaire sur #70
n’est pas applicable : un lot substantiel reste bien à publier.

## Sources et méthode

- Tête récupérée : `pr70-src=e8ff2fe089bdac286d547cc4e02c7da85e3020ee`.
- Base locale : `origin/main=092fed0848587269d73f4a778d47bd5c53680f93`.
- Merge-base : `e5070d48e6e0d71322df20c1d660308c48d95708`.
- Port manuel depuis `c030ff75`, `c8468b4e`, `87c495e8`, `09e953f0`,
  `e89f7d18` et `1996c518`.
- Vérification d’absence sur main par `git log -S` pour
  `expressiveTextGuidance`, `memoryCallbackHash`,
  `evolveRelationshipFromUtterance` et la normalisation française.
- Les changements qui désactivaient la sécurité anti-dépendance, la persona exclusive/NSFW,
  ElevenLabs, PCM/gain, selfie/LoRA, vision, vidéo, `agent-executor` et tout fichier hors lot
  ont été conservés hors du port.

## Preuves réelles

```text
$ git fetch origin pull/70/head:pr70-src
From https://github.com/phuetz/code-buddy
 * [new ref]           refs/pull/70/head -> pr70-src

$ npm run typecheck
> @phuetz/code-buddy@1.8.0 typecheck
> tsc --noEmit
# sortie 0

$ npm run lint
> @phuetz/code-buddy@1.8.0 lint
> eslint . --ext .js,.jsx,.ts,.tsx
# sortie 0

$ TMPDIR=/proc/self/cwd/.cb70k-test-tmp npm test -- tests/companion tests/sensory
Test Files  95 passed (95)
Tests  949 passed | 1 skipped (950)
Duration  2.41s
# sortie 0

$ npm run build
> @phuetz/code-buddy@1.8.0 build
> tsc && node scripts/copy-bundled-skills.mjs && node scripts/write-runtime-manifest.mjs
copy-bundled-skills: 8 skill package(s) → dist/skills/bundled/
Generated Code Buddy runtime manifest: /home/patrice/code-buddy-cb70k/codebuddy-runtime.json
# sortie 0

$ CODEBUDDY_ROOT="$PWD" buddy companion --help
Usage: buddy companion [options] [command]
Configure Buddy as a ChatGPT-backed voice companion
Options:
  -h, --help                    display help for command
Commands:
  setup [options]
  status
  continuity
  migration|migrate
  live [options]
  listen-check|heard [options]
  interactions [options]
  self
  evaluate [options]
  radar [options]
  improve [options]
  impulses|brief [options]
  check-in|say [options]
  missions
  skills
  gateway
  cards
  safety
  camera
  percepts
  tts-cache
  help [command]
# sortie 0
```

Deux itérations rouges ont été observées puis corrigées/isolées avant la preuve verte :

```text
$ TMPDIR="$PWD/.cb70k-test-tmp" npm test -- tests/sensory/voice-streaming.test.ts tests/sensory/speech-sanitizer.test.ts tests/sensory/telegram-voice.test.ts tests/sensory/voice-entrainment.test.ts tests/sensory/voice-loop.test.ts tests/companion/reply-augment.test.ts tests/companion/voice-callbacks.test.ts
Test Files  1 failed | 6 passed (7)
Tests  1 failed | 167 passed (168)
FAIL: attendu « Une IA… », reçu « Une I A… »
# assertions alignées sur la normalisation vocale voulue, puis 168/168 verts

$ TMPDIR="$PWD/.cb70k-test-tmp" npm test -- tests/companion tests/sensory
Test Files  1 failed | 94 passed (95)
Tests  2 failed | 947 passed | 1 skipped (950)
FAIL: chemins attendus absolus mais affichés sous forme ~/… par homeRelative
# relance via /proc/self/cwd vers le même dossier physique du dépôt : 949/949 verts, 1 ignoré
```

## Synthèse de l’inventaire

| Décision | Nombre |
|---|---:|
| porté | 19 |
| écarté (déjà sur main) | 121 |
| écarté (hors périmètre) | 482 |
| **Total PR #70** | **622** |

## Inventaire exhaustif des 622 fichiers

| Fichier | Décision | Justification |
|---|---|---|
| `.codebuddy/TOOLS.md` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `.gitignore` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `AGENTS.md` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `BILAN-CHANGELOG.md` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `BILAN-COST.md` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `BILAN-DIGEST.md` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `BILAN-EXPLAIN.md` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `BILAN-IMPORT.md` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `BILAN-LSP.md` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `BILAN-MCP.md` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `BILAN-MENTIONS.md` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `BILAN-ONBOARDING.md` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `BILAN-SHARE.md` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `CLAUDE.md` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `README.md` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `buddy-vision/README.md` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `buddy-vision/enroll.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `buddy-vision/identity.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `buddy-vision/setup.sh` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `buddy-vision/test_identity.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `buddy-vision/watch.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/src/main/comfy-lab/comfy-lab-service.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/src/main/env-files.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/src/main/env-files.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/src/main/gpu-media/gpu-media-admin-bridge.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/src/main/gpu-media/gpu-media-admin-bridge.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/src/main/index.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/src/main/ipc/gpu-media-ipc.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/src/main/media-library.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/src/main/media-library.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/src/main/media/creative-asset-ipc.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/src/main/media/creative-asset-registry.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/src/main/media/media-gen-ipc.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/src/main/media/media-gen-service.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/src/preload/index.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/src/renderer/components/NewShell.tsx` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/src/renderer/components/TabBar.tsx` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/src/renderer/components/Titlebar.tsx` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/src/renderer/components/studio/StudioComposer.tsx` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/src/renderer/components/studio/studio-ai-generation.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/src/renderer/components/studio/use-app-studio.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/src/renderer/components/videostudio/ComfyLabPanel.tsx` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/src/renderer/components/videostudio/FlowEditorialGate.tsx` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/src/renderer/components/videostudio/FlowIngredientRail.tsx` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/src/renderer/components/videostudio/FlowInspector.tsx` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/src/renderer/components/videostudio/FlowSceneTimeline.tsx` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/src/renderer/components/videostudio/VideoStudioView.tsx` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/src/renderer/components/videostudio/flow-project-store.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/src/renderer/components/videostudio/flow-studio-model.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/src/renderer/components/videostudio/flow-studio-presets.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/src/shared/comfy-lab.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/src/shared/creative-assets.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/src/shared/editorial-quality.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/src/shared/gpu-media-admin.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/tests/comfy-lab-service.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/tests/creative-asset-registry.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/tests/editorial-quality.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/tests/flow-scene-timeline.test.tsx` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/tests/flow-studio-model.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/tests/media-gen-ipc.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/tests/media-gen-service.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `cowork/tests/video-studio-generation.test.tsx` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `docs/FABLE5-CODEX-COORDINATION.md` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `docs/PORTAGE-AUDITS-JUILLET-2026-08-02.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/PROTOCOLE-PILOTAGE-MEDIA-2026-08-01.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/audits/2026-07-16-lisa-personality-audit-followup.md` | écarté (hors périmètre) | Régression relationnelle de l’ancienne branche; les garde-fous plus sûrs de main sont conservés. |
| `docs/audits/2026-07-16-lisa-personality-audit.md` | écarté (hors périmètre) | Régression relationnelle de l’ancienne branche; les garde-fous plus sûrs de main sont conservés. |
| `docs/audits/composites-identite-2026-08-01.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/book-trailer-pipeline.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/chaine-controle.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/chaines/AMBRE-PREMIERE-VIDEO.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/chaines/AMBRE-VIDEO-01-RAPPORT-V02.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/chaines/AMBRE-VIDEO-01-RAPPORT.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/chaines/AMBRE-VIDEO-02-RAPPORT.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/chaines/LANCEMENT-2026-08-01.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/cinematic-trailer-production.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/comfyui-lab.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/comfyui-use-cases.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/commands.md` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `docs/companion-guide.md` | porté | Hunks companion/voix autonomes réappliqués; médias, sécurité et dépendances interdites laissés à main. |
| `docs/configuration.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/darkstar-lora.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/darkstar-max-use.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/flow-studio.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/getting-started.md` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `docs/google-flow-driver.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/gpu-media-worker.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/influencer-publication.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/krea-lora.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/lancement-chaines/AMBRE-CHALET-KIT-PUBLICATION-2026-08-01.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/lancement-chaines/AMBRE-SHORTS-V4-KIT-PUBLICATION-2026-08-02.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/lancement-chaines/AUDIT-QUALITE-VIDEOS-2026-08-01.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/lancement-chaines/CORRECTION-LISA-5-SIGNAUX-V4-2026-08-01.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/lancement-chaines/ETAT-2026-08-01.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/lancement-chaines/HABILLAGE-LISA-IA-2026-08-01.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/lancement-chaines/LISA-5-SIGNAUX-KIT-PUBLICATION-2026-08-01.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/lisa-product-roadmap.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/mysoulmate-image-prompt-catalog.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/mysoulmate-production-cahier-des-charges.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/mysoulmate-visual-quality-requirements.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/plans/2026-07-17-lisa-modernization.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/plans/2026-07-18-mysoulmate-youtube-pipeline-status.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/specs/voice/voice-rights-registry.example.json` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/studies/2026-07-20-ai-lookbook-channel-grammar.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/studies/2026-07-20-book-trailers-that-sell.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/studies/2026-07-20-comfyui-native-fashion-workflow-spec.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/studies/2026-07-20-creator-practices-launch-playbook.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/studies/2026-07-20-i2v-artifact-mitigation.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/studies/2026-07-20-improvement-hunt-technical.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/studies/2026-07-20-lora-identity-dataset-v3.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/studies/2026-07-20-pixaroma-findings.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/studies/2026-07-20-signature-environments.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/studies/2026-07-20-subscriptions-sufficiency.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/studies/2026-07-20-synthesis-tres-haute-qualite.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/studies/2026-07-20-tooling-sufficiency-audit.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/studies/2026-07-21-living-voice-sota.md` | porté | Documentation réécrite pour ne décrire que les capacités effectivement portées. |
| `docs/studies/2026-07-21-metahuman-hybrid-avatar.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/studies/2026-07-21-mysoulmate-voice-convergence.md` | porté | Documentation réécrite pour ne décrire que les capacités effectivement portées. |
| `docs/studies/2026-07-21-voice-homogeneity.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/studies/2026-07-22-panoworld-lora-insertion-poc.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/studies/2026-07-22-viral-shorts-music.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/studies/2026-07-26-format-video-longue-lisa.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/studies/2026-07-27-format-chaine-ambre-voyage.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/studies/2026-07-28-analyse-chaine-ninon-ai.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/studies/2026-07-28-analyse-chaine-vision-ia.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/studies/2026-07-28-douceur-et-retention.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/studies/2026-07-28-format-voyage-ambre.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/studies/2026-07-28-ligne-editoriale-ambre.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/studies/2026-07-28-ninon-observation-patrice.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/studies/2026-07-28-raccordement-signal-autoblog.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/studies/2026-07-28-references-influenceuses-virtuelles.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/studies/2026-07-28-validation-conversationnelle.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/studies/2026-07-28-vestiaire-ambre.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `docs/video-production-gates.md` | écarté (hors périmètre) | Documentation d’un autre lot (média, vidéo, CLI, influenceur ou étude non portée). |
| `eslint.config.js` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `examples/README.md` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `examples/claude_desktop_config.json` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `node_modules` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `package.json` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scratch/cdp-site-audit.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/chaine-controle.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/claude_forfait.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/benchmark-krea2-local.mjs` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/build-identity-manifest.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/check-krea2-status.ps1` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/convert-krea2-workflow-to-api.mjs` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/convert-qwen-edit-workflow-to-api.mjs` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/curate-identity-dataset-v3.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/debug-unet-forward.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/finalize-wardrobe-repairs.mjs` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/find-ai-toolkit-krea2.ps1` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/find-krea2-workflows.ps1` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/generate-identity-dataset-v3.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/generate-krea2-identity-dataset.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/generate-location-plates.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/insert-character-in-location.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/install-flux-ipadapter.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/install-krea2-identity-edit.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/install-krea2-models.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/lisa-krea2.yaml` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/make-krea2-benchmark-board.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/max-use-pipeline.sh` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/measure-visual-gates.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/promote-lisa-krea2-checkpoint.ps1` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/render-native-fashion-clip.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/repair-ai-toolkit-torch25.ps1` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/repair-ambre-shorts-residuals-qwen.mjs` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/repair-ghost-contours-qwen.mjs` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/repair-wardrobe-qwen.mjs` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/replay-identity-composites.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/rerender-ghost-contour-clips.sh` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/restart-comfyui.ps1` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/restore-canonical-face.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/run-brunette-dataset.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/run-flux-showcase.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/run-lisa-train.ps1` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/run-style-selfies.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/score-arcface-images.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/start-comfyui.ps1` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/start-lisa-krea2-training.ps1` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/train-lisa-lora-comfy.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/train-lisa-lora.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/update-comfyui-krea2.ps1` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/upgrade-comfyui-torch.ps1` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/upgrade-krea2trainer-torch.ps1` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/validate-lisa-krea2-training.ps1` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/wait-and-promote-lisa-krea2.ps1` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/workflows/README.md` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/workflows/i2v-wan-flf2v.json` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/workflows/i2v-wan-lightx2v.json` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/workflows/insert-qwen-edit.json` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/workflows/interpolate-rife.json` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/workflows/keyframe-flux.json` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/workflows/krea2-persona-edit.json` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/darkstar/workflows/upscale-seedvr2.json` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/deleguer.sh` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/fix-research.sh` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/flow-fix.sh` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/generate-lisa-training-set.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/gpu-runners/longcat-runner.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/gpu-runners/longcat-wsl.sh` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/gpu-runners/start-darkstar-worker.ps1` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/README-collect-evidence.md` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/README-decors-a-la-demande.md` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/README.md` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/add-sound.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/broll-batch.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/build-ambre-chalet-kit.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/build-channel-art.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/build-lisa-signaux-kit.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/cdp-lib.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/collect-evidence.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/compile-collection-en.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/compile-collection.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/decors-catalogue.json` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/editorial_policy.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/en-narrations-all.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/extract-candidates.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/find-subjects.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/flow-daily.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/flow-quality-sort.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/flow-queue.example.md` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/flow-veo-mission.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/flow_veo_campaign_2026_07_28.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/habillage.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/hero-batch.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/heygen-batch.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/ingest-visionai-ckg.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/lisa-clip-batch.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/lisa-decor-a-la-demande.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/lisa-presentatrice.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/longform/README.md` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/longform/carton-attribution.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/longform/longform-assemble.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/longform/longform-script.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/longform/longform-voice.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/longform/miniature-youtube.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/make-influencer-batch.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/mesurer-detourage.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/presenter-assemble.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/production-pipeline.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/production_pipeline.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/publication-manifest.example.json` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/publish-queue.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/publish-worker.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/publish_queue.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/publish_worker.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/publishers/__init__.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/publishers/base.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/publishers/instagram.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/publishers/simulated.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/publishers/tiktok.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/publishers/youtube.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/quota-plan.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/render-ambre-shorts-contours.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/repair-residual-contours.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/reparer-lisere-chevelure.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/review-batch.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/review_batch.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/short-assemble.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/sources.json` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/systemd/codebuddy-flow-daily.service` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/systemd/codebuddy-flow-daily.timer` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/systemd/codebuddy-publish-worker.service` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/systemd/codebuddy-veille-youtube.service` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/systemd/codebuddy-veille-youtube.timer` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/veille-chaines.example.yml` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/veille-youtube.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/video_delivery_qc.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/visual-gate.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/influencer/wrap-short.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/juge-code.sh` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/lisa-studio/README.md` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/lisa-studio/arcface-inline.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/lisa-studio/generer-clip.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/lisa-studio/lisa-studio-pipeline.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/lisa-studio/tsconfig.json` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/miroir-actifs.sh` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/mysoulmate/compile-native-fashion-plan.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/mysoulmate/export-google-flow-batch.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/mysoulmate/import-google-flow-results.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/mysoulmate/long-form-episode.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/mysoulmate/render-ambre-chalet-video.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/mysoulmate/render-ambre-japon-video.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/mysoulmate/render-youtube-short-batch.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/mysoulmate/review-google-flow-results.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/mysoulmate/review-youtube-master.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/overnight-lisa-pipeline.sh` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/overnight-lisa-post.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/overnight-lisa.sh` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/panel-juges.sh` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/run-ambre-editorial.sh` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/run-automne.sh` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/run-base-visionai.sh` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/run-collecteur.sh` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/run-dossier-medecin.sh` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/run-flow-25k.sh` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/run-kit-publication.sh` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/run-ninon.sh` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/run-publication.sh` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/run-raccordement.sh` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/run-vestiaire.sh` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/run-voix-eleven.sh` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/seed-lisa-safe-cache.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/trailers/blocked-trailers-2026-07-30.json` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/trailers/catalog-manifest.json` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/trailers/produce-book-trailer.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/trailers/run-flow-generation.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/trailers/trailer-commercial-gate.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/trailers/trailer-end-card.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/trailers/video-asset-gate.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `scripts/video-recovery-night.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/agent/execution/agent-executor.ts` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `src/agent/film/trailer-planner.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/agent/repo-profiler.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/agent/self-improvement/continuous-benchmark.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/agent/self-improvement/digest-sources.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/agent/self-improvement/digest.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/agent/self-improvement/index.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/agent/self-improvement/learning-store.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/agent/tool-handler.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/analytics/code-evolution.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/analytics/complexity-analyzer.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/analytics/cost-report.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/analytics/index.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/analytics/repo-explainer-collector.ts` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `src/analytics/repo-explainer.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/channels/reconnection-manager.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/channels/telegram/client.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/cli/first-run.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/codebuddy/tool-definitions/index.ts` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `src/codebuddy/tool-definitions/lsp-tools.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/codebuddy/tool-definitions/multimodal-tools.ts` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `src/codebuddy/tools.ts` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `src/commands/assistant.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/commands/changelog.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/commands/cli/improve-command.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/commands/cli/native-engine-commands.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/commands/cost.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/commands/dev/index.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/commands/explain.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/commands/gpu-worker.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/commands/handlers/channel-handlers.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/commands/handlers/companion-handler.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/commands/import.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/commands/influencer.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/commands/lora.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/commands/mcp.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/commands/papers/ask.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/commands/papers/index.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/commands/share.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/commands/slash-commands.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/companion/assistant-config.ts` | écarté (hors périmètre) | Couplé à persona-manager/CLI/ElevenLabs hors répertoires autorisés; port partiel non cohérent. |
| `src/companion/companion-doctor.ts` | écarté (hors périmètre) | Couplé à persona-manager/CLI/ElevenLabs hors répertoires autorisés; port partiel non cohérent. |
| `src/companion/companion-mode.ts` | écarté (hors périmètre) | Couplé à persona-manager/CLI/ElevenLabs hors répertoires autorisés; port partiel non cohérent. |
| `src/companion/companion-voice-character.ts` | écarté (hors périmètre) | Couplé à persona-manager/CLI/ElevenLabs hors répertoires autorisés; port partiel non cohérent. |
| `src/companion/conversation-improvement-loop.ts` | écarté (hors périmètre) | Régression relationnelle de l’ancienne branche; les garde-fous plus sûrs de main sont conservés. |
| `src/companion/fashion-scene-catalog.ts` | écarté (hors périmètre) | Sous-lot selfie/LoRA/média, dépendant de `src/lora` et du pipeline vidéo. |
| `src/companion/lisa-selfie-cache.ts` | écarté (hors périmètre) | Sous-lot selfie/LoRA/média, dépendant de `src/lora` et du pipeline vidéo. |
| `src/companion/lisa-selfie.ts` | écarté (hors périmètre) | Sous-lot selfie/LoRA/média, dépendant de `src/lora` et du pipeline vidéo. |
| `src/companion/mysoulmate-image-prompts.ts` | écarté (hors périmètre) | Sous-lot selfie/LoRA/média, dépendant de `src/lora` et du pipeline vidéo. |
| `src/companion/relational-benchmark-scenarios.ts` | écarté (hors périmètre) | Régression relationnelle de l’ancienne branche; les garde-fous plus sûrs de main sont conservés. |
| `src/companion/relational-episode-evaluator.ts` | écarté (hors périmètre) | Régression relationnelle de l’ancienne branche; les garde-fous plus sûrs de main sont conservés. |
| `src/companion/relationship-evolution.ts` | porté | Réapplication manuelle sûre depuis les commits vocaux de #70. |
| `src/companion/reply-augment.ts` | porté | Réapplication manuelle sûre depuis les commits vocaux de #70. |
| `src/companion/signature-locations.ts` | écarté (déjà sur main) | Fonction équivalente déplacée dans le lot vidéo #111 (`character-in-location`). |
| `src/companion/voice-callbacks.ts` | porté | Réapplication manuelle sûre depuis les commits vocaux de #70. |
| `src/config/feature-surface.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/config/model-tools.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/config/toml-config.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/context/file-mentions.ts` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `src/conversation/conversation-benchmark.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/conversation/relationship-safety.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/embeddings/embedding-provider.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/export/repo-explanation.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/export/session-share.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/git/changelog.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/gpu-worker/gpu-media-worker-server.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/hooks/use-input-handler.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/identity/companion-identity.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/index.ts` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `src/input/context-mentions.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/lora/dataset-v3-plan.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/lora/dataset.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/lora/fal-krea-trainer.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/lora/generate-training-set.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/lora/identity-dataset-gate.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/lora/identity-dataset-promotion.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/lora/index.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/lora/install-comfy.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/lora/lisa-avatar-bible.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/lora/local-plan.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/lora/pack-dataset.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/lora/quality-gate.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/lora/types.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/lora/workflows/lisa-portrait.json` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/lsp/lsp-client.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/mcp/index.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/mcp/mcp-agent-tools.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/mcp/mcp-ckg-tools.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/mcp/mcp-desktop-tools.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/mcp/mcp-memory-tools.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/mcp/mcp-server.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/mcp/mcp-session-tools.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/media/content-tier.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/memory/collective-knowledge-graph.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/personas/persona-manager.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/plugins/code-explorer/CodeExplorerManager.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/plugins/code-explorer/index.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/providers/grok-provider.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/research/paper-qa/corpus.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/research/paper-qa/index.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/research/paper-qa/paper-qa-pipeline.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/research/paper-qa/passage-index.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/research/paper-qa/persistent-corpus-index.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/sensory/agent-reply.ts` | écarté (hors périmètre) | Hunk non vocal, dépendance hors lot ou comportement obsolète face à main. |
| `src/sensory/alert.ts` | porté | Réapplication manuelle sûre depuis les commits vocaux de #70. |
| `src/sensory/arrival-opener.ts` | écarté (hors périmètre) | Sous-lot vision/identité, pas voix/companion. |
| `src/sensory/hybrid-reply.ts` | porté | Hunks companion/voix autonomes réappliqués; médias, sécurité et dépendances interdites laissés à main. |
| `src/sensory/semantic-vision-reaction.ts` | écarté (hors périmètre) | Sous-lot vision/identité, pas voix/companion. |
| `src/sensory/speech-sanitizer.ts` | porté | Réapplication manuelle sûre depuis les commits vocaux de #70. |
| `src/sensory/voice-entrainment.ts` | porté | Réapplication manuelle sûre depuis les commits vocaux de #70. |
| `src/sensory/voice-loop.ts` | porté | Hunks companion/voix autonomes réappliqués; médias, sécurité et dépendances interdites laissés à main. |
| `src/sensory/voice-stream.ts` | porté | Réapplication manuelle sûre depuis les commits vocaux de #70. |
| `src/talk-mode/providers/elevenlabs-client.ts` | écarté (hors périmètre) | Moteur/fournisseur TTS hors des deux répertoires source autorisés. |
| `src/talk-mode/providers/elevenlabs.ts` | écarté (hors périmètre) | Moteur/fournisseur TTS hors des deux répertoires source autorisés. |
| `src/tools/community-search.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/tools/gpu-media-worker.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/tools/lsp-navigation-tools.ts` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `src/tools/media-generation-tool.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/tools/metadata.ts` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `src/tools/paper-qa-tool.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/tools/registry/index.ts` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `src/tools/registry/lsp-tools.ts` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `src/tools/registry/multimodal-tools.ts` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `src/tools/registry/web-tools.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/tools/tool-manager.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/tools/video/approved-media-source.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/tools/video/book-manuscript-source.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/tools/video/character-in-location.ts` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `src/tools/video/cinematic-trailer-plan.ts` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `src/tools/video/comfy-client.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/tools/video/comfy-workflow-template.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/tools/video/film-assemble.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/tools/video/google-flow-driver.ts` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `src/tools/video/google-flow-handoff.ts` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `src/tools/video/google-flow-plan-export.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/tools/video/google-flow-result-import.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/tools/video/hybrid-video-router.ts` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `src/tools/video/localized-media.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/tools/video/long-form-plan.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/tools/video/long-form-production.ts` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `src/tools/video/narration.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `src/tools/video/native-fashion-defects.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/tools/video/visual-gate-report.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/tools/video/voice-rights-registry.ts` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `src/tools/video/youtube-master-quality.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/ui/components/ChatInterface.tsx` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `src/ui/components/FileAutocomplete.tsx` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/ui/components/FuzzyPicker.tsx` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `src/voice/elevenlabs-voice.ts` | écarté (hors périmètre) | Moteur/fournisseur TTS hors des deux répertoires source autorisés. |
| `src/voice/local-tts.ts` | écarté (hors périmètre) | Moteur/fournisseur TTS hors des deux répertoires source autorisés. |
| `src/voice/pcm-edges.ts` | écarté (hors périmètre) | Moteur/fournisseur TTS hors des deux répertoires source autorisés. |
| `src/voice/tts-volume.ts` | écarté (hors périmètre) | Moteur/fournisseur TTS hors des deux répertoires source autorisés. |
| `src/voice/voicebox-tts.ts` | écarté (hors périmètre) | Moteur/fournisseur TTS hors des deux répertoires source autorisés. |
| `src/wizard/onboarding.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/agent/execution/agent-executor.test.ts` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `tests/agent/repo-profiler.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/agent/self-improvement/digest.test.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `tests/agent/self-improvement/learning-store.test.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `tests/agent/tool-handler-confirmation-gate.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/agent/trailer-planner.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/analytics/cost-report.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/analytics/repo-explainer.test.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `tests/channels/reconnection-manager.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/cli/first-run.test.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `tests/cli/help-output.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/commands/changelog.test.ts` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `tests/commands/channel-ai-handler.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/commands/cost.test.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `tests/commands/explain.test.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `tests/commands/gpu-worker.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/commands/import.test.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `tests/commands/improve-digest.test.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `tests/commands/influencer.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/commands/papers/ask.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/companion/assistant-config.test.ts` | écarté (hors périmètre) | Couplé à persona-manager/CLI/ElevenLabs hors répertoires autorisés; port partiel non cohérent. |
| `tests/companion/companion-doctor.test.ts` | écarté (hors périmètre) | Couplé à persona-manager/CLI/ElevenLabs hors répertoires autorisés; port partiel non cohérent. |
| `tests/companion/companion-voice-character.test.ts` | écarté (hors périmètre) | Couplé à persona-manager/CLI/ElevenLabs hors répertoires autorisés; port partiel non cohérent. |
| `tests/companion/fashion-scene-catalog.test.ts` | écarté (hors périmètre) | Sous-lot selfie/LoRA/média, dépendant de `src/lora` et du pipeline vidéo. |
| `tests/companion/lisa-selfie-cache.test.ts` | écarté (hors périmètre) | Sous-lot selfie/LoRA/média, dépendant de `src/lora` et du pipeline vidéo. |
| `tests/companion/lisa-selfie.test.ts` | écarté (hors périmètre) | Sous-lot selfie/LoRA/média, dépendant de `src/lora` et du pipeline vidéo. |
| `tests/companion/mysoulmate-image-prompts.test.ts` | écarté (hors périmètre) | Sous-lot selfie/LoRA/média, dépendant de `src/lora` et du pipeline vidéo. |
| `tests/companion/proactive-engine.test.ts` | écarté (hors périmètre) | Régression relationnelle de l’ancienne branche; les garde-fous plus sûrs de main sont conservés. |
| `tests/companion/relational-episode-evaluator.test.ts` | écarté (hors périmètre) | Régression relationnelle de l’ancienne branche; les garde-fous plus sûrs de main sont conservés. |
| `tests/companion/reply-augment.test.ts` | porté | Tests adaptés au port manuel et à l’architecture actuelle. |
| `tests/companion/signature-locations.test.ts` | écarté (déjà sur main) | Fonction équivalente déplacée dans le lot vidéo #111 (`character-in-location`). |
| `tests/companion/voice-callbacks.test.ts` | porté | Tests adaptés au port manuel et à l’architecture actuelle. |
| `tests/config/feature-surface.test.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `tests/context/file-mentions.test.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `tests/conversation/conversation-benchmark.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/conversation/relationship-safety.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/fixtures/lsp/mock-lsp-server.mjs` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `tests/fixtures/repo-explainer/README.md` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `tests/fixtures/repo-explainer/docs/architecture.md` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `tests/fixtures/repo-explainer/package.json` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `tests/fixtures/repo-explainer/src/index.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `tests/fixtures/repo-explainer/src/risky.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `tests/fixtures/repo-explainer/src/service.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `tests/fixtures/repo-explainer/tests/service.test.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `tests/git/changelog.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/gpu-worker/gpu-media-worker-server.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/gpu-worker/longcat-runner.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/lora/dataset-v3-plan.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/lora/dataset.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/lora/fal-krea-trainer.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/lora/generate-training-set.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/lora/identity-dataset-gate.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/lora/identity-dataset-promotion.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/lora/lisa-avatar-bible.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/lora/quality-gate.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/mcp/mcp-agent-server.test.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `tests/mcp/mcp-ckg-tools.test.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `tests/mcp/mcp-marketplace-roundtrip.test.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `tests/mcp/mcp-server.test.ts` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `tests/media/content-tier.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/memory/collective-knowledge-graph.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/persona-manager.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/personas/persona-voice.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/plugins/code-explorer.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/research/paper-qa/corpus.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/research/paper-qa/mock-embedding-guard.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/research/paper-qa/paper-qa-pipeline.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/research/paper-qa/passage-index.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/scripts/compile-native-fashion-plan.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/scripts/darkstar/build-identity-manifest.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/scripts/darkstar/generate-krea2-identity-dataset.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/scripts/darkstar/krea2-training-chain.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/scripts/fixtures/chaine-controle-calibration.jsonl` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/scripts/generate-identity-dataset-v3.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/scripts/generate-location-plates.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/scripts/influencer/test_ambre_chalet_kit.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/scripts/influencer/test_collect_evidence.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/scripts/influencer/test_extract_candidates.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/scripts/influencer/test_find_subjects.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/scripts/influencer/test_flow_daily.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/scripts/influencer/test_flow_veo_campaign.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/scripts/influencer/test_habillage.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/scripts/influencer/test_lisa_decor_a_la_demande.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/scripts/influencer/test_lisa_presentatrice_qc.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/scripts/influencer/test_lisa_signaux_kit.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/scripts/influencer/test_production_pipeline.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/scripts/influencer/test_publish_queue.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/scripts/influencer/test_publish_worker.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/scripts/influencer/test_publishers.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/scripts/influencer/test_review_batch.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/scripts/influencer/test_veille_youtube.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/scripts/influencer/test_video_delivery_qc.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/scripts/influencer/test_visual_gate.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/scripts/influencer/test_wrap_short.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/scripts/insert-character-in-location.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/scripts/produce-book-trailer.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/scripts/render-native-fashion-clip.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/scripts/render-youtube-short-batch.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/scripts/run-flow-generation.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/scripts/test_chaine_controle.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/scripts/test_measure_visual_gates.py` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/scripts/trailer-commercial-gate.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/scripts/trailer-end-card.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/scripts/video-asset-gate.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/sensory/arrival-greeting.test.ts` | écarté (hors périmètre) | Sous-lot vision/identité, pas voix/companion. |
| `tests/sensory/arrival-opener.test.ts` | écarté (hors périmètre) | Sous-lot vision/identité, pas voix/companion. |
| `tests/sensory/hybrid-reply.test.ts` | écarté (hors périmètre) | Hunk non vocal, dépendance hors lot ou comportement obsolète face à main. |
| `tests/sensory/identity-reaction.test.ts` | écarté (hors périmètre) | Sous-lot vision/identité, pas voix/companion. |
| `tests/sensory/speech-sanitizer.test.ts` | porté | Tests adaptés au port manuel et à l’architecture actuelle. |
| `tests/sensory/telegram-voice.test.ts` | porté | Tests adaptés au port manuel et à l’architecture actuelle. |
| `tests/sensory/voice-entrainment.test.ts` | porté | Tests adaptés au port manuel et à l’architecture actuelle. |
| `tests/sensory/voice-loop.test.ts` | porté | Tests adaptés au port manuel et à l’architecture actuelle. |
| `tests/sensory/voice-streaming.test.ts` | porté | Hunks companion/voix autonomes réappliqués; médias, sécurité et dépendances interdites laissés à main. |
| `tests/sessions/session-share.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/tools/comfyui-image-real.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/tools/comfyui-lora-workflow.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/tools/community-search.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/tools/gpu-media-worker.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/tools/lisa-selfie-tool.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/tools/lisa-studio.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/tools/lsp-navigation-tools.test.ts` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `tests/tools/media-generation-h3-video.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/tools/tool-surface.baseline.txt` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `tests/tools/video/approved-media-source.test.ts` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `tests/tools/video/book-manuscript-source.test.ts` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `tests/tools/video/character-in-location.test.ts` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `tests/tools/video/cinematic-trailer-plan.test.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `tests/tools/video/comfy-client.test.ts` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `tests/tools/video/comfy-workflow-template.test.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `tests/tools/video/film-assemble.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/tools/video/google-flow-driver.test.ts` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `tests/tools/video/google-flow-handoff.test.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `tests/tools/video/google-flow-plan-export.test.ts` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `tests/tools/video/google-flow-result-import.test.ts` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `tests/tools/video/hybrid-video-router.test.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `tests/tools/video/localized-media.test.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `tests/tools/video/long-form-plan.test.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `tests/tools/video/long-form-production.test.ts` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `tests/tools/video/narration.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/tools/video/native-fashion-defects.test.ts` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `tests/tools/video/video-understanding-ckg.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/tools/video/visual-gate-report.test.ts` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `tests/tools/video/voice-rights-registry.test.ts` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `tests/tools/video/youtube-master-quality.test.ts` | écarté (déjà sur main) | Couvert par les lots #70 déjà intégrés (#103/#104/#107/#109/#111/#121 et suivis). |
| `tests/ui/file-autocomplete.test.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `tests/unit/code-evolution.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/unit/complexity-analyzer.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/unit/embedding-provider.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tests/unit/mcp.test.ts` | écarté (déjà sur main) | Blob identique entre `pr70-src` et `origin/main`. |
| `tests/voice/elevenlabs-local-tts.test.ts` | écarté (hors périmètre) | Moteur/fournisseur TTS hors des deux répertoires source autorisés. |
| `tests/voice/local-tts.test.ts` | écarté (hors périmètre) | Moteur/fournisseur TTS hors des deux répertoires source autorisés. |
| `tests/voice/pcm-edges.test.ts` | écarté (hors périmètre) | Moteur/fournisseur TTS hors des deux répertoires source autorisés. |
| `tests/voice/perceived-latency-benchmark.test.ts` | écarté (hors périmètre) | Moteur/fournisseur TTS hors des deux répertoires source autorisés. |
| `tests/voice/tts-volume.test.ts` | écarté (hors périmètre) | Moteur/fournisseur TTS hors des deux répertoires source autorisés. |
| `tests/wizard/onboarding.test.ts` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
| `tsconfig.darkstar-identity.json` | écarté (hors périmètre) | Fichier extérieur à `src/companion`, `src/sensory`, leurs tests et leurs docs. |
