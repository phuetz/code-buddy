# SPEC-CB2 — INNOV-7 : GUI générative par défaut (widgets auto-proposés + réutilisation)

Tu travailles dans un worktree git du repo **Code Buddy** (agent de codage IA multi-provider,
TypeScript strict ESM, tests Vitest). Branche : `cb2/generative-ui`. Campagne « Code Buddy 2 ».

## Règles du repo (OBLIGATOIRES)
- Imports relatifs avec extension `.js` même depuis des `.ts`. Pas de `any`. `noUncheckedIndexedAccess` ON.
- `logger` (`src/utils/logger.js`) en production, jamais `console.*`.
- Fichiers kebab-case ; tests UNIQUEMENT sous `tests/` : `npm test -- tests/<fichier>`.
- Feature OPT-IN (`CODEBUDDY_WIDGETS_AUTO=true`, qui exige aussi l'existant `CODEBUDDY_WIDGETS=true`) —
  défaut ⇒ ZÉRO changement. Never-throws : une panne du pipeline widget n'altère jamais la réponse texte.
- Conventional Commits. Avant chaque commit : `npm run typecheck` (0 erreur) + tes tests ciblés verts.
  N'exécute PAS la suite complète. `npm install --no-audit --no-fund` si node_modules manque.
- Ne commite jamais : SPEC-CB2.md, node_modules, état `.codebuddy/`.
- Documente dans `docs/cb2/generative-ui.md`. NE MODIFIE PAS CLAUDE.md.

## Mission
Généraliser la bibliothèque de widgets génératifs existante : quand une réponse de l'agent
contient des **données structurées** (payload `data:{type:…}` ou tableau markdown substantiel),
le moteur propose automatiquement un widget server-rendered inline, en **réutilisant** un widget
authored existant qui matche le type de données avant d'en générer un nouveau. L'app fabrique son UI.

## Ancrage dans l'existant (à lire d'abord — IMPÉRATIF)
- `grep -rn "CODEBUDDY_WIDGETS" src/ | head -30` — la bibliothèque de widgets existe déjà
  (PRs #58/#59/#60) : moteur de rendu **100 % côté serveur (zéro `<script>` — le srcDoc hérite de
  la CSP hôte)**, widgets authored = templates Mustache inertes gatés. COMPRENDS ce moteur avant
  d'écrire quoi que ce soit ; ta feature est une COUCHE au-dessus, pas un nouveau moteur.
- `src/tools/stock-quote.ts` — exemple du payload `data:{type:'stock'|…}` qui rend un widget curé.
- Les points d'émission de réponse : cherche où les payloads `data:` sont interceptés pour le rendu.

## Périmètre P0
1. `src/widgets/widget-matcher.ts` (adapte le chemin au module widgets existant) :
   - `detectWidgetable(text, payloads)` (PURE) : détecte les candidats — payload `data:{type}`
     connu, ou tableau markdown ≥ 3 lignes × ≥ 2 colonnes. Retourne
     `{kind:'payload'|'table', dataType, data}` ou null.
   - `matchAuthored(dataType, registry)` : cherche dans le registre des widgets authored existant
     un template dont le type de données déclaré matche ; retourne le widget ou null.
2. `src/widgets/auto-widget.ts` : pipeline `answer → widget` gardé par
   `CODEBUDDY_WIDGETS_AUTO=true` :
   - candidat détecté → widget authored matché → rendu server-side (moteur existant) inline ;
   - pas de match → si `CODEBUDDY_WIDGETS_AUTOGEN=true` (opt-in séparé, défaut off), génération
     LLM d'un nouveau template via le chemin de génération gaté EXISTANT (celui de
     `buddy widgets gen`), puis enregistrement authored (re-gaté) et rendu ;
   - toute erreur ⇒ la réponse texte passe inchangée (never-throws), log debug.
   - Anti-bruit : max 1 widget auto par réponse ; jamais si la réponse < 200 caractères.
3. Registre : étends le registre authored existant avec un champ `dataTypes: string[]` déclaré par
   template (rétro-compatible : absent ⇒ jamais auto-matché) + stats d'usage
   (`usedCount`, `lastUsedAt`) incrémentées à chaque rendu auto.
4. CLI : `buddy widgets stats` (liste les widgets authored avec dataTypes + usage) — étends la
   commande widgets existante.

## Tests exigés (`tests/widgets/auto-widget.test.ts` + `widget-matcher.test.ts`)
- `detectWidgetable` : payload connu, tableau markdown (3×2 min), texte pur ⇒ null, réponse courte ⇒ null.
- `matchAuthored` : match par dataType, absence de champ ⇒ jamais matché, plusieurs candidats ⇒
  le plus utilisé (usedCount).
- Pipeline : env off ⇒ passthrough strict (byte-identique) ; erreur de rendu simulée ⇒ passthrough +
  pas de throw ; max 1 widget par réponse ; stats incrémentées.
- AUTOGEN off par défaut : sans `CODEBUDDY_WIDGETS_AUTOGEN`, aucun appel au générateur (spy).
- Sécurité : le HTML rendu ne contient JAMAIS de `<script>` (assertion sur la sortie du moteur —
  réutilise les assertions des tests widgets existants).

## Critères de done
- `npm run typecheck` : 0 erreur. Tests ciblés verts (+ les tests widgets existants toujours verts :
  `npm test -- tests/widgets`).
- Sans les env vars, tout est byte-identique.
- `docs/cb2/generative-ui.md` écrit. Commits `feat(widgets): …`.

## Interdits
- AUCUN JavaScript côté widget (CSP) — server-rendered only, comme l'existant.
- Ne contourne JAMAIS le gate des templates authored. Pas de génération LLM par défaut.
- Ne touche pas à Cowork en P0 (le rendu inline existant suffit).
