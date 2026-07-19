# Point de reprise — pipeline MySoulmate → YouTube

**Date** : 2026-07-19
**Statut** : premier master V3 privé rendu ; preuve technique validée, corrections visuelles requises

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
- Un master privé complet rendu : trois clips, 720×1280/30 FPS, H.264/AAC,
  10,328 secondes, WebVTT et sidecar liés aux empreintes
- Preflight réel : 9 sources approuvées, profil voix FR commercial autorisé,
  révision LongCat valide et file worker disponible
- Premier clip pilote lancé puis annulé à 72 % : GPU 0 à 95 °C, aucun MP4 produit
- Deux retries bornés ont confirmé le diagnostic initial : la garde a arrêté
  LongCat à 88 °C sous plafonds temporaires de 250/200 W puis 150/120 W.
- Après ouverture et dépoussiérage du boîtier, un grand ventilateur a abaissé la
  carte de 71 à 53 °C en 30 secondes à froid. Le même Short a ensuite terminé
  ses trois clips sous plafond 150 W, avec un bref passage à 180 W en fin de lot.
- Mesures en charge à 150 W : 58–67 °C ventilateur fort, 76–78 °C ventilateur au
  tiers, 81 °C boîtier ouvert seul. La garde à 88 °C est restée active.
- GPU 1 identifié comme le service ComfyUI MySoulmate et laissé intact
- Runner renforcé avec arrêt thermique à 88 °C après deux mesures consécutives
- Retry vocal renforcé : le WAV normalisé est conservé avec un SHA-256 local,
  réutilisé seulement si les octets correspondent, et le `turnId` inclut
  l'identité du WAV. Une nouvelle synthèse non déterministe ne peut donc plus
  entrer en collision avec le job précédent ni se faire passer pour lui.

Ne pas reconstruire `companion-image-cache/manifest.json` tant que le service de
génération est actif. Ne jamais approuver les images en masse.

## Reprise opérateur

1. Conserver le boîtier ouvert, le ventilateur externe et la garde thermique à
   88 °C pour tout nouveau lot LongCat.
2. Refaire les trois références du Short avec deux tasses réellement visibles,
   une place vide lisible et un costume/décor continus.
3. Recompiler le plan avec les nouveaux SHA-256 et refaire un seul master FR.
4. Contrôler manuellement voix, lip-sync, identité, anatomie, VTT, durée, codecs
   et sidecar ; enregistrer une approbation ou un nouveau reçu de corrections.
5. Seulement après cette revue, produire une variante ou étendre au lot.
6. Importer et vérifier les résultats Flow avant montage ; ne pas automatiser la
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
- Pilote final : trois clips et un master technique produits sans arrêt thermique
- Revue visuelle : corrections requises sur `identity` et `editorial`; bundle
  d'upload bloqué par reçu lié au SHA-256
- Tests gate qualité : 6 OK ; typecheck Code Buddy : OK après ajout du reçu
  `changes-requested`

Le typecheck Cowork global conserve des diagnostics `noUnused` préexistants dans
des modules hors pipeline ; les deux erreurs introduites sur la durée du montage
ont été corrigées et le build complet passe.
