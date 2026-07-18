# Point de reprise — pipeline MySoulmate → YouTube

**Date** : 2026-07-18
**Statut** : pilote V2 préparé et sécurisé ; rendu bloqué volontairement sur les droits voix

## Résultat disponible

- Plan local : `/home/patrice/DEV/MySoulmate/youtube-shorts-workspace/plan.json`
- Six masters privés planifiés : trois histoires, chacune en `fr-FR` et `en-US`
- 18 clips LongCat ; gate éditorial final : 100/100 pour les six masters
- Manifeste Flow local : neuf plans `ambient-only`, 90 crédits Fast estimés,
  aucun appel Google et aucun crédit consommé
- Sortie attendue : MP4 720×1280/30 FPS, VTT localisé, sidecar YouTube privé,
  SHA-256 du master, des captions et des clips, provenance de voix

## Garde-fous livrés

- Le renderer commercial accepte uniquement le schéma V2 et exige un registre
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

- `mysoulmate-image-catalog.service` actif depuis le 17 juillet 20:25 CEST
- Dernier journal observé : 3 690/17 280, `failed=0`
- Cache observé : 3 739 PNG, 4,2 Go
- Aucun master final rendu
- Preflight réel : sources et éditorial valides, puis arrêt attendu car
  `~/.codebuddy/voice-rights-registry.json` est absent

Ne pas reconstruire `companion-image-cache/manifest.json` tant que le service de
génération est actif. Ne jamais approuver les images en masse.

## Reprise opérateur

1. Faire valider juridiquement les profils FR et EN et leur provenance.
2. Créer `~/.codebuddy/voice-rights-registry.json` avec permissions `0600` à
   partir du modèle, sans recopier les valeurs `commercialUseApproved: false`.
3. Déployer/recharger le worker Darkstar avec l'idempotence `turnId` ajoutée.
4. Lancer le preflight sur un seul Short FR.
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
- Preflight : arrêt fail-closed attendu sur le registre de droits absent

Le typecheck Cowork global conserve des diagnostics `noUnused` préexistants dans
des modules hors pipeline ; les deux erreurs introduites sur la durée du montage
ont été corrigées et le build complet passe.
