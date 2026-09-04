# Réparation DISCOVERY1 — catalogue Mistral bouchon

Date : 2026-09-04  
Dépôt : `~/DEV/cb-discovery1-2026-09-04`  
Branche : `fix/discovery1-catalogue-bouchon-2026-09-04`

## Périmètre

Reproduire puis corriger l’abaissement indu d’une déclaration nominative de
fenêtre de contexte par une entrée hébergée `/v1/models` sans capacité.
Le catalogue Mistral sera rejoué uniquement par fixture locale : aucun service
et aucune API payante ne sont requis.

## État initial

Rapport créé avant inspection du code, conformément à la mission. La
réservation Fable 5 est inscrite dans `docs/FABLE5-CODEX-COORDINATION.md`.

## Journal

2026-09-04 — Point 1, reproduction ajoutée dans
`tests/config/local-runtime-context.test.ts`, avec la fixture locale
`tests/fixtures/mistral-v1-models.json` contenant exactement les deux entrées
Mistral ciblées. Rouge confirmé avec :
`HOME=~/DEV/cb-discovery1-2026-09-04/_qa/discovery1/home npx vitest run tests/config/local-runtime-context.test.ts --reporter=verbose`.
Résultat : 18 tests, 17 verts et 1 rouge ; `mistral-medium-latest` reçoit
32768 au lieu des 128000 attendus, tandis que Magistral est à 262144.

À compléter avec le correctif, les tests rouge → vert, les vérifications de
typecheck/lint/diff et les éventuels écarts préexistants.

2026-09-04 — Point 2, le cache porte désormais la source (`local` ou
`catalog`). Un catalogue hébergé sans capacité vraie est ignoré avec un
`logger.debug` explicite ; une capacité vraie ne peut pas abaisser une
déclaration nominative, alors qu’elle remplace toujours une estimation de
famille. Les tests OpenRouter et GMI ont été rendus explicites sur leurs
capacités ; le test vLLM local reste vert.

2026-09-04 — Point 3, test d’intégration
`tests/services/prompt-builder-catalogue-budget.test.ts` : la fixture Medium
est ignorée, `mistral-medium-latest` conserve 128000 et le budget du prompt
système est exactement 32000 jetons, sans `CODEBUDDY_MAX_CONTEXT`. Résultat :
1 test vert.

## Bilan

À compléter après les vérifications finales, en dix lignes maximum.
