# 6. Sessions & historique

Chaque conversation avec l'agent est une **session**. Cowork les garde organisées, cherchables et
reprenables.

## 6.1 Onglets & barre latérale

- Les **onglets** (en haut) fonctionnent comme ceux d'un navigateur — un par session ouverte.
  Basculez d'un clic ou avec `Cmd/Ctrl+1…9`, fermez avec la ×, et épinglez ceux que vous rouvrez.
- La **barre latérale** (à gauche, `Cmd/Ctrl+B` pour l'afficher/masquer) liste vos sessions groupées
  par date, avec une recherche, export/suppression au survol, et un sélecteur de projet.

> _[capture : barre latérale avec sessions groupées]_

## 6.2 Projets

Un **projet** est un Hub local — un dossier plus ses propres réglages, son instruction maître, sa
petite base documentaire et sa mémoire. Créez et changez de projet depuis le sélecteur de la barre
latérale ou **Réglages → Projects**. Chaque session du projet reçoit automatiquement l'instruction
et les fichiers texte explicitement listés. Les chemins restent confinés au dossier du projet ;
Cowork refuse les sorties de dossier, les binaires et les fichiers sensibles comme `.env` ou les
clés privées. Le mode mémoire manuel coupe la mémoire apprise, pas l'instruction explicite.

## 6.3 Reprendre le travail

- Au redémarrage, Cowork peut proposer de **reprendre** votre dernière session.
- À tout moment, `Cmd/Ctrl+Maj+O` ouvre le **sélecteur de reprise** : cherchez d'anciennes sessions
  par titre, modèle, espace de travail ou transcription, prévisualisez la conversation, et rouvrez-la
  avec tout son historique restauré.

> _[capture : sélecteur de reprise de session]_

## 6.4 Tout rechercher

`Cmd/Ctrl+P` (ou `Cmd/Ctrl+Maj+K`) ouvre la **recherche globale** sur les sessions, messages, mémoire
et fichiers de l'espace de travail, avec résultats groupés et aperçus. `Cmd/Ctrl+F` cherche dans la
session courante.

## 6.5 Favoris

Mettez une étoile sur n'importe quel message pour le mettre en **favori**. Le panneau **Favoris**
(icône étoile) les rassemble entre projets, avec recherche et navigation en un clic vers le message
d'origine — pratique pour garder de bons extraits, des décisions ou des résultats.

## 6.6 Branches de conversation

Survolez un message utilisateur ou assistant puis cliquez sur l'icône de
**bifurcation** pour créer une branche à cet endroit. Le message sélectionné
est inclus dans la nouvelle branche. Cowork sauvegarde les historiques dans la
même base SQLite que la conversation active, puis restaure réellement les
messages du checkout — ce n'est pas un simple libellé visuel.

Le sélecteur de branche dans l'en-tête permet de revenir à `main` ou à une
alternative. Avant chaque changement, l'historique sortant est sauvegardé dans
une transaction ; les identifiants de thread distants et le cache du moteur
sont invalidés pour éviter que le contexte caché d'une branche contamine
l'autre. Le journal de reprise de la branche sortante est archivé hors du
chemin de récupération avant le commit SQLite : un redémarrage ne peut donc
pas réinjecter un ancien tour dans la nouvelle branche. Un checkout/fork est
refusé pendant un tour actif ou en attente.

## 6.7 Insights, coût & audit

- **Insights de session** (`Cmd/Ctrl+Maj+I`) — un résumé par session : usage de tokens, coût, appels
  d'outils, temps passé, et une trace rejouable.
- **Coût** — usage de tokens et dépense par provider, avec limites de budget et un compteur en
  direct ; les tendances dans le temps sont dans **Réglages → Cost**.
- **Journal d'audit** — un enregistrement persistant de chaque run et de ses événements ; filtrez par
  statut/date et exportez en CSV.
- **Trace de raisonnement** (`Cmd/Ctrl+Maj+R`) — un arbre des étapes de décision du modèle avec un
  curseur de lecture.
- **Jauge de fenêtre de contexte** — un compteur indiquant le remplissage de la fenêtre de contexte
  du modèle (vert → jaune → rouge), pour compacter ou scinder avant d'atteindre la limite.

> _[capture : insights de session]_

## 6.8 Export & partage

Exportez une session depuis la barre latérale (survol → télécharger) ou la commande `/export` — en
**JSON** (données complètes), **Markdown** (transcription lisible), ou d'autres formats. Une option
d'export partageable peut produire un lien/fichier à transmettre. Sauvegardez ou déplacez tous vos
réglages depuis **Réglages → Import/Export**.
