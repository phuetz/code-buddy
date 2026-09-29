# Reprise de la relecture n°9 de la PR #259

Branche `fix/securite-2-3-0`, départ `339a67968`, correctif `2e4567256`. La relecture indépendante n°9 a été lue en entier. Tous les essais ont utilisé `_qa/securite-reprise-9` et `_qa/securite-reprise/runner-home`, avec des jetons fictifs. Aucun identifiant personnel ni fichier `.env` du propriétaire n'a été ouvert.

## Bloquants, traitement et preuve

| Constat | Traitement | Preuve rouge avant / verte après |
|---|---|---|
| **B9 :** `env`, `nice`, `timeout`, `stdbuf`, `nohup`, `command`, `exec`, `xargs`, `\git`, `env sh -c`, `env -C` et `GIT_DIR` pouvaient restituer une valeur de `.env` suivi sans passer par le contrôle Git d'entrée. | Ajout d'une barrière indépendante à la sortie publique de `BashTool` : empreintes des valeurs de fichiers secrets suivis, présents dans l'index, le travail ou l'historique Git, puis remplacement des occurrences littérales par `[REDACTED]`. Les chemins de répertoires littéraux indiqués dans la commande complètent le dépôt courant. Le contrôle d'entrée reste actif. | État initial : 10 échecs sur 11 du premier lot de régressions ; la relecture n°9 reproduit 13 sorties en clair. La variante `env -C` / `env --chdir=` échouait encore 2 fois sur 48 lors de cette reprise, avec le secret en clair ; après correction, **50/50 verts**. Les tests vérifient aussi les options globales et sous-commandes des relectures précédentes. |
| **B9bis :** `git cat-file -p <hash>` restituait le blob d'un secret suivi. | La sortie est masquée même si le nom du fichier n'apparaît ni dans la commande ni dans la sortie. | Relecture n°9 : hash obtenu par `git ls-files -s`, puis sortie en clair. Test de reprise : `env git cat-file -p <hash>` est autorisé par le validateur, réussit et rend `API_KEY=[REDACTED]`. |
| **R4 :** chemin `.env` composé à l'exécution, hors analyse statique. | La même barrière masque la valeur du secret suivi après exécution. | Relecture n°9 : `Z=; cat .en${Z}v` rendait le jeton. Le test conserve l'autorisation d'entrée, vérifie l'exécution et obtient `API_KEY=[REDACTED]`. |
| Fuite possible entre fragments de flux, dans `error`, par `shellFreeExec` ou par le ripgrep direct. | Le flux est accumulé jusqu'à la fin du processus avant publication ; les champs `output` et `error`, les chemins directs et les diagnostics du sandbox passent par la même barrière. Inventaire incomplet ou sortie de plus de 2 Mio : sortie retenue. | Tests de fragments séparés, de sortie finale, d'erreur, de `shellFreeExec`, de ripgrep, d'historique après suppression, de rafraîchissement après commit, de sortie trop longue et d'inventaire incomplet : **verts**. |
| Risque de faux positif ou de régression sur une sortie ordinaire. | Les fichiers de modèle public restent exclus par le classificateur ; les valeurs publiques reconnues d'un `.npmrc` ne sont pas masquées. | Tests `printf bonjour` dans un dépôt neuf, `printf false` avec `.npmrc` suivi, et sortie Git dont les noms de clés et chemins restent lisibles : **verts**. |

Le cache persistant ne contient que des empreintes (hash roulant et SHA-256) ; les octets des fichiers sont lus temporairement, ne sont pas journalisés et ne sont pas placés dans les messages retournés. L'index des références Git est recalculé après changement de tête, branche ou reflog ; les fichiers suivis du travail sont relus à chaque résultat.

## Validation

`npm test -- --configLoader runner tests/security/reprise-9-sortie-git.test.ts` : **50/50**. Périmètre élargi `tests/security tests/bash tests/unit/git-tool.test.ts tests/tools/video/video-understanding.test.ts` : **81 fichiers, 1 531 tests**. `npx vitest run --configLoader runner tests/security/donnees-personnelles.test.ts` : **40/40**. `npx tsc --noEmit`, ESLint ciblé et `git diff --check` : **verts**.

## Décision de version

**Ce correctif doit bloquer la 2.3.0 ; il ne doit pas attendre la 2.3.1.** La PR est annoncée comme un correctif de sécurité et la relecture prouve une fuite exploitable dans son état précédent. Le résultat de cette reprise doit encore être relu indépendamment avant la publication. Cette barrière compare des valeurs littérales ; une commande qui transforme ou encode la valeur peut toujours déjouer la comparaison, en particulier quand l'analyse d'entrée laisse passer un chemin calculé. Il faut garder le confinement natif comme frontière de sécurité pour cette classe de commandes et ne pas annoncer que la sortie shell est protégée contre toute transformation arbitraire.

## Ce que je n'ai pas pu vérifier

- Le cycle complet avec un modèle, l'interface Ink, Electron et la suite totale d'environ 27 000 tests n'ont pas été exécutés.
- Windows et macOS, le confinement natif, les dépôts bare ou externes désignés par un chemin entièrement calculé, ainsi que toutes les transformations possibles des secrets en sortie n'ont pas été éprouvés.
- Le changement de flux retarde désormais ses fragments jusqu'à la fin de la commande ; l'effet sur l'expérience utilisateur longue durée n'a pas été mesuré.
- Aucun jeton réel, aucun envoi réseau et aucune publication de la PR n'ont été utilisés.
