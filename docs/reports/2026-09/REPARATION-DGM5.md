# Mission DGM5 — Donner à la Darwin-Gödel Machine de la matière réelle : la journée du 04/09 comme première expérience

- **Date** : 2026-09-04
- **Branche** : `feat/dgm5-experience-reelle-2026-09-04`
- **Clone** : `~/DEV/cb-dgm5-2026-09-04`
- **Original** : `~/code-buddy` (interdit en écriture)
- **Pilote / Auteur** : Antigravity (Assistant) & Patrice

---

## 1. Objectifs de la mission

1. **Source d'expérience « journaux de lanes »** (`src/agent/self-improvement/experience-source.ts`, `digest-sources.ts`) :
   - Source opt-in lisant les journaux de délégation (`~/.codebuddy/delegations` par défaut, injectable).
   - Extraction de faits structurés : moteur, durée, sortie, modifications constatées, échecs nommés (*Maximum tool execution rounds*, *Unexpected end of JSON input*, *trim is not a function*, *peer closed connection*, *Turn limit*).
   - Extraction des leçons opérationnelles du pilote (HOME isolé pour Vitest, commiter après chaque point, lire journal du boot précédent avant relance, ne pas éditer script bash en cours, preuve = tests des fichiers touchés).
   - Intégration au digest (`provenance: 'delegation-log'`).
   - Tests avec fixture anonymisée de 3 journaux, sans fuite de données personnelles (`tests/security/donnees-personnelles.test.ts` vert).

2. **Trois outils à faire écrire par la machine** (`buddy improve tools --apply`, portes G1→G4) :
   - `sitemap-check` : parsing sitemap.xml / HTML d'accueil, simulation de statuts injectables sans réseau.
   - `ffmpeg-argv-audit` : audit d'arguments ffmpeg (`-stream_loop -1` sans `-t`, double sortie, `-f` après sortie).
   - `orphan-temporaries` : listing d'un dossier, détection de `<cible>.tmp.*` orphelins de plus de N minutes.
   - Rapport par outil : acceptation / rejet, porte, métriques temps / coût.

3. **Deux skills à faire écrire par la machine** (`buddy improve skills --apply`) :
   - « relecture typographique française de premier passage » (guillemets « », insécables avant `; : ? !`, apostrophes typographiques, virgules, blocs ``` préservés).
   - « mission-contrat de lane » (clone dédié, rapport avant inspection, HOME isolé, commit par point, preuve = tests touchés, bilan dix lignes).
   - Pare-feu et couverture, installation en `authored-*` sous `.codebuddy/skills/` du clone.

---

## 2. Journal d'exécution

*(Rapport créé avant toute inspection)*
