# Intégration des six patchs Jules du 30 septembre 2026

Branche `jules/lot-cb-2026-09-30-nuit`, base `70bcab004` (`origin/main`). Six patchs appliqués dans l'ordre demandé avec `git apply --3way` ; quelques fichiers ne disposaient pas des métadonnées nécessaires et Git est retombé sur une application directe, sans conflit. Aucun push.

| Lot | Commit | Décision et correction |
| --- | --- | --- |
| Parité des outils multiagents | `fd73ead97` | Appliqué. `list_directory` et `self_describe` ajoutés au registre asynchrone ; écarts intentionnels explicités. Espaces finaux du test retirés. |
| Tests hors de `src` | `58955316c` | Appliqué. Cinq fichiers déplacés avec leurs 23 cas et noms de tests conservés. Contrôle d'hygiène de Jules corrigé : parcours Node portable, erreurs non masquées, extensions TS et TSX couvertes. Le déplacement renomme nécessairement les chemins de fichiers, sans supprimer ni renommer les cas. |
| Guide de flotte | `ab0ae7d19` | Appliqué. Exemples distants corrigés. Test de Jules corrigé : son ancienne heuristique pouvait passer sans examiner ces exemples ; assertions directes sur trois commandes et le secret. Script `initiate-recording.js` écarté car il écrasait un rapport à l'exécution ; rapport racine redondant écarté au profit de ce rapport. |
| Guardian non câblé | `4bd195fd6` | Appliqué. Recherche dans `src` : `guardian-agent.ts` n'est pas importé par la chaîne d'approbation ; les imports trouvés concernent le CodeGuardian spécialisé. Titre du guide ajusté pour refléter le statut autonome. |
| Tests Shadow portables | `9b766f2b6` | Appliqué sans changement d'intention : SHA-256 via Node et `USERPROFILE` isolé. Exécution fonctionnelle bloquée par le bac à sable, donc portabilité native non validée. |
| Alias `pattern`/`replacement` | `39d9723f1` avant finalisation du suivi | Appliqué. Test étendu au schéma Zod, pour vérifier aussi la normalisation. |

## Preuves rouge → vert

- Parité : test 1/1 vert ; retrait temporaire des deux ajouts → 1/1 rouge, écarts `list_directory` et `self_describe` ; restauration → vert.
- Hygiène : six suites 24/24 vertes ; restauration temporaire des cinq anciens fichiers sous `src` → contrôle 1/1 rouge, cinq chemins affichés ; retrait des copies → vert.
- Flotte : 1/1 vert ; ancienne version de `docs/fleet-guide.md` restaurée temporairement → 1/1 rouge sur la commande réseau ; version corrigée restaurée → vert.
- Guardian : test documentaire et suite d'isolation 43/43 verts ; anciennes pages restaurées temporairement → test documentaire 1/1 rouge ; pages corrigées restaurées → vert.
- Alias : éditeur et validation 203/203 verts ; retrait temporaire des alias dans les extracteurs → nouveau cas 1/1 rouge ; restauration → vert.
- Shadow : pas de preuve rouge → vert exécutable ici. Les quatre tests échouent avant leur logique sur `spawnSync git EPERM` et la garde HOME. Rejoués avec les deux fichiers de test d'avant patch, ils échouent de la même façon (2 suites, 4 cas) ; le blocage n'est donc pas créé par ce patch. Le résultat annoncé par Jules (4/4 local et 4/4 avec simulation `CI_PORTABLE_WIN32_HOME=1`) n'est pas reproduit dans ce bac à sable ; la simulation Linux ne prouve pas Windows natif.

## Vérifications finales

- `npm run build` : succès, TypeScript et copie des ressources terminés.
- 14 suites ciblées et voisines : **354 tests réussis** (registre, éditeur, validation, six suites déplacées, docs, Guardian).
- ESLint sur les sources et tests touchés : 0 erreur, 1 avertissement préexistant (`DANGEROUS_PATH_PATTERNS` inutilisé, ligne 75 d'`input-validation/index.ts`).
- `git diff --check` : succès. Recherche des lignes ajoutées : aucun chemin personnel, nom de machine ni secret en clair ajouté. Les cinq tests historiques sont des déplacements avec cas conservés.
- Installation npm hors réseau : `npm ci --offline --ignore-scripts` a échoué sur une archive absente du cache (`@opentelemetry/sdk-trace`). Vérifications réalisées avec les dépendances locales déjà installées du dépôt principal, même Vitest 4.1.9 et TypeScript 5.9.3 que le verrou.

## Verdict

**À REPRENDRE** pour le lot complet : les cinq lots vérifiables sont intégrables localement ; le lot Shadow doit encore passer dans un environnement autorisant les sous-processus, puis sur macOS et Windows natifs avant de confirmer la portabilité annoncée.

## Ce que je n'ai pas pu vérifier

- Tests Shadow fonctionnels : `spawnSync git EPERM` dans les forks Vitest ; essai de pool threads bloqué par `ERR_WORKER_INVALID_EXEC_ARGV` lié à `--max-old-space-size=8192`.
- Réseau entre deux machines, tunnel Tailscale/LAN, et écoute réelle du serveur : aucun socket distant autorisé ici.
- Windows et macOS natifs, installation npm propre, suite Vitest complète et GUI Avalonia (ce dépôt est TypeScript et ne contient aucun projet .NET/Avalonia concerné). Docker non disponible et non lancé.
