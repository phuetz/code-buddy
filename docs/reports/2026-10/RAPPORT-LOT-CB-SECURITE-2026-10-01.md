# Intégration locale des six patchs sécurité Jules — 1er octobre 2026

Branche `jules/lot-cb-securite-2026-10-01-matin`, base `70bcab004` (`origin/main`). Six patchs examinés et appliqués dans l'ordre avec `git apply --3way`, un commit par patch. Aucun test existant supprimé, renommé ou affaibli. Les trois fichiers `MESSAGE.md` vides (plugins, lecture MCP, OAuth) ne contiennent aucune affirmation de tests à confirmer.

| Patch | Commit | Décision et corrections d'intégration | Preuve rouge → vert |
| --- | --- | --- | --- |
| Signature webhook sur corps brut | `6a21988c3` | Appliqué. Témoin GitHub renforcé avec un JSON dont les espaces sont significatifs ; octets `Buffer` conservés jusque dans le HMAC Slack. Cast Express corrigé ensuite dans le sixième commit pour le build. | Ancien calcul : 2/2 échecs ; correctif : 66/66 avec les tests historiques. L'annonce Jules « 1 vert, 1 rouge » n'était vraie que pour son témoin GitHub initial, qui ne distinguait pas les représentations. |
| Préfixes execpolicy / desktop | `9a6a4d1cb` | Appliqué. Le test de sous-chemin admet aussi un nom enfant commençant par `..` et suivi d'autres caractères. | Mutation de l'ancienne comparaison : 4 échecs / 54 ; correction : 54/54. |
| Confinement plugins | `a97f8d2f3` | Appliqué. Import CommonJS `require` du test remplacé par un import ESM. | Anciennes comparaisons par préfixe : 3 échecs / 5 ; correction : 5/5. Le cas `plugin-system` du test de Jules vérifie seulement le helper, pas le chargement réel. |
| Lecture MCP Cowork | `959227ae7` | Appliqué. Refus des dossiers frères et des liens symboliques sortants pour la lecture. | Ancienne résolution simulée : 2 échecs / 4 ; correction : 4/4. |
| Cloud tasks SSRF / contexte | `d2e88cacc` | Appliqué. Le fichier parasite `patch.diff` inclus dans le patch a été écarté. DNS simulé dans le test pour éviter la dépendance au réseau ; envoi via `safeFetchFollow` existant avec zéro redirection, afin d'épingler l'adresse vérifiée. | Ancienne lecture sans confinement : 1 échec / 3 ; ancien envoi `fetch` direct : 1 échec / 3 ; correction : 3/3. Le test fourni par Jules échouait avec le patch appliqué dans ce bac, car `example.com` ne se résolvait pas. |
| URL d'autorisation OAuth MCP | `HEAD` (sixième commit) | Appliqué. Le contrôle refuse les schémas non HTTP(S), HTTP hors boucle locale et les identifiants intégrés. Le sixième commit porte aussi le cast Express nécessaire au build du premier patch. | Sans le contrôle : 1 échec / 2 ; avec : 2/2. |

## Vérifications

- `npm run build` : succès après correction du cast Express ; le premier essai échouait sur deux diagnostics TS2352 dans `src/server/index.ts`.
- Vitest racine, lot webhook/execpolicy/plugins/cloud et voisins : 11 fichiers réussis, 235 tests réussis, 3 sautés ; `tests/server/webhooks-routes.test.ts` ne démarre pas (`listen 127.0.0.1 → EPERM` dans ce bac). Les tests voisins `plugin-manager` et `cloud-agent-runner` : 71/71.
- Vitest Cowork, nouveaux témoins MCP lecture et OAuth : 6/6. Suite voisine `mcp-oauth.test.ts` : 4/6 ; les deux autres échouent sur `listen 127.0.0.1 → EPERM`.
- `tsc --noEmit -p cowork/tsconfig.node.json` et `tsc --noEmit -p cowork/tsconfig.json` : succès.
- ESLint ciblé racine : 0 erreur, 6 avertissements dans les tests ajoutés. `git diff --check` : succès après indexation des six lots.

## Ce que je n'ai pas pu vérifier

- Les routes HTTP qui ouvrent un port, à cause du refus `EPERM` local. Les tests de ces routes devront être relancés sur un hôte autorisant `listen`.
- Windows, macOS, DNS et livraisons de webhooks réels. Le test de résolution publique utilise un DNS simulé. Le contrôle de lien symbolique Cowork vérifie le chemin avant la lecture ; une substitution concurrente du lien n'a pas été éprouvée.
- `npm run build:gui` : bloqué pendant la préparation de Node/Python embarqués (`getaddrinfo EAI_AGAIN` sur les serveurs de téléchargement). `vite build --configLoader runner` seul échoue sur un `__dirname` historique de la configuration ; le build GUI complet reste à relancer avec ses dépendances.
- Docker n'est pas disponible dans ce bac ; aucune commande Docker ni .NET n'était nécessaire pour ce dépôt TypeScript.
- Aucun test GUI Avalonia n'est présent dans ce dépôt ; aucune tâche de fond n'a été lancée.

**Verdict : À REPRENDRE** pour la validation des routes HTTP et d'OAuth sur un hôte autorisant les sockets, puis pour la recette réseau réelle. Les six correctifs sont intégrés localement.
