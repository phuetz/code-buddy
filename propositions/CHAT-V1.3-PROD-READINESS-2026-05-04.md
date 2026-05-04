# gitnexus-chat — Audit production-readiness

> 3ème audit de la nuit 03→04 mai 2026. Les 2 audits précédents
> ([V1 features](CHAT-V1-ROADMAP-2026-05-04.md) +
> [V1.2 bugs cachés/sécu/perf](CHAT-V1.2-AUDIT-2026-05-04.md))
> ont épuisé le stock de bugs trouvables sans usage réel.
>
> Cet audit pivote vers le saut **dev local → déployable client**.

## TL;DR

- **Mini-fix livré ce soir** (commit `d037fd9` dans gitnexus-chat) :
  premier pas a11y — aria-label sur les 5 boutons icon-only +
  `role="log" aria-live="polite"` sur ChatMessages.
- **4 chantiers identifiés** pour passer en mode produit, à choisir
  par Patrice selon priorité commerciale.

## Les 4 angles non couverts par les 2 audits précédents

### 🟣 A — Tests (0 test actuel)

Setup Vitest + `@testing-library/react` + 5-10 tests sur les zones
fragiles : SSE parser (déjà cassé une fois en V1), store actions,
`parseIndexedAt` (V1.2), composants ChatInput/ChatMessages.

**Effort** : 1 jour pour ~60% coverage utile.
**Bénéfice** : refactor sans peur.

### 🟤 B — Déploiement (rien n'est packageable)

| Item | Pourquoi |
|---|---|
| `Dockerfile` multi-stage (Vite build → nginx static) | Pas besoin que le client installe Node |
| `docker-compose.yml` : `gitnexus serve` + chat ensemble | Onboarding `docker compose up` |
| `nginx.conf` proxy `/api`, `/health`, `/mcp` → backend | Réplique le proxy Vite |
| `.dockerignore` (node_modules, dist, .git) | Images plus petites |
| Doc env vars (`MCP_URL`, `GITNEXUS_HTTP_TOKEN`, `GITNEXUS_HTTP_ORIGINS`) | Config par client sans rebuild |

**Effort** : 0.5-1 jour.
**Bénéfice** : tient la promesse "déployable chez clients agile-up".

### 🟠 C — Accessibilité (a11y)

| Item | Statut |
|---|---|
| `aria-label` sur tous les boutons icon-only | ✅ **fait ce soir** (commit `d037fd9`) |
| `role="log" aria-live="polite"` sur ChatMessages | ✅ **fait ce soir** |
| `aria-busy` sur textarea pendant streaming | ✅ **fait ce soir** |
| Focus management (re-focus textarea après Send) | À faire |
| Navigation clavier ProjectSelector (↑↓ Enter Esc) | À faire — actuellement souris uniquement |
| Audit contraste WCAG AA (`text-neutral-600` sur `bg-neutral-950`) | À faire — probable fail sur les hints |
| Skip links / landmarks (`<main>`, `<aside>`) | Présents (ChatPanel utilise `<main>`, ChatSidebar `<aside>`) ✅ |
| Audit Lighthouse a11y score | À lancer |

**Effort restant** : 0.5 jour.
**Bénéfice** : conformité RGAA pour clients secteur public (CCAS, etc.).

### 🟢 D — DX & qualité de code

| Item | Pourquoi |
|---|---|
| `prettier` + config | Cohérence formatage cross-IDE |
| `husky` + `lint-staged` pre-commit | Empêche commits cassés |
| `.github/workflows/ci.yml` (lint + typecheck + build) | Régressions détectées sur PR |
| `vitest --coverage` config + badge README | Visibilité qualité (dépend de A) |
| `bundle visualizer` (`rollup-plugin-visualizer`) | Identifier ce qui pèse dans 114 KB gzip |

**Effort** : 0.5 jour.
**Bénéfice** : sustainability long-terme.

## Recommandation séquencement

| Si tu veux… | Attaque… | Effort |
|---|---|---|
| Démo client agile-up cette semaine | **B (Déploiement)** | 0.5-1 j |
| Refactorer librement sans peur | **A (Tests)** | 1 j |
| Servir secteurs régulés (CCAS, public) | **C (a11y restant)** | 0.5 j |
| Dormir tranquille à long terme | **D (DX)** | 0.5 j |

**Mon vote** : faire **A puis B** (tests d'abord, puis Docker) → tu peux
itérer sur le produit avec confiance puis le packager.

## Total estimé pour "chat vraiment prêt démo client"

A + B + reste de C + D = **~3 jours** focus.

À ce stade le chat coche : 0 bug connu, déployable Docker, conforme
RGAA, testé, CI verte, formatage automatique. C'est la baseline
attendue pour un produit commercial agile-up.com.

---

*Rédigé par Claude Opus 4.7 (1M context), nuit 03→04 mai 2026, MINISTAR.*
*Audit production-readiness, 3ème pivot après V1.0 (UX/features) et V1.2 (bugs cachés).*
