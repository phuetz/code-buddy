# Point de reprise — pipeline MySoulmate → YouTube

**Date** : 2026-07-18
**Statut** : pilote V3 préparé ; droits voix et worker validés, rendu suspendu par garde thermique

## Résultat disponible

- Plan local : `/home/patrice/DEV/MySoulmate/youtube-shorts-workspace/plan.json`
- Trois masters privés FR planifiés : trois histoires Lisa
- 9 clips LongCat ; gate éditorial final : 100/100 pour les trois masters
- Manifeste Flow local : neuf plans `ambient-only`, 90 crédits Fast estimés,
  aucun appel Google et aucun crédit consommé
- Sortie attendue : MP4 720×1280/30 FPS, VTT localisé, sidecar YouTube privé,
  SHA-256 du master, des captions et des clips, provenance de voix

## Garde-fous livrés

- Le renderer commercial accepte uniquement le schéma V3 et exige un registre
  de voix explicitement approuvées, lié à la locale et à la provenance.
- Les profils Piper sont liés au SHA-256 des poids ; le cache inclut la révision
  du profil vocal.
- Les assets sont confinés, non symlinkés et revérifiés par empreinte avant usage.
- L'approbation QA MySoulmate est liée aux octets jusque dans le manifeste ; une
  image remplacée redevient `pending`.
- Les jobs avatar sont idempotents par `turnId` côté worker ; annuler dans Cowork
  arrête aussi les variantes suivantes et n'active aucun fallback payant.
- Les montages restent privés et `humanReviewRequired`; une durée inconnue ou
  une métadonnée QA absente échoue en mode fermé.

## État runtime observé

- `mysoulmate-image-catalog.service` reste indépendant du rendu vidéo et ne doit
  pas être interrompu pour libérer l'autre GPU
- Aucun master final rendu
- Preflight réel : 9 sources approuvées, profil voix FR commercial autorisé,
  révision LongCat valide et file worker disponible
- Premier clip pilote lancé puis annulé à 72 % : GPU 0 à 95 °C, aucun MP4 produit
- GPU 1 identifié comme le service ComfyUI MySoulmate et laissé intact
- Runner renforcé avec arrêt thermique à 88 °C après deux mesures consécutives
- Retry vocal renforcé : le WAV normalisé est conservé avec un SHA-256 local,
  réutilisé seulement si les octets correspondent, et le `turnId` inclut
  l'identité du WAV. Une nouvelle synthèse non déterministe ne peut donc plus
  entrer en collision avec le job précédent ni se faire passer pour lui.

Ne pas reconstruire `companion-image-cache/manifest.json` tant que le service de
génération est actif. Ne jamais approuver les images en masse.

## Reprise opérateur

1. Déployer/recharger le worker Darkstar avec la garde thermique à 88 °C.
2. Vérifier à froid que le preflight expose la nouvelle révision du runner.
3. Diagnostiquer le refroidissement de la RTX 3090 n°0 avant un nouveau rendu
   long : flux d'air, poussière, pâte/pads thermiques et température ambiante.
4. Reprendre le même Short FR ; le journal idempotent recréera uniquement le job
   annulé, sans valider l'essai incomplet.
5. Rendre ce Short, puis contrôler manuellement voix, lip-sync, identité,
   anatomie, VTT, durée, codecs et sidecar.
6. Seulement après cette revue, rendre son master EN puis étendre au lot.
7. Importer et vérifier les résultats Flow avant montage ; ne pas automatiser la
   publication YouTube à ce stade.

## Validation technique

- Typecheck Code Buddy : OK
- Tests cœur pipeline : 69 OK
- Tests Cowork ciblés : 40 OK
- Tests MySoulmate ciblés : 12 OK
- Lints ciblés : OK
- Build Cowork renderer/main/preload : OK
- Preflight V3 : OK
- Test garde thermique : OK, arrêt du groupe de processus après deux mesures
- Pilote : annulation de sécurité à 95 °C, sortie non validée

Le typecheck Cowork global conserve des diagnostics `noUnused` préexistants dans
des modules hors pipeline ; les deux erreurs introduites sur la durée du montage
ont été corrigées et le build complet passe.
