# Audit des composites d’identité — 2026-08-01

## Conclusion

Le diagnostic architectural est confirmé : la réparation de garde-robe protège
le visage par masque latent puis recomposition, tandis que l’ancienne insertion
en décor échantillonnait et décodait toute l’image. Les reprises aléatoires ne
corrigeaient donc pas la dérive systématique.

Deux précisions factuelles ressortent toutefois de la vérification :

- les 38 sidecars contiennent **18 OK, 7 MINEUR et 13 REJET**, soit 38, et non
  14 rejets ;
- il y a **11 rejets d’identité**, pas 12 : `008`, `010`, `012`, `017`, `019`,
  `020`, `023`, `030`, `034`, `035`, `036`. Les deux autres rejets sont `037`
  et `038`, fermés faute de juge LLM vision.

Les 11 images réellement rejetées pour l’identité ont été rejouées. Toutes les
sorties retenues dépassent la cible ArcFace 0,75 avec une référence canonique de
la même tenue. Les sorties sont sous :

```text
/home/patrice/Videos/personas/composites-identite-2026-08-01/
```

Les résultats exacts et non arrondis du tableau sont conservés dans
`mesures/tableau-final.json`; les recomptages du diagnostic dans
`mesures/diagnostic-qc.json` et `mesures/diagnostic-garde-robe-16.json`.

Aucune source de `~/.codebuddy/personas/**` n’a été modifiée et aucune image
n’est ajoutée au dépôt.

## Diagnostic vérifié

### Différence entre les chaînes

La chaîne A (`repair-wardrobe-qwen.mjs`) construit bien un
`SetLatentNoiseMask`, puis réinsère le résultat au moyen de deux
`ImageCompositeMasked`. La chaîne B historique encodait la plaque entière,
utilisait `denoise: 1.0` et sauvegardait directement le `VAEDecode`, sans masque
latent ni recomposition finale. La cause décrite est donc présente dans le code,
et pas seulement dans les résultats.

Le rapport ArcFace existant de la garde-robe mélangeait 16 tenues et trois
composites numérotés. Après filtrage des trois intrus, les 16 tenues donnent :

- moyenne : **0,9110** ;
- 15/16 entre **0,9059 et 0,9266** ;
- exception : `ambre-chemise-lin-chapeau.png`, **0,8096**.

La formulation « 16 tenues entre 0,91 et 0,92 » n’est donc pas littéralement
exacte, même si l’écart de niveau entre les deux chaînes est confirmé.

La lecture rejouée des 38 QC donne :

```text
total=38 ; OK=18 ; MINEUR=7 ; REJET=13 ; rejets ArcFace=11
```

Les reprises historiques ont bien des SHA-256 différents. Avec les scores
canoniques archivés, `034` passe de 0,4728 à 0,4700 et `035` de 0,5026 à
0,5068 : des images différentes, sans réparation de la cause.

### Défaut de référence découvert

La référence Ambre par défaut de `visual-gate.py` était le composite généré
`ambre-002`, et non le référentiel canonique. Cela explique aussi pourquoi les
scores historiques du QC ne sont pas numériquement comparables aux mesures
fraîches ci-dessous. Le défaut est corrigé : le défaut pointe désormais vers
`~/.codebuddy/personas/ambre/identity-kit`. Pour chaque avant/après, la mesure
utilise plus précisément la source canonique de la tenue concernée.

## Correctif porté sur l’insertion en décor

La nouvelle chaîne est obligatoire dans le CLI, sans option de désactivation :

1. une première passe produit seulement un brouillon de placement ;
2. `restore-canonical-face.py` détecte les cinq repères, applique une
   transformation de similitude (échelle uniforme, rotation, translation), ce
   qui interdit l’étirement anisotrope, puis recolle les pixels canoniques ;
3. un relighting LAB conservateur adapte la photométrie sans changer la
   géométrie ;
4. la seconde passe Qwen reçoit l’image protégée et le masque inverse :
   `SetLatentNoiseMask` interdit l’échantillonnage du visage ;
5. `GrowMask(-16)` réserve une marge propre, puis `ImageCompositeMasked`
   rétablit exactement la base canonique après décodage.

Le visage généré de la première passe n’est qu’un guide de placement. Les pixels
canoniques sont introduits ensuite et ne sont jamais échantillonnés dans la
passe protégée. Un rapport `face-protection-report.json` accompagne chaque
sortie.

## Protocole de mesure

Les colonnes « avant canonique » et « après canonique » proviennent de
`scripts/darkstar/score-arcface-images.py`, avec la même image canonique de tenue
comme référence. La colonne « QC historique » est conservée pour relier le
tableau aux sidecars demandés, mais utilisait l’ancienne référence générée et ne
doit pas servir au calcul du gain. Le gate final est exécuté séparément par
`scripts/influencer/visual-gate.py`, avec seuil de rejet 0,55, cible 0,75 et
référence canonique explicite. Le juge s’exécute localement via
`gemma4:12b` ; coût déclaré : 0 USD.

## Rejeux avant/après

| ID | QC historique | Avant canonique | Après canonique | Gain comparable | Écart visage après | Gate final |
|---:|---:|---:|---:|---:|---:|:---|
| 030 | 0,105 | 0,109 | 0,962 | +0,853 | 0,070 | OK |
| 008 | 0,267 | 0,321 | 0,864 | +0,543 | 0,095 | À REGARDER |
| 017 | 0,272 | 0,302 | 0,957 | +0,655 | 0,066 | À REGARDER |
| 012 | 0,347 | 0,340 | 0,886 | +0,546 | 0,074 | À REGARDER |
| 010 | 0,380 | 0,352 | 0,965 | +0,613 | 0,066 | À REGARDER |
| 034 | 0,473 | 0,430 | 0,758 | +0,328 | 0,127 | À REGARDER |
| 035 | 0,505 | 0,489 | 0,785 | +0,296 | 0,156 | À REGARDER |
| 019 | 0,509 | 0,456 | 0,760 | +0,304 | 0,140 | À REGARDER |
| 036 | 0,528 | 0,506 | 0,825 | +0,319 | 0,070 | À REGARDER |
| 023 | 0,530 | 0,561 | 0,864 | +0,303 | 0,077 | À REGARDER |
| 020 | 0,531 | 0,494 | 0,753 | +0,259 | 0,116 | À REGARDER |

« À REGARDER » n’est pas un échec d’identité : les onze jugements LLM sont OK
et aucun résultat retenu n’est rejeté. `030`, le pire cas initial, passe même le
gate complet en OK. Les avertissements restants viennent de
la détection de contours/OCR ou, pour `019`, `034` et `035`, d’un écart de
proportions situé entre le seuil d’avertissement 0,12 et le rejet 0,18.

## `ambre-037` et `ambre-038`

Les originaux ont été copiés dans le dossier daté avant jugement ; leurs
sidecars historiques n’ont pas été écrasés. Le juge absent est désormais
présent :

| ID | Référence canonique | ArcFace | Écart visage | LLM vision | Verdict final |
|---:|:---|---:|---:|:---|:---|
| 037 | doudoune sapin | 0,810 | 0,122 | `gemma4:12b` : OK | À REGARDER |
| 038 | velours cognac | 0,872 | 0,142 | `gemma4:12b` : OK | À REGARDER |

Les deux images sont donc évaluées. Elles ne sont pas REJET ; elles restent à
regarder uniquement parce que leur écart facial dépasse légèrement le seuil
d’avertissement 0,12. `038` porte aussi un avertissement OCR de pseudo-texte.

## Ce qui reste sous le seuil et limites

- **Sous le seuil de rejet ArcFace 0,55 : rien** parmi les rejeux retenus.
- **Sous la cible 0,75 : rien** parmi les rejeux retenus.
- Aucun gate final n’est REJET. `030` est OK ; les dix autres restent
  `À REGARDER` pour au moins un avertissement non bloquant et ne doivent pas être
  promus aveuglément sans la revue humaine demandée par ce niveau.
- La mesure d’identité est sensible au choix de référence. L’audit conserve le
  score historique pour traçabilité, mais fonde toute conclusion avant/après
  sur la même source canonique de tenue.
- Aucun appel payant n’a été utilisé. Le jugement sémantique vérifié ici est
  celui du modèle Ollama local disponible ; aucune seconde famille de modèle
  vision indépendante n’a été exécutée.

## Exécutions de contrôle

Commandes représentatives réellement exécutées :

```bash
jq -s '{total:length,
  verdicts:(group_by(.verdict)|map({key:.[0].verdict,value:length})|from_entries),
  identity_rejects:[.[]|select((.deterministic.identity_arcface // 1)
    < (.deterministic.identity_threshold // 0.55))]}' \
  /home/patrice/Videos/personas/ambre-scenes/automne-composites/ambre-0{01..38}-*.png.qc.json

/tmp/codebuddy-visual-gate-20260801/bin/python \
  scripts/darkstar/score-arcface-images.py \
  --reference ~/.codebuddy/personas/ambre/wardrobe-automne/ambre-cocooning-flanelle-sapin.png \
  --output /home/patrice/Videos/personas/composites-identite-2026-08-01/mesures/ambre-030-v3-score.json \
  /home/patrice/Videos/personas/composites-identite-2026-08-01/replays-v3/ambre-030-salon-dore-flanelle/composite.png

/tmp/codebuddy-visual-gate-20260801/bin/python \
  scripts/influencer/visual-gate.py \
  /home/patrice/Videos/personas/composites-identite-2026-08-01/replays-v3/ambre-030-salon-dore-flanelle/composite.png \
  --persona ambre \
  --reference ~/.codebuddy/personas/ambre/wardrobe-automne/ambre-cocooning-flanelle-sapin.png \
  --force \
  --journal /home/patrice/Videos/personas/composites-identite-2026-08-01/mesures/ambre-030-v3-gate.jsonl

npm test -- tests/tools/video/character-in-location.test.ts \
  tests/scripts/insert-character-in-location.test.ts
/tmp/codebuddy-visual-gate-20260801/bin/python -m unittest \
  tests.scripts.influencer.test_visual_gate
npm run typecheck
npm run lint
```

Résultats de vérification du code : 12 tests Vitest réussis, 26 tests Python
réussis, typecheck réussi, lint réussi.
