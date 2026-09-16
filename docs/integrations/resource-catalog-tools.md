# Découvrir les ressources puis consulter RagChat

`resource_catalog` donne accès au catalogue explicite de l’utilisateur Buddy. `operation: list` expose les déclarations et la fraîcheur des observations ; `operation: select` prend une capacité exacte et éventuellement un type, puis applique les droits d’usage, le TTL et les critères de sélection du catalogue existant.

Ces deux opérations lisent seulement le fichier : aucune sonde, écriture, requête réseau, exécution ou reconfiguration d’un autre outil. La sortie garde les références d’environnement, jamais les URL résolues ni les empreintes internes. La charge reste inconnue ; une réponse HTTP de santé ne prouve pas la qualité de recherche ou la disponibilité d’un modèle.

Pour préparer une ressource, l’utilisateur utilise `buddy resources add <fichier.json>` puis `buddy resources probe <id>`. Cette sonde explicite nécessite `permissions.probe: true`. Un résultat périmé est exclu de la sélection ; lire le catalogue ne renouvelle jamais son horodatage.

## Voir le catalogue sans le modèle

- **Terminal et `buddy -p "/resources"`** : `/resources` liste chaque ressource (type, hôte, capacités, référence d’endpoint, état et raison, âge de l’observation). Lecture du fichier seulement : aucune sonde, écriture ni appel au modèle. Sans catalogue, le message renvoie vers `buddy resources add`.
- **Cowork** : `/resources` est déclaré `headless` dans `src/commands/slash/surfaces.ts` ; le rail « Activité » affiche aussi « Ressources déclarées (lecture seule) » via l’IPC `tools.resourceCatalog.list`. Cette vue ne contient ni URL résolue ni empreinte.
- **Avertissement de sélection** : quand `select` (outil ou `buddy resources select`) retient une ressource `rag` dont `endpointRef` n’est pas `RAGCHAT_BASE_URL`, la réponse ajoute un champ `warning` : `ragchat_search` continue d’interroger `RAGCHAT_BASE_URL`, la sélection ne le redirige pas.

Exemple RagChat :

```json
{
  "id": "ragchat-local",
  "kind": "rag",
  "hostId": "mon-hote",
  "declaredCapabilities": ["pdf-search"],
  "endpointRef": "RAGCHAT_BASE_URL",
  "healthPath": "/api/health",
  "permissions": { "probe": true, "use": true },
  "ttlMs": 60000
}
```

La route `/api/health` est confirmée dans RagChat `0c60df7`, `Program.cs:2473`. Seul ce chemin a été ajouté aux sondes de type `rag` ; aucune inspection des documents ou readiness générale n’est faite par cette sonde.

Après configuration privée de l’origine, du JWT et du profil RagChat, demander : « Consulte mes ressources, sélectionne un service rag pour pdf-search puis retrouve le budget HELIOS avec les pages. » Buddy peut enchaîner `resource_catalog` puis `ragchat_search`. Le connecteur recherche toujours sur son propre `RAGCHAT_BASE_URL` : une sélection portant une autre référence ne le redirige pas. Le catalogue fournit une recommandation, pas une autorisation de transport ni une bascule automatique ; RagChat applique indépendamment les droits de son JWT.

## Recette native

Le 15 septembre 2026, serveur RagChat natif .NET et corpus synthétique réutilisé : le pilote enregistre la ressource puis lance une sonde CLI explicite. Buddy ChatGPT `gpt-5.6-sol` appelle réellement liste, sélection, profils RagChat, recherche. Il rend 42 750 euros avec page 2 et précise l’absence de reconfiguration automatique. Le catalogue reste identique octet par octet après le tour Buddy. RAG activé et désactivé : définitions complètes des deux outils observées, paramètres et champs requis conservés.

La recette est bornée à cinq outils autorisés : resource_catalog, ragchat_search, view_file, search, list_directory. Elle ne démontre pas une bascule automatique entre deux corpus. Les limites OCR à 90°, pack français absent et test UI RagChat préexistant restent celles de la recette [RagChat](ragchat.md). Aucun moteur OCR modifié ici.
