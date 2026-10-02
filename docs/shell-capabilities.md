# Capacités de shell d’une mission sans terminal

`--permission-mode dontAsk` conserve les gardes d’exécution. Pour autoriser
explicitement les opérations confinées d’une mission de développement :

```sh
buddy -p "…" --permission-mode dontAsk --shell-capabilities tests,git-local,npm-registry
```

La variable opérateur `CODEBUDDY_SHELL_CAPABILITIES` accepte les mêmes noms.
Les refus explicites et les règles personnalisées restent prioritaires.

- `tests` autorise les routines npm de tests, compilation et audit, ainsi que
  la consultation de sa version et `npm ls|list|explain`. Chaque segment des
  séquences ordinaires est vérifié, y compris quand une ligne les sépare. Le code du projet s’exécute dans le sandbox.
- `git-local` autorise `git add` et `git commit` dans le dépôt courant. Le
  sandbox garde les configurations, hooks et références distantes en lecture
  seule. Les commandes de publication et de réécriture restent contrôlées.
- `npm-registry` donne accès à `npm audit`, `npm view` (versions et champs de métadonnées) et
  `npm install|update --package-lock-only`. `npm pack <paquet-registre>` permet
  d’inspecter un paquet embarquant ses dépendances : scripts désactivés, archive
  unique de taille bornée dans `$TMPDIR`, sans écraser un fichier existant. Une passerelle Unix lance le npm
  de l’installation Node dans un répertoire privé, avec registre fixe,
  scripts désactivés, sans configuration utilisateur ni identifiants. Les
  résolutions de lock s’exécutent sans réseau, sans Git et sans le HOME de
  l’opérateur. Seules des métadonnées demandées à npmjs.org alimentent leur
  cache (une fois par paquet, volume et durée bornés). Les entrées Git/URL et
  les liens de workspaces déjà verrouillés doivent rester identiques ; toute
  création, modification ou suppression d’une entrée externe est refusée.
  Les sources `file:`/`link:` restent interdites.
  L’audit conserve son JSON et son code de sortie, y compris les vulnérabilités.
  Ses workspaces acceptent des chemins relatifs et glob simples locaux ; les
  chemins absolus, traversées et expansions ambiguës sont refusés avant npm.

Les scripts npm simples qui lancent Vitest utilisent `--configLoader runner`
quand aucun chargeur n’est demandé explicitement : les dépendances partagées
restent en lecture seule, sans configuration temporaire écrite dedans.

Le shell conserve son réseau fermé. La passerelle et ses sous-processus sont
fermés avant la fin de l’appel. Les temporaires entre appels se trouvent dans
`$TMPDIR`, propre au workspace et au processus, retiré à sa fermeture.

Ces capacités concernent le backend natif local. Les backends Docker et SSH
conservent leurs propres politiques ; aucune permission réseau implicite
n’est ajoutée à ces backends. Linux est la plateforme de vérification du banc.
