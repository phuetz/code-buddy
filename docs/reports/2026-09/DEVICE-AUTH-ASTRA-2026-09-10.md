# DEVICE AUTH — ASTRA — 2026-09-10

Début : 11:43 UTC. Budget 90 minutes ; point verdict à 12:58 UTC.
Branche : `astra/device-auth-2026-09-10`, clone courant uniquement.

## Contrat et réservation
Authentification Android P-256, appairage local, trois routes publiques limitées,
JWT agent/owner, permissions default et confirmations WebSocket existantes.
PWA et lane companion hors périmètre. HOME QA : `_qa/device-auth/home`.

## Étapes
0. Rapport et réservation avant inspection.
1. Magasin, routes, JWT et profil WebSocket avec tests cryptographiques et de compatibilité.
2. CLI pair/devices et tests de commande.
3. Documentation, validations et passation.

## Preuves
### Tranche 1 — protocole et sessions

Base vérifiée : `76e675a6923e67e48b2fb2cf68c7fdd7c5fba5f7` = `origin/main`.
Réservation : `9a4d6b7db`. Commit fonctionnel : `b7de292c8`.
Index : analyse initiale terminée (6 857 fichiers), HEAD de réservation à jour ;
requêtes context/impact avant les modifications, complétées par rg exact.
Pendant l'analyse initiale, quatre requêtes ont échoué faute de snapshot ;
les interrogations utiles ont ensuite été rejouées. Attention aux homonymes :
`generateToken` et `refreshToken` ont aussi des définitions non JWT dans le graphe.

- Trois routes publiques, indépendantes de PWA et de CSRF, dix requêtes/minute
  par IP de transport et par route, erreurs génériques, réponses non stockables.
- Codes locaux : huit caractères, dix minutes, empreintes SHA-256 persistées,
  consommation atomique avec l'enregistrement. P-256 validé par WebCrypto ; JWK
  privée refusée. Nonces 32 octets, 60 secondes, consommés avant le travail async.
- JWT d'une heure : subject appareil, agent/owner, amr biometric/device, portées
  utilisateur. Révocation vérifiée sur HTTP et WS ; refresh interdit pour éviter
  de convertir une preuve appareil en jeton historique sans marqueur de révocation.
- Agent complet sur WS même avec `assistant: companion`, permission default par
  contexte async ; pont existant activé pour Android sans drapeau PWA. Identité
  signée exposée dans le principal et `getDeviceSessionIdentity()` ; aucun changement
  de politique companion ni de fichiers PWA.
- Collision de magasin traitée : les nœuds SSH/ADB utilisaient déjà devices.json.
  L'enveloppe conserve leurs champs et ajoute deviceAuth. Verrou interprocessus,
  écriture atomique 0600, pas de récupération automatique d'une ancienne sauvegarde
  susceptible de ressusciter une révocation. Journal d'audit sans données de preuve.

Preuves exécutées sous HOME et TMPDIR QA isolés :

| Vérification | Résultat |
| --- | --- |
| `npm run typecheck` (trois projets) | 0 |
| ESLint ciblé des fichiers touchés | 0, aucun avertissement après nettoyage |
| Tests protocole initiaux | 13/13 |
| Tests nœuds SSH/ADB voisins | 80/80 |
| Tests core avant commit (`device-auth` + nœuds voisins) | 106/106 (26 auth + 80 voisins) |
| Tests auth + CLI, formats WebCrypto et Android DER | 33/33 |
| `timeout 900 npm test -- tests/server tests/commands/token` (final) | 776 verts, 2 ignorés, 0 rouge ; 83 fichiers ; 9,96 s |
| Vrai serveur + vraie CLI pair/list/rename/revoke + QR ANSI | Trois routes 200 sans JWT préalable ; révocation 401 ; sortie finale 0 |
| `git diff --check` | 0 |

Les chiffres finaux incluent les confirmations acceptées/refusées, l'expiration
sur une connexion existante, l'exclusion des anciennes surfaces d'approbation
lorsque seule l'application native active le pont et les signatures DER Android.
La CLI est préparée séparément pour la tranche 2 ; le core compile sans elle.

Échecs observés, sans les masquer :

- Un premier test HTTP utilisait un store de test différent du singleton appelé
  lexicalement par le validateur. La couture device-token distincte permet le même
  store injecté à toutes les surfaces ; test rejoué vert.
- Typecheck du parseur DER : deux accès d'octets possiblement indéfinis (TS2532),
  corrigés par des gardes explicites ; typecheck complet final : 0.
- Premier smoke : assertions fonctionnelles réussies puis `Server stopped`, mais
  sortie 124 après 120 s (timers de singletons encore ouverts). Harnais corrigé :
  sortie explicite seulement après toutes les assertions et `server.listening === false`.
  Second smoke : sortie 0. Aucune modification des services existants.
- `timeout 900 npm run validate` : lint, typecheck et check:pack franchis, puis
  timeout 124 dans la suite globale, sans total final. Le journal brut montre
  28 cas rouges dans 13 fichiers hors auth/CLI de cette mission (dont 16 dans
  `tests/docs/revue-gemini-docs.test.ts`). Leur antériorité n'a pas été prouvée ;
  plusieurs fixtures « hors Git » sont exécutées sous le TMPDIR QA inclus au dépôt.
  Ne pas annoncer validate vert. Journaux complets conservés sous `_qa/device-auth/`.

### Limites d'intégration

L'application Kotlin/Keystore et le contrôle biométrique réel restent dans la lane
Android ; aucune preuve sur téléphone physique ici. ES256 sur le fil utilise les
64 octets P1363 r||s en base64url ; le DER natif Android est également accepté
en base64url/base64 standard, avec conversion stricte avant vérification WebCrypto.
Le contexte companion est exposé, sa politique est laissée à la lane dédiée.
Les magasins et clés privées des comptes réels n'ont pas été utilisés.

### Tranche 2 — commandes locales

`src/commands/device-auth.ts` et l'enregistrement paresseux dans `src/index.ts` :
`buddy pair [--url URL] [--json]`, `buddy devices list [--json]`,
`buddy devices revoke <id>`, `buddy devices rename <id> <name>`.
QR ANSI via le renderer existant de `buddy token`, URL validée sans identifiants.
Les commandes ne contactent aucun fournisseur LLM et ne lisent aucun secret JWT.
Le store est partagé avec le serveur sous le même HOME.

Preuve Commander réelle : `npm test -- tests/commands/token` → 24/24,
dont sept nouveaux tests pair/devices. Smoke de sous-processus CLI avec QR réel
et serveur réel → 0, détaillé dans la tranche 1. Index : réindexation incrémentale
après le commit core (16 fichiers reparsés), puis après la CLI (1 fichier
reparsé). Commit CLI : `7ddf1a4a2`. HEAD indexé vérifié avant la tranche documentaire.

### Tranche 3 — documentation et passation

Préparée le 2026-09-10 à 12:20 UTC ; avant les 75 minutes du budget.

Section « Application Android » dans `docs/mobile-pwa.md` : contrat complet,
formats de signatures, code local, QR, réponses, limites, révocation, verrou,
point d'accès pour la lane companion. `CLAUDE.md` expose les commandes et routes.
Commit documentaire : commit portant cette section ; analyse incrémentale après
ce commit prévue par le protocole, état final vérifié avant le message de clôture.

Contrôles complémentaires : privacy `tests/security/donnees-personnelles.test.ts`
40/40 ; `npm run lint -- ...` a aussi parcouru le dépôt (le script contient `.`),
sortie 0 avec avertissements hors fichiers modifiés ; lint ciblé final 0/0.
`commitlint` était absent : premier essai `npx --no` refusé (sortie 1), puis outil
19 installé uniquement sous QA, sans scripts d'installation. Les mêmes règles du
fichier du dépôt, copié en `.cjs` dans QA pour son `module.exports`, donnent sortie 0
sur tous les commits fonctionnels ; le commit documentaire est contrôlé après création.
Aucune dépendance de production ajoutée.

Outillage : 14 appels Code Explorer (context/impact/query), 34 commandes via
lm-resizer, 764 186 octets économisés nets (925 076 octets bruts → 160 890 transmis).
Les appels Code Explorer incluent les échecs initiaux et les homonymes écartés ;
ce sont des volumes de sortie, pas des tokens facturés. Les compteurs lm-resizer
proviennent exclusivement des métadonnées JSON de cette mission ; journaux bruts
relus pour la revue, les erreurs et les preuves finales.

État remis : branche `astra/device-auth-2026-09-10`, réservations libérées à la
passation, aucun push, aucune PWA modifiée, aucun service existant redémarré ou
reconfiguré. Artefacts QA gitignorés ; aucune clé privée, code d'appairage, signature,
jeton ni chemin personnel dans les commits. L'essai Android physique et la politique
companion restent aux lanes désignées. `validate` global reste incomplet avec les
28 échecs hors lot observés, sans affirmation d'antériorité.

VERDICT: routes 3/3 ; profil agent sur /ws OUI ; tests 776/778 (2 ignorés)
===LANE_ASTRA_DEVICE_AUTH_TERMINE===
