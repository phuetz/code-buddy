# Reprise de la sixième relecture de sécurité PR #259

Branche `fix/securite-2-3-0`, correctif `f17c1b4ee`. Aucun push ni fusion. Tous les essais utilisent le HOME fictif `_qa/securite-reprise-6/home` et des valeurs `FAKE-*`. Aucun identifiant réel ou fichier `.env` du propriétaire n'a été ouvert.

| Bloquant ou réserve | Traitement | Preuve |
| --- | --- | --- |
| **B7 — continuation de ligne dans `codex-auth.json`** | La commande est normalisée en retirant `\\` suivi de LF ou CRLF avant l'expansion du HOME et la tokenisation. Le nom recollé passe alors par la garde commune des fichiers secrets. | Avant : `findCredentialPathInCommand` rendait `null`, le validateur acceptait et le vrai `BashTool` renvoyait le jeton fictif. Suite neuve : **5 échecs sur 6 tests** avant le correctif, puis **7/7 verts** après. Les formes `~`, `$HOME`, LF et CRLF sont couvertes ; le vrai `BashTool` refuse avant lecture. |
| **Réserve B6 — `.npmrc` public bloque une recherche récursive** | Seul un `.npmrc` de projet hors HOME, fichier régulier de taille bornée avec des options publiques explicitement reconnues, est ignoré pendant l'inspection du répertoire. Un fichier de jeton, un lien, un contenu inconnu ou un accès direct restent refusés. | Test initial rouge sur `grep -r bonjour .` avec `.npmrc` public, vert après ; ajout d'une directive `_authToken` fictive → refus ; `cat .npmrc` → refus. |
| **Réserve B6 — limite de 10 000 entrées** | Retrait du seuil arbitraire de refus. Les erreurs de lecture et les liens problématiques restent bloquants ; les répertoires sont parcourus une seule fois par chemin canonique. | Arbre fictif de **10 001 fichiers ordinaires** : recherche refusée avant, admise après. |
| **Régression détectée en vérification — motif `.` pris pour un répertoire** | Le premier motif de `grep`/`rg` est distingué des chemins à lire. | Première passe élargie : test `grep -r . $HOME` en délai dépassé (20 s), car le validateur parcourait le dépôt. Après correction, suites de reprise 5 et 6 : **26/26** verts en environ 3 s. |
| **Régression de la distinction motif/chemin — `grep`/`rg -f` lit un fichier secret** | `-f FILE`, `--file=FILE` et `-fFILE` restent des opérandes de fichier ; `-e`/`--regexp` désignent des motifs littéraux. | Test rouge ajouté pour `grep -f .env notes.txt`, puis vert avec `rg -f .env notes.txt` et `grep -f.env notes.txt`. Les `.env` sont fictifs sous `_qa`. |

Vérifications finales avec `HOME=$PWD/_qa/securite-reprise/runner-home` : `npm test -- --configLoader runner tests/security tests/bash tests/tools/video/video-understanding.test.ts` : **77 fichiers, 1 346/1 346 tests** ; `npx vitest run --configLoader runner tests/security/donnees-personnelles.test.ts` : **40/40** ; `npx tsc --noEmit` : succès ; ESLint ciblé : zéro erreur ; `git diff --check` : succès. `CHANGELOG.md` et `CLAUDE.md` décrivent la portée statique de la garde et l'exception étroite du `.npmrc` public.

## Ce que je n'ai pas pu vérifier

- La suite complète du dépôt, un vrai modèle, Ink, Electron, Windows et macOS n'ont pas été exécutés.
- `CODEBUDDY_NATIVE_SANDBOX` n'a pas été activé. Un chemin entièrement calculé par un interpréteur reste hors de portée de l'analyse statique du shell.
- L'exception `.npmrc` est volontairement restreinte : une option publique non reconnue peut encore faire refuser une recherche. Le parcours sans seuil a été mesuré sur 10 001 fichiers, pas sur des arbres de millions de fichiers.
- Aucun envoi réseau ni service domestique n'a été utilisé ; le tarball npm et l'audit de dépendances ne font pas partie de cette reprise.
