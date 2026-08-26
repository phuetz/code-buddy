# Mission V9 — treize portes dérobées du pipeline vidéo

Date : 2026-08-26

Branche : `fix/v9-longform-fail-closed-2026-08-26`

Base reproduite : `279b36c6`

## Résultat

Les treize replis silencieux échouent maintenant explicitement ou sont recalculés.
Le script narré absent est fatal : sa transcription automatique n'est jamais utilisée
pour fabriquer les sous-titres. Aucun rendu complet, média ou appel d'API n'a été lancé.

Le même test est joué contre l'ancienne source puis contre la source courante. Pour
chaque ligne du tableau, remplacer `<NŒUD>` par le sélecteur indiqué :

```bash
LONGFORM_SOURCE_REF=279b36c6 python3 -m pytest -q <NŒUD>  # AVANT
python3 -m pytest -q <NŒUD>                                # APRÈS
```

Les treize commandes AVANT ont rendu `exit 1`; les treize commandes APRÈS ont rendu
`exit 0`.

| Défaut fermé | NŒUD | Commit |
|---|---|---|
| script narré absent → transcription | `tests/scripts/influencer/test_longform_fail_closed.py::TriggerSafetyTests::test_declared_missing_script_is_fatal` | `6de2b6f9` |
| nombres français lettres/chiffres | `tests/scripts/influencer/test_longform_fail_closed.py::TriggerSafetyTests::test_french_number_words_match_aligned_digits` | `800973b9` |
| occurrence `mot#2` ignorée | `tests/scripts/influencer/test_longform_fail_closed.py::TriggerSafetyTests::test_hash_occurrence_syntax_from_real_order_is_supported` | `b8331bf0` |
| déclencheur absent → instant arbitraire | `tests/scripts/influencer/test_longform_fail_closed.py::TriggerSafetyTests::test_missing_trigger_never_uses_fallback` | `ee9df4d8` |
| zéro erreur sans transcription vérifiée | `tests/scripts/influencer/test_longform_fail_closed.py::TriggerSafetyTests::test_verifier_cannot_pass_without_cached_transcription` | `22d43311` |
| carte trop tardive supprimée | `tests/scripts/influencer/test_longform_fail_closed.py::TimelineSafetyTests::test_card_that_cannot_fit_is_not_silently_dropped` | `c44e7a64` |
| chapitre inconnu supprimé du sommaire | `tests/scripts/influencer/test_longform_fail_closed.py::TimelineSafetyTests::test_unknown_declared_chapter_is_fatal_before_render` | `290ab94d` |
| échec ffprobe → durée zéro | `tests/scripts/influencer/test_longform_fail_closed.py::SubtitleSafetyTests::test_ffprobe_failure_is_not_converted_to_zero_seconds` | `9cced5f6` |
| ancienne timeline SRT acceptée | `tests/scripts/influencer/test_longform_fail_closed.py::SubtitleSafetyTests::test_two_minute_timeline_media_gap_is_fatal` | `72bbff6d` |
| chapitres existants non recalculés | `tests/scripts/influencer/test_longform_fail_closed.py::LegacyAssemblySafetyTests::test_existing_chapter_file_is_recomputed` | `071e12f2` |
| master existant annoncé comme nouveau succès | `tests/scripts/influencer/test_longform_fail_closed.py::LegacyAssemblySafetyTests::test_existing_final_mux_is_not_reported_as_success` | `929a3770` |
| avatar absent → placeholder | `tests/scripts/influencer/test_longform_fail_closed.py::LegacyAssemblySafetyTests::test_missing_avatar_is_fatal_without_placeholder` | `2bc1d109` |
| section sans visuel → carte générique | `tests/scripts/influencer/test_longform_fail_closed.py::LegacyAssemblySafetyTests::test_missing_voiceover_visuals_are_fatal` | `08a7667e` |

## Preuves sur les fichiers déjà produits

La piste historique finit à `1067.533 s` tandis que le master v3 dure `1213.367 s`,
soit `145.834 s` de décalage. En utilisant l'ancien work avec ce master, la nouvelle
commande refuse la sortie avant écriture :

```bash
python3 scripts/influencer/longform/srt_depuis_rendu.py \
  /home/patrice/.codebuddy/personas/lisa/longform-02-glm-2026-08-23/work/render-v2 \
  --media /home/patrice/.codebuddy/personas/lisa/longform-02-glm-2026-08-23/v3-voix/LONG02-glm-talonne-claude-v2.mp4 \
  --out scripts/influencer/longform/.v9-ne-doit-pas-exister.srt
```

Résultat : `exit 1`, écart timeline/média `125.400 s`, fichier de sortie absent.
Les journaux existants `rendu3.log` et `rendu2.log` prouvent respectivement les
déclencheurs arbitraires et les chapitres ignorés de l'ancienne version.

## Vérifications finales

```bash
python3 -m py_compile \
  scripts/influencer/longform/assemble_news_long.py \
  scripts/influencer/longform/verifier_declencheurs.py \
  scripts/influencer/longform/srt_depuis_rendu.py \
  scripts/influencer/longform/longform-assemble.py \
  tests/scripts/influencer/test_longform_fail_closed.py
python3 -m pytest -q tests/scripts/influencer/test_longform_fail_closed.py
python3 -m pytest -q tests/scripts/influencer
```

Résultats mesurés avant la passation : `py_compile` exit 0, cible `13 passed`,
dossier influenceur `171 passed, 1 skipped`.
