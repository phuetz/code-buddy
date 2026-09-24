# Réparation — une puce écrite à la main bloquait toute la mémoire utilisateur (24/09/2026)

Agent : Opus 5.5 (Claude Code), à la demande de Patrice.

## Symptôme

Au démarrage, Code Buddy avertissait :

```
[persistent-memory] could not load user memory (non-canonical memory markdown contains no
recoverable entries) — destructive saves are blocked until a successful reload
```

Le fichier `~/.codebuddy/memory.md` contenait le modèle standard, et, ajoutée à la main le
14/09 après le pied de page, une seule préférence sous forme de puce simple (`- texte`). Le
chargeur n'accepte que `- **clé**: valeur` : il ne trouvait aucune entrée, déclarait le fichier
corrompu et bloquait toute sauvegarde. La mémoire utilisateur n'a rien pu enregistrer pendant
dix jours. (Le fichier réel a été réparé à la main le 24/09 ; cette PR empêche la récidive.)

## Correctif

- Une puce en colonne 0 sans `**clé**:` est récupérée comme entrée. Sa clé est dérivée de son
  texte (`note-<5 premiers mots>-<sha256 6>`), donc stable d'un rechargement à l'autre ; la
  sauvegarde suivante la réécrit au format canonique. Les lignes de suite canoniques commencent
  toujours par deux espaces : une puce en colonne 0 n'en est jamais une.
- **La protection est conservée.** Si des puces récupérées côtoient d'autres lignes non
  reconnues (texte libre), une sauvegarde perdrait ces lignes : le fichier reste bloqué, et
  l'erreur nomme la première ligne en cause.
- Sans puce orpheline, la règle historique est strictement inchangée.
- Le chargement et le rechargement qui précède chaque sauvegarde appliquent la même règle
  (`assertRecoverableMemoryFile`), au lieu de deux copies du test.

## Vérifications

- `tests/memory/persistent-memory-bare-bullets.test.ts` (3 cas) : fichier réel type (modèle +
  puce après le pied de page) récupéré ; la puce survit à une sauvegarde et devient canonique ;
  puce + texte libre → sauvegarde refusée, fichier inchangé à l'octet.
- Rejoué contre le chargeur de `main` : les deux cas de récupération tombent ; le cas de
  protection passe des deux côtés (comportement de protection inchangé).
- Garde existant (`persistent-memory-corruption-guard`) inchangé et vert.
- `tests/memory` et `tests/agent/learning` : 49 fichiers, 309 tests verts ; `tsc --noEmit` 0 ;
  test de confidentialité vert.
- Copie du fichier réel d'origine chargée par le nouveau chargeur : non bloquée, une entrée.
