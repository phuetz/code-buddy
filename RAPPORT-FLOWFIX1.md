# RAPPORT FLOWFIX1 — Pilote Flow / Veo

Date : 2026-09-03 (Europe/Paris)
Agent : Grok 4.6
Clone : `~/DEV/cb-flowfix1-2026-09-03`
Branche : `fix/flowfix1-pilote-flow-2026-09-03`
Original `~/code-buddy` : interdit en écriture. Aucun push.

## Statut

**FAIT.** Le pilote soumet à nouveau. Deux clips Veo 3.1 Quality téléchargés depuis les prompts du JSON de test, contenu vérifié sur image extraite.

## Cause

Le bouton d’envoi Agent (`arrow_forward` + « Créer », w=32) n’utilise plus l’attribut HTML `disabled`. React pose `aria-disabled="true"` tant que le **modèle Slate** est vide. `.disabled` reste `false`.

`fill_prompt()` faisait `selectNodeContents` + `Input.insertText` : `innerText` égalait le prompt (le DOM était peint) alors que Slate restait sur le placeholder + U+FEFF. Le pilote voyait un bouton « actif », cliquait (DOM synthétique, clic TRUSTED, Entrée) : l’`onClick` React partait, l’application no-opait. Champ non vidé, solde inchangé.

Mesure : `document.elementFromPoint` atteignait bien le bouton ; `document.hasFocus()` était true ; aucun calque ni modal hors écran ; reCAPTCHA enterprise présent mais hors cause une fois Slate committé.

## Correctifs

- `fill_prompt` : `Page.bringToFront` + clic TRUSTED, vidage triple-clic, saisie `Input.dispatchKeyEvent` `type=char` + `text` (pipeline `beforeinput`). Repli `insertText` seulement si `aria-disabled===false` et nœud `[data-slate-string]`.
- `submit` / `send_agent` : attendre `aria-disabled !== 'true'` (plus `.disabled`), clic TRUSTED `mouseMoved` + `buttons:1`.
- `unlock_ui` : la boîte ULTRA laisse parfois `body.style.pointerEvents='none'` et un dialog fantôme — les clics n’atteignent plus Slate.
- `ensure_project` : l’onglet a dérivé vers `flow-projet-B-…` ; on le ramène sur `flow-projet-A-…`.
- Attente : ne plus prendre un `<video>` « nouveau » sur un projet déjà peuplé (un clip Lyon préexistant a été téléchargé en 8 s — rejeté). Clic `Réessayer` si Flow répond « Un problème est survenu ».
- `failure_count` : le libellé « Échec » est désormais **visible** sur une carte en cours (à côté du %). L’ancienne formule abortait à 8 s / 53 %.

## Preuve

| | Prise 1 `heritiers-01-veo` | Prise 2 `heritiers-14-veo` |
|---|---|---|
| Prompt | plateau calcaire, chênes tordus, brume | seuil moussu, ombre, bleu crépuscule |
| Fichier | `_qa/flowfix1/heritiers-01-veo.mp4` | `_qa/flowfix1/heritiers-14-veo.mp4` |
| Taille | 1 552 824 o | 2 506 241 o |
| ffprobe | h264 1280×720 24 fps, 8,000 s, 192 frames, aac | h264 1280×720 24 fps, 8,000 s, 192 frames, aac |
| Image | `_qa/flowfix1/heritiers-01-veo.jpg` | `_qa/flowfix1/heritiers-14-veo.jpg` |
| Contenu | chênes nuds, plateau, brouillard — conforme | seuil de mousse, vide central, bleu — conforme |

Solde ULTRA : **N** (18 h 50 et 20 h 35) → **N** après la 1re prise (**100 crédits** / Veo 3.1 Quality) → **N** après la 2e. L’offre Ultra « ~50 % » n’apparaît pas sur cette prise : le coût mesuré reste **100**, comme en juillet.

L’UI carte affiche « Résolution: 720p » pour Quality (pas 1080p). Fichiers 1280×720. Réglages inchangés (Veo 3.1 Quality, 16:9, x1, confirmer = Jamais).

Un mp4 `_qa/flowfix1/REJECTED-lyon-quais-pas-heritiers-14.mp4` est un faux positif (quais de Lyon du projet `flow-projet-B`) : même durée, mauvais sujet. Non utilisé.

## Vérifications

```
python3 -m pytest -q tests/scripts/influencer/test_flow_crame_send.py
# 5 passed
ffprobe …/heritiers-01-veo.mp4  → duration=8.000000 width=1280 height=720
ffprobe …/heritiers-14-veo.mp4  → duration=8.000000 width=1280 height=720
```

## Journal (abrégé)

1. Rapport créé avant inspection. CDP 9222 : 1 onglet Flow `flow-projet-A`, iframe reCAPTCHA, New Tab. Pas d’onglet Antigravity sur ce Brave.
2. Bouton `aria-disabled=true` / `.disabled=false`. Placeholder Slate + U+FEFF. `elementFromPoint` = le bouton.
3. `dispatchKeyEvent` char « ab » : placeholder parti, `[data-slate-string]=aabb` (doublon keyDown+char), `aria-disabled=false`.
4. Clic TRUSTED avec champ committé soumet. Un « k » de test a été annulé (0 crédit).
5. 1re prise : soumise, faux « Échec » à 8 s, génération à 53 % poursuivie, clip téléchargé, contenu OK, −100 crédits.
6. 2e prise : `pointer-events:none` après ULTRA ; puis dérive vers l’autre projet → Lyon rejeté. Prompt moussu bien parti, Flow « Un problème est survenu », `Réessayer` → clip moussu OK.

## Garde-fous tenus

Budget < 1 000 (284 lus sur ULTRA, dont 200 sur les deux prises Quality). Pas de recharge. Pas de changement de compte. Pas de push. ComfyUI / robot / ports intacts. Original `~/code-buddy` non écrit.
