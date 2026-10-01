# Catalogue des fonctionnalités

`buddy catalog status` produit un tableau Markdown ; `--json` produit le même état structuré.

L'inventaire `inventory.json` nomme les fonctionnalités suivies, leurs fichiers de code et les maillons attendus entre un point d'entrée et l'implémentation. Le générateur vérifie chaque fichier et chaque extrait de code à la lecture. Il retire les commentaires avant la recherche des maillons. Cette analyse statique établit un raccordement déclaré dans le code ; elle ne prouve pas que les prérequis, permissions ou services externes permettent une exécution sur une machine donnée.

Chaque état vaut `vrai`, `faux` ou `inconnu`. Une source ou un maillon annoncé et absent donne `faux`. Une information non déclarée donne `inconnu`. Une preuve d'exécution vaut pour `TESTÉE EN SITUATION` si sa révision est celle du code courant, ou si son empreinte optionnelle `sourceDigest` correspond encore aux fichiers de code, de raccordement et à la déclaration structurelle de cette fonctionnalité. Une preuve plus ancienne reste affichée dans `lastProof`. Un échec récent sur la même source donne `faux`.

La version installée est confirmée seulement lorsque la commande s'exécute depuis le paquet npm installé. Un lancement depuis un checkout ou un export de test garde `DÉPLOYÉE` à `inconnu`. Le paquet contient cet inventaire et `docs/preuves/` ; les chemins `src/*.ts` sont alors vérifiés dans les modules `dist/*.js` correspondants.

Une preuve est un JSON dans `docs/preuves/` : `schemaVersion: 1`, `featureId`, `kind` (`integration` ou `field`), `result` (`passed` ou `failed`), `date` ISO, `revision` Git, `artifact` relatif au dépôt et `summary`. La trace doit être un fichier non vide sous `docs/preuves/` ou `tests/integration/`, sans sortie du dépôt. Pour une **nouvelle exécution réelle**, `currentCatalogSourceDigest(root, featureId)` donne l'empreinte à inscrire dans `sourceDigest` : elle couvre `codePaths`, `entrypoint`, et le contenu des fichiers de code et de raccordement de cette seule fonctionnalité. Une correction de libellé ailleurs dans l'inventaire ne périme plus toutes les preuves. Les anciennes empreintes qui couvraient tout `docs/catalog/inventory.json` restent reconnues tant que leurs fichiers n'ont pas changé ; elles ne sont pas converties sans nouvelle exécution. Le champ `proofs` d'une entrée de l'inventaire accepte les mêmes champs hors `featureId` et `schemaVersion`. Un test défini mais jamais exécuté ne constitue pas une preuve de fonctionnement.

Après avoir rejoué et contrôlé la trace sur le candidat à publier, calculer par exemple l'empreinte avec `npx tsx -e "import { currentCatalogSourceDigest } from './src/catalog/status.ts'; console.log(currentCatalogSourceDigest(process.cwd(), 'catalog-status'));"`. Sans nouvelle trace, garder l'état `inconnu` d'une preuve périmée.

Le générateur ajoute les commandes CLI enregistrées dans `src/index.ts` et les noms d'outils déclarés dans `src/tools/metadata.ts`. Une entrée ainsi découverte ne prouve pas à elle seule l'existence de l'implémentation ou du chemin d'exécution de l'outil : ces états restent `inconnu`. L'inventaire explicite couvre 91 capacités visibles par l'utilisateur, regroupées en 11 domaines. `domain`, `benefit.en`, `benefit.fr` et `verificationLimit` documentent leur portée et la raison d'une absence d'essai réel. Le champ `discoveryKey` évite de doubler une entrée découverte. Les fonctions internes et les entrées non détectables statiquement demandent encore une entrée explicite.

L'[audit statique](../preuves/verification-statique.md) répertorie les maillons vérifiés et les limites de chaque entrée. Il ne constitue pas une preuve d'exécution. Les [vitrines française](../FONCTIONNALITES.md) et [anglaise](../feature-catalog.md) renvoient à cette source ou à une trace réelle sous `docs/preuves/` lorsqu'un parcours a été exécuté.

## Qualification de la vitrine après audit

La vitrine utilise deux statuts : **Prouvée** ou **Non prouvée ici**, avec raison.
`showcase-review.json` qualifie le contenu de chaque trace : un manifeste `passed`,
un raccordement ou un résumé sans sortie suffisante ne valide pas le bénéfice annoncé.
Une acceptation est attachée au chemin et au SHA-256 du journal examiné ; une trace
nouvelle ou modifiée exige une nouvelle qualification. L’empreinte source doit aussi
être valide. Cette revue documentaire ne crée ni ne modifie une preuve d’exécution.

`showcase-status.json` contient les états et compteurs générés : les derniers essais
en échec sont un sous-ensemble des entrées non prouvées, y compris lorsque la source
est périmée. Les essais remplacés restent dans les journaux historiques, sans devenir
un échec courant. Le CLI `catalog status` conserve son calcul mécanique d’intégrité ;
il ne qualifie pas le contenu et ne constitue pas le compteur éditorial de la vitrine.

Les deux README, les pages détaillées FR/EN et les trois résumés sont régénérés ensemble :

```bash
node --import tsx scripts/generate-proven-features.ts
node --import tsx scripts/generate-proven-features.ts --check
```

Les résultats P9 relus sur une autre branche ne sont pas importés dans cet arbre.
Le critère de sortie reste une installation neuve avec un petit modèle local et une
première tâche vérifiée ; aucune trace de ce catalogue ne prouve ce parcours complet.

## Contrôle des formulations documentaires

Aucun compte d’outils ou de fournisseurs n’est utilisé comme argument dans les pages de présentation ou de marketing. Une référence technique ne peut publier un tel compte que s’il est exact et produit par un script du dépôt ; cette reprise retire les comptes fixes non mesurés. Les quantités d’un scénario enregistré, limites d’exécution et exemples ne sont pas des totaux du catalogue.

```bash
node --import tsx scripts/check-showcase-claims.ts
node --import tsx scripts/check-showcase-claims.ts --json
node --import tsx scripts/check-showcase-claims.ts --revision <commit> --json
```

Le contrôle parcourt tous les fichiers textuels suivis, et les nouveaux fichiers non ignorés, du périmètre documentaire : README et Markdown à la racine, `docs/**`, Markdown sous `cowork/**`. Il ne suit pas seulement les liens. Les variantes numériques, plages, suffixes `+`, quantités écrites en lettres, qualifications de registre et comptes inversés sont détectées. Les SVG et métadonnées HTML sont inclus. Toute occurrence est consignée avec sa ligne et sa classification ; le code de sortie vaut 1 pour une assertion non qualifiée.

Les journaux, archives, audits et propositions sont recensés séparément. Les comptes rendus historiques de référence et sections datées autorisés sont nommés dans le script et portent une limite explicite ; un nouveau document ne peut pas s’exempter en ajoutant un marqueur. Les résultats et statuts générés restent soumis au contrôle du générateur et à la revue du catalogue. Les tests de la vitrine exécutent ce garde et exercent les variantes de formulation.

Le contrôle reste lexical : son zéro signifie « aucune violation des règles exécutées », pas une preuve universelle d’absence de survente. Une nouvelle formulation doit être examinée et, si nécessaire, ajoutée aux cas de régression.
