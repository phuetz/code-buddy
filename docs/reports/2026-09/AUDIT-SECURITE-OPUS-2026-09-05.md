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
| 2.1 | firewall skills | jailbreak/prompt-override via homoglyphe cyrillique | **CONTOURNÉE → fermée** | **B** | (voir commit surface 2) | audit-secaudit-skill-firewall-obfuscation |
| 2.2 | firewall skills | prompt-override via césure inter-lignes | **CONTOURNÉE → fermée** | **B** | (voir commit surface 2) | audit-secaudit-skill-firewall-obfuscation |
| 2.3 | firewall skills | jailbreak via zero-width / soft-hyphen | REFUSÉE (partiel avant, robuste après) | B | (voir commit surface 2) | audit-secaudit-skill-firewall-obfuscation |
| 2.4 | gate authored (tools) | outil authored lit `~/.ssh/id_rsa` en dur + stdout | **CONTOURNÉE → fermée** | **B** | (voir commit surface 2) | audit-secaudit-authored-secret-read |
| 2.5 | gate authored (tools) | outil authored lit `/etc/shadow` / `.aws/credentials` / `.env` | **CONTOURNÉE → fermée** | **B** | (voir commit surface 2) | audit-secaudit-authored-secret-read |
| 2.6 | runtime authored | `child_process`/`execSync`/`spawn` + réseau (exfiltration) | REFUSÉE (gate statique) | — | (garde existante) | authored-artifact-gate (existant) |
| 2.7 | runtime authored | `isolate` confine-t-il les lectures par chemin absolu ? | RÉSIDU C (non confiné ; egress bloqué) | C | (documenté, non fermé) | audit-secaudit-authored-secret-read (résidu) |

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

## Détail par surface (suite)

## Récapitulatif failles A/B fermées

_(à compléter)_

## Bilan (10 lignes)

_(à compléter en clôture)_
