# Qualification Jev des interactions vocales

## Modes

`CODEBUDDY_VOICE_JEV_MODE=off` (ou absent) conserve la décision locale sans réseau. `shadow` observe uniquement les suivis rejetés par le filtre. `serve` qualifie les suivis non triviaux pendant une conversation ouverte par adresse explicite, à condition de disposer d’une parole récente rapportée par le moteur vocal. Une simple arrivée détectée ne suffit pas.

Le texte adressé explicitement à Lisa, les réponses brèves reconnues (« oui »), les salutations et les demandes de contact gardent leur chemin immédiat. Dans la session, Jev peut accepter une continuation sans prénom et écarter une parole ambiante. Acceptation : option `continuation`, confiance ≥ 0,7 et probabilité ≥ 0,85. Ce sont des seuils de départ conservateurs, pas une calibration établie sur un grand corpus. Un jugement valide mais insuffisamment sûr ne déclenche pas la parole. Une erreur réseau, un résultat invalide, une expiration ou un budget épuisé revient au filtre local. Les résultats caducs ne déclenchent rien.

## Contexte et confidentialité

Le contexte comprend au plus 1 000 caractères de la dernière parole signalée par `onSpoke`, 500 caractères de transcription et l’indication de conversation ouverte. Aucun historique de conversations n’est chargé. TypeSafe reçoit ce texte lorsqu’il est sélectionné. Les logs enregistrent uniquement issue, durée, confiance et probabilités ; jamais les phrases ni les erreurs brutes du fournisseur.

Le callback `onSpoke` décrit une lecture rapportée par le moteur. Les défauts audio recensés dans l’audit ne sont pas tous corrigés par cette intégration ; cela ne certifie pas la qualité acoustique.

## Configuration

| Variable | Rôle |
|---|---|
| `CODEBUDDY_VOICE_JEV_MODE` | `off`, `shadow`, `serve` |
| `CODEBUDDY_VOICE_JEV_PROVIDER` | `typesafe` par défaut, ou `openjev` |
| `TYPESAFE_API_KEY` | Clé serveur TypeSafe, jamais envoyée au backend local |
| `CODEBUDDY_VOICE_JEV_TIMEOUT_MS` | 1 000 ms par défaut, borné 50–1 000 ms et par le temps restant de session |
| `CODEBUDDY_VOICE_JEV_BUDGET_FILE` | Registre persistant de réservations, indispensable en mode actif |
| `CODEBUDDY_VOICE_JEV_MAX_REQUESTS` | Limite cumulée, maximum 1 000, non remise à zéro au redémarrage |
| `CODEBUDDY_VOICE_JEV_EXPIRES_AT` | Fin absolue ISO, obligatoire en mode actif |
| `CODEBUDDY_VOICE_OPENJEV_URL` | Origine loopback HTTP(S), défaut `http://127.0.0.1:8080` |
| `OPENJEV_API_KEY` | Facultative, dédiée au backend local |

TypeSafe est épinglé à `jev-1.13.0`, OpenJev à son alias `openjev-latest`. Aucun poids local n’est installé. Une requête en vol au maximum, pas de relance automatique, redirections refusées, annulation au délai. Les réservations précèdent les appels ; fichier invalide, verrou présent ou répertoire manquant empêchent les appels. Une panne brutale peut laisser un verrou : diagnostic manuel après vérification qu’aucune requête ne tourne, sans supprimer le compteur.

## Validation du 22 septembre 2026

119 tests ciblés passent (qualification, budget, décideur et streaming vocal) ; compilation TypeScript et lint ciblé passent. Le branchement compilé réellement livré a aussi été exercé avec l’API officielle : sept scénarios synthétiques, sept comportements attendus, six appels API. Cinq continuations acceptées, un « oui » local, un énoncé destiné à Paul écarté par abstention. Sur ce dernier, le modèle hésite et sa catégorie brute n’est pas correcte : le succès comportemental dépend du seuil, pas d’une classification parfaite.

Les trois campagnes du branchement sont conservées : v1 a révélé un contournement par les règles locales ; v2 a exposé l’incertitude ; v3 valide la politique d’abstention. Aucun microphone ni haut-parleur n’a servi à cette recette. La conversation acoustique reste à éprouver en usage.

## Exploitation locale

Le service `buddy-vision-brain` utilise une copie isolée du runtime existant avec quatre modules JS ajoutés/modifiés : serveur, décideur, qualification, budget. Les autres services conservent leur runtime. `VOICE-JEV-OVERLAY.json` décrit les empreintes et la provenance, et le digest du manifeste est recalculé. La version existante n’a pas été remplacée en bloc par main.

Configuration privée dans `~/.config/codebuddy-jev/lisa-jev.env` (0600), dossier 0700. Override systemd `buddy-vision-brain.service.d/90-jev.conf`. Le budget limite cet essai à 1 000 appels cumulés et trente jours ; il ne constitue pas une vérification du solde ou de l’expiration des crédits promotionnels du compte.

Le retour arrière consiste à désactiver ce seul override, recharger systemd et redémarrer le service. Le script livré dans le Partage le fait en conservant l’override renommé. Les sources et tests sont dans la branche `feat/lisa-jev-shadow-2026-09-22` ; aucun commit ni push réalisé dans cette livraison.

Sources : [API TypeSafe](https://docs.typesafe.ai/api), [modèles et tarif](https://docs.typesafe.ai/models).
