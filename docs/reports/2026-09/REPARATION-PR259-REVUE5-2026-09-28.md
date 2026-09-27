# Reprise de la cinquième relecture de sécurité PR #259

Branche `fix/securite-2-3-0`, code `0e80af4a3`. Aucun push ni fusion. Les essais emploient exclusivement le HOME fictif `_qa/securite-reprise-5/home` et des valeurs `FAKE-*` ; aucun identifiant réel n'a été ouvert.

| Bloquant ou réserve | Traitement | Preuve |
| --- | --- | --- |
| **B6 — `grep -r`, `rg`, `find`, `tar` sur le HOME, sans nom de secret dans la commande** | Le validateur inspecte les répertoires effectivement parcourus, même hors racine d'identifiants. Il contrôle aussi la recherche implicite dans le répertoire courant. | Test neuf `reprise-5-recursive-shell-video.test.ts` : six formes HOME, dont le pipeline `tar`, étaient rouges avant (validateur `ALLOW`) puis vertes. Le vrai `BashTool` refuse avant exécution, en appel normal et en streaming. |
| **B6 — projet `.env` lu par recherche récursive ou glob** | Contrôle des répertoires du projet et des globs simples qui peuvent désigner un fichier secret ; `*` ne correspond pas à un fichier caché, conformément au shell. La recherche de noms source `find . -name '*.ts'` seule demeure possible. | Cinq formes projet rouges avant, puis vertes, complétées par `grep -r .` implicite, `cat *.env` et `cat *` sur un lien symbolique secret. Les usages `cat .env.example`, `head notes.txt`, `grep -r` sur un dossier sans secret, `find . -name '*.ts'` et `tar` sur un fichier ordinaire sont verts. |
| **B6 — répertoire effectif différent du `cwd` du processus** | Le `cwd` réel est transmis au validateur par `BashTool.execute`, `executeStreaming` et la revalidation RTK ; le contrôle Git diff utilise la même base. | Test du vrai `BashTool` avec `cwd` explicite : refus normal et streaming, aucune valeur `FAKE-*` dans le résultat ; contrôle positif sur dossier propre. |
| **Réserve — `understand_video` local transmet un secret à ffmpeg** | Garde `checkSecretFileAccess` avant `extractAudio`, sur chemin direct et lien symbolique. | Test rouge avant : `extractAudio` était appelé et rendait `fixture`. Après : deux refus `credential/secret`, zéro appel à l'extracteur ; fichier ordinaire encore transmis. |

La première exécution du nouveau test, avant le code, comptait **12 échecs sur 13 tests**. Après correction et compléments : **19/19** dans ce fichier. Vérification élargie : `npm test -- --configLoader runner tests/security tests/bash tests/tools/video/video-understanding.test.ts` : **76 fichiers, 1 339/1 339 tests** ; `npx vitest run --configLoader runner tests/security/donnees-personnelles.test.ts` : **40/40** ; `npx tsc --noEmit` : succès ; ESLint ciblé : zéro erreur ; `git diff --check` : succès. Ces commandes ont été lancées avec un HOME fictif sous `_qa/securite-reprise/runner-home`.

## Ce que je n'ai pas pu vérifier

- La suite complète du dépôt, un vrai modèle, l'interface Ink, Electron, Windows et macOS n'ont pas été exécutés.
- Le confinement `CODEBUDDY_NATIVE_SANDBOX` n'a pas été testé. Un chemin de secret calculé entièrement à l'exécution par un interpréteur reste hors de portée d'une analyse statique de la commande ; le correctif couvre les formes prouvées par la cinquième relecture, sans prétendre rendre le shell hermétique.
- Aucun envoi réseau ni secret réel n'a été utilisé. La preuve de la réserve vidéo porte sur l'absence d'appel à l'extracteur injecté avant lecture ; le comportement de ffmpeg avec un média réellement classé secret n'a pas été mesuré.
