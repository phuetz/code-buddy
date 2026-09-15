# Pont A2A JSON-RPC

Le pont est facultatif. `CODEBUDDY_A2A_PEERS` contient un objet JSON de pairs déclarés, par exemple :

```json
{"reviewer":{"url":"https://reviewer.example/a2a/v1","outboundTokenEnv":"REVIEWER_TOKEN","inboundTokenEnv":"REVIEWER_INBOUND_TOKEN"}}
```

Les valeurs des secrets restent dans les variables référencées, jamais dans cet objet. L’authentification entrante associe chaque token à une identité unique ; les identifiants du corps ne peuvent pas changer cette identité. HTTPS est requis hors loopback. URL avec credentials, query ou fragment et redirections sont refusées. `CODEBUDDY_A2A_PUBLIC_URL` fixe l’URL annoncée ; son défaut est le port loopback du serveur. Aucun hôte n’est découvert ou contacté implicitement.

Quand la configuration est présente, `buddy server` expose `/.well-known/agent-card.json` (alias agent.json) et `POST /a2a/v1`. Le POST conserve sa propre authentification même si le serveur principal désactive la sienne. Le corps est limité à 1 Mio et chaque pair à 10 requêtes par minute.

Sous-ensemble annoncé : JSON-RPC A2A 1.0, SendMessage et GetTask ; alias message/send et tasks/get. Messages texte uniquement, mode bloquant, cinq tours par contexte. Streaming, annulation, médias et notifications push ne sont pas implémentés et sont refusés explicitement. L’ancien REST `/api/a2a/*` reste distinct.

Le moteur réel reçoit uniquement view_file, list_directory et search. Leur exécution passe par peer.tool.invoke : allowlist, fleetSafe, workspace configuré et permissions restent obligatoires. Sans `CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT`, les lectures de fichiers échouent. Les commandes slash entrantes sont refusées. Les tâches et contextes sont isolés par pair, bornés et conservés en mémoire ; il n’y a ni stockage durable ni reprise HA. Une tâche encore en exécution garde sa protection contre les doublons même après le timeout de réponse. Un contexte occupé ne démarre pas un second tour concurrent.

L’outil Buddy `a2a_call` accepte peer, text et contextId facultatif, jamais une URL ou un token fourni par le modèle. Il utilise le pair déclaré, exige la permission d’émission habituelle et est bloqué en mode plan. Il ne suit pas les redirections et ne réessaie pas automatiquement. La réponse distante est marquée non fiable : elle ne constitue ni une instruction système ni une autorisation.

`TASK_STATE_COMPLETED` indique que l’exécution a terminé ; cela ne prouve pas la véracité du texte. La recette locale qwen3:4b-instruct a d’abord produit une réponse inexacte après lecture, puis restitué exactement un marqueur aléatoire avec une consigne explicite. Les deux captures sont conservées. Le pilote a invoqué l’outil sortant ; le choix de view_file côté destinataire a été réalisé par le vrai modèle. Il ne s’agit pas d’une preuve de sélection autonome du pair sortant.

Validation : échanges HTTP réels, appels du moteur de production et du pont de lecture de fichiers, oracle indépendant, authentification, isolation, timeout, déduplication, UTF-8, quotas et régressions REST. Les corps concurrents ont été vérifiés sur les sources release épinglées ; aucune application Hermes/OpenClaw complète n’a été installée pour cette recette. Compatibilité limitée au sous-ensemble documenté.
