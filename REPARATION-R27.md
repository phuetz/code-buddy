# Réparation R27 — widgets Telegram et contrat JSON

Date : 2026-09-02
Dépôt : `/home/patrice/DEV/cb-repar-widgets-2026-09-02`
Branche : `fix/repar-widgets-2026-09-02`

Ce rapport est créé avant les correctifs, conformément à la mission. Aucun
message Telegram réel ni aucune API payante ne seront utilisés. La coordination
`docs/FABLE5-CODEX-COORDINATION.md` est lue mais volontairement inchangée,
conformément à la consigne R27.

## État initial

- Audit lu intégralement : `AUDIT-A-REPARER.md` (E9).
- Défauts à traiter :
  1. Telegram ne convertit pas `widgetHtml`/payload en PNG et n'appelle pas
     `sendPhoto` pour ce chemin.
  2. `autoWidget` impose à tort 200 caractères aux payloads structurés.
  3. Le JSON headless n'expose pas `data` et, en mode automatique, pas
     `widgetHtml` pour le cours boursier court.

## Preuves

### Point 1 — Telegram

Test rouge avant le correctif :

```text
tests/channels/telegram.test.ts (24 tests | 1 failed)
Expected: "/sendPhoto"
Received: "https://api.telegram.org/bottest-bot-token/sendMessage"
Tests 1 failed | 23 passed (24)
```

Correctif : `src/widgets/widget-image-renderer.ts` résout Playwright
facultatif, puis `puppeteer-core` + Chromium système, avec une limite de 8 s ;
`src/channels/telegram/client.ts` rend `channelData.telegram.widgetHtml` ou
`.data` et réutilise le multipart `sendPhoto`, avec repli texte explicite si le
rendu échoue. Le handler Telegram transmet le candidat produit par
`autoWidget`.

Test vert :

```text
npx vitest run tests/channels/telegram.test.ts
Test Files  1 passed (1)
Tests  24 passed (24)
```

Le test utilise uniquement `fetch` mocké, vérifie `/sendPhoto`, `FormData`, la
légende et un Blob PNG de taille strictement positive. Aucun appel Telegram
réel n’a été effectué.

### Point 2 — seuil de détection

Test rouge avant le correctif :

```text
tests/widgets/widget-matcher.test.ts (8 tests | 1 failed)
tests/widgets/auto-widget.test.ts (7 tests | 1 failed)
Tests 2 failed | 13 passed (15)
```

Le matcher renvoyait `null` pour le payload `stock` court. Le seuil de 200
caractères est maintenant appliqué après l’examen des payloads typés ; il reste
donc réservé aux tableaux Markdown.

Test vert :

```text
npx vitest run tests/widgets/auto-widget.test.ts tests/widgets/widget-matcher.test.ts
Test Files  2 passed (2)
Tests  15 passed (15)
```

La règle est documentée dans `docs/cb2/generative-ui.md`.

### Point 3 — JSON headless

Test rouge avant le correctif :

```text
tests/cli/headless-exit-code.test.ts (7 tests | 1 failed | 6 skipped)
expected undefined to match object { type: 'table', ... }
Tests 1 failed | 6 skipped (7)
```

`src/index.ts` expose maintenant le `data` du candidat détecté, même sans
rendu automatique ; `widgetHtml` reste ajouté lorsqu’il est produit par
`autoWidget` (variables `CODEBUDDY_WIDGETS=true` et
`CODEBUDDY_WIDGETS_AUTO=true`).

Test vert :

```text
npx vitest run tests/cli/headless-exit-code.test.ts -t "automatic table widget"
Test Files  1 passed (1)
Tests  1 passed | 6 skipped (7)
```

Le contrat est documenté dans `docs/cb2/generative-ui.md` et le test headless
réel vérifie simultanément `data.type`, les cellules et `widgetHtml`.

## Vérifications finales

```text
npx vitest run tests/widgets tests/channels
Test Files  58 passed (58)
Tests  1523 passed (1523)

npm run typecheck
> tsc --noEmit && npm run typecheck:darkstar-identity
> tsc --project tsconfig.darkstar-identity.json
exit 0

npx eslint src/widgets/widget-image-renderer.ts src/channels/core.ts src/channels/telegram/client.ts src/commands/handlers/channel-handlers.ts src/widgets/widget-matcher.ts src/index.ts tests/channels/telegram.test.ts tests/widgets/auto-widget.test.ts tests/widgets/widget-matcher.test.ts tests/cli/headless-exit-code.test.ts
0 errors, 3 warnings (imports inutilisés historiques dans telegram/client.ts et any historique dans telegram.test.ts)

git diff --check
exit 0
```

## Commits

- `116f307a1` — `fix(telegram): rendre les widgets en image`
- `16f681415` — `fix(widgets): ignorer le seuil pour les payloads structures`
- troisième commit — `fix(widgets): exposer les payloads dans le JSON headless`

Le rapport est ajouté nominativement au troisième commit. État final attendu :
les seuls non-suivis préexistants restent `AUDIT-A-REPARER.md` et le lien
`node_modules`; aucun push, aucun service et aucun fichier de coordination n’a
été touché.
