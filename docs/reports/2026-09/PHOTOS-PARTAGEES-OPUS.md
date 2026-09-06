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

## Inspection de l'existant

_(en cours)_
