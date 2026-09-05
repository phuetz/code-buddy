# REPARATION-PRIV3 — Résidus « à nettoyer » de la revue Gemini AGYSEC2

**Date :** 2026-09-04
**Mission :** fichier de mission dédié dans l'espace de travail de coordination, hors de ce dépôt.
**Clone :** `~/DEV/cb-priv3-2026-09-04`, branche `fix/priv3-residus-2026-09-04`, base `f42783007`.
**Périmètre :** les lignes « à nettoyer » (non « bloquant ») de la revue de sécurité AGYSEC2 :

1. Chemins d'espaces de travail privés dans `docs/**` et `CHANGELOG.md` : le nom de l'espace de brouillons personnel,
   le nom du dépôt de formation privé, l'ancien nom du dépôt privé de passation cités comme chemins de travail.
   Remplacés par une désignation neutre (`<espace-de-travail>/…`, « dépôt privé dédié », « le dépôt privé de
   passation », « the handover repo's … ») sans perdre l'information utile (le nom du fichier référencé reste).
2. Ancien nom du moteur (l'alias binaire historique de Code Explorer) dans `docs/reports/2026-09/RAPPORT-GK35.md` et
   `docs/research/ETUDE-PERCEPTION-MONDE-PHYSIQUE.md` : le nom public est Code Explorer. Les identifiants réellement
   exécutés (commandes CLI citées comme preuve, description de l'alias encore reconnu par le code) ne sont **pas**
   touchés — signalés ci-dessous.
3. Niveaux d'abonnement / crédits tiers encore chiffrés dans `CHANGELOG.md` et la table de coordination : reformulés
   sans chiffre de solde ni palier d'abonnement (le fait technique « une prise coûte des crédits » reste).
4. Prénom de l'auteur dans les citations de consignes : **hors périmètre, non retiré** — c'est l'auteur public du
   dépôt.

Original `~/code-buddy` interdit en écriture. Aucun push, aucune API payante, aucun service redémarré. HOME QA :
`_qa/priv3/home` (gitignoré, ligne ajoutée à `.gitignore`).

## Complément de mission (reçu en cours de route)

La revue GF3 (lecture seule, sur le diff intégré par PRIV2) a constaté que `DETECTION_FIXTURES` était passé de 16 à
11 témoins alors que dix termes correspondants (les motifs d'emploi/chômage/CCAS, le préfixe de réseau maillé de la
machine GPU de l'auteur, le nom de cette machine) restent actifs dans `INTERDITS` : la portée du garde n'était pas
réduite, mais sa preuve isolée l'était. Périmètre ajouté : restaurer un témoin isolé par terme manquant, construit
par concaténation comme les fixtures existantes, chaque mutation vérifiée rouge avant d'être annulée.

## Pré-vérification des points « bloquant » (traités par PRIV2)

`grep -rn` sur le dépôt cloné pour chacun des motifs bloquants de la revue AGYSEC2 :

Par prudence, ce tableau ne reproduit AUCUNE des valeurs privées elles-mêmes (adresses, identifiants, soldes) — un
rapport qui les recopierait pour les « documenter » réintroduirait exactement la fuite qu'il constate. Seul le
motif de recherche (déjà présent dans le garde-fou ou dans la mission) est cité.

| Motif recherché | Résultat | Verdict |
| --- | --- | --- |
| Adresse LAN privée (plage /16 documentée par la mission) | 0 occurrence | VRAI (déjà corrigé) |
| Préfixe de réseau maillé privé de la machine GPU de l'auteur | 0 occurrence sous forme pointée — **mais** la même adresse subsistait sous forme de tirets dans un exemple de commentaire de `src/commands/handlers/fleet-handler.ts:328` (l'exemple d'entrée avait été remplacé par une adresse de documentation RFC 5737, mais l'exemple de *sortie* gardait la forme tiretée de l'adresse réelle) | **PARTIELLEMENT FAUX** — corrigé dans cette mission (voir commits), hors périmètre écrit mais trouvaille directe de la pré-vérification demandée |
| Identifiant de projet vidéo tiers (préfixe cité par la mission) | 0 occurrence | VRAI (déjà corrigé) |
| Sujet médical (maladie neurodégénérative nommée) | 0 occurrence sur le sujet personnel — les seules occurrences restantes sont un vocabulaire scientifique générique dans un script de veille éditoriale (`scripts/influencer/veille-youtube.py`) et deux fixtures de test sur la recherche biomédicale (CKG, PaperQA), sans lien avec la situation familiale de l'auteur | VRAI (le fait personnel est retiré ; le vocabulaire de domaine reste légitime) |
| Solde de crédits Flow réel (valeur citée par la mission) | 0 occurrence avec l'espace insécable d'origine — **mais** le même solde, sans cet espace, subsistait dans la table de coordination (`docs/FABLE5-CODEX-COORDINATION.md`, ligne FLOWFIX1) | **FAUX** — corrigé dans cette mission (point 3) |
| Chemin home encodé de l'auteur | 0 occurrence | VRAI (déjà corrigé) |

## Travail

### Point 1 — chemins d'espaces de travail privés

Fichiers modifiés (préfixe de chemin remplacé par `<espace-de-travail>/…`, ou par « dépôt privé dédié » quand la
référence était au dépôt lui-même plutôt qu'à un fichier) :

- `docs/FABLE5-CODEX-COORDINATION.md` (7 occurrences de l'espace de brouillons, 3 du dépôt de formation, 2 de
  l'ancien nom du dépôt de passation)
- `docs/drafts/BILAN-REPRISE-OPUS-2026-08-24.md` (1 occurrence du dépôt de formation)
- `docs/fleet-guide.md` (3 occurrences de l'ancien nom du dépôt de passation)
- `docs/operations/AUTOPILOT-STATE.md` (1 occurrence)
- `docs/reports/2026-09/BANC-FIN-DE-TOUR.md`, `REPARATION-CONV1.md`, `REPARATION-CONV2.md`, `REPARATION-SENSE1.md`,
  `REVUE-SENSE-GEMINI.md`, `REVUE-VOIX-GEMINI.md` (occurrences de l'espace de brouillons)
- `docs/reports/2026-09/REPARATION-PRIV1.md` (1 occurrence, reformulée sans reproduire l'ancien nom du dépôt de
  passation dans un tableau de correspondance avant/après)

**Hors du périmètre écrit mais nécessaire pour la cohérence du garde-fou étendu** (le garde-fou scanne tous les
fichiers suivis, pas seulement `docs/**`) : 14 commentaires source citant l'ancien nom du dépôt de passation comme
provenance d'un audit ou d'un portage, dans `src/agent/autonomous/fleet-task-types.ts`,
`src/agent/autonomous/fleet-tick-handler.ts` (dont une chaîne de prompt), `src/agent/execution/agent-executor.ts`,
`src/agent/facades/message-history-manager.ts`, `src/codebuddy/stream-retry.ts`,
`src/commands/handlers/daily-reset-handler.ts`, `src/commands/handlers/heartbeat-handler.ts`,
`src/config/toml-config.ts` (×2), `src/context/auto-compact-threshold.ts`, `src/context/tool-pair-preserver.ts`,
`src/fleet/colab-store.ts`, et 4 fichiers de test miroirs. Reformulés en « the handover repo's `<fichier>` » / « le
dépôt privé de passation, `<fichier>` » — le nom du fichier cité (preuve/audit) reste.

### Point 2 — ancien nom du moteur

- `docs/reports/2026-09/RAPPORT-GK35.md` : la prose descriptive (« chemin privé, ancien nom du moteur, pas de
  timeout » / « ancien nom du moteur + chemins ») a été reformulée. **Non touché, signalé** : la commande
  `buddy mcp test gitnexus` citée comme preuve d'exécution réelle dans le même tableau — c'est un identifiant
  réellement exécuté au moment de la mission GK35, pas un mot de doc.
- `docs/research/ETUDE-PERCEPTION-MONDE-PHYSIQUE.md` : le parenthésage redondant dans un schéma ASCII a été retiré
  (« Code Explorer (ancien nom) » → « Code Explorer »). **Non touché, signalé** : la citation directe d'un README de
  dépôt tiers (intégrité de la citation), le chemin de build local et la mention de double-nommage toléré par regex
  (comportement réellement codé, `src/codebuddy/tools.ts:398`), la commande CLI d'exemple, et la note de nommage qui
  documente elle-même que le binaire n'est pas encore renommé sur disque.
- `.codebuddy/mcp.json` : une seule occurrence, dans la description du serveur MCP, expliquant que l'ancien nom de
  binaire est **toujours reconnu par le code**. **Non touché** — c'est exactement le cas d'un identifiant exécuté
  que la mission demande de signaler sans changer.
- Motif de garde-fou pour l'ancien nom du moteur (bare, sans le suffixe déjà couvert) **non ajouté** : au-delà de ces
  deux fichiers, le nom reste légitimement présent dans de nombreux documents publics (README d'intégration,
  bancs de test, page de présentation, benchmark) où il désigne un alias de binaire réellement toléré par le code —
  impossible à retirer partout sans casser une documentation exacte. La consigne du complément (« si tu as pu le
  retirer partout ») n'est donc pas remplie ; décision consciente de ne pas l'ajouter, à trancher par un humain si un
  jour le binaire est effectivement renommé partout.

### Point 3 — abonnement / crédits tiers chiffrés

- `CHANGELOG.md` : déjà propre (vérifié, 0 occurrence de solde chiffré ou de palier d'abonnement nommé).
- `docs/FABLE5-CODEX-COORDINATION.md` : deux résidus trouvés et corrigés — le palier d'abonnement nommé dans le
  titre de la mission IMG1 (reformulé en « abonnement forfaitaire ») et le solde chiffré avant/après d'une session
  Flow dans la ligne FLOWFIX1 (reformulé en « solde décrémenté de 100 crédits par prise », le fait technique du
  coût par prise étant conservé comme autorisé par la mission).
- Autres mentions de crédits/paliers dans `docs/` (grilles tarifaires publiques de Google/HeyGen, plafonds
  opérationnels des scripts, coût par clip du pilote Flow) : laissées en l'état — ce sont des faits techniques
  génériques (tarification publique ou plafond de sécurité), pas le solde personnel de l'auteur.

### Garde-fou étendu

`tests/security/donnees-personnelles.test.ts` :

- Trois nouveaux motifs (concaténés, jamais en clair dans le fichier) : l'espace de brouillons privé, le dépôt de
  formation privé, l'ancien nom du dépôt de passation. Trois nouvelles fixtures isolées (`DETECTION_FIXTURES`), une
  par motif, mutation vérifiée rouge puis restaurée.
- Complément GF3 : dix fixtures isolées restaurées pour les dix termes déjà actifs dans `INTERDITS` mais sans
  témoin isolé (les motifs d'emploi/chômage, le préfixe de réseau maillé de la machine GPU de l'auteur, son nom de
  machine). Une exemption nommée ajoutée à `FICHIERS_PLAGES_PRIVEES` pour le témoin du préfixe de réseau maillé :
  toute adresse commençant par ce préfixe tombe aussi dans la plage régex `ip-maillee` (le second octet appartient à
  64-127), donc isoler le motif littéral exige d'exempter ce témoin de la détection régex — le sujet du fichier EST
  l'adresse privée, comme les autres entrées de cette liste.
- Chaque nouvelle fixture (13 au total) mutée individuellement (un caractère modifié dans un segment autre que le
  dernier mot, pour ne pas laisser un sous-préfixe valide) et vérifiée rouge avant d'être restaurée.

### Trouvaille hors périmètre écrit (pré-vérification)

`src/commands/handlers/fleet-handler.ts:328` — un commentaire d'exemple donnait en entrée une adresse de
documentation RFC 5737 (`203.0.113.10`, déjà corrigée par PRIV2) mais gardait en sortie la forme tiretée (points →
tirets) de l'adresse réelle de la machine GPU de l'auteur, un résidu direct de fuite « bloquant » (le remplacement
mécanique de PRIV2 avait corrigé l'exemple d'entrée sans remarquer que l'exemple de sortie recalculait la même
adresse réelle sous une autre forme). Corrigé pour que l'exemple de sortie dérive de l'exemple d'entrée
(`203-0-113-10`, cohérent avec l'adresse de documentation citée juste avant).

## Preuves

- `npx vitest run tests/security/donnees-personnelles.test.ts` : **31/31 verts** après le travail complet (28 avant
  le complément GF3, +3 nouvelles fixtures PRIV3, +10 fixtures restaurées GF3 → 31).
- `npx vitest run tests/docs` : 94 verts / 16 rouges (`tests/docs/revue-gemini-docs.test.ts`, section CLI). Rejeu
  identique sur le commit de base `f42783007` en `git stash` : **16 rouges déjà présents avant tout changement de
  cette mission** — le CLI compilé (`dist/`) est absent d'un clone neuf, comme déjà documenté par PRIV2. Aucun
  fichier touché par cette mission n'est en cause.
- `npx tsc --noEmit -p tsconfig.json` : **0 erreur**.
- `git diff --check` : propre (0 sortie).
- Chaque motif ajouté mutation-testé isolément (13 fixtures : 3 pour le périmètre écrit, 10 pour le complément
  GF3) : un caractère modifié dans le témoin (jamais le dernier mot, pour ne pas laisser un préfixe encore valide)
  → la fixture correspondante rougit seule, puis le fichier est restauré et la suite complète revérifiée verte.
- Pré-vérification des six motifs « bloquant » de la revue AGYSEC2 : cinq déjà corrigés par PRIV2 (0 occurrence),
  un partiellement manqué (préfixe réseau maillé résiduel sous forme tiretée) et un faux (solde de crédits sans
  l'espace insécable d'origine) — les deux corrigés dans cette mission, voir « Travail » ci-dessus.

## Bilan

**Fait** : (1) chemins d'espaces de travail privés retirés de 11 documents + 15 commentaires/tests source (nécessaire
pour que le garde-fou étendu passe), reformulés sans perte d'information (nom de fichier conservé) ; (2) ancien nom
du moteur retiré de la prose descriptive des deux fichiers du périmètre, identifiants réellement exécutés signalés
et non touchés ; (3) deux résidus chiffrés (palier d'abonnement, solde Flow) reformulés dans la table de
coordination ; (4) garde-fou étendu de 3 motifs PRIV3 + 13 fixtures isolées mutation-testées ; (5) complément GF3 :
10 fixtures manquantes restaurées pour des motifs déjà actifs mais sans preuve isolée ; (6) trouvaille directe de la
pré-vérification (fragment d'adresse réelle sous forme tiretée) corrigée hors périmètre écrit.

**Preuves réelles** : garde-fou 31/31 vert (0 → 31, chaque motif rouge sous mutation) ; `tsc` 0 erreur ; `git diff
--check` propre ; `tests/docs` 16 rouges pré-existants au commit de base, témoin identique en `git stash`.

**Reste ouvert / non tranché** : (a) l'ancien nom du moteur reste présent, à dessein, dans de nombreux documents
publics hors périmètre (README d'intégration, page de présentation, bancs de test) où il désigne un alias de
binaire réellement toléré — pas de motif de garde-fou bare ajouté, décision documentée ci-dessus ; (b) le garde-fou
détecte les adresses IP privées sous forme pointée mais pas sous forme tiretée (`a-b-c-d`) — la trouvaille de
pré-vérification l'illustre ; un motif régex supplémentaire serait nécessaire pour fermer cette classe, hors
mandat de cette mission, signalé pour arbitrage humain ; (c) l'historique git déjà poussé conserve les anciennes
valeurs (rappelé par PRIV2, toujours vrai) ; (d) les quotas/pourcentages d'usage de la flotte LLM (ligne du
01/08/2026 dans la table de coordination) n'ont pas été touchés — hors du périmètre écrit (« crédits/paliers
d'abonnement »), pas des soldes de crédits au sens de la mission.

Aucun push. `~/code-buddy` (original) non touché. Aucune API payante ni service redémarré.
