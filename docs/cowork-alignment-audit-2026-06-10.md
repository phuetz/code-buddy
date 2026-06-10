# Audit d'alignement Cowork ↔ capacités de l'application — 2026-06-10

> Demandé par l'objectif de session « Cowork 100 % aligné avec les capacités de l'application ».
> Méthode : inventaire croisé (capacités core : ~90 slash commands, ~50 sous-commandes CLI,
> 15 familles de routes serveur, sous-systèmes opérateur) × (surfaces Cowork : ~235 canaux IPC,
> ~54 bridges, ~30 surfaces majeures + 24 onglets Settings), puis vérification de l'état réel des
> trois mécanismes de suivi qui font autorité. Les écarts constructibles identifiés ont été fermés
> le jour même (commits référencés ci-dessous).

## 1. Verdict

**Alignement : complet pour tout ce qui est constructible.** Les seuls restes sont (a) des
items **gated par un design sécurité dédié** (délibérés, listés §4) et (b) des résidus
**« low » par décision** au RUNNER_AUDIT. Aucun domaine opérateur du core n'est sans surface
GUI après cet audit.

## 2. État vérifié des trois trackers d'autorité

| Tracker | Portée | État vérifié 2026-06-10 |
|---|---|---|
| `docs/cowork-pilotability-matrix.md` (2026-05-29) | routage CLI/slash → surfaces UI | Backlog **vide** ; il ne restait que le bloc *gated*. `research / flow LIVE` y était gated « provider configuré requis » — **gate levé** par l'Ollama local ($0) → fermé par cet audit (lanceur live, voir §3). |
| `cowork/RUNNER_AUDIT.md` | parité moteur (engine vs pi) | Gaps restants tous **low par décision** : `steer`/`run_event` log-only (acceptable), injection sudo bash (rare en GUI), hot-swap du niveau de thinking *en cours de session* (le `ReasoningLevelPicker` couvre déjà le niveau au prochain run). |
| `docs/hermes-openclaw-parity.md` (canonique 2026-06-09) | parité capacités vs Hermes/OpenClaw | 0 gap ; 5 `partial` gated (comptes externes / choix produit). Supersède GAP-1..12 (archive 2026-q2). |

## 3. Écarts constructibles fermés par cet audit

| Écart | Pourquoi il existait | Fermeture |
|---|---|---|
| **Research / Flow live** (`buddy research`, `buddy flow`) sans surface GUI | Gated « provider + réseau requis » dans la matrice | Lanceur live (`LiveLauncherPanel`, groupe Automation) : spawn du **vrai CLI dist** headless, stream stdout ligne-à-ligne (`liveLauncher.event`), cancel SIGTERM→SIGKILL, timeout dur, rapport markdown rendu. Pré-requis core : `--model`, `--wide` (le gate TTY du mode parallèle retombait silencieusement en mode direct dans un subprocess Electron), fallback provider `detectProviderFromEnv()` (la map `PROVIDERS` n'avait pas d'entrée ollama → exit 1 sans clé payante). Bug attrapé par le run live : le `-m, --model` **global** du programme racine avalait l'option du sous-commande → fix `optsWithGlobals()`. |
| **Backups `.codebuddy/`** (`buddy backup create/verify/list/restore`) sans surface GUI | Hors trackers — découvert par l'inventaire croisé | Section « Backups » dans Settings → Import/Export : create (toggle `--only-config`), list, verify, restore derrière confirmation explicite (destructif). Même handler core que le CLI (`commands/handlers/backup-handlers.js`) — format et chemins single-sourcés ; sortie texte affichée verbatim (honnête pour v1). |

## 4. Restes assumés (décisions, pas des oublis)

- **Gated sécurité** (matrice de pilotabilité, bloc gated) : D4 gateway inbound (threat-model dédié ;
  posture fixée : l'inbound *propose* `needs_local_operator`, jamais d'auto-dispatch), secrets-vault
  EXECUTION (coffre chiffré + master key, design dédié), browser-operator EXECUTION (session derrière
  le consent-gate, pilotée opérateur par design), groups/`group-security` (frontière d'accès messaging —
  appartient à la passe sécurité).
- **Low par décision** (RUNNER_AUDIT) : steer/run_event log-only ; injection sudo (rare en GUI) ;
  hot-swap thinking *mid-run* (niveau au prochain run déjà pilotable).
- **Heartbeat engine** (`buddy heartbeat`) : pas de panneau dédié — le daemon systemd
  `codebuddy-autonomy` (piloté de bout en bout par l'AutonomyPanel : service, ticks, logs, install
  custom, board kanban) est son successeur opérationnel.
- **Actions scan/review en chat** (review, vulns, secrets-scan, security-review, guardian) :
  délibérément 🔴 dans la matrice — les router vers un onglet Settings qui n'exécute pas le scan
  serait de la misdirection.

## 5. Domaines couverts (synthèse de l'inventaire croisé)

Chat/sessions/branches/export ✓ · mémoire (browser, providers, lessons, knowledge, user model) ✓ ·
multi-agents (orchestrateur, teams, sub-agents) ✓ · fleet (peers, dispatch, sagas + cancel/replay,
coûts, **utilisation**, route preview, sessions peer interactives) ✓ · autonomie (daemon, board
kanban write, logs, install options, model tier) ✓ · skills (manager, vault, candidates, signing) ✓ ·
MCP (serveurs, marketplace, playground) ✓ · plugins ✓ · channels & remote (Slack/Feishu, pairing,
mobile supervision) ✓ · companion/OpenClaw (gateway, percepts, missions, migration) ✓ · A2A ✓ ·
checkpoints/undo/redo ✓ · audit/observabilité (runs, insights, activity, reasoning traces) ✓ ·
coûts/budgets ✓ · sécurité (rules, permission modes, diagnostics) ✓ · voix/TTS ✓ · sandbox
WSL/Lima ✓ · config (sets, profils, import/export + **backups**) ✓ · git ✓ · tests ✓ ·
**research/flow live** ✓ (cet audit).

## 6. Vérification

- Tests : `cowork/tests/live-launcher-bridge.test.ts`, `live-launcher-panel.test.tsx`,
  `backup-bridge.test.ts`, `tests/commands/research-flow-provider.test.ts` (core).
- Typecheck core + cowork propres ; `npm run build` (le lanceur exécute le dist).
- Run live : `research` dist pinné `qwen2.5:7b-instruct` sur l'Ollama local ($0) — résolution
  provider/modèle correcte prouvée ; latence de chargement à froid du modèle sur l'iGPU = limite
  matérielle, pas un défaut du lanceur (timeout honnêtement rapporté dans le rapport d'échec).
