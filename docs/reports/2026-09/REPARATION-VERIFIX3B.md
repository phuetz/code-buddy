# REPARATION-VERIFIX3B — fermeture des trouvailles T12 à T15 (VERIF3)

Lane : VERIFIX3B. Date d'ouverture : 2026-09-04.
Clone de travail : `~/DEV/cb-verifix3b-2026-09-04`, branche `fix/verifix3b-garde-fifo-2026-09-04`.
HOME temporaire de test : `_qa/verifix3b/home` (gitignoré). `~/code-buddy` et le vrai `~/.codebuddy` sont
interdits en ecriture pour cette lane.

Zone reservee : `tests/security/donnees-personnelles.test.ts`, `tests/agent/delegation/`,
`tests/commands/swarm*`, `tests/commands/team*`, `tests/commands/worktree-handlers*`,
`src/sandbox/execpolicy.ts` + son test.

Protocole applique a chaque trouvaille : mutation VERTE rejouee (preuve du trou) -> renforcement du
test -> mutation ROUGE (preuve de discrimination) -> restauration VERTE.

## Etat

| Trouvaille | Sujet | Etat |
| ---------- | ----- | ---- |
| T12 | Fixtures manquantes du garde-fou donnees personnelles | en cours |
| T13 | FIFO non discriminant dans /swarm et /team | en cours |
| T14 | Entree `-C` redondante dans execpolicy | en cours |
| T15 | Assertions tautologiques de `worktree add` | en cours |

