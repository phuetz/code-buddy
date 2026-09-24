# Rechargement de la configuration

Le surveillant de fichiers `src/config/hot-reload` n'est plus livré.

Il n'était jamais démarré. Ses chemins par défaut visaient le profil utilisateur et un fichier de réglages, pas `config.toml`. Aucun rechargeur n'était inscrit, et la liste des sous-systèmes couvrait la sécurité, les politiques et MCP. Le démarrer aurait surveillé des fichiers sans appliquer les limites, ou appliqué des changements de sécurité en cours de session.

Les plafonds de `[middleware]` sont lus au lancement du processus. Un changement de `config.toml` pendant la session ne les modifie pas : il faut relancer. `/reload` recharge les réglages, les commandes, les agents et le filtre d'outils. Il ne change pas les plafonds de tours, de coût, d'avertissement ni de compactage.

D'autres rechargements existent et ne sont pas ce module : personas, compétences, règles sensorielles.
