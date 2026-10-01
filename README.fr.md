# Code Buddy 2 — agent de code local-first

L’angle de la sortie prévue le 8 octobre est un agent de code en terminal qui doit
fonctionner sur **une installation neuve avec un petit modèle local**, dès la
première tâche et jusqu’à la vérification du résultat. **Ce critère n’est pas
prouvé par les traces de cette branche.**

Le modèle propose des actions ; Code Buddy exécute les outils selon les permissions
configurées. Ollama permet un usage local avec un modèle capable d’appeler des
outils. Les fournisseurs cloud sont optionnels.

<!-- proven-features:start -->
## État des fonctionnalités

[`PROUVÉES 1/338 | NON PROUVÉES ICI 337 | DONT DERNIERS ESSAIS EN ÉCHEC 9`](docs/FONCTIONNALITES-PROUVEES.md)
**1/338 fonctionnalités prouvées** ; 337 non prouvées ici, avec raison (dont 9 derniers essais en échec, historiques si l’empreinte est périmée).
Chaque état « prouvée » est limité au composant et au scénario capturés, avec la limite du scénario lorsqu’elle est consignée. Ce total ne valide pas une installation neuve.
[Statuts, raisons et traces par domaine](docs/FONCTIONNALITES-PROUVEES.md) · [English: feature status](docs/PROVEN-FEATURES.md)
<!-- proven-features:end -->

## Installation et premier essai

```bash
npm i -g @phuetz/code-buddy
buddy --version
buddy doctor --offline
```

Après avoir installé et démarré Ollama avec un modèle adapté, `buddy onboard`
configure le parcours local. `buddy try` propose un exercice dans un projet jetable :
il faut examiner les fichiers produits et la sortie des tests. Ces commandes sont
des points d’entrée, pas une preuve de réussite sur installation neuve.

La source est un candidat 2.3.0 ; le paquet publié peut être différent. Voir le
[README principal](README.md), le [guide de démarrage](docs/getting-started.md) et
les [conditions d’installation](docs/install.md).

## Limites visibles

La voix, le compagnon, la conversation parlée, Telegram public et les cinq entrées
Cowork restent **non prouvés ici**, avec les raisons dans le catalogue. Les derniers
essais LSP et compréhension vidéo ont échoué ; leur empreinte périmée ne permet pas
de conclure sur le code courant. Les propositions d’apprentissage et de variantes
ne démontrent aucune amélioration retenue ni aucun gain de productivité.

Les [mécanismes de mémoire et de proposition](docs/learning-mechanisms.md) sont une
description du code et des conditions d’activation. Les inspirations scientifiques
ne constituent pas des résultats mesurés de Code Buddy.

Licence Business Source License 1.1 : consulter [LICENSE](LICENSE).
