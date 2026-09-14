# Plusieurs Code Buddy, un travail commun

Chaque machine lance son propre `buddy server`. Le poste pilote se connecte directement aux serveurs configurés : aucune inscription temporaire dans une autre session CLI n'est nécessaire.

Deux commandes rendent ce parcours reproductible :

```sh
buddy fleet check --config fleet.json
buddy fleet collaborate "Examiner notre architecture et proposer un plan de fiabilisation" --config fleet.json
```

`check` vérifie l'authentification, le RPC et la présence d'un fournisseur de modèle configuré, sans appeler le modèle. Il ne garantit pas que le fournisseur dispose encore de crédits. `collaborate` demande une contribution à chaque pair en parallèle, puis une synthèse au premier pair ayant répondu. Les rôles permettent de répartir l'analyse, par exemple architecture et validation. Chaque commande ouvre puis ferme ses propres connexions.

## Préparer les machines

Sur chaque machine, utiliser la même version récente de Code Buddy. Configurer le fournisseur et le modèle de ce serveur suivant le [guide Fleet](fleet-guide.md), puis lancer le serveur avec son secret JWT propre. Exemple PowerShell dans une console dédiée :

```powershell
# Exemple avec Ollama déjà installé et un modèle déjà téléchargé.
$env:CODEBUDDY_PEER_PROVIDER = "ollama"
$env:OLLAMA_HOST = "http://127.0.0.1:11434"
$env:CODEBUDDY_PEER_MODEL = "NOM_DU_MODELE_INSTALLE"
# Réutiliser le secret du serveur existant si celui-ci est déjà configuré.
$env:JWT_SECRET = "SECRET_ALEATOIRE_PROPRE_A_CETTE_MACHINE"
buddy fleet token --user pilote --scopes fleet:listen,peer:invoke --ttl 24h
buddy server --host 0.0.0.0 --port 3000
```

Conserver le jeton produit pour le poste pilote. Le secret de signature reste sur le serveur. Le même port sert HTTP et WebSocket (`/ws`). Autoriser ce port dans le pare-feu pour le réseau privé utilisé. Employer `wss://` avec un relais TLS sur un réseau non privé ; un réseau privé chiffré permet aussi de relier les machines. Ne pas désactiver l'authentification.

## Configurer le poste pilote

Créer `fleet.json` avec les adresses des deux machines :

```json
{
  "version": 1,
  "peers": [
    {
      "id": "windows",
      "url": "ws://192.168.1.20:3000/ws",
      "tokenEnv": "BUDDY_WINDOWS_TOKEN",
      "role": "Examiner l'architecture et proposer les changements."
    },
    {
      "id": "linux",
      "url": "ws://192.168.1.21:3000/ws",
      "tokenEnv": "BUDDY_LINUX_TOKEN",
      "role": "Examiner les risques, la portabilite et les tests necessaires."
    }
  ]
}
```

Les adresses sont des exemples à remplacer. Le fichier contient les **noms** de variables, jamais les jetons. Dans la console PowerShell du pilote :

```powershell
$env:BUDDY_WINDOWS_TOKEN = "JETON_DU_SERVEUR_WINDOWS"
$env:BUDDY_LINUX_TOKEN = "JETON_DU_SERVEUR_LINUX"
buddy fleet check --config fleet.json
buddy fleet collaborate "Proposer une amelioration de Code Buddy avec un plan de tests" --config fleet.json
```

Sous Linux, définir les mêmes variables avec `export BUDDY_WINDOWS_TOKEN='...'` et `export BUDDY_LINUX_TOKEN='...'`. Les commandes Buddy restent identiques.

## Résultats et limites

- `--json` fournit le rapport structuré ; la progression textuelle est alors désactivée. Sans cette option, la progression passe sur stderr et le résultat sur stdout.
- `complete` : tous les pairs ont réussi, y compris la synthèse pour une collaboration. `partial` : contributions ou synthèse manquantes. `failed` : aucun pair utilisable ou opération annulée. Les deux derniers cas donnent un code de sortie 1.
- Un refus d'authentification, un modèle absent, une réponse vide ou un délai dépassé sont signalés par pair. Les contributions réussies restent dans le rapport.
- `--timeout 120000` règle le délai par requête (1–300 secondes). Deux phases de modèle sont nécessaires, donc ce n'est pas un délai total. Aucun nouvel essai automatique des appels de modèle ; ces appels peuvent consommer les crédits de chaque fournisseur.
- `check` accepte 1–8 pairs ; `collaborate` en demande 2–8. Le but est limité à 16 000 caractères. Les contributions sont bornées pour limiter le contexte de synthèse. Réduire la tâche si le modèle atteint sa limite de sortie.
- Ce parcours produit des analyses et un plan commun. Il n'exécute pas de modifications de fichiers à distance. Les sessions multi-tours, les salons signés et les outils distants en lecture seule restent disponibles via les autres commandes Fleet. L'exécution de workflows dispose de ses propres permissions et validations.
- La configuration représente les destinataires choisis par l'opérateur : le but et les contributions leur sont transmis. Une suggestion d'un pair reste du contenu à examiner, pas une commande exécutée.

Les tests automatisés démarrent deux vrais serveurs dans deux processus isolés, avec des fournisseurs HTTP déterministes. Ils vérifient les contributions distinctes, leur synthèse, une conversation conservée après reconnexion et le refus d'un jeton signé pour l'autre serveur. Ils ne remplacent pas le contrôle du pare-feu et des fournisseurs sur les machines physiques.
