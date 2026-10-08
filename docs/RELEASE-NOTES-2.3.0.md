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
- @@CACHE@@

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

@@VALIDATION@@
