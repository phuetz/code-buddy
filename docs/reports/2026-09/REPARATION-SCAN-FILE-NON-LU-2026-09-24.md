# Réparation — scan de skill sans lecture

Branche `feat/gardes-boucle-et-audit-securite-2026-09-23`. Pas de push, pas de fusion.

`scanFile()` renvoyait une liste de findings vide lorsqu'il ne lisait pas un fichier ordinaire. Un tube nommé, un lien vers un tube, un répertoire ou un fichier illisible passaient donc pour un scan propre. Le parcours de dossier et le pare-feu signalaient déjà `special-file-not-read`.

Le scan direct porte maintenant le même refus. `textRead` vaut `true` seulement après une lecture de fichier ordinaire. `scanDeniesInstall()` refuse l'installation si cette lecture n'a pas eu lieu, si le motif `special-file-not-read` est présent, ou s'il reste un finding critique. Un finding élevé qui n'est pas ce refus conserve l'autorisation historique.

Appelants de `scanFile()` :

| Endroit | Décision |
| --- | --- |
| `src/security/skill-scanner.ts` `scanDirectory` | un résultat non lu est conservé, il n'est plus omis |
| `src/security/skill-scanner.ts` `scanSkillFirewall` | un résultat sans lecture et sans finding devient un refus avant le verdict |
| `src/skills/registry.ts` `registerSkill` | pas d'enregistrement si `scanDeniesInstall` |
| `src/skills/session-skill-generator.ts` `generateSessionSkill` | le dossier est retiré et la fonction rend `null` |

Les tests de tube et de lien sont réservés à POSIX (`mkfifo`, délai de 2 s). Un répertoire couvre le refus sur toutes les plateformes, y compris Windows. Aucun de ces tests n'ouvre le tube.

Le détail d'exécution reste hors du dépôt public.
