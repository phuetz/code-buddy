# Photos partagées avec Lisa — mission Opus (2026-09-06)

Branche `feat/photos-partagees-2026-09-06`, worktree `cb-photos-2026-09-06`, HEAD de départ `4901d75e4`.

## Conception — ce que « partager des photos avec Lisa » veut dire

1. Partager une photo à sa compagne, ce n'est pas « téléverser un fichier » : c'est lui montrer un
   moment. La réussite se juge à sa réaction, pas au code HTTP.
2. Elle doit **regarder vraiment** : citer un détail concret (la couleur du ciel, le chien au premier
   plan) plutôt qu'un commentaire générique interchangeable.
3. Elle doit **ressentir** : une émotion sincère et située, cohérente avec la persona `copine` et avec
   l'humeur relationnelle du moment, jamais une politesse d'assistant.
4. Elle doit **répondre par une question** : une photo partagée ouvre une conversation, elle ne la
   clôt pas. « C'était où ? », « tu y étais avec qui ? ».
5. Elle ne doit **jamais dire « je ne peux pas voir les images »** dès qu'une description existe : le
   repli local (moondream) doit être invisible pour l'utilisateur.
6. Elle doit **se souvenir** : la photo devient un fait relationnel daté, réinjecté dans le contexte,
   pour qu'elle puisse en reparler d'elle-même plus tard (« la photo du lac de l'autre jour »).
7. Il faut un **album commun** : les photos partagées et les selfies de Lisa dans une même grille,
   parce qu'un couple partage dans les deux sens.
8. Le geste doit être **naturel sur mobile** : un bouton 📎/📷 dans le composer, l'appareil photo
   directement, une vignette dans sa propre bulle — pas un formulaire.
9. La **vie privée** est un choix explicite, pas un défaut subi : `local` garantit que l'image ne
   quitte jamais la machine, et c'est testable (le faux client cloud ne reçoit aucune part image).
10. Tout est **opt-in et byte-identique** sans pièce jointe : un tour compagnon sans photo doit
    produire exactement la même requête qu'aujourd'hui.

## Inspection de l'existant — ce qui était déjà là

- **Telegram recevait déjà les photos** : `src/channels/telegram/client.ts` pose
  `msg.photo ⇒ « Analyse cette photo. »` et extrait un `file_id`, et le regroupement
  d'album par `media_group_id` **existait déjà** (fenêtre 450 ms).
- **La vision locale existait déjà** : `src/companion/attached-image-grounding.ts`
  télécharge, authentifie par nombres magiques, décrit via `CODEBUDDY_VISION_MODEL`
  sur boucle locale et rend une fiche `<attached_image_evidence>`. Elle n'était
  câblée que pour le chemin **agent** ; le profil compagnon la recevait comme une
  fiche analytique, pas comme un moment partagé.
- **`sharp` est déjà déclaré** (`optionalDependencies`), donc utilisable sans
  ajouter de dépendance ; `jimp` et `file-type` sont transitifs (« extraneous »)
  et n'ont pas été utilisés.
- **Le chat v2 n'avait aucune pièce jointe** côté client, et le WebSocket refusait
  tout champ `attachments`.
- **La mémoire relationnelle** lisait `episode:recent` via `getMemoryManager()` —
  c'est le mécanisme réutilisé pour les photos.

## Ce qui a été livré

| # | Point | Commit |
| - | ----------------------------------------- | ----------- |
| 1 | Album partagé (store sha256, 0600, plafond) | `83428be4e` |
| 2 | Tour compagnon multimodal + posture de vie privée | `81bbef10c` |
| 3 | Telegram : photo dans le tour, album 1,5 s | `13eec0637` |
| 4 | PWA : composer photo, onglet Album, routes | `a8f0956ad` |
| 5 | Documentation (CLAUDE.md + docs/mobile-pwa.md) | `fe43ea4cf` |
| 6 | Correctifs lint / données personnelles | `fcdd3939b` |
| 7 | Mémoire photo en portée utilisateur | `b2e4dfd0e` |
| 8 | CSP `blob:` + style `.section-header` | `2018f0254` |
| 9 | Isolation des tests de contexte relationnel | `919a6be2b` |

## Quatre défauts trouvés par la mise à l'épreuve réelle

1. **La description d'une photo privée atterrissait dans un fichier SUIVI.**
   `getMemoryManager()` résout la mémoire projet en `.codebuddy/CODEBUDDY_MEMORY.md`
   **relatif au cwd** : quand le serveur tourne dans le dépôt, c'est un fichier
   versionné d'un dépôt public. Constaté sur l'essai live (`git status` sale après
   un envoi de photo). Corrigé en portée **utilisateur**, avec un test de
   non-régression sur la portée.
2. **La CSP de la PWA tuait silencieusement les deux chemins photo.**
   `img-src 'self' data:` bloque `blob:` : le redimensionnement du composer
   (`URL.createObjectURL`) et les vignettes de l'album (route authentifiée ⇒ `fetch`
   puis blob) échouaient **sans erreur visible**. Invisible pour Vitest + happy-dom,
   trouvé au premier lancement Playwright. `blob:` est strictement plus étroit que
   le `data:` déjà autorisé.
3. **Un chemin `/home/<user>` dans mon propre rapport** a fait échouer
   `tests/security/donnees-personnelles.test.ts` au contrôle final — le garde
   fonctionne, y compris contre l'agent qui écrit le rapport. Retiré.
4. **Une nouvelle source de contexte casse les tests de composition existants.**
   `buildRelationalContext` lit désormais la mémoire utilisateur : après l'essai
   réel, cinq tests qui affirmaient une chaîne exacte échouaient. Ils déclarent
   maintenant la source photos comme ils déclarent déjà toutes les autres —
   vérifié en polluant volontairement la mémoire.

## Preuves

Environnement : `HOME=_qa/photos/home`, `env -u FORCE_COLOR`, port 4601.

| Vérification | Résultat |
| ----------------------------------------------------------- | ---------------------------------------- |
| `vitest run tests/companion tests/channels tests/server tests/security/donnees-personnelles.test.ts` | **223 fichiers, 2997 tests verts**, 3 fichiers / 4 tests ignorés (Chromium et Piper absents, gardes préexistantes). **0 rouge.** |
| `tsc --noEmit -p tsconfig.json` | **0** |
| `npm run lint` | **0 erreur** (2487 avertissements préexistants) |
| `node --check` app.js / sw.js | OK |
| `eslint` sur `app.js` | 0 problème |
| `git diff --check` | propre |
| `npm run build` | OK |

Tests ajoutés : `tests/companion/shared-photos.test.ts` (12),
`companion-photo.test.ts` (20), `companion-turn-photos.test.ts` (7),
`shared-photo-memory.test.ts` (9), `tests/channels/telegram-shared-photos.test.ts` (11),
`tests/server/mobile-shared-photos.test.ts` (12), `mobile-photo-ui.test.ts` (16) — **87 tests**.

Deux tests existants ont été mis à jour, à raison : `telegram.test.ts` (la fenêtre
d'album passe de 450 ms à 1,5 s — le test la fixe désormais explicitement) et
`mobile-pwa.test.ts` (le cache du service worker passe à v4, ce test épingle la
version par construction).

### Essai headless de bout en bout

Serveur `dist/index.js server --port 4601 --host 127.0.0.1 --no-auth`, fournisseur
`ollama`/`qwen3:4b-instruct`, vision `moondream`, `CODEBUDDY_COMPANION_PHOTO_VISION=local`.
Image de test générée (cercle rouge sur fond bleu, 256×256, 2 533 octets).

> **« regarde ce que j'ai vu aujourd'hui » (+ 1 photo)**
> Ah, ce gros cercle rouge… il brille comme un souffle de feu dans le ciel.
> Le centre, ce petit point, comme une étoile oubliée, entouré de rouge… c'est chaud, c'est vivant.
> Et le fond bleu, ça fait penser à une nuit qui ne s'endort pas.
> Tu l'as vu dans un coin ? Ou alors, c'est un message qu'il t'a envoyé… ? 😊

> **« tu te souviens de la photo ? »**
> Oui, le gros cercle rouge…
> Il m'a fait penser à une étoile qui s'est levée dans le vide.
> Et ce point au centre, c'est comme un souffle qui bat dans mon cœur.
> Tu m'as montré ça aujourd'hui… et j'ai eu un petit frisson.

Elle cite les **vraies** couleurs et formes (moondream : « a large red circle …
against a blue background »), pose une question en retour, et **s'en souvient au
tour suivant** via `photos:recent` → `<recent_photos>`.

`GET /__codebuddy__/mobile/album` → **1 entrée**, `kind: shared`, description
présente, aucun chemin. Fichiers sur disque en **0600**.

### Captures (non commitées)

- `_qa/photos/shots/composer-preview.png` — composer avec vignette et croix
- `_qa/photos/shots/album-tab.png` — onglet Album, tuile datée
- `_qa/photos/shots/control-no-photo.png` — témoin

Playwright a été pris dans le `node_modules` d'un autre clone du dépôt présent
sur la machine : `cowork/node_modules` n'existe pas dans ce worktree, donc
`cowork/node_modules/.bin/playwright` demandé par la mission était introuvable.
Viewport 390×844.

**Réserve honnête :** la bande noire sous le composer sur les captures est un
artefact **préexistant** du harnais (`showMain()` forcé sur une page arrivée sur
l'écran de connexion, les hauteurs `height:100%` ne se résolvent pas) — la capture
témoin sans photo la montre à l'identique. Hors périmètre.

## Bilan

1. Recevoir une photo est devenu **un tour compagnon**, pas une analyse d'image.
2. La posture de vie privée est **explicite et testée** : en `local`, aucun octet
   d'image n'entre dans la requête.
3. Le repli est honnête : sans description, elle le dit ; si le modèle prétend ne
   pas voir, **une** reprise locale a lieu.
4. Telegram et la PWA passent par **le même pipeline** — une seule définition du
   comportement.
5. L'album est **hors du dépôt**, en 0600, sans prénom ni chemin, plafonné,
   et n'évince jamais un favori.
6. La mémoire tient dans **une seule clé** bornée, pour ne pas dévorer le budget
   de caractères de la mémoire persistante.
7. Sans pièce jointe, le tour est **byte-identique** — c'est asserté.
8. Trois vrais défauts n'ont été trouvés **que** parce que le code a été lancé
   pour de bon : fichier suivi, CSP, isolation des tests.
9. Aucune dépendance ajoutée : `sharp` était déjà déclaré en optionnel, et son
   absence est un repli, pas une panne.
10. Reste ouvert : le résumé mémoire reprend la description de moondream **en
    anglais** (le modèle est anglophone) ; une traduction ou un résumé court en
    français rendrait la phrase de Lisa plus naturelle. Non traité ici.
