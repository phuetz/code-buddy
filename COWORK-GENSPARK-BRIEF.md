# Cowork × Genspark — Implementation Brief (for gpt-5.5)

You are implementing a batch of **additive** Cowork UI components that modernize
it toward Genspark's "super-agent" UX. Work **slice by slice**; each slice =
new file(s) only, typecheck-clean, one commit. When you finish, we do a review.

## Absolute constraints (do NOT violate)
1. **ADDITIVE ONLY.** Create NEW files. Never edit / rename / delete an existing
   file. Other agents are editing `cowork/` live — touching a shared file WILL
   corrupt their work.
2. Only create files under `cowork/src/renderer/components/`. Never touch `src/`
   (that's the CLI engine — off-limits) or anything outside that folder.
3. **Presentational / pure only:** props in, callbacks out. NO Zustand store, NO
   `window.electronAPI` / IPC, NO network, NO telephony. Wiring into the running
   app is a separate human step (kept out to avoid god-file conflicts).
4. Do **NOT** `git push`, merge, or open PRs.
5. One slice = one commit (Conventional Commits). After each commit, note its
   SHA (`git rev-parse HEAD`).

## Setup (isolated worktree, off `main`)
```sh
cd /home/patrice/code-buddy
git worktree add /home/patrice/genspark-wt -b feat/cowork-genspark main
cd /home/patrice/genspark-wt
# node_modules for typechecking — symlink the main checkout's; NEVER commit these:
ln -s /home/patrice/code-buddy/cowork/node_modules cowork/node_modules
ln -s /home/patrice/code-buddy/node_modules node_modules
```

## Conventions — copy the patterns in `cowork/src/renderer/components/GoalBanner.tsx`
- `.tsx`: `import React from 'react';` · `import { useTranslation } from 'react-i18next';` · named icons from `'lucide-react'`.
- Relative imports have **NO `.js` extension** (this is Vite, not the CLI).
- Styling is **Tailwind with semantic tokens ONLY**: `border-border`, `bg-surface`,
  `text-text`, `text-text-muted`, `text-accent`, `text-success`, `text-warning`,
  `bg-accent`, `bg-border`, `bg-warning`, plus opacity variants (`bg-accent/15`).
  Active ≈ `bg-accent/15 text-accent`; hover ≈ `hover:bg-border`. No hardcoded hex.
- i18n: `t('some.key', 'English default')` with defaults. Do **not** add locale files.
- Top-of-file JSDoc block ending `@module renderer/components/<Name>`.
- Single quotes, semicolons, 2-space indent. Every interactive element:
  `type="button"`, a `data-testid`, and aria attributes.
- Each component: a **named export** AND `export default`.

## Typecheck recipe — run after EVERY slice, fix until exit 0
```sh
printf '%s\n' '{ "extends": "./tsconfig.json", "compilerOptions": { "noEmit": true, "skipLibCheck": true }, "include": ["src/renderer/components/FILE1","src/renderer/components/FILE2"] }' > cowork/tsconfig.check.json
( cd cowork && npx tsc -p tsconfig.check.json ); echo "tsc exit: $?"
rm -f cowork/tsconfig.check.json
git add cowork/src/renderer/components/FILE1 cowork/src/renderer/components/FILE2
git -c commit.gpgsign=false commit -m "feat(cowork): <slice summary>"
```
Never `git add` the node_modules symlinks or `tsconfig.check.json`.
Commit trailer (2 lines) on every commit:
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Wten2ENavfScZnAfZRCSix
```

## ALREADY DONE — do NOT reimplement (skip if the file exists)
- `agent-recipes.ts` + `RecipeGallery.tsx`  (Genspark "recipes" gallery)
- `AutonomySelector.tsx`  (plan/auto/full posture)
- `credits.ts` + `CreditsMeter.tsx`  (usage-as-credits meter)

---

## SLICES TO BUILD (one commit each, in order)

### Slice 1 — `MissionTimeline.tsx` — the "plan of flight" (roadmap #2)
- Inline type `export interface MissionStep { id: string; label: string; status: 'pending' | 'running' | 'done' | 'error'; tool?: string; detail?: string }`.
- Props `{ steps: MissionStep[]; className?: string }`; export `MissionTimelineProps`.
- Ordered vertical timeline; per-step icon by status (lucide `Circle` / `Loader` / `CircleCheck` / `CircleX`), the running row emphasized (`text-text`), others muted; `tool` as a muted chip; `detail` truncated with `title`.
- Container `data-testid="mission-timeline"`, each row `data-testid={`mission-step-${step.id}`}`.

### Slice 2 — `VerifiedBadge.tsx` — cross-check "verified by N models" (roadmap #21)
- Type `export interface ModelVerdict { model: string; verdict: 'agree' | 'disagree' | 'abstain' }`.
- Props `{ verdicts: ModelVerdict[]; className?: string }`.
- A small badge: shield icon + `Verified by N models` (N = count of `agree`); tone `text-success` if agree is a majority and none disagree, else `text-warning`. Tooltip (`title`) lists `model — verdict`. `data-testid="verified-badge"`.

### Slice 3 — `ModelContributionStrip.tsx` — mixture-of-agents transparency (roadmap #30/#31)
- Type `export interface ModelContribution { model: string; role: string; costUsd?: number; tokens?: number }`.
- Props `{ contributions: ModelContribution[]; className?: string }`.
- Horizontal wrap of chips: `model · role` (+ optional `$cost` muted). `data-testid="model-contribution-strip"`.

### Slice 4 — `sparkpage.ts` + `SparkPageView.tsx` — living research page (roadmap #11)
- `sparkpage.ts` (pure): `export interface SparkCitation { n: number; title: string; url: string }`,
  `SparkSection { heading: string; body: string }`,
  `SparkPage { title: string; sections: SparkSection[]; citations: SparkCitation[] }`,
  and `export function citationCount(page: SparkPage): number`.
- `SparkPageView.tsx`: props `{ page: SparkPage; onAskFollowUp?: (q: string) => void; className?: string }`.
  Renders the title, each section (heading + body in a readable block), a numbered References list linking citations (`target="_blank" rel="noreferrer"`), and — only if `onAskFollowUp` is provided — a small input + "Ask" button that calls it with the typed question. `data-testid="sparkpage-view"`.

### Slice 5 — `deliverables.ts` + `DeliverableCard.tsx` — AI Drive item (roadmap #26)
- `deliverables.ts` (pure): `export type DeliverableKind = 'deck' | 'sheet' | 'doc' | 'page' | 'image' | 'report'`,
  `Deliverable { id: string; kind: DeliverableKind; title: string; createdAt: number; sizeLabel?: string }`,
  `export function kindEmoji(kind: DeliverableKind): string`,
  `export function formatWhen(ts: number, now?: number): string` (relative, e.g. `2h ago`).
- `DeliverableCard.tsx`: props `{ item: Deliverable; onOpen?: (d: Deliverable) => void; onShare?: (d: Deliverable) => void; onDownload?: (d: Deliverable) => void; className?: string }`.
  Card: kind emoji + title + relative time + `sizeLabel`; render an action button ONLY when its callback is provided. `data-testid={`deliverable-card-${item.id}`}`.

### Slice 6 — `CallForMeForm.tsx` — phone-call agent scaffold (roadmap #17), PRESENTATIONAL ONLY
- Props `{ onSubmit: (req: { phone: string; goal: string }) => void; busy?: boolean; className?: string }`.
- A small form: phone `<input type="tel">`, goal `<textarea>`, "Place call" submit button (disabled while `busy` or when either field is empty). NO telephony — just validate + call `onSubmit`. JSDoc must state the calling backend is out of scope. `data-testid="call-for-me-form"`.

### Slice 7 — `use-recipe-launch.ts` — pure bridge hook (optional)
- `export function useRecipeLaunch(send: (text: string) => void): (recipe: { prompt: string }) => void` — a tiny `useCallback` wrapper, no store. Lets a parent bridge `RecipeGallery` → composer in one line. `@module renderer/components/use-recipe-launch`.

---

## Finish
After Slice 7: `git log --oneline main..HEAD` and produce a list of `slice → SHA`,
the per-slice typecheck result, and anything skipped/failed and why. Do NOT push.
