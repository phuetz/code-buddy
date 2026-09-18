# Mission Grok — Cowork export bureautique des artefacts (2026-09-17)

**STATUT : LIVRÉ LOCAL (sans commit)**

Worktree : `worktree cb-cowork-export-2026-09-17`  
Branche : `feat/cowork-export-2026-09-17`  
Base : `origin/main` `b5c50c189` (v2.2.0)  
Agent : Grok 4.6, session dédiée, medium, sans sous-agent.

## Garde-fous respectés

- Pas de `git commit`, pas de `rm -rf`, aucune publication.
- Pas de secret en clair.
- Tests sous `os.tmpdir()`, pas le HOME réel.
- `<domicile>/code-buddy` non utilisé.

## Livraison

Export **document** (.docx) et **présentation** (.pptx) depuis un artefact, DocComposer, ou une conversation (`ExportDialog`). Bibliothèques déjà au dépôt : `docx` et `pptxgenjs`, MIT, JS pur.

IPC `officeExport.save` : chemin proposé `{cwd}/exports/…`, dialogue natif, écriture locale, message avec le chemin.

Livrable utilisateur : `<dépôt privé de passation>/20260917-cowork-comparaison/EXPORT-BUREAUTIQUE.md`

## Vérifications

| Commande | Résultat |
|---|---|
| `cd cowork && npx vitest run tests/office-export-*.test.ts tests/doc-outline.test.ts` | 4 fichiers / 24 verts |
| lint ciblé `src/main/office-export` + composants branchés | 0 erreur |
| `npx tsc --noEmit` (paquet cowork) | erreurs **préexistantes** `../src/*` (pas de node_modules racine) ; **0** sur les fichiers de ce chantier |
| unzip des exemples | `word/document.xml`, `ppt/slides/slide1.xml` + `notesSlide1.xml` |
| LibreOffice `--headless --convert-to pdf` | Writer et Impress OK |

## Commits

Aucun. Propositions dans `EXPORT-BUREAUTIQUE.md`.
