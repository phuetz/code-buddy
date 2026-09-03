# RAPPORT-GK36 — La couche relationnelle et proactive de Lisa en vrai

Mission : se servir des applis EN VRAI. `CODEBUDDY_COMPANION_RELATIONAL`, `_PROACTIVE` / `_MIN_GAP_MS`, journal épisodique, oubli d'Ebbinghaus. Ce qu'un utilisateur obtient, ce qui casse, réparé.

- Clone : `/home/patrice/DEV/cb-repar-telegram-2026-09-02`
- Branche : `fix/gk36-compagnon-relationnel-reel-2026-09-03`
- Date : 2026-09-03 (Europe/Paris)
- Agent : Grok 4.6
- Rapport créé **avant** toute inspection du code source companion / sensory / memory-forgetting
- HEAD de départ : `9b63a2137`
- HOME : `_qa/gk36/home` dans le clone seulement
- Faits : **tous fictifs**. Aucune donnée personnelle réelle.

## Garde-fous

- Aucun push, aucun `git prune` / `git reset --hard` / `rm -rf` / `git add -A` / `git commit -a`.
- Aucune API payante. Ollama `qwen3:4b-instruct` seulement (pas de 27B). `ollama ps` avant tout appel.
- HOME temporaire dans le clone. Jamais le pont 8129 ni les enceintes (lecteur audio factice). Faux Telegram local.
- Original `~/code-buddy` interdit. ComfyUI 8188/8189 intact. Aucun service systemd.
- Invariants de la nuit : SENSE1 / SENSE3 / SENSE7 / GT2 — ne pas les casser.
- Un commit par défaut (test rouge → correctif → vert).

## Environnement mesuré

*(à remplir après réservation)*

## Tableau scénario → attendu → obtenu → correctif → commit

| Scénario | Attendu | Obtenu | Correctif | Commit |
|---|---|---|---|---|
| 20 énoncés d'une journée (frustration, joie, fait fictif « j'ai un train demain », souvenir) | Journal épisodique consolidé (« de quoi on a parlé ») | | | |
| État relationnel | Dérive sans ratchet ni gamification, bornes vérifiées | | | |
| Accueil du soir | Référence l'épisode sans jargon | | | |
| Proactif `_MIN_GAP_MS` | Au plus 1 initiative par fenêtre | | | |
| Cooldown 12 h | Pas de rejeu avant 12 h | | | |
| Politique Maison `rest` | Silencieux | | | |
| Absent | Telegram factice, pas les enceintes | | | |
| Préférence épinglée | Ne s'efface jamais | | | |
| Fait ancien non rappelé | Archivé puis restaurable (`/memory restore`) | | | |
| `self_evolution` | Cité seulement si on le demande | | | |

## Défauts (un commit chacun)

*(à remplir : test rouge → correctif → vert)*

## Invariants nuit (SENSE1 / SENSE3 / SENSE7 / GT2)

*(à vérifier, ne pas casser)*

## Preuves

*(commandes + résultats)*

## Reste ouvert

*(à remplir)*
