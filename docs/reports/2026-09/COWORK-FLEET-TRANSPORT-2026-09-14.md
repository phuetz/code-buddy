# Transport Fleet partagé — reprise Cowork

État : correctif relu, validation complète verte.

La revue du lot Cowork de Claude Opus a identifié un défaut dans le listener
partagé : après une tentative échouée avant le message d'accueil, un ancien
callback d'authentification pouvait armer un délai lors de la tentative suivante.
Ce délai fermait ensuite le nouveau socket, même authentifié. Le test de
régression échouait avec un socket fermé au lieu d'ouvert.

Le correctif Codex rattache les délais de connexion et d'authentification à leur
socket local, les nettoie au règlement de la tentative et ignore les callbacks
des sockets remplacés. Il supprime le callback interne `once` persistant sans
changer les messages ni les événements publics du protocole.

Une sonde avec de vrais sockets a également reproduit un crash lors du
remplacement d'une connexion encore en négociation : fermer son socket après
retrait des handlers provoquait une erreur `ws` non gérée. Le remplacement
rejette maintenant immédiatement l'ancienne tentative, annule ses délais et
consomme les erreurs de fermeture. Il réinitialise aussi l'authentification et
rejette les RPC de l'ancien socket ; un nouveau socket ouvert ne peut émettre
de RPC avant sa propre authentification.

Quatre régressions couvrent les délais, le remplacement et l'isolation des RPC,
dont un sous-processus avec serveur loopback réel. La suite du listener passe :
**49/49**. TypeScript et lint ciblé sont verts.

Contre-validation Codex après assemblage : listener **49/49 sous Node 20.20.2**,
y compris la sonde réelle ; Cowork **69/69** sur cinq suites voisines, lint
ciblé propre. Typecheck Cowork : exactement les mêmes 20 diagnostics que la base
`d579f26ec`, tous dans le noyau partagé, aucun nouveau diagnostic.

`npm run validate` avec HOME et CODEBUDDY_HOME isolés, quatre workers, après
ajout des nouveaux fichiers au suivi Git : **exit 0**, lint/typechecks/pack verts,
**2 150 fichiers verts, 9 ignorés ; 38 538 tests verts, 37 ignorés, 1 todo**.
Les gardes navigateur ignorent les cas exigeant le cache Chromium absent de ce
profil. Log : `/tmp/cb-cowork-final-validate.log`.

L'API du listener reste appelable en concurrence ; remplacer une tentative
rejette désormais immédiatement sa promesse, que l'appelant doit observer.
La sérialisation des tentatives du panneau Cowork appartient au lot Opus
distinct. Aucun serveur utilisateur ni robot physique sollicité.
