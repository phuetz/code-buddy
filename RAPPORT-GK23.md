# RAPPORT GK23 — Les rappels de Lisa (`buddy remind`, runner, voix, Telegram) en vrai

Date : 2026-09-03
Agent : Grok 4.6
Clone : `/home/patrice/DEV/cb-repar-jumeaux-3-2026-09-02`
Branche : `fix/gk23-rappels-reel-2026-09-03`
HEAD au démarrage : `4659bf343` (`Merge GK16 (buddy backup en vrai, cas méchants) into codex/audit-systeme-nerveux-2026-09-01`)
Original `~/code-buddy` : interdit (jamais ouvert, jamais écrit)
Rapport créé **avant toute inspection** du code des rappels, du runner, des outils, des tests et de la documentation.

## Mission

Éprouver le parcours réel des rappels de Lisa : `buddy remind add` (one-shot daté et récurrent) → `list`/`agenda` → déclenchement à l'heure (annonce vocale synthétisée + Telegram factice reçu) → ack vocal « c'est fait » lié au BON rappel (deux rappels en attente) → snooze « dans 10 min » → re-nag ×2 puis escalade `missed` → redémarrage du runner (rien n'est rejoué ni perdu : `snoozes.json`, `pending-acks.json`) → le one-shot daté se retire après tir, le récurrent revient le lendemain → `buddy remind rm`.

Loi : « se servir de ses applis EN VRAI ». Horloge factice/accélérée. Piper pour la voix, sortie WAV, jamais de lecture sur les enceintes (`aplay` remplacé par un faux lecteur). HOME temporaire dans le clone. `~/.codebuddy/reminders.json` RÉEL jamais touché.

## Garde-fous

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Aucune API payante.
- Aucun service systemd, aucun service déjà en cours (ComfyUI 8188/8189) touché.
- Aucune écriture hors du clone. HOME temporaire : `_qa/gk23/home` dans le clone.
- Faux Telegram local (`_qa/gk10/fake-telegram.mjs` s'il est présent et suffisant, sinon un minimal `_qa/gk23/`).
- Piper : synthèse WAV uniquement. Jamais `aplay` réel.
- Un commit conventionnel par lot, fichiers nommés un par un.
- Chaque écart : test rouge → correctif minimal → vert, un commit.
- typecheck + lint ciblé + tests ciblés verts.

## Journal

| Heure (Europe/Paris) | Action |
|---|---|
| 2026-09-03 (démarrage) | Rapport créé **avant inspection**. Coordination réservée. HOME temporaire prévu : `_qa/gk23/home`. |

## Plan d'exécution (annoncé avant lecture)

1. Réserver le chantier dans `docs/FABLE5-CODEX-COORDINATION.md`.
2. Préparer `_qa/gk23/` (HOME temporaire, journal, artefacts, faux lecteur audio).
3. Lire uniquement les sources autorisées : CLAUDE.md (§ `CODEBUDDY_REMINDERS`, ack, snooze, re-nag, `remind` tool), `src/companion/reminders.ts`, `reminder-runner.ts`, `src/tools/registry/remind-tools.ts`, tests existants.
4. Identifier les chemins de store (`reminders.json`, `snoozes.json`, `pending-acks.json`, log) et les pointer sur le HOME temporaire.
5. Identifier comment forcer l'horloge / accélérer le tick (`CODEBUDDY_REMINDER_TICK_MS`, injection d'horloge si elle existe).
6. Brancher un faux Telegram local et un faux lecteur (`aplay` jamais réel).
7. Parcours réel avec horloge factice/accélérée :
   - `buddy remind add` one-shot daté
   - `buddy remind add` récurrent
   - `list` / `agenda`
   - déclenchement à l'heure → WAV Piper + Telegram factice
   - deux rappels en attente → ack vocal « c'est fait » lié au BON rappel
   - snooze « dans 10 min »
   - re-nag ×2 puis escalade `missed`
   - redémarrage du runner : rien rejoué ni perdu
   - one-shot retiré après tir, récurrent revient le lendemain
   - `buddy remind rm`
8. Pour chaque écart (rappel tiré deux fois, ack lié au mauvais rappel, snooze perdu au redémarrage, annonce sans Telegram, message technique) : test rouge → correctif → vert → commit.
9. Tableau final « scénario → attendu → obtenu → correctif → commit ».

## Fichiers lus (complété au fil de l'eau)

*(vide — inspection pas encore commencée)*

## Écarts

*(aucun — inspection pas encore commencée)*

## Tableau final « scénario → attendu → obtenu → correctif → commit »

*(à remplir)*

## Bilan (≤ 10 lignes)

*(à remplir en fin de mission)*
