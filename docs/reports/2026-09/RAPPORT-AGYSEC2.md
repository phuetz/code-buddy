# RAPPORT-AGYSEC2 — revue de sécurité : fuites de données privées (copie assainie)

**Origine** : revue AGYSEC2 du 2026-09-04, menée en lecture seule sur un clone d'analyse
du dépôt public, à partir du diff de la nuit (~21 900 lignes de diff, ~12 400 lignes ajoutées).

> **Copie assainie.** Le rapport d'origine citait en clair les valeurs qu'il dénonçait
> (adresses IP, nom de machine, UUID de projet tiers, soldes de crédits, sujet médical).
> Cette copie les DÉCRIT sans jamais les reproduire : c'est la condition pour qu'elle
> puisse vivre dans le dépôt public sans réintroduire la fuite qu'elle documente.

## Bilan de la revue (le pire d'abord)

1. **Donnée médicale et familiale** — un script d'exemple nomme une maladie neurodégénérative,
   le lien de parenté de l'auteur avec la personne atteinte, et un fichier de diagnostic privé.
2. **Identifiant de projet d'un service vidéo tiers en clair** — un UUID de projet de
   production et son URL directe, dans un script d'automatisation et dans un rapport.
   Un second UUID (dérive d'onglet) apparaît dans le même rapport.
3. **Soldes, crédits et niveau d'abonnement** — solde réel de l'auteur, consommation par
   prise, nom de palier d'abonnement, dans un rapport, la table de coordination et le CHANGELOG.
4. **Adresses IP privées, nom de machine, home encodé** — une IP de LAN privé (partage de
   fichiers), une IP de réseau maillé privé, le nom de la machine Linux de l'auteur et un
   chemin de profil de session contenant son identifiant système.
5. **Noms de dépôts et dossiers de travail privés** — plusieurs répertoires internes
   (brouillons de vitrine, dépôt de passation, formation interne, dépôt de livres) et de
   nombreuses mentions nominatives de l'auteur.

## Familles recensées (fichiers, sans les valeurs)

| Famille | Fichiers concernés (extraits) | Gravité |
| :--- | :--- | :--- |
| Santé / situation familiale | `scripts/fix-research.sh` | bloquant |
| UUID de projet tiers | `scripts/influencer/flow-crame.py` (5 occurrences), `docs/reports/2026-09/RAPPORT-FLOWFIX1.md` (2) | bloquant |
| Soldes / crédits / abonnement | `docs/reports/2026-09/RAPPORT-FLOWFIX1.md`, `docs/FABLE5-CODEX-COORDINATION.md`, `CHANGELOG.md` | bloquant |
| IP privée (LAN) | `docs/FABLE5-CODEX-COORDINATION.md` | bloquant |
| IP privée (réseau maillé) | `docs/audits/2026-07-10-application-audit.md` | bloquant |
| Nom de la machine de l'auteur | `docs/FABLE5-CODEX-COORDINATION.md`, `docs/audits/2026-08-25-sante-depot-avant-push.md`, et une vingtaine d'autres fichiers | bloquant |
| Chemin de profil de session encodé | `docs/reports/2026-09/REPARATION-CONV2.md` | bloquant |
| Dépôts / dossiers privés | table de coordination, plusieurs rapports 2026-09 | à nettoyer |
| Mentions nominatives de l'auteur | table de coordination (nombreuses) | à nettoyer |
| Chemins de clones temporaires | `RAPPORT-GK21.md`, `RAPPORT-GK22.md`, `REPARATION-HEADLESS2.md` | bénin |

## Ce que le garde-fou couvrait déjà

`tests/security/donnees-personnelles.test.ts` inspecte tous les fichiers suivis par git,
sauf `CHANGELOG.md` et lui-même. Il couvrait : mots-clés de situation sociale, **un seul**
préfixe d'IP de réseau maillé, **un seul** nom de machine, les chemins de home absolus,
le dépôt de passation historique, l'ancien nom du moteur de graphe, un outil éditorial.

## Ce que la revue lui reprochait de ne PAS couvrir

1. Santé et situation personnelle / familiale.
2. Identifiants de projets cloud tiers (UUID + nom de la constante qui les porte).
3. Soldes, crédits et paliers d'abonnement.
4. Les plages d'IP privées en général : seul UN préfixe de réseau maillé était interdit,
   ni le RFC 1918 « 192.168. » ni « 10. » ni le reste de la plage maillée n'étaient vus.
5. La **seconde** machine de l'auteur (une seule des deux était listée).
6. Les chemins de home **encodés** dans les noms de dossiers de profil de session.
7. Les noms de dépôts / dossiers de travail privés.
8. Le prénom de l'auteur hors chemin `/home/`.
9. L'exemption aveugle de `CHANGELOG.md`.

## Suite donnée

Mission PRIV2 — voir `docs/reports/2026-09/REPARATION-PRIV2.md` pour le nettoyage
effectivement appliqué et l'extension du garde-fou (motifs construits par concaténation,
fixtures isolées, preuve rouge-avant / vert-après).
