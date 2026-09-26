# Remise à zéro — lecture absente ou illisible

24 septembre 2026. Branche `feat/reset-sessions-messagerie-2026-09-23`, correctif `96e713b5b` après `0c6fa9f7b`. Commit local uniquement : pas de push, pas de fusion.

Une lecture disque refusée, ou un fichier présent mais invalide, n'est plus traitée comme une mémoire absente sur le chemin de remise à zéro des sessions de messagerie. Cet état annule la remise à zéro. Rien n'est effacé. L'absence prouvée reste le code `ENOENT`, ou un fichier valide réellement vide.

Les essais POSIX qui retirent le droit de lecture sont ignorés sous Windows. Le détail et les preuves sont hors du dépôt public.
