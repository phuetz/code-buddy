# SPEC-CB2 — INNOV-9 : Skill Exchange signé (l'écosystème)

Tu travailles dans un worktree git du repo **Code Buddy** (agent de codage IA multi-provider,
TypeScript strict ESM, tests Vitest). Branche : `cb2/skill-exchange`. Campagne « Code Buddy 2 ».

## Règles du repo (OBLIGATOIRES)
- Imports relatifs avec extension `.js` même depuis des `.ts`. Pas de `any`. `noUncheckedIndexedAccess` ON.
- `logger` (`src/utils/logger.js`) en production, jamais `console.*` (sauf sortie CLI dans `src/commands/`).
- Fichiers kebab-case ; tests UNIQUEMENT sous `tests/` : `npm test -- tests/<fichier>`.
- FAIL-CLOSED partout : signature invalide, hash divergent, firewall en alerte ⇒ REFUS d'installation.
- Conventional Commits. Avant chaque commit : `npm run typecheck` (0 erreur) + tes tests ciblés verts.
  N'exécute PAS la suite complète. `npm install --no-audit --no-fund` si node_modules manque.
- Ne commite jamais : SPEC-CB2.md, node_modules, état `.codebuddy/`, ni AUCUNE clé privée.
- Documente dans `docs/cb2/skill-exchange.md`. NE MODIFIE PAS CLAUDE.md.

## Mission
Les skills authored par les agents (déjà gatés par le skill firewall) deviennent **partageables en
confiance** : export en paquet avec manifeste signé ed25519 (hash de chaque fichier, provenance,
version), publication vers un registre (un simple dossier/dépôt git), installation avec
vérification de signature + re-scan firewall. La brique de l'écosystème — et de la monétisation.

## Ancrage dans l'existant (à lire d'abord — IMPÉRATIF)
- `src/skills/skill-importer.ts` — l'import externe existant : `scanSkillFirewall` (LA défense —
  tu la RÉUTILISES à l'install), le flattening `imported-<name>`, la provenance écrite, scripts
  copiés jamais exécutés. Ton install est un cousin de ce chemin, avec la crypto en plus.
- `src/skills/skill-sources.ts` — le référentiel de sources nommées (dir/git) : étends-le pour les
  registres d'exchange plutôt que créer un doublon.
- `src/agent/self-improvement/skill-mutator.ts` — où vivent les skills authored
  (`.codebuddy/skills/authored-*/SKILL.md`, frontmatter, pinning).
- Node `crypto` natif : `generateKeyPairSync('ed25519')`, `sign(null, data, key)` /
  `verify(null, data, pub, sig)` — AUCUNE dépendance npm nouvelle.

## Périmètre P0
1. `src/skills/skill-signing.ts` :
   - Paire de clés locale sous `~/.codebuddy/skill-signing/` (`key.pem` mode 0600 + `key.pub`),
     générée lazy au premier export. `getPublicKeyId()` = empreinte courte (sha256 base64url 12c).
   - `signManifest(manifest)` / `verifyManifest(manifest, sig, pubKey)` — signature du JSON
     canonicalisé (clés triées).
2. `src/skills/skill-exchange.ts` :
   - `exportSkill(name, outDir)` : prend un skill `authored-*` OU bundlé local, produit
     `<outDir>/<name>/` avec les fichiers du skill + `exchange-manifest.json` :
     `{name, version, createdAt, author: pubKeyId, files: {path, sha256}[], publicKey, signature}`.
     Refus si le skill contient des fichiers hors de son dossier (pas de traversal).
   - `installSkill(dir, opts)` : vérifie DANS L'ORDRE, fail-closed : (a) manifeste bien formé ;
     (b) signature valide contre la clé publique embarquée ; (c) sha256 de CHAQUE fichier
     conforme ; (d) `scanSkillFirewall` sur le dossier — quarantaine ⇒ refus ; (e) pas de
     collision avec un skill non-exchange existant. Puis installe en `imported-<name>` (chemin
     importer existant) avec provenance `{exchange: true, author: pubKeyId, installedAt}`.
   - Trust store : `~/.codebuddy/skill-signing/trusted-keys.json` — première installation d'un
     auteur inconnu ⇒ refus sauf `--trust` explicite (TOFU) ; les suivantes de la même clé passent.
3. CLI `buddy skills exchange` (étends la commande skills existante) :
   - `export <name> [--out DIR]`, `install <dir> [--trust]`, `keys` (montre sa clé publique + les
     clés de confiance), `verify <dir>` (dry-run : verdict sans installer).
4. Stats d'usage locales : à l'installation, entrée JSONL `~/.codebuddy/skill-exchange-log.jsonl`
   (install/verify/refus + raison) — l'audit trail.

## Tests exigés (`tests/skills/skill-exchange.test.ts` + `skill-signing.test.ts`)
- Signing : round-trip sign/verify, altération d'un octet du manifeste ⇒ verify false, clé 0600.
- Export : manifeste complet, sha256 corrects, skill inexistant ⇒ erreur propre.
- Install fail-closed : signature invalide ⇒ refus ; fichier altéré après signature ⇒ refus ;
  firewall en quarantaine (mock) ⇒ refus ; auteur inconnu sans `--trust` ⇒ refus ; avec `--trust`
  ⇒ installe + clé ajoutée au trust store ; ré-install même auteur ⇒ passe sans --trust.
- Jamais d'exécution : aucun script du paquet n'est spawné pendant export/verify/install (spy).
- CLI : motif Commander existant.

## Critères de done
- `npm run typecheck` : 0 erreur. Tests ciblés verts (+ `npm test -- tests/skills` toujours vert).
- `docs/cb2/skill-exchange.md` écrit (format du manifeste, modèle de confiance TOFU, menaces).
- Commits `feat(skills): …`.

## Interdits
- AUCUNE dépendance npm nouvelle (crypto natif). AUCUNE clé privée ne quitte
  `~/.codebuddy/skill-signing/` (jamais dans le manifeste, les logs ou le paquet).
- Jamais d'exécution de scripts du paquet. Pas de réseau en P0 (registre = dossier local/git déjà
  cloné ; le fetch distant viendra en P1).
- Ne modifie pas le skill firewall (consommateur uniquement).
