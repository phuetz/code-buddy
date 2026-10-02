# Capacités de shell d’une mission sans terminal

`--permission-mode dontAsk` conserve les gardes d’exécution. Pour autoriser
explicitement les opérations confinées d’une mission de développement :

```sh
buddy -p "…" --permission-mode dontAsk --shell-capabilities tests,git-local,npm-registry
```

La variable opérateur `CODEBUDDY_SHELL_CAPABILITIES` accepte les mêmes noms.
Les refus explicites et les règles personnalisées restent prioritaires.

- `tests` autorise les routines npm de tests, compilation et audit, ainsi que
  la consultation de sa version. Le code du projet s’exécute dans le sandbox.
- `git-local` autorise `git add` et `git commit` dans le dépôt courant. Le
  sandbox garde les configurations, hooks et références distantes en lecture
  seule. Les commandes de publication et de réécriture restent contrôlées.
- `npm-registry` donne accès à `npm audit`, `npm view` (versions) et
  `npm install|update --package-lock-only`. Une passerelle Unix lance le npm
  de l’installation Node dans un répertoire privé, avec registre fixe,
  scripts désactivés, sans configuration utilisateur ni identifiants. Les
  résolutions de lock refusent les sources Git, fichiers et URL externes.
  L’audit conserve son JSON et son code de sortie, y compris les vulnérabilités.

Le shell conserve son réseau fermé. La passerelle et ses sous-processus sont
fermés avant la fin de l’appel. Les temporaires entre appels se trouvent dans
`$TMPDIR`, propre au workspace et au processus, retiré à sa fermeture.

Ces capacités concernent le backend natif local. Les backends Docker et SSH
conservent leurs propres politiques ; aucune permission réseau implicite
n’est ajoutée à ces backends. Linux est la plateforme de vérification du banc.
