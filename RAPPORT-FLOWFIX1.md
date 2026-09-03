# RAPPORT FLOWFIX1 — Pilote Flow / Veo

Date : 2026-09-03 (Europe/Paris)
Agent : Grok 4.6
Clone : `/home/patrice/DEV/cb-flowfix1-2026-09-03`
Branche visée : `fix/flowfix1-pilote-flow-2026-09-03`
Original `~/code-buddy` : interdit en écriture. Aucun push.

## Statut

**RÉSERVÉ.** Ce fichier est créé **avant toute inspection** du pilote, du DOM Flow, du CDP ou des scripts.

## Enjeu (donné, non redécouvert)

Le compte Google AI Ultra (palier 20x) porte 25 000 crédits Flow vidéo par mois, non reportables.
Solde lu par le pilotage le 03/09 à 18 h 50 = **N**, perdus le **28** s'ils ne sont pas consommés.
Veo 3.1 Quality est le seul moteur 1080p « pièce maîtresse ». Le pilote ne sait plus soumettre :
tout l'usage vidéo Flow est à l'arrêt.

## Constats déjà établis par le pilotage (03/09, 18 h 40–19 h 20)

1. `flow-crame.py` échoue avec « champ non vidé après envoi ». `credits()`, navigation, `close_profile()`, `card_count()` et le réglage de l'agent fonctionnent encore.
2. Réglage agent enregistré : **Veo 3.1 - Quality**, 16:9, x1, « Confirmer avant de générer » = **Jamais**. Options menu : `Omni 1.1 Flash`, `Veo 3.1 - Lite`, `Veo 3.1 - Fast`, `Veo 3.1 - Quality`, `Veo 3.1 - Lite [Lower Priority]`.
3. Éditeur de prompt = Slate (`[data-slate-editor=true]`, y≈1107, hauteur 100). `fill_prompt()` écrit correctement. Un `textarea` invisible (largeur nulle) n'est pas la cible.
4. Bouton d'envoi : `<button>` contenant `arrow_forward` + `Créer`, largeur 32, non désactivé, à (1995, 1240) dans un viewport 3438×1297.
5. Trois soumissions tentées, aucune ne déclenche (solde N, `card_count()=0`, `progress_count()=0`, `failure_count()=0`, aucune erreur affichée) :
   - `MouseEvent` synthétiques ;
   - clic TRUSTED `Input.dispatchMouseEvent` (recette Suno/Seedance/Grok) ;
   - `Input.dispatchKeyEvent` Entrée / Ctrl+Entrée avec focus Slate.

## Pistes à explorer (ordre imposé)

1. État interne React/Slate vraiment renseigné ? (`Input.insertText` vs `Input.dispatchKeyEvent` caractère par caractère.)
2. Clic : `document.elementFromPoint(1995,1240)` — calque invisible ?
3. Focus SYSTÈME (xrdp) : `document.hasFocus()` avant/après `Page.bringToFront`.
4. Confirmation résiduelle, quota, bannière, dialogue modal hors écran.
5. Réseau : une requête part-elle au clic ?

## Preuve exigée

Un clip Veo réellement généré et téléchargé depuis un prompt du pilote :
- solde AVANT / APRÈS (doit baisser) + coût exact d'une prise Veo 3.1 Quality ;
- fichier `.mp4` sur disque + taille + durée `ffprobe` ;
- image extraite du clip prouvant que le CONTENU correspond au prompt.

Prompt de test : `~/DEV/trailers-2026-09-03/pipeline/scripts-v2/hero-veo-heritiers.json` (2 prises).

## Garde-fous

- Budget : **ne pas dépasser 1 000 crédits** (10 prises Quality).
- Arrêt après **6 tentatives** sans déclenchement, avec mesures.
- N'acheter aucune recharge. Ne modifier aucun réglage de compte.
- Navigateur : Brave CDP **9222**, un seul onglet Flow (`FLOW_PROJECT_ID_REDACTED`). Ne pas fermer les onglets Antigravity. Ne pas toucher robot, ComfyUI, ports robot.
- Rester dans le clone. Pas de `git push` / `prune` / `reset --hard` / `rm -rf` / `git add -A` / `git commit -a`.

## Journal d'observation

*(vide — inspection non commencée)*

## Bilan

Pas encore. Inspection à venir.
