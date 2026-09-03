# RAPPORT-GK32 — `buddy onboard`, `buddy doctor --fix`, `buddy login`/`whoami` et `buddy update` par un inconnu, sans réseau payant

Date : 2026-09-03 (Europe/Paris)
Agent : Grok 4.6
Clone : `/home/patrice/DEV/cb-repar-heure-2026-09-02`
Branche : `fix/gk32-onboard-doctor-2026-09-03`
HEAD au départ : `345bb4f87` (`Merge GK27 (conseil de modèles et routage en vrai) into codex/audit-systeme-nerveux-2026-09-01`)
Original `~/code-buddy` : interdit (jamais ouvert, jamais écrit)
Rapport créé **avant toute inspection** des commandes `onboard`/`doctor`/`login`/`whoami`/`update`.
Buddy invoqué depuis le clone uniquement. HOME temporaire : `_qa/gk32/home`. Aucune écriture dans le vrai `~/.codebuddy`.
Ollama local uniquement. Aucun service systemd. ComfyUI 8188/8189 non touché.
`buddy login` : jamais la vraie session ChatGPT. `buddy update` : `--dry-run` ou registre npm factice local.

## Mission

Éprouver **pour de vrai** le parcours d’un inconnu à profil vierge :

1. `buddy onboard` (assistant : choix fournisseur local, modèle, dossier)
2. `buddy doctor` (diagnostic réel : Ollama, ffmpeg, Piper, node, permissions)
3. `buddy doctor --fix` (corrige ce qu’il annonce, rien d’autre — sha256 avant/après)
4. `buddy whoami` sans session (message honnête)
5. `buddy login` sans navigateur (échec propre, pas de blocage)
6. `buddy update --dry-run` (version, canal, source, sans écrire)
7. `buddy --help` cohérent avec la doc

Chaque défaut : test rouge → correctif → vert, un commit.

## Garde-fous

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Aucune API payante. Aucun service systemd. ComfyUI 8188/8189 non touché.
- HOME temporaire dans le clone seulement.
- E18 (`~/DEV/cb-exec-inconnu-cli-2026-09-02/REPARATION-E18.md`) déjà 7 points (D5–D11) : ne pas les rejouer comme s’ils étaient ouverts.

## Journal

### 2026-09-03 — création du rapport (avant inspection)

HEAD `345bb4f87`. Arbre propre. Réservation du chantier Fable 5.

### Inspection

*(à remplir après réservation)*

### Parcours réel (avant correctifs)

*(à remplir)*

### Défauts, rouge → vert

| Id | Défaut | Rouge | Commit |
|---|---|---|---|
| | | | |

### Tableau final

| Commande | Attendu | Obtenu | Correctif | Commit |
|---|---|---|---|---|
| | | | | |

## Bilan

*(dix lignes max, à la clôture)*
