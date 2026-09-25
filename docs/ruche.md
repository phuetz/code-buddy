# Ruche : protocole de coordination signé pour la flotte

Ruche est une couche **optionnelle** de coordination au-dessus des connexions de flotte existantes. Elle ne change ni `peer.chat`, ni les outils, ni la politique d'autorisation quand `CODEBUDDY_RUCHE` est absent. Chaque opération qui prétend être protégée par Ruche doit appeler son garde explicitement.

## Identités et confiance

Chaque agent possède sa propre clé Ed25519 ; son identifiant est l'empreinte SHA-256 courte de la clé publique. Ruche reprend la sérialisation JSON canonique et l'identifiant de clé de `src/skills/skill-signing.ts`, utilisés par `skill-exchange`. Le coffre de clé Ruche est distinct de celui de la signature des skills : partager une clé entre deux agents détruirait l'attribution. La clé privée reste locale, avec permissions restrictives. La clé publique est épinglée explicitement à un agent et à un rôle (`agent`, `arbitre`, `humain`) ; la première signature inconnue ne crée jamais une confiance automatique. Un changement de clé demande une décision humaine hors protocole. La possession d'une clé « humain » est une configuration locale explicite, jamais déduite d'un nom fourni par le pair.

## Événements et journaux

Un événement porte `v`, `agentId`, `seq`, `prevHash`, `at`, `type`, `payload`, `hash` et `signature`. Le hash est SHA-256 du JSON canonique des champs précédant `hash` ; la signature Ed25519 couvre ce hash et le domaine Ruche. Chaque auteur tient une chaîne indépendante : `seq=1` part d'un hash nul, puis chaque entrée référence le hash précédent. Une réception vérifie le schéma, la clé épinglée, la signature, le hash, le numéro et le précédent avant toute mutation. Un doublon ou une bifurcation est rejeté ; une lacune impose un nouveau tirage. Le stockage durable du prototype est un JSONL append-only, vérifié intégralement à la lecture. Un ancrage externe des dernières têtes reste nécessaire pour déceler la suppression de la fin d'un journal ou sa réécriture par le propriétaire de la clé.

Types prévus : `message` (texte borné), `mention` (destinataire identifié), `lease.request`, `lease.grant`, `lease.deny`, `lease.renew`, `lease.release`, `verdict`, `approval.request`, `approval.response`, `heartbeat`. Un verdict contient obligatoirement la révision Git complète, la commande exécutée, son code de sortie et l'empreinte SHA-256 du journal de commande. Le journal de commande et les rapports sont conservés séparément ; une modification ultérieure est détectée en recalculant cette empreinte. `heartbeat` porte l'identifiant de lane et son échéance ; une lane sans renouvellement confirmé est affichée `stale`, jamais `active`.

## Baux et partitions

Chaque chantier a **un arbitre unique**, configuré avant l'exécution. Il sérialise les requêtes et signe **accord ou refus**. Une demande concurrente sur la même clé de chantier obtient au plus un `lease.grant` courant. Le bail contient un jeton de fencing monotone et une échéance émise par l'horloge de l'arbitre. Renouvellement et libération exigent le détenteur et le jeton courants. Après expiration, l'arbitre peut donner un nouveau jeton ; l'ancien détenteur doit être rejeté par **chaque écrivain** qui vérifie le jeton courant immédiatement avant l'effet. Une partition réseau, un arbitre indisponible, un décalage d'horloge incertain ou une réponse non signée entraînent un refus, jamais un bail local de secours. Le verrouillage d'un processus ou un fichier de coordination ne remplace pas l'arbitre pour deux machines.

Le prototype fournit cet arbitre dans un processus et deux pairs en mémoire. Il ne protège donc un worktree que si tous ses écrivains passent par le même arbitre et vérifient le jeton. Une recette sur deux machines doit confirmer le rejet d'un vieux jeton après reprise. Le verrouillage interprocessus et la bascule d'arbitre nécessitent un stockage transactionnel partagé, absent de cette étape.

## Approbations et verdicts

Une `approval.request` fixe `effectId`, l'effet exact, la révision cible et `expiresAt`. Seule une `approval.response` signée par la clé publique **épinglée** au rôle `humain`, portant le même `effectId` et la même révision, peut ouvrir la porte ; elle est à usage unique. Le silence à l'échéance vaut refus. Un changement de révision ou une réponse tardive exige une nouvelle demande. Un outil à effet sortant doit appeler le garde juste avant l'effet. Le prototype fournit ce garde, sans prétendre couvrir déjà tous les outils et scripts existants.

Un `verdict` est admis seulement si la révision annoncée est le `HEAD` attendu et si l'empreinte du journal fourni correspond exactement à celle déclarée. Un code de sortie nul reste une donnée vérifiable, pas une preuve suffisante de réussite fonctionnelle. L'événement signé empêche de réattribuer un verdict à une autre révision sans détection ; il ne garantit pas que la commande annoncée a réellement été exécutée. Une recette réelle doit conserver la sortie brute et comparer son empreinte.

## Transport et réplication

Le maillage WebSocket existant transporte un **tirage** `peer.ruche.pull` paginé des événements signés, après authentification du pair et avec limites de taille. Le tirage est fermé par défaut ; aucun push automatique, aucun nouvel écouteur réseau. La réception vérifie la chaîne de chaque auteur avant insertion. Un pair ne devient pas arbitre en répliquant ses données. Le statut d'une lane utilise la fraîcheur d'un heartbeat signé et l'état du bail, et passe à `stale` à l'échéance même si la connexion WebSocket semble ouverte.

## Ce que Ruche ne fait pas

Ruche ne remplace pas Git, les branches isolées, les contrôles de permission existants, le superviseur de processus ou un consensus distribué. Elle ne garantit ni la vérité d'un rapport ni l'exécution d'une commande ; elle garantit l'attribution et la détection des modifications aux données signées dont la tête est conservée. Elle ne peut empêcher un programme qui contourne le garde d'écrire dans un worktree ou d'agir vers l'extérieur. Les limites de l'arbitre unique, de l'horloge, de la conservation des têtes et de l'intégration des outils restent explicites dans le rapport de livraison.

## Rapport avec Buzz

Les idées viennent du journal d'audit chaîné de `buzz-audit`, des mentions et files de `buzz-acp`, et de la CLI structurée de `buzz-cli`. Ruche réécrit ces primitives en TypeScript sans reprendre de code Buzz. Buzz utilise un relais Nostr et un journal d'audit central ; Ruche s'appuie sur le RPC WebSocket déjà présent et sur Ed25519 déjà utilisé par l'échange de skills. Le chaînage signé et l'arbitre de baux répondent aux pannes constatées dans la flotte, sans importer la base de données, le protocole Nostr ni le harnais ACP de Buzz.
