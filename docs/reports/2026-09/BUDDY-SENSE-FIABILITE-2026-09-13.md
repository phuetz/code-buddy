# Buddy Sense — fiabilité, 13 septembre 2026

Branche : `codex/audit-ameliorations-2026-09-13`. Correctifs : `54f23d36c`.
Travail isolé dans `~/DEV/cb-audit-ameliorations-2026-09-13` ; les modifications
concurrentes du dépôt principal sont préservées. Codex possède le pont ; Astra a
corrigé le bus puis relu le pont et la documentation indépendamment.

## Correctifs

- Connexion/handshake WebSocket limité à 10 s, écritures à 5 s. Ping toutes les
  15 s et surveillance du pong à 10 s ; reconnexion après 2 s sur échec.
- Le pont cesse ses reconnexions quand les producteurs ferment leur canal,
  même avec un reliquat d’événements. Une connexion existante peut vider la file.
- Une capacité mémoire nulle désactive réellement le stockage, sans désactiver
  l’admission ou la fusion des événements.
- La fusion utilise la distance temporelle absolue : le tri par saillance ne
  supprime plus les événements plus anciens situés hors de la fenêtre de fusion.
- README actualisé : tri par priorité, résumés mémoire périodiques et options
  microphone/caméra déjà présentes dans le code.

## Vérifications

Base Rust : 34 tests. Après correction : **42/42**, dont 5 nouveaux cas du pont
(sources fermées, handshake silencieux, absence de pong, pong normal, écriture
bloquée) et 3 du bus. Les trois régressions du bus ont été reproduites avant fix.

Commandes effectuées sans features matérielles :

```sh
cargo test --manifest-path buddy-sense/Cargo.toml --locked --offline
cargo build --manifest-path buddy-sense/Cargo.toml --locked --offline
cargo clippy --manifest-path buddy-sense/Cargo.toml --locked --offline -- -D warnings
rustfmt --check --edition 2021 buddy-sense/src/bridge.rs buddy-sense/src/bus.rs
npm run validate -- tests/sensory/sensory-bridge.test.ts tests/sensory/sensory-memory.test.ts tests/sensory/domain-event-bridge.test.ts
```

Validation npm avec HOME isolé et `VITEST_MAX_WORKERS=2` : lint sans erreur
(2488 avertissements préexistants), vérifications TypeScript réussies, **20 tests
ciblés + 10 tests de pack** réussis. Diff sans erreur de whitespace.

Preuve E2E : binaire Rust compilé, WAV synthétique, récepteur TypeScript réel
sur port loopback éphémère, jeton de test. Le bus reçoit `heartbeat`,
`speech_start` et `speech_end`. Une première exécution a révélé une erreur dans
le script de preuve (variable du jeton) ; corrigée en `BUDDY_SENSE_TOKEN`, puis
preuve réussie. Aucun changement de code produit nécessaire pour ce point.

Logs locaux non suivis : `_qa/audit/sense-{tests,build,clippy,validate,e2e}.json`.
Compression des sorties par lm-resizer et consultation/rafraîchissement de
l’index Code Explorer pour économiser le contexte. Aucun appel à Fable.

## Limites conservées

Livraison best-effort : débordement du broadcast et échec d’envoi peuvent perdre
des événements ; aucune promesse d’acquittement ou de rejeu durable. Le watchdog
pong est vérifié entre les écritures : une écriture en cours peut le retarder et
retarder le traitement d’un pong déjà arrivé. La sérialisation JSON est synchrone.

L’arrêt sur canal fermé suppose que le runtime reste vivant. Le binaire attend
encore un délai fixe en mode WAV et n’attend pas la tâche du pont avant sa sortie ;
ce correctif ne garantit pas une vidange gracieuse à l’arrêt du processus.

Aucun microphone, caméra, robot, modèle STT/TTS optionnel ou service permanent
activé. Ces chemins matériels ne sont pas couverts par cette validation.
Aucun push ni fusion dans la branche principale.
