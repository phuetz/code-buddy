# Journal et règles de Lisa (2.4, opt-in)

Activer **une seule variable**, `CODEBUDDY_LISA_REGLES=true`, dans le profil qui
exécute Lisa. Sans cette valeur exacte, aucune règle ni entrée de journal Lisa
n'est créée, et les moteurs conservent leur comportement historique. Ce garde
n'active pas les capteurs, Telegram, les outils compagnons ou les moteurs
proactifs : leurs options existantes restent nécessaires.

```sh
export CODEBUDDY_LISA_REGLES=true
buddy lisa regles list
buddy lisa journal
buddy lisa journal --since 2026-09-30T00:00:00+02:00
buddy lisa journal --json
```

Le fichier lisible est `~/.codebuddy/companion/lisa/regles.json` (ou sous
`CODEBUDDY_HOME`). Il est créé en **lecture**. Ce régime conserve les observations
et inscrit des propositions locales dans le journal, sans envoyer de message,
parler, exécuter de commande ou modifier les rappels. Les propositions ne sont
pas des tâches en attente : changer de régime ne les rejoue pas.

```sh
buddy lisa regime action
buddy lisa regles autoriser parole
buddy lisa regles demander autre
buddy lisa regles interdire commande-shell
buddy lisa regime lecture
```

| Autorisé par défaut | Demander par défaut | Interdit par défaut |
| ------------------- | ------------------- | ------------------- |
| observer            | parole              | commande-shell      |
| rappel              | autre               | ecrire-fichier      |
| message-utilisateur |                     | publier             |
|                     |                     | payer               |

Une action absente des colonnes demande un accord. Une configuration illisible,
invalide ou contradictoire refuse les actions. Les commandes déplacent une action
entre colonnes ; elles n'ajoutent pas de permission contradictoire.

En régime **action**, « autorisé » permet l'action sous les gardes existants.
« demander » exige un accord frais par le service de confirmation existant ;
AUTO_CONFIRM, les flags de session et bypassPermissions ne remplacent pas cet
accord. « interdit » refuse avant l'effet et avant toute demande d'accord.
Une règle sensorielle event→action ne remplace jamais ces permissions.

Pour Telegram, utiliser la destination privée existante
`CODEBUDDY_SENSORY_ALERT_CHAT` et l'authentification propriétaire du canal. Les
identifiants privés figurant dans `allowedUsers` sont également reconnus par
l'adaptateur Telegram. Les groupes et autres destinations demandent un accord.
Le canal de confirmation existant est réutilisé ; si nécessaire, le transport
d'alertes configuré sert à envoyer la demande. Un destinataire interdit ne
reçoit pas de demande d'accord.

Répondre **« oui »** lorsqu'il existe une seule demande Lisa en cours, ou
`oui approval-…` ; « non » refuse. Les commandes existantes `/approve <id>` et
`/deny <id>` restent utilisables. Une note vocale **privée et authentifiée** peut
dire `confirme lisa approval-…`. Une demande expirée, rejouée ou ambiguë n'accorde
rien. Un membre d'un groupe autorisé ne devient pas propriétaire pour confirmer.
Le micro ambiant ne constitue pas une preuve d'identité : un simple « oui »
entendu dans la pièce n'autorise pas une action. Les rappels conservent aussi
leur coordinateur de confirmation propriétaire existant.

Les gardes de Lisa sont appliqués aux initiatives des moteurs proactif, présence
et arrivée, aux rappels, aux transports Telegram (texte, voix, image et indication
de frappe), à la parole et aux outils des tours vocaux et compagnons. Les outils
sont classés selon leurs effets déclarés ; les alias sont résolus. Les outils de
shell/processus et les outils d'interaction pouvant publier sont classés
prudemment. Un outil inconnu demande un accord. Autoriser un outil parent ne
dispense pas ses outils imbriqués d'un accord.

Les permissions normales, l'identité compagnon, les interdictions du toolset,
les garde-fous shell et l'arrêt d'urgence restent applicables. Les hooks
exécutables de l'agent sont désactivés dans les tours Lisa, pour qu'un outil de
consultation ne déclenche pas indirectement un effet. Une action sensorielle
`agent` utilise le runner existant dans le même processus : elle ne délègue pas
à un enfant headless qui perdrait le contexte des règles. En opt-in, la voix
utilise une sortie audio bloquante pour conserver la décision avant synthèse et
lecture, et le chemin vocal d'outils passe par le dispatch journalisé commun.

Le journal append-only `companion/lisa/journal.jsonl` contient la date, le
déclencheur, le type d'action, l'opération, le nom catalogué de l'outil, le régime,
la colonne, la décision et le résultat. Un identifiant relie début, accord et
résultat. `propose`, `refuse` et `echec` ne signifient jamais « exécuté ». Les
messages, transcriptions, labels de rappels, arguments, chemins, images et textes
d'erreurs ne sont pas recopiés dans ce journal. Les décisions alimentent aussi
l'audit existant ; les événements RunStore des outils restent en place.

Les nouveaux fichiers sont privés (0600 ; répertoire Lisa 0700 sous POSIX).
Un journal non inscriptible bloque l'action avant son lancement. Une modification
des règles pendant une confirmation révoque l'accord en attente. Les résultats
de transport indiquent l'acceptation ou l'échec signalé par l'adaptateur, pas la
lecture du message par son destinataire ni une mesure du son dans la pièce.

Il n'y a ni nouveau scheduler, ni service, ni modèle imposé, ni endpoint HTTP
supplémentaire. Les journaux historiques et la mémoire existante conservent leur
format ; la minimisation décrite ici concerne le nouveau journal d'activité.
