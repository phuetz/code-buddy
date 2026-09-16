# Réparation GF3FIX — 2026-09-04

## Périmètre et contraintes

Rapport créé avant toute inspection du dépôt. Travail effectué uniquement dans
`~/DEV/cb-gf3fix-2026-09-04`, sur la branche
`fix/gf3fix-localgpu-ip-tiretees-2026-09-04`. HOME QA :
`~/DEV/cb-gf3fix-2026-09-04/_qa/gf3fix/home`.

`~/code-buddy` n’a pas été écrit. Aucun push, aucune API payante, aucun service
touché. Les changements déjà présents dans le clone (réservation de
coordination, `.gitignore` et le test R1 non commité) ont été conservés.

## R1 — alias de `capacity.localGpu`

`parseHybridCapacity` lit désormais, dans cet ordre, la clé canonique
`localGpu` puis les alias génériques `local_gpu`, `localGpuAvailable` et
`local_gpu_available`. Le chemin d’export du handoff accepte aussi
`local_gpu` en plus de ses deux formes génériques déjà présentes.

Les schémas des trois outils vidéo et du schéma multimodal documentent ces
alias et indiquent explicitement que les anciennes clés liées à une machine ne
sont pas lues. Aucun nom de machine n’a été réintroduit.

Preuve rouge→verte : le témoin initial échouait 1 fois sur 7 ; après correction,
`video-studio-tool-helpers-parse-capacity.test.ts` passe à 10/10. Les quatre
formes sont exercées directement par `pickBoolean`, puis par le parseur complet.

## R2 — IP privées sous forme tiretée

`tests/security/donnees-personnelles.test.ts` ajoute `RE_IP_PRIVEE_TIRETEE`,
avec les quatre plages demandées et la même exemption
`FICHIERS_PLAGES_PRIVEES` que les motifs IP pointés. Quatre témoins isolés sont
construits par concaténation ; les contre-épreuves couvrent boucle locale,
adresses de documentation, numéro de version et plage hors seuil.

Mutation : remplacer l’alternative `172` par `173` a produit 1 échec sur 35
(le témoin /12), puis la restauration a rendu la suite verte. Avec les
contre-épreuves finales, la garde passe à 40/40.

Balayage final des fichiers suivis, sans résidu et sans sortie :
`git ls-files -z | xargs -0 -r grep -rnE -- '(^|[^[:alnum:].-])((192-168)-[0-9]{1,3}-[0-9]{1,3}|10-[0-9]{1,3}-[0-9]{1,3}-[0-9]{1,3}|172-(1[6-9]|2[0-9]|3[01])-[0-9]{1,3}-[0-9]{1,3}|100-(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])-[0-9]{1,3}-[0-9]{1,3})([^[:alnum:].-]|$)'`
(le code `123` de `xargs` signifie ici que grep n’a trouvé aucune occurrence).

## Preuves finales

- `HOME=... npx vitest run tests/tools/video tests/security/donnees-personnelles.test.ts` : **41 fichiers / 441 tests verts**.
- `HOME=... npx vitest run tests/tools tests/security/donnees-personnelles.test.ts` : **174 fichiers / 1 720 tests ; 1 717 verts, 3 échecs hors périmètre**. Les deux tests GK21 échouent faute de navigateur Playwright dans la HOME QA ; `lessons-tools` expire après 60 s. Aucun échec ne touche R1/R2.
- `npx tsc --noEmit -p tsconfig.json` : **0 erreur**.
- ESLint ciblé sur les cinq sources et deux tests touchés : **0 erreur**.
- `git diff --check` : **propre**.

## Commits

- R1 : `d6273e1c6` — `fix(video): accept generic local GPU capacity aliases`.
- R2 : `88d472b77` — `fix(security): detect private peer ids with dashes`.
- Documentation/coordination : commit de passation contenant ce rapport et la ligne de coordination.

## Reste ouvert

Les trois échecs hors périmètre de la suite `tests/tools` restent ouverts :
Playwright absent de la HOME temporaire et timeout de `lessons-tools`. Les
anciennes valeurs déjà présentes dans l’historique Git restent, par nature,
hors de portée d’un correctif dans l’arbre courant.
