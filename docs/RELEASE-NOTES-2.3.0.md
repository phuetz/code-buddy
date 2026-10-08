# Code Buddy 2.3.0 « Code Buddy 2 »

Cette version rassemble le centre de flotte multi-IA, l'atelier d'applications de Cowork, les fonctions optionnelles de « Code Buddy 2 »
et une série de correctifs trouvés à l'usage réel : édition de fichiers, bac à sable, skills importés, cache du prompt, coûts, compatibilité Claude 5.5.
Le détail ligne par ligne, avec les commits, est dans le [changelog](../CHANGELOG.md) ; les fonctions nouvelles et leurs limites sont dans
[whats-new-2.3.md](whats-new-2.3.md).

## Ce qui change pour vous

### Sécurité

- **Bac à sable natif** (`CODEBUDDY_NATIVE_SANDBOX`, optionnel) : les sockets des moteurs de conteneurs (docker, containerd, podman, cri-o) ne sont plus joignables depuis `bash` ;
  `/run/user` (bus de session, agents ssh et gpg) et le bus système sont masqués. Sous Landlock, qui ne peut pas filtrer ces connexions, la commande est refusée quand un socket est joignable.
  Sans la variable, `bash` s'exécute comme avant.
- **Skills importés** : leurs scripts sont importés sans bit exécutable, et les lancer demande une confirmation explicite (jamais approuvée automatiquement, refusée sans humain).
- **Lecteurs de fichiers** : les fichiers d'identifiants classés sont refusés ; le serveur écoute `127.0.0.1` par défaut.
- **Dépendances** : 0 avis critique, 27 avis hauts documentés avec motif et échéance (porte d'audit de la CI).
- **Appels auxiliaires** (leçons, mémoire, résumés) : ils suivent le fournisseur de la session, plus le login ChatGPT.

### Fiabilité

- `str_replace` et `multi_edit` refusent une occurrence ambiguë au lieu de modifier la première en silence ; `apply_patch` est tout ou rien et conserve CRLF et BOM.
- LM Resizer ne perd plus une erreur située au milieu d'une longue sortie ; un échec reste visible.
- `buddy research` se termine avec le moteur Rust du graphe de connaissances.
- Le coût d'un appel payant n'est plus affiché « 0 $ forfait » ; le plafond de session n'est plus annulé par une URL de bouclage.
- Une boucle d'agent qui explore sans écrire est recentrée ; la progression de `-p` ne dépasse plus 100 %.

### Performance — cache

- Le préfixe du prompt reste stable d'un tour à l'autre (date et dossier après le préfixe, contexte variable en ajout seul, expiration des anciens résultats d'outils par paliers).
- Mesure sur cette version : 50 requêtes d'un audit en lecture seule de 36 fichiers (OpenRouter, `deepseek/deepseek-v4.1-flash` servi par DeepInfra), 89,5 % des jetons d'entrée lus en cache (92,5 % de la 21e à la 40e requête), 0,03 $ au total, contre 30 à 45 % avant le correctif. Les ruptures de préfixe tombent aux paliers d'expiration (messages 7 et 25) et une fois sur le message système ; un seul modèle et un seul fournisseur ont été mesurés.

### Compatibilité Claude 5.5

- Modèle par défaut `claude-sonnet-5-5` pour le fournisseur `anthropic` ; `temperature`, `top_p` et `top_k` ne sont plus envoyés aux modèles qui les refusent ;
  un appel d'outil ne casse plus au deuxième tour ; une réponse vide devient une erreur explicite.

### Déjà dans cette version (depuis 2.2.0)

Premier contact amélioré, `buddy config set|patch|unset`, historique unifié (terminal, Cowork, mobile), atelier d'applications de Cowork (correction automatique, versions, export),
`buddy deploy run` et `buddy provision db-auth` (simulation par défaut), `buddy figma import`, sources de recherche RSS, GitHub et Hugging Face.

## Installer et vérifier

```sh
npm install -g @phuetz/code-buddy@2.3.0
buddy --version
buddy doctor --offline
```

Node.js 20 ou plus récent.

## Validation et limites connues

- **CI de `main` du 07/10** : un seul job rouge, « Security Audit » (`scripts/ci-audit-gate.mjs`), à cause de cinq avis critiques (`simple-git`, `@simple-git/argv-parser`, `proxy-addr`, `node-llama-cpp`, `shell-quote`) et d'avis hauts non listés dont le SDK MCP (< 1.31.0). La branche d'audit des dépendances corrige quatre critiques ; `shell-quote` (1.12.0) et le SDK MCP (1.32.1) le sont par un commit de l'assemblage. La porte passe sur cette version : 0 critique, 27 avis hauts documentés. La CI complète de cette branche (Node 20 et 22, Ubuntu, Windows, macOS) n'a pas encore tourné : à lire sur la demande de fusion.
- `npm run typecheck`, `npm run lint` (0 erreur, 2 602 avertissements) et `npm run build` : verts. Typecheck de Cowork : vert.
- **Vitest, dépôt racine, 4 fragments (2 473 fichiers, 42 000 tests)** : dernier passage complet, 4 tests rouges. Deux sont déjà rouges sur `main` : `tests/hygiene/home-isolation` (variables XDG) et `tests/security/prenoms-code-public` (il exclut les noms de `git config user.name`, ici « t », qui est contenu dans presque tout le code). Deux sont des délais de 20 s dépassés sous une machine saturée (charge 46 sur 24 cœurs : `serv2-openai-usage`, `kyutai-local-voice`) ; ils passent 3 fois sur 3 isolés. Le fichier `screen-recorder` échoue si la session est Wayland (comportement voulu du code) et passe en session X11, comme sur la CI.
- **Cowork** : 3 653 tests verts, 2 rouges déjà présents sur `main` (licence du verrou attendue MIT alors que le dépôt est sous BUSL-1.1 ; décompte des passerelles de protocole). Les tests touchés par le correctif Claude 5.5 passent.
- **Harnais d'évaluation** : `eval/run-task.mjs`, 6 tâches sur 6 ; `eval/harness-benchmark.mjs`, 17 sur 17.
- **Paquet npm** (`npm pack`, installation dans un dossier personnel vierge) : `buddy --version` donne 2.3.0, `buddy doctor` ne relève aucune erreur (22 contrôles passés, il sort en code 1 tant qu'aucun fournisseur n'est configuré), et deux vraies requêtes `buddy -p` avec un abonnement ChatGPT répondent (texte, puis lecture d'un fichier par un appel d'outil).
- **Non vérifié** : un appel réel à l'API Anthropic avec les modèles 5.5 (aucune clé dans l'environnement de l'assemblage ; les essais de l'auteur du correctif et les rejeux de fixtures sont la seule preuve), le banc Codex et qwen sur la machine Windows, les essais de bout en bout de Cowork, l'extension VS Code, l'installation sous macOS et Windows.

### Limites connues

- Un secret suivi par Git peut encore être lu par une commande shell qui lit les objets du dépôt : la garantie est reportée en 2.3.1 (voir la section Sécurité du changelog).
- Reportés en 2.3.1 : les correctifs de sécurité du service mobile (relecture « à corriger » : un jeton d'appareil absent du magasin est accepté par `/desktop`) et les tarifs de la gamme Claude 5.5 (absents de la table des prix : l'estimation de coût utilise le prix d'un modèle inconnu).
- Les 27 avis hauts acceptés de `audit-allowlist.json` ont tous pour échéance de relecture le **14/10/2026** : passé cette date, la porte d'audit de la CI échoue de nouveau tant qu'ils ne sont pas réexaminés.
- Le bac à sable natif reste optionnel ; sous Landlock il refuse la commande plutôt que de masquer les sockets.
- Le catalogue des fonctionnalités et les notes précédentes restent la référence pour les limites des fonctions optionnelles de « Code Buddy 2 ».
