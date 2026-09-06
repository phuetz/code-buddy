# VERIF2-PHOTOS-SECU-GROK — seconde relecture adversariale (sécurité)

- **Date :** 2026-09-07
- **Auditeur :** Grok 4.6
- **Mission :** GROK-VERIF2-PHOTOS
- **Worktree :** `~/DEV/cb-photos-secu-2026-09-07`
- **Branche :** `verif/photos-secu-2026-09-07`
- **HEAD de départ :** `46dd650b8`
- **HOME QA :** `~/DEV/cb-photos-secu-2026-09-07/_qa/ps/home` (gitignoré)
- **Ports :** ≥ 5500
- **Rapports de référence :** `docs/reports/2026-09/PHOTOS-PARTAGEES-OPUS.md`, `docs/reports/2026-09/VERIF-PHOTOS-AGY.md` (8/8 TIENT)
- **Périmètre :** `src/companion/companion-photo.ts`, `src/companion/shared-photos.ts`, `src/server/mobile/album.ts`, `src/server/websocket/handler.ts` (pièces jointes WS), `src/channels/telegram/client.ts` (`getFile`)
- **Hors périmètre :** `scanSkillFirewall`
- **Contrainte :** chemins `~`, jamais de prénom ; original `~/code-buddy` et `~/.codebuddy` interdits après création du worktree

Stub créé **avant inspection**. Les cas adverses, preuves et verdict seront remplis après exécution contre l'API réelle.

## 0. Méthode

Valeur = ce que la première vérification n'a pas essayé (magic bytes, 4×600 Ko, sha256, JWT, vision locale). Ici : décodage (polyglotte, bombe PNG, SVG déguisé, formats animés, EXIF GPS), quotas/DoS, Telegram (`getFile`, taille, `media_group_id`, allowlist), routes album (CSRF, énumération, favori étranger, cache).

## 1. Tableau cas → attendu → obtenu → TIENT/TROU

| # | Cas | Attendu | Obtenu | Verdict |
| - | --- | ------- | ------ | ------- |
| | *(à remplir)* | | | |

## 2. Preuves d'exécution

*(à remplir)*

## 3. Suites

*(à remplir)*

## 4. Bilan

*(à remplir, 10 lignes max)*

VERDICT: *(à remplir)*
