# SELFIE-CACHE-GROK — « envoie-moi une photo de toi » sert le cache d'abord

Date : 2026-09-06 (Europe/Paris)
Agent : Grok 4.6
Clone : `~/DEV/cb-selfie-2026-09-06`
Branche : `feat/selfie-cache-2026-09-06`
HEAD au départ : `8c878d393` (`fix(gemini): Gemini 3.x tool round-trip`)
Original `~/code-buddy` : interdit (jamais ouvert, jamais écrit)
Rapport créé **avant toute inspection** du code.
HOME temporaire : `_qa/selfie/home`. Aucune écriture dans le vrai `~/.codebuddy`.
Vitest : `HOME=…/_qa/selfie/home` et `env -u FORCE_COLOR`.

## Mission

Dans cet ordre, chacun avec tests rouge→vert :

1. **Cache d'abord** — profil compagnon (Telegram/mobile ET voix) : une demande de photo/selfie/portrait de Lisa (motifs FR/EN, avec ou sans style) → réponse IMMÉDIATE avec un selfie du cache du palier autorisé (`CONTENT_TIER` + gate). Rotation anti-répétition (jamais la même image deux fois de suite). Légende dans la persona. La génération n'enrichit que le cache. Router explicite AVANT le LLM (pas seulement une description d'outil).
2. **Mise en cache de tout selfie généré** — quand `image_generate` / l'outil selfie produit une image de Lisa, copie dans `CODEBUDDY_LISA_SELFIE_CACHE_DIR/<tier>/<style>/` (nom horodaté + hash, sidecar JSON). Plafond `CODEBUDDY_LISA_SELFIE_CACHE_MAX` (défaut 200), éviction des plus anciennes non favorites. Jamais dans le dépôt.
3. **Remplissage en arrière-plan** — opt-in `CODEBUDDY_LISA_SELFIE_REFILL=true`. Traitement de battement (comme `system-vitals`) : ComfyUI joignable ET load < N → une image par cycle jusqu'à un minimum par palier/style. Never-throws. S'arrête si le générateur est injoignable. Tests : générateur factice seulement.

## Invariants

- Code public. Jamais `/home/<user>`, prénom, secret, ni image réelle dans les fichiers suivis (fixtures = PNG 1×1 générés dans le test).
- `git add` nommément fichier par fichier. Commit par point.
- Aucun push. ComfyUI 8188/8189 non touché.
- Byte-identique sans persona compagnon.

## Garde-fous

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Vitest : `HOME=~/DEV/cb-selfie-2026-09-06/_qa/selfie/home` et `env -u FORCE_COLOR`.
- Jamais `~/code-buddy` ni `~/.codebuddy`.
- Ne pas lancer de génération réelle pendant les tests.

## Journal

### 2026-09-06 — création du rapport (avant inspection)

HEAD `8c878d393`. Branche déjà extraite (persona copine, profil compagnon, Gemini 3.x). Working tree propre.
