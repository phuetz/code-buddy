# AUDIT SÉCURITÉ DÉFENSIF — Hub de flotte + bac à sable (avant publication 2.0)

- **Auteur** : Fable / Opus 4.8
- **Date** : 2026-09-05
- **Clone isolé** : `~/DEV/cb-astra-secaudit-2026-09-05`
- **Branche** : `opus/audit-securite-flotte-2026-09-05` (base `astra/live-agentique-2026-09-05`)
- **Cadre** : audit adversarial de ma propre installation, sur clone isolé, pour trouver et FERMER des failles. Aucun push, aucun service hors loopback, HOME Vitest `_qa/astrasec/home`. `~/code-buddy` et le vrai `~/.codebuddy` en lecture seule stricte. Jetons de test factices uniquement.

## Méthode
Pour chaque surface : lecture de la source → construction d'un cas de test adversarial borné au dépôt → si contournement : test rouge (faille), correctif fail-closed minimal, test vert (fermeture) ; si garde déjà solide : test qui prouve le REFUS. Aucun outil offensif généraliste. `git add` fichier par fichier, commit par point.

## Surfaces
1. `peer.tool.invoke` / `.stream` (allowlist → fleetSafe → workspace root fail-closed)
2. Bac à sable natif (bwrap/Landlock/seatbelt) + outils authored (cwd jetable, RPC off, pare-feu)
3. Serveur HTTP/WS (CORS non-contrôle-d'accès, JWT prod, trustedProxies/rate-limit, SSRF)
4. Secrets (garde-fou données personnelles, filtre validateur, output-sanitizer, temporaires atomic-write)

---

## Tableau des attaques

| # | Surface | Attaque | Résultat | Gravité | Correctif (SHA) | Test |
|---|---------|---------|----------|---------|-----------------|------|
| 1.1 | peer.tool.invoke | chemin absolu `/etc/passwd` | REFUSÉE | — | (garde existante) | audit-secaudit-peer-traversal |
| 1.2 | peer.tool.invoke | `../` profond hors workspace | REFUSÉE | — | (garde existante) | audit-secaudit-peer-traversal |
| 1.3 | peer.tool.invoke | encodage `%2e%2e` | REFUSÉE (littéral, pas de fuite) | — | (garde existante) | audit-secaudit-peer-traversal |
| 1.4 | peer.tool.invoke | symlink interne → `/etc` (existant + pendant) | REFUSÉE | — | (garde existante) | audit-secaudit-peer-traversal |
| 1.5 | peer.tool.invoke | alias non-fleetSafe → exécuteur | REFUSÉE (`UNKNOWN_PEER_TOOL`) | — | (par conception) | (analyse) |
| 1.6 | peer.tool.invoke | needs_approval sans confirmant (headless) | REFUSÉE (fail-closed) | — | (garde existante) | audit-secaudit-peer-needs-approval |
| 2.1 | firewall skills | jailbreak/prompt-override via homoglyphe cyrillique | **CONTOURNÉE → fermée** | **B** | `52efd0109` | audit-secaudit-skill-firewall-obfuscation |
| 2.2 | firewall skills | prompt-override via césure inter-lignes | **CONTOURNÉE → fermée** | **B** | `52efd0109` | audit-secaudit-skill-firewall-obfuscation |
| 2.3 | firewall skills | jailbreak via zero-width / soft-hyphen | REFUSÉE (partiel avant, robuste après) | B | `52efd0109` | audit-secaudit-skill-firewall-obfuscation |
| 2.4 | gate authored (tools) | outil authored lit `~/.ssh/id_rsa` en dur + stdout | **CONTOURNÉE → fermée** | **B** | `52efd0109` | audit-secaudit-authored-secret-read |
| 2.5 | gate authored (tools) | outil authored lit `/etc/shadow` / `.aws/credentials` / `.env` | **CONTOURNÉE → fermée** | **B** | `52efd0109` | audit-secaudit-authored-secret-read |
| 2.6 | runtime authored | `child_process`/`execSync`/`spawn` + réseau (exfiltration) | REFUSÉE (gate statique) | — | (garde existante) | authored-artifact-gate (existant) |
| 2.7 | runtime authored | `isolate` confine-t-il les lectures par chemin absolu ? | RÉSIDU C (non confiné ; egress bloqué) | C | (documenté, non fermé) | audit-secaudit-authored-secret-read (résidu) |
| 3.1 | SSRF | IP décimale/hex/octale/short (127.0.0.1) | REFUSÉE | — | (garde existante) | audit-secaudit-ssrf-ip-forms |
| 3.2 | SSRF | metadata cloud 169.254.169.254 (pointée + décimale) | REFUSÉE | — | (garde existante) | audit-secaudit-ssrf-ip-forms |
| 3.3 | SSRF | IPv6 loopback/mapped/link-local/ULA | REFUSÉE | — | (garde existante) | audit-secaudit-ssrf-ip-forms |
| 3.4 | SSRF | DNS-rebinding (TOCTOU résolution→fetch) | REFUSÉE (IP épinglée) | — | (garde existante) | ssrf-dns-pinning (existant) |
| 3.5 | SSRF | protocole file://, gopher:// | REFUSÉE | — | (garde existante) | audit-secaudit-ssrf-ip-forms |
| 3.6 | HTTP | JWT_SECRET absent en production | REFUSÉE (throw module-load) | — | (garde existante) | (analyse index.ts:123) |
| 3.7 | webhook | cible RFC1918/metadata via règle sensorielle | REFUSÉE (assertSafeUrl + redirect manual) | — | (garde existante) | webhook-ssrf (existant) |
| 4.1 | scanner secrets | clé Anthropic `sk-ant-` non détectée | **CONTOURNÉE → fermée** | **B** | `105c10797` | audit-secaudit-scanner-provider-keys |
| 4.2 | scanner secrets | clé OpenAI `sk-proj-`/`sk-` non détectée | **CONTOURNÉE → fermée** | **B** | `105c10797` | audit-secaudit-scanner-provider-keys |
| 4.3 | scanner secrets | clé xAI `xai-` non détectée | **CONTOURNÉE → fermée** | **B** | `105c10797` | audit-secaudit-scanner-provider-keys |
| 4.4 | audit-logger | fuite d'une clé fournisseur dans le log disque | REFUSÉE (secret-scrubber couvre sk-ant/sk-proj/sk-/Bearer) | — | (garde existante) | (analyse secret-scrubber.ts) |
| 4.5 | atomic-write | temporaire `*.tmp.*` monde-lisible | REFUSÉE (0o600, atomique) | — | (garde existante) | audit-secaudit-atomic-temp-perms |
| 4.6 | output-sanitizer | fuite d'un jeton dans la sortie LLM | N/A (redaction = data-redaction/secret-scrubber ; sanitizer = tokens LLM) | — | (par conception) | (analyse) |

---

## Surface 1 — `peer.tool.invoke` / `.stream` : SOLIDE (aucune faille)

Les trois gardes tiennent, dans l'ordre : allowlist (match exact, `permissions.ts`) → `fleetSafe` (`registry.isFleetSafe`) → conteneur workspace (`assertPathInsideWorkspace`). La garde de chemin re-résout tout via `realpathFollowingExistingAncestors` + `resolveDanglingSymlink`, puis `isPathInsideOrEqual` — donc `../`, chemin absolu, symlink interne pointant dehors (existant OU pendant) et racine `/` sont tous rejetés. `%2e` n'est jamais décodé par `path` : traité comme littéral, il ne peut pas remonter. Les seuls exécuteurs sont `view_file`/`list_directory`/`search`, donc un alias non-`fleetSafe` n'atteint aucun exécuteur (`UNKNOWN_PEER_TOOL`). Enfin, toute décision `needs_approval` (garde secrets du PolicyEngine, ou peer:invoke non read-only) passe par `ConfirmationService`, qui **échoue fermé** sur un pair headless (pas de TTY, pas de canal distant, pas d'auto-confirm) — ligne 448-450.

Profondeur (`CODEBUDDY_PEER_MAX_DEPTH`) et `role=leaf` sont des gardes **anti-boucle coopératives** (le champ `depth` est fourni par l'appelant, `leaf` tague sans bloquer) — documentées comme telles, ce ne sont pas des frontières de sécurité, et la vraie frontière (les 3 gardes) tient. Aucun correctif nécessaire.

Preuves ajoutées (refus) : `tests/fleet/audit-secaudit-peer-traversal.test.ts` (7) + `tests/fleet/audit-secaudit-peer-needs-approval.test.ts` (1).

## Surface 2 — bac à sable natif + outils/skills authored : 2 failles B fermées + 1 résidu C

### 2a. Firewall des skills contourné par obfuscation — FAILLE B, fermée
Le gate des stratégies a été durci le 04/09 (`normalizeDirectiveText` : zero-width, soft-hyphen, césures, NFKC, homoglyphes cyrilliques). Le firewall des skills (`src/security/skill-scanner.ts`) ne faisait AUCUNE de ces normalisations : `scanFile` teste les patterns sur la ligne brute, et `collectPromptInjectionFindings` sur le contenu brut. Un skill est INJECTÉ dans le contexte de l'agent — un LLM lit "ignore all previous instructions" ou "jailbreak" même écrit avec un homoglyphe cyrillique (`ignоre`), un zero-width, ou une césure (`jail-\nbreak`), mais le regex les manquait. Prouvé rouge (homoglyphe + césure passaient en verdict `allow`).
**Correctif** : nouveau helper partagé `src/security/text-deobfuscation.ts` (`deobfuscateText`, copie indépendante de la logique stratégies — la zone self-improvement est réservée à une autre lane), appliqué à la passe prompt-injection full-document. La passe brute reste (numéros de ligne exacts) ; la passe normalisée ajoute les captures obfusquées (ligne 1, description « (obfuscated) »). Vert : 6/6.

### 2b. Outil authored lisant un secret par chemin absolu — FAILLE B, fermée
Un outil authored tourne « lit l'entrée depuis l'env, imprime sur stdout », sandboxé par `authored-tool-runtime.ts` (`envMode:'isolate'` → env scrubbé, HOME redirigé). Mais `inspectAuthoredCode` bloque écritures + réseau + `child_process`/`exec` (donc pas d'exfiltration directe) **sans bloquer les LECTURES**, et un chemin ABSOLU en dur (`/home/x/.ssh/id_rsa`, `/etc/shadow`, `.aws/credentials`, `.env`) contourne la redirection HOME. Prouvé rouge : `inspectAuthoredCode` renvoyait `ok=true` pour un tel outil ; et le runtime `isolate` lit bien un fichier hors du runDir (test résidu).
**Correctif** : pattern `sensitive-credential-path` (severity high, `appliesTo:['code']`) dans `src/security/dangerous-patterns.ts` — bloque les références aux chemins d'identifiants bien connus. Fail-closed, ciblé (n'affecte pas un outil qui lit `/var/log/app.log` ou calcule sur son entrée). Vert : 6/6 gate + 1 résidu documenté.

### 2c. Résidu C — le runtime `isolate` ne confine pas les lectures FS
`envMode:'isolate'` ne fait que scrubber l'env et rediriger HOME : aucun confinement FS kernel (bwrap/Landlock) dans ce chemin. Un chemin absolu **calculé/injecté au runtime** (via l'entrée de l'outil) peut donc encore lire un fichier arbitraire. Mitigé par : (1) l'egress réseau/sous-processus bloqué (le secret ne sort pas) ; (2) l'entrée provient de l'agent lui-même, pas d'un pair distant ; (3) le nouveau gate statique ferme le cas réaliste (chemin en dur). Le confinement FS runtime complet (activer `CODEBUDDY_NATIVE_SANDBOX` pour ce chemin, ou un allowlist de lecture) touche `authored-tool-runtime.ts`/`execute-code-runner.ts` — recommandé à la lane self-improvement (zone réservée), non fermé ici. Gravité C (défense en profondeur).

## Surface 3 — serveur HTTP/WS + SSRF : SOLIDE (aucune faille), 2 résidus D

Le garde SSRF (`src/security/ssrf-guard.ts`) couvre TOUTES les formes de littéral IPv4 obfusqué (décimal `2130706433`, hex `0x7f000001`, octal `0177.0.0.1`, short `127.1`), toutes les plages RFC1918/loopback/link-local/metadata, et l'IPv6 (loopback, IPv4-mapped, NAT64, 6to4, Teredo, ULA, link-local, multicast). Il résout le DNS et valide CHAQUE IP retournée, fail-closed sur erreur. `src/security/safe-fetch.ts` **épingle l'IP validée** dans un dispatcher undici custom (`lookup` renvoie l'IP exacte validée) → la fenêtre DNS-rebinding/TOCTOU est fermée ; chaque redirection est re-validée et re-épinglée, `authorization` est retiré cross-origin. Le consommateur webhook (`sensory-action-executor.ts`) route non-loopback via `assertSafeUrl` + `safeFetchFollow`, loopback via fetch direct `redirect:'manual'` (tout 3xx bloqué). `JWT_SECRET` absent en production ⇒ `getJwtSecret` **throw** au démarrage (`index.ts:123`). Rate-limit 60/min par défaut. CORS documenté comme non-contrôle-d'accès (WS refuse l'Origin, HTTP 200 sans en-tête) — la frontière reste le JWT + le réseau.

Résidus (défense en profondeur, gravité D, NON fermés — hors valeur/risque) :
- **`*.localhost` webhook** : `isLoopbackHost` traite `*.localhost` comme loopback par nom SANS vérifier l'IP résolue. Un résolveur empoisonné + un webhook opérateur `x.localhost` pourrait atteindre une IP non-loopback. Exige un résolveur compromis ET une règle opérateur `.localhost` (opt-in + jeton) — théorique. Recommandation : résoudre et exiger que TOUTES les IP soient 127/8 ou ::1 sur le chemin loopback.
- **`DEFAULT_SERVER_CONFIG.jwtSecret='change-me-in-production'`** (`types.ts:107`) : secret faible codé en dur, mais **inatteignable** — `startServer` construit sa config depuis `DEFAULT_CONFIG` et écrase toujours `jwtSecret` via `getJwtSecret` (throw prod) ; aucun consommateur ne lit `DEFAULT_SERVER_CONFIG`. Footgun latent ; recommandation : le mettre à `''` (fail-closed) plutôt qu'un secret utilisable.

## Surface 4 — secrets : 1 faille B fermée (3 clés) + gardes confirmés

### 4a. Le scanner de secrets ne connaissait PAS les 3 clés que Code Buddy utilise le plus — FAILLE B, fermée
Il existe trois systèmes : `secret-scrubber.ts` (audit-logger, écrit sur disque — couvre `sk-ant-`/`sk-proj-`/`sk-`/`Bearer` EN PLUS de `SECRET_PATTERNS`), `data-redaction.ts` (exports — couvre OpenAI/Anthropic/xAI), et `secrets-detector.ts` (le SCANNER exposé à l'utilisateur : outil `scan_secrets` + `enhanced-command-handler`), qui n'utilisait QUE `SECRET_PATTERNS`. Or `SECRET_PATTERNS` n'avait NI OpenAI `sk-`/`sk-proj-`, NI Anthropic `sk-ant-`, NI xAI `xai-`. Résultat : `scan_secrets` sur un fichier contenant une vraie clé Anthropic/OpenAI/xAI renvoyait « aucun secret » — fausse assurance sur la fuite la plus probable pour CE produit. Prouvé rouge (4/4 clés manquées, `risk-management` non signalé).
**Correctif** : ajout des patterns `anthropic_key`/`openai_key`/`xai_key` dans `SECRET_PATTERNS` (source unique partagée par scanner ET scrubber), avec ancrage de frontière `(?<![A-Za-z0-9-])` (pas de faux positif sur « risk-management »). Vert : 5/5.
**Note fuite disque** : l'audit-logger était déjà couvert par `secret-scrubber.ts` (qui ajoutait ces clés) — aucune fuite dans le log persistant ; la faille portait sur la QUALITÉ du scanner, pas sur une fuite du log.

### 4b. Temporaires atomic-write — REFUSÉE (garde confirmé)
`writeFileAtomic`/`writeFileAtomicSync` ouvrent le temporaire `*.tmp.*` avec le même mode que le final, défaut `DEFAULT_MODE=0o600` (owner rw only), atomiquement (`open('w', 0o600)` — pas de fenêtre monde-lisible). Prouvé : final 0o600, et le mode transmis à l'`open` du temporaire est 0o600 (fs injecté).

### 4c. output-sanitizer — hors périmètre secrets (par conception)
`output-sanitizer.ts` retire les tokens de contrôle LLM (`<think>`, `<|im_start|>`, GLM/DeepSeek). La rédaction des SECRETS est la responsabilité de `data-redaction.ts` (exports) et `secret-scrubber.ts` (logs) — deux chemins distincts, tous deux couvrant les clés fournisseurs. Aucun jeton ne « fuit » par l'output-sanitizer car ce n'est pas son rôle et les chemins de rédaction en amont/aval le couvrent.

## Détail par surface (suite)

## Récapitulatif failles A/B fermées

Aucune faille A (contournement direct exploitable à distance sans opt-in). **Quatre failles B fermées** :

| Réf | Faille B | Fermeture | Test |
|-----|----------|-----------|------|
| 2a | Firewall des skills contourné par obfuscation (homoglyphe/césure/zero-width) — un skill injecté dans le contexte du LLM | `deobfuscateText` sur la passe prompt-injection (`52efd0109`) | audit-secaudit-skill-firewall-obfuscation |
| 2b | Outil authored lisant un secret par chemin absolu en dur (`~/.ssh/id_rsa`, `/etc/shadow`, `.aws/credentials`, `.env`) | pattern `sensitive-credential-path` (`52efd0109`) | audit-secaudit-authored-secret-read |
| 4a | Scanner de secrets (`scan_secrets`) ne détectait NI OpenAI, NI Anthropic, NI xAI — les 3 clés que Code Buddy utilise le plus | patterns provider dans `SECRET_PATTERNS` (`105c10797`) | audit-secaudit-scanner-provider-keys |

*(2a et 4a comptent chacune plusieurs vecteurs — cf. tableau détaillé lignes 2.1–2.3 et 4.1–4.3.)*

Résidus NON fermés (justifiés) :
- **C — runtime authored `isolate`** ne confine pas les lectures FS par chemin calculé au runtime (egress bloqué ; entrée = agent lui-même ; chemin en dur désormais gaté). Confinement FS complet → touche `authored-tool-runtime.ts` (zone réservée self-improvement).
- **D — `*.localhost` webhook** fetché sans vérifier l'IP résolue (exige résolveur empoisonné + règle opérateur opt-in).
- **D — `DEFAULT_SERVER_CONFIG.jwtSecret='change-me-in-production'`** : footgun latent mais inatteignable (jamais consommé ; `startServer` écrase via `getJwtSecret` qui throw en prod).

## Vérifications finales

- `tests/security/` : **47 fichiers / 872 tests verts**
- `tests/fleet/` : **41 fichiers / 645 tests verts**
- `tests/server/` : **61 fichiers verts + 1 ignoré (natif better-sqlite3, préexistant) / 556 tests verts + 1 ignoré**
- `npx tsc --noEmit -p .` : **0**
- ESLint ciblé `--max-warnings=0` sur tous les fichiers touchés : **0**
- `git diff --check` : **0**
- Vrai `~/.codebuddy` et `~/code-buddy` : intacts (lecture seule stricte, aucun secret réel affiché) ; aucun push ; aucun service hors loopback.

## Bilan (10 lignes)

1. Audit adversarial défensif de 4 surfaces du hub de flotte + bac à sable, sur clone isolé, avant la 2.0.
2. Surface 1 (peer.tool.invoke) : SOLIDE — allowlist/fleetSafe/workspace + needs_approval headless échouent fermé ; traversée (`../`, absolu, `%2e`, symlink, racine) prouvée refusée (8 tests).
3. Surface 3 (HTTP/WS/SSRF) : SOLIDE — SSRF couvre décimal/hex/octal/IPv6/metadata, DNS-rebinding fermé par épinglage d'IP, JWT prod throw (17 tests).
4. Faille B (2a) fermée : le firewall des skills ne dé-obfusquait pas — homoglyphe/césure faisaient passer un jailbreak injecté dans le contexte.
5. Faille B (2b) fermée : un outil authored lisait un secret par chemin absolu en dur ; egress déjà bloqué, mais l'env-isolation documentée était défaite.
6. Faille B (4a) fermée : le scanner `scan_secrets` ratait OpenAI/Anthropic/xAI — les clés les plus utilisées par ce produit — donnant une fausse assurance.
7. Le log persistant (audit-logger) était déjà protégé par `secret-scrubber.ts` ; les temporaires atomic-write sont 0o600 atomiques (prouvé).
8. Restent 1 résidu C (confinement FS runtime des outils authored, zone réservée) + 2 résidus D (footguns inatteignables/théoriques), tous documentés.
9. Preuves : 41 tests d'audit rouge→vert / preuve-de-refus ; security 872, fleet 645, server 556 verts ; tsc 0, eslint 0, diff-check 0.
10. **Le hub de flotte est publiable en l'état** : aucune faille A/B ouverte ; les résidus C/D sont opt-in, mitigés et documentés, non bloquants pour la 2.0.

