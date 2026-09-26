# Provenance et fraîcheur de la mémoire

Activer avec `CODEBUDDY_MEMORY_PROVENANCE=true` ou `provenanceEnabled: true` dans `PersistentMemoryManager`. Sans activation, les sorties et les écritures historiques restent inchangées. Le contexte relationnel de Lisa reprend ce drapeau ; son composeur accepte aussi `provenanceEnabled` pour une invocation précise.

Chaque entrée persistante peut porter une classe `preference`, `observation`, `hypothesis` ou `report`, ainsi qu'une provenance : `observedAt` (date ISO du constat), `machine`, `channel`, `verification` et `source`. Exemple d'appel :

```ts
await manager.remember('build-state', 'la compilation réussit', {
  kind: 'observation',
  provenance: {
    observedAt: new Date().toISOString(),
    machine: 'poste-de-test',
    channel: 'cli',
    verification: 'commande de compilation terminée avec succès',
    source: 'journal de vérification',
  },
});
```

Le commentaire `meta` Markdown stocke la classe et la provenance encodée en base64url ; le texte de l'entrée reste lisible. Une entrée antérieure est conservée telle quelle et reçoit, au prochain enregistrement avec le mode actif, une classe prudente et une provenance inconnue. Les dates de fichier et de rappel ne sont jamais utilisées comme date de constat. Une mise à jour sans nouvelle preuve n'hérite pas de la preuve de l'ancienne valeur. Les archives d'oubli conservent les nouveaux champs, et la restauration ne rajeunit pas le constat.

Dans les contextes injectés, la date, l'âge, la machine, le canal et la preuve sont explicites. Une observation de plus de sept jours est étiquetée « périmée : ne pas présenter comme actuelle » ; une date absente ou future donne une fraîcheur inconnue. Le rappel d'une entrée ne change pas cette horloge. La mémoire utilisateur acceptée par Lisa présente aussi la date et la validation humaine ; les observations sans source gardent la mention « provenance inconnue ». Les hypothèses restent désignées comme telles même après validation humaine de leur stockage.

Les vues `/memory list`, `/memory recent`, `/memory recall` et `/memory archived` affichent cette attribution en mode actif. Le temps relatif de `recent` est nommé « stored » : il décrit la mise à jour du fichier et ne remplace pas la date du constat. Les résultats du second index sémantique, qui ne portent pas cette provenance, sont explicitement signalés comme non attribués.

Le mode attribué écrit directement les nouveaux souvenirs au lieu de les confier à la réconciliation par modèle, qui pourrait fusionner deux affirmations et mélanger leurs sources. Les lecteurs de fournisseurs distants ne disposent pas de ce format local.
