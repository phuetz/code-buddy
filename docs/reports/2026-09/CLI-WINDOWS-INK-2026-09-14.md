# CLI Windows : démarrage, modèle et interface Ink

Le journal utilisateur montrait un module TypeScript manquant dans le paquet npm publié. Le dépannage temporaire permettait ensuite le lancement, mais les caractères apparaissaient avec plusieurs minutes de retard. La capture montrait un lancement depuis le dossier personnel, une indexation sémantique automatique, et GPT-4o affiché malgré la détection de ChatGPT avec Sol.

## Corrections

- Le profilage au niveau du dossier personnel ou de la racine du disque reste superficiel : pas de cartographie récursive, pas d’initialisation des embeddings ni de rechargement d’un ancien graphe volumineux. Les projets en sous-dossier gardent leur profilage.
- La compatibilité du modèle sauvegardé avec ChatGPT reprend la politique du catalogue Codex déjà utilisée par le fournisseur. GPT-4o reste valide pour l’API OpenAI, mais ne remplace plus le modèle par défaut de l’abonnement.
- La saisie utilise des références synchronisées pour préserver les frappes arrivant avant un rendu React. Entrée CR/CRLF, collage CRLF et Ctrl+J sont exercés avec le véritable Ink.
- Pendant une réponse, Entrée met le message suivant en file. Les appels restent séquentiels ; le démarrage d’un message en attente ne supprime pas le nouveau brouillon. Les continuations automatiques cèdent aux messages en attente.
- Les flèches se déplacent dans un brouillon multiligne ; l’historique restitue le brouillon original en sortant de la navigation. Les confirmations et questions gardent l’exclusivité du clavier.
- L’accueil compact remplace la bannière journalisée ligne par ligne. Le compositeur affiche l’état, jusqu’à six lignes logiques autour du curseur et les raccourcis réels. Le pied de page affiche fournisseur, modèle, mode et permissions. L’historique est mémorisé par React ; les réponses stabilisées utilisent toujours Ink Static.
- Les répertoires de stockage de plugins `cache` et `installed` ne sont plus signalés comme des plugins cassés sans manifeste. Un manifeste explicite dans ces répertoires reste accepté.

## Vérifications

- `npm run validate` ciblé : 392 tests verts, lint sans erreur, typechecks et 10 tests de contenu du paquet verts.
- Contre-validation Node 20 : 352 tests verts sur douze suites.
- Tests React/Ink réels : frappes groupées, Entrée Windows, collage multiligne, Ctrl+J, déplacement dans le texte ; test distinct de file FIFO et conservation du brouillon.
- Build TypeScript et `npm pack` réussis. Installation neuve du tarball avec `--omit=dev --ignore-scripts` : 1 307 dépendances installées, y compris TypeScript runtime.
- Pseudo-terminal avec API de fixture locale : deux réponses sérialisées, brouillon conservé, pas d’indexation du home. Paquet installé prêt en 1,02 s sous Node 24 et 1,15 s sous Node 20 dans l’environnement de test.
- Démarrage du paquet installé avec authentification factice et GPT-4o sauvegardé : ChatGPT (OAuth) et gpt-5.6-sol affichés en 0,86 s ; aucun message soumis.

## Portée

Ink conserve sa version compatible avec React 18 et Node 20 ; les interactions et le rendu sont modernisés sans imposer une migration de runtime. Ce travail ne revendique pas une parité complète avec Claude Code. Les mesures sont réalisées sous Linux avec de vrais pseudo-terminaux et des services simulés, pas sur le PC Windows de l’utilisateur. L’installation ignore les scripts natifs pour cette preuve ; les performances natives et le lancement Windows complet restent à confirmer. Les warnings de dépréciation de dépendances transitives npm ne sont pas tous éliminés.

Le paquet privé destiné au partage contient les correctifs de `main` non encore publiés sur npm ; le numéro de version reste 2.0.0. Aucun compte ni profil existant n’a été modifié et aucune publication npm n’a été effectuée.
