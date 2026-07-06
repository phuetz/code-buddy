# Vague — Tool noyau `csv_analyze` (analyse tabulaire déterministe, sans réseau)

Tu es GPT-5.5 (Codex). Respecte `CODEX-CONVENTIONS.md` (concaténé au-dessus). Worktree `feat/csv-tool`.

## But
Un tool noyau **read-only, déterministe, sans réseau** qui analyse un fichier CSV : dimensions, colonnes (type inféré
number/string/date), stats par colonne numérique (min/max/moyenne/médiane/count/nuls), et un aperçu des N premières
lignes. Pur TypeScript (PAS de pandas, PAS de subprocess) — un parseur CSV robuste à la main (guillemets, virgules
échappées, retours ligne dans les champs).

## Fichiers NEUFS uniquement
1. `src/tools/csv-analyze-tool.ts` — `class CsvAnalyzeTool { async execute(args:{ path:string, delimiter?:string,
   maxPreview?:number }): Promise<ToolResult> }` (ToolResult = `{success,output?,error?}`, never-throws). Borne la lecture
   (rejette chemin absurde/binaire ; taille max raisonnable). `output` = markdown lisible (dimensions + table colonnes/types/stats
   + aperçu).
2. `src/tools/csv/csv-parse.ts` — fonctions PURES : `parseCsv(text, delimiter):string[][]`, `inferColumnTypes(rows)`,
   `numericStats(values)`. C'est le cœur testable.
3. `tests/tools/csv-analyze-tool.test.ts` — Vitest no-mocks : écris de VRAIS petits CSV dans un tmpdir (avec guillemets,
   champs vides, nombres) et vérifie le parse (dont un champ contenant une virgule entre guillemets), l'inférence de types,
   les stats (moyenne/médiane), et l'aperçu tronqué. + un CSV malformé → erreur propre (pas de throw).

## NE TOUCHE PAS le registry / `tools.ts` / `metadata.ts` / `codebuddy-agent.ts` — Fable câble (donne juste la classe + les purs + le test).
Ajoute quand même un `src/tools/csv/csv-wiring.ts` data-only listant `{ tool:'csv_analyze', classFile, pureFile, testFile,
suggestedKeywords, fleetSafe:true }` pour que Fable câble en une passe.

## Gate : `npx tsc --noEmit`=0 sur tes fichiers + `npx vitest run tests/tools/csv-analyze-tool.test.ts` verts (colle la sortie).
Ne pousse pas. Compte-rendu FR : cas couverts, vitest (X passed), SHA. `feat(tools): csv_analyze core tool + parser + tests`.
