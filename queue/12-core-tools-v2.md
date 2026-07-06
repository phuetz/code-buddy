# Vague — Noyau tools v2 : build / qualité / déploiement

Lis d'abord **`/home/patrice/code-buddy/CODEX-CONVENTIONS.md`**. Ce brief ajoute une 2ᵉ suite de **tools agent** au noyau (v1 déjà sur main : scaffold_app, project_map, dep_inspect, code_stats, git_summary, todo_scan, json_query, csv_preview, env_doctor, port_check).

**Zone (fichiers neufs)** : classes sous `src/tools/`, tests sous `tests/tools/`, manifeste `src/tools/authored-tools-manifest-2.ts` (NE touche PAS `authored-tools-manifest.ts` de v1).

**Contrat d'un tool** (rappel) : classe avec `name`, `description`, `execute(input): Promise<ToolResult>` (`{success, output?, error?, data?}`), **never-throws**, + schéma JSON de définition. Modèle : `src/tools/registry/process-tools.ts`, `src/tools/registry/web-test-tool.ts`. Chaque tool = fichier neuf + test réel (no-mocks : tmpdir + fichiers réels).

**Sécurité** : ces tools restent **bornés à un `root`/chemin explicite**. Les tools qui exécutent une commande (`lint`, `test`, `format`, `build`) le font via `execFile` avec le binaire du projet (`node_modules/.bin/…`) dans le `cwd` projet, jamais une commande arbitraire ; timeout borné ; never-throws.

## Tools à livrer (1 commit chacun)
1. **`lint_project`** (`src/tools/lint-project-tool.ts`) : lance l'ESLint du projet (`node_modules/.bin/eslint`) sur un `root`, parse le JSON de sortie, résume erreurs/warnings par fichier. No-op propre si eslint absent.
2. **`test_runner`** (`src/tools/test-runner-tool.ts`) : détecte le runner (vitest/jest via package.json scripts) et lance les tests d'un `root`, résume passés/échoués. Timeout. Ne lance QUE le script `test` déclaré.
3. **`format_project`** (`src/tools/format-project-tool.ts`) : lance Prettier (`--check` par défaut, `--write` si `write:true` explicite) sur un `root`. Résume les fichiers non conformes.
4. **`bundle_analyze`** (`src/tools/bundle-analyze-tool.ts`) : analyse un dossier `dist/` build (tailles de fichiers, plus gros chunks, total gzippé estimé). Read-only.
5. **`build_project`** (`src/tools/build-project-tool.ts`) : lance le script `build` du package.json d'un `root`, capture succès/échec + durée + erreurs. Timeout borné.
6. **`license_check`** (`src/tools/license-check-tool.ts`) : parse les licences des deps (champ `license` de chaque `node_modules/*/package.json`), signale les non-permissives (GPL/AGPL/…). Read-only, pas de réseau.
7. **`sbom_generate`** (`src/tools/sbom-generate-tool.ts`) : génère un SBOM minimal (liste nom@version + licence de toutes les deps) au format JSON. Read-only.
8. **`http_probe`** (`src/tools/http-probe-tool.ts`) : GET **loopback-only** une URL (réutilise la validation loopback de `src/security/dev-origins.ts` / `app-server-tool.ts`), retourne statut + headers + taille. Refuse toute URL non-loopback (fail-closed).
9. **`file_search`** (`src/tools/file-search-tool.ts`) : recherche un motif (regex) dans les fichiers d'un `root` (ignore node_modules/.git/binaires), retourne fichier:ligne:extrait, borné en résultats. Read-only.
10. **`diff_files`** (`src/tools/diff-files-tool.ts`) : diff unifié entre deux fichiers d'un `root`, algo LCS simple. Read-only.
11. **Manifeste** `src/tools/authored-tools-manifest-2.ts` (data-only, même forme que v1 : `{name, classFile, className, definitionFile, registryFactory, metadata:{keywords,priority,fleetSafe}, readOnly, testFile}`).
