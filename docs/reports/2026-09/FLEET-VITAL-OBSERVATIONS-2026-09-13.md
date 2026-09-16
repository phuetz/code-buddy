# Observations vitales vers les missions Fleet

Branche `feat/robot-mission-observations-2026-09-13`, base `51e698e8a`.
Travail Codex, pilotage Codex racine. Aucun commit ni push effectué.

## Contrat livré

`wireSensoryMissionBridge({ enabled, missionId, bus, publish, intervalMs? })`
retourne un désabonnement idempotent. Le drapeau doit être exactement `true`
et la mission explicitement configurée. Aucun raccord serveur dans ce lot.

Le pont lit seulement les perceptions locales connues : `buddy-sense` / vital /
heartbeat (charge), et `system-vitals` / system / resource_threshold, disk_low,
fleet_saturated. Une liste fermée de champs numériques ou booléens est copiée.
Images, transcriptions, coordonnées, commandes, noms de processus et champs
inconnus ne sont jamais transmis. Les compteurs de battements sont omis pour
ne pas déjouer la déduplication des états identiques.

Les messages contiennent un UUID, une mission, une origine, un type observation,
des valeurs structurées et l'heure de réception. L'heure du producteur reste
une indication séparée, sans supposer des horloges synchronisées.

La file conserve au plus quatre derniers états, un par type, et une seule
publication est en vol. Cadence par défaut : une publication toutes les cinq
secondes ; configuration bornée entre une et soixante secondes. Un échec est
retenté au plus deux fois avec le même UUID, puis abandonné. Le callback doit
résoudre après persistance et utiliser cet UUID comme clé d'idempotence.

## Frontière et limites

Le pont ne réémet jamais de perception et n'importe aucun outil, action ou
contrôleur de périphérique. Les événements distants, domain-bridge et sans
origine reconnue sont ignorés. Ces marqueurs locaux ne constituent PAS une
authentification : le raccord serveur doit réserver ces sources à l'ingress
local et contrôler les droits de lecture/écriture du journal par mission.

La file est volatile et coalesce les transitions avant publication ; seul le
journal en aval sera durable. Un callback qui ne termine jamais bloque les
publications suivantes avec mémoire bornée ; son signal est annulé à l'arrêt,
mais son implémentation doit respecter cette annulation. Le pont n'est ni une
boucle de contrôle robotique, ni un journal exhaustif des événements physiques.

## Vérifications

Vitest ciblé : 19 tests verts (configuration, confidentialité, source, validation,
coalescence, déduplication, lenteur, retries et arrêt). ESLint ciblé : code 0.
Typecheck complet du dépôt : code 0 (noyau, identité GPU et companion-core).
Aucun appareil, service ou API distante invoqué.

## Couture vers le salon signé (14 septembre)

`createMissionObservationRoomPublisher(room, publish)` fournit le callback
du pont. Il produit le JSON exact de l'observation et convertit `receivedAt`
en secondes pour `created_at`. Les retries conservent donc contenu, UUID,
horodatage et ID Nostr pour une clé de signature fixe. Une annulation préalable
refuse l'envoi ; les erreurs de l'éditeur remontent au retry borné du pont.

Le raccord serveur doit créer une session locale du hub avec un principal
interne déclaré dans l'ACL, répondre à son challenge avec la clé locale et
l'audience du hub, puis utiliser `RoomSession.publish()` pour chaque événement
signé. Il ne doit jamais appeler directement `RoomStore.append()`, ce qui
contournerait contrôle des droits, signature, cadence et diffusion.

Dans le callback injecté, construire/signature avec
`buildRoomMessage({room, content, createdAt})` puis `signRoomEvent` ; lever une
erreur si `session.publish(event).accepted` est faux. Un doublon accepté est
un succès. La même clé reste capturée pendant toute la durée de vie du pont.

Configuration serveur proposée : opt-in séparé
`CODEBUDDY_FLEET_ROOM_OBSERVATIONS=true`, mission explicite, salle explicite
et chemin de clé explicite (noms définitifs laissés au pilote). Aucun démarrage
si une valeur manque ou si l'authentification locale échoue ; aucun envoi sur
une salle par défaut. La clé est lue au démarrage sans exposition aux messages
ni aux logs. À l'arrêt : désabonner/annuler le pont, fermer sa session, puis
fermer le hub et son store.

Tests du raccord final à effectuer avec les vrais modules Opus : réception
signée par un lecteur autorisé ; aucun événement chez un lecteur non membre ;
retrait des droits d'écriture empêchant la publication suivante ; erreur après
acceptation puis retry ne créant qu'un record ; arrêt sans listener ni verrou
résiduel. Aucun message reçu ne doit déclencher une nouvelle perception.
