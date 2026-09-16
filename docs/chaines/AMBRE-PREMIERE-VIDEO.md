# AMBRE — plan de la première vidéo

Établi le 1er août 2026, à partir de ce qui existe réellement et qui a passé le
contrôle. Aucune ressource n'est supposée : chaque plan cité a un fichier et un
verdict.

---

## Le choix de la destination, et pourquoi celle-là

Quatre décors sont en stock. Leur taux de réussite au contrôle d'identité
tranche la question sans discussion :

| Décor | OK | Mineur | Rejet | Exploitable ? |
|---|---:|---:|---:|---|
| **Chalet d'automne** | **9** | 0 | 3 | ✅ **oui, dès maintenant** |
| Japon (temple, sakura) | 4 | 3 | 3 | plus tard |
| Intérieurs | 3 | 4 | 2 | plus tard |
| Village | 2 | 0 | 5 | non |

**Le chalet d'automne est le seul décor où neuf plans sur douze sont validés
sans réserve.** C'est donc la première destination, et ce n'est pas un choix
éditorial : c'est le seul qui permette de tenir la promesse sans attendre les
réparations en cours.

---

## Les neuf plans disponibles

Tous dans `~/Videos/personas/ambre-scenes/automne-composites/` :

| Fichier | Ce qu'il montre |
|---|---|
| `ambre-007-chalet-large-doudoune` | Plan large — le lieu avant la personne |
| `ambre-001-chalet-exterieur-doudoune` | Extérieur, plan moyen |
| `ambre-002-chalet-exterieur-flanelle` | Extérieur, changement de tenue |
| `ambre-005-chalet-terrasse-doudoune` | Terrasse, ouverture sur le paysage |
| `ambre-006-chalet-terrasse-bordeaux` | Terrasse, autre tenue |
| `ambre-009-chalet-fenetre-flanelle` | Fenêtre — cadre dans le cadre |
| `ambre-003-chalet-salon-pull-creme` | Salon, chaleur |
| `ambre-004-chalet-salon-flanelle` | Salon, autre tenue |
| `ambre-011-chalet-interieur-flanelle` | Intérieur, plan rapproché |

**Trois sont écartés** : `008` (0,267), `010` (0,380) et `012` (0,347) — dérive
d'identité, réparation en cours sur gpuNode. S'ils repassent le seuil, ils
enrichiront le montage ; sinon la vidéo tient sans eux.

---

## La structure, d'après le gabarit mesuré

Le format de référence a été mesuré : 87 s, **34 plans, 2,40 s de moyenne**,
musique continue **sans narration**. Les sept codes sont dans
`docs/studies/2026-07-28-format-voyage-ambre.md`. Cible ici : **75 à 90 s**.

L'arc — parce que « c'est un voyage, pas un diaporama » :

**Arriver → entrer → s'installer → regarder dehors → repartir avec l'image.**

| Temps | Plan | Échelle | Source |
|---|---|---|---|
| 0–4 s | Le chalet dans la montagne, personne encore | très large | B-roll + `007` |
| 4–12 s | Ambre approche, doudoune | large → moyen | `001` |
| 12–22 s | Extérieur, elle avance, flanelle | moyen | `002` |
| 22–32 s | La terrasse s'ouvre sur la vallée | large | `005`, `006` |
| 32–42 s | Elle passe le seuil, salon | moyen → rapproché | `003`, `004` |
| 42–52 s | Détails : mains, tissu, tasse, fenêtre embuée | gros plan | B-roll |
| 52–64 s | À la fenêtre, elle regarde la lumière tomber | rapproché | `009`, `011` |
| 64–75 s | Retour au large, heure dorée, la chute | très large | B-roll |

**Règles à ne pas casser** — ce sont celles qui font la différence entre un film
et un diaporama :
- **jamais deux plans de même échelle à la suite** ;
- **du mouvement dans chaque plan** — un plan fixe casse le rythme ;
- **environ 40 % de plans avec Ambre, 60 % de décor pur** ;
- **on ne finit jamais sur un plan faible** : la chute est le plus beau plan ;
- coupes rapides + **mouvement interne lent** = élégance. C'est la clé technique
  du registre « film de marque de luxe » retenu contre le registre Nas Daily.

---

## Ce que la vidéo ne dira JAMAIS

Le positionnement l'interdit, et c'est aussi une protection juridique :

- ❌ « j'ai testé », « mon coup de cœur », « je vous recommande » ;
- ❌ un avis sur un établissement identifiable ;
- ❌ une rencontre, une anecdote ou un vécu inventés.

Ambre **ne prétend pas montrer sa vie**. Elle interprète visuellement un lieu.
La signature de chaîne le dit : *« Les destinations, habillées par Ambre. »*

**Déclaration de contenu synthétique obligatoire** à la publication.

---

## Ce qu'il reste à faire, dans l'ordre

1. Attendre la fin des réparations d'identité sur gpuNode — et **re-scorer** les
   neuf plans retenus, pas seulement les trois réparés : une réparation peut en
   abîmer une autre.
2. Choisir la musique dans Epidemic Sound — licence multi-chaînes et publicité
   déjà couverte par l'abonnement.
3. Monter selon la table ci-dessus, puis mesurer : durée, **nombre de plans**,
   **durée moyenne de plan** (cible 2,4 s), loudness cible **−14 LUFS** comme
   pour la vidéo Lisa.
4. Passer la porte visuelle sur le **rendu final**, pas seulement sur les sources.
   Un montage peut introduire un défaut qu'aucune image ne portait.

---

## Ce que je n'ai pas vérifié

- Les **102 vidéos** déjà présentes dans `~/.codebuddy/media-video/ambre-automne/` :
  je me suis appuyé sur les verdicts des composites qui les alimentent, pas sur
  un visionnage.
- Les **91 B-roll** disponibles : non audités, alors que le plan ci-dessus en
  utilise pour un tiers de la durée. À contrôler avant montage.
- La **musique** : aucune piste n'est choisie ni vérifiée pour sa licence.
