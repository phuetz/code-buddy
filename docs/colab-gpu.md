# Jobs GPU Colab

L'intégration est éteinte par défaut. Avec `CODEBUDDY_COLAB=true`, `buddy colab`
gère les VM Google Colab ; sans ce drapeau, le nom reste l'alias historique
`buddy autonomy`. La file flotte reste disponible sous `buddy autonomy`.
Installer et autoriser la CLI officielle `~/.local/bin/colab` avant utilisation.
Les appels emploient toujours `--auth oauth2` ; aucun montage Drive n'est effectué.

```bash
export CODEBUDDY_COLAB=true
buddy colab run scripts/colab/probe.py --gpu L4 --out resultats-gpu
buddy colab run scripts/colab/diffusion-cats.py --out images-chats \
  --dependency diffusers==0.35.1 accelerate==1.10.1 transformers==4.57.1
buddy colab run train.py --gpu A100 --in donnees.csv --out entrainement --timeout 900
buddy colab status
buddy colab stop cb-00000000-0000-0000-0000-000000000000
```

L'outil agent `colab_run` passe par la confirmation habituelle des outils : il
transmet des fichiers et dépense des unités. Son registre déclare
`requiresConfirmation: true`, `effect: emission`, `fleetSafe: false`.
Les modes et autorisations explicitement choisis par l'opérateur restent applicables.
Le chemin d'exécution est `CodeBuddyAgent.executeTool` → `ToolHandler` → registre
formel → `ColabRunTool` → `ColabRunner`, comme les autres outils du registre.

Seuls le script et les fichiers `--in` sont envoyés. Les chemins canoniques doivent
rester dans le projet ; les noms sensibles et les contenus reconnus par le
catalogue existant de secrets sont refusés, même si la lecture locale des secrets
est autorisée. Les liens durs et fichiers spéciaux sont refusés. Des copies privées
figent les octets contrôlés avant l'envoi. Les dépendances acceptent un nom PyPI ou
`nom==version` ; ni URL, ni fichier de requirements, ni option pip.

Le script s'exécute dans `/content/codebuddy-job`. Les entrées se trouvent sous
`inputs/<chemin relatif au projet>` ; les variables distantes
`CODEBUDDY_COLAB_INPUT_DIR` et `CODEBUDDY_COLAB_OUTPUT_DIR` désignent ces dossiers.
Écrire les livrables dans le second. L'environnement local n'est pas envoyé.
Chaque fichier est limité à 64 MiB ; au plus 128 sorties, 256 MiB au total.
Le dossier de sortie local doit être nouveau et dans le projet. Aucun fichier
existant n'est remplacé. Les sorties contenant un secret détectable sont refusées.

L4 est le défaut. A100 est explicite. H100 se replie sur A100 après fermeture
vérifiée de la première tentative si la CLI traduit un refus d'allocation ou
d'accélérateur, ou signale `Service Unavailable` sur une requête GET ou POST vers
`https://colab.research.google.com/tun/m/assign`. `assign()` ajoute des paramètres
à cette URL et commence par GET avant POST. Le runner reconnaît aussi son affichage
coupé sur plusieurs lignes par Typer, avec ou sans styles ANSI (y compris si
le parent force la couleur sur stderr redirigé). Un 503 sur un autre endpoint, une erreur
d'authentification, un délai réseau ou une interruption ne déclenche pas une
nouvelle allocation. Un simple texte `503 Server Error` sans cette preuve
d'allocation ne suffit pas.

Le délai de travail (600 secondes par défaut, maximum 3600) démarre après le
contrôle des fichiers locaux et couvre installation, calcul et téléchargement.
Il déclenche aussi l'annulation pendant l'allocation ; celle-ci attend toutefois
la fin de l'appel `new`, borné à 120 secondes, pour enregistrer l'identité de la VM.
Le délai demandé n'est donc pas une borne sur la durée totale de la commande.
SIGINT, SIGTERM et annulation de l'outil attendent également cette stabilisation,
puis `stop` dans `finally`. Seule la CLI fixe son code de sortie à 130 ou 143 ; le
runner réutilisable n'altère pas le code de sortie du serveur qui l'héberge.
Pendant `buddy colab run`, les gestionnaires globaux d'arrêt de la CLI sont
suspendus puis restaurés après le nettoyage, pour éviter une sortie prématurée.
Dans un serveur, le runner inscrit une barrière prioritaire auprès du gestionnaire
d'arrêt : elle annule le travail et attend son `finally`. Pendant ce job, le budget
minimal de l'arrêt global est de 300 secondes pour laisser finir allocation et
nettoyage bornés ; la barrière est retirée après le job ou lors de l'arrêt de l'hôte.
Le nettoyage dispose de trois tentatives (30 secondes pour `stop`, 10 pour
`sessions`, 10 pour `usage` chacune), puis 10 secondes de mesure finale, soit
160 secondes de marge. Il exige une liste sans la session ni affectation inconnue
et un contrôle indépendant `usage` indiquant zéro affectation active. Des
diagnostics sur stderr de `sessions` interdisent de conclure à une fermeture.
Une autre VM encore active peut donc empêcher cette vérification prudente ; elle
n'est jamais fermée automatiquement. Un échec de nettoyage est une erreur visible,
conserve la réservation et interdit une nouvelle allocation.

`CODEBUDDY_COLAB_MAX_UNITS_PER_DAY` vaut 50 par défaut. Le compteur est
`$CODEBUDDY_HOME/compute/colab-units.json`, ou `~/.codebuddy/compute/colab-units.json`.
Son verrou exclut les jobs concurrents utilisant ce compteur. Une réservation
conservatrice précède toute allocation : délai + 280 secondes de marge, aux
plafonds horaires L4=15, A100=30, H100=100 unités, plus 0,02 unité d'arrondi.
Le débit réel du compte est contrôlé après allocation ; un dépassement arrête la VM.
Après fermeture, la charge retenue est le maximum entre la différence de solde
augmentée de 0,02 et le temps écoulé au plafond horaire augmenté de 0,02. Si la
mesure échoue, toute la réservation reste chargée. `status` distingue cette charge
prudente de la différence de solde mesurée. Le jour comptable est UTC ; les jobs
dont la réservation franchirait minuit UTC sont refusés. Un état corrompu est
refusé. Le budget s'applique aux jobs utilisant ce compteur ; utiliser le même
profil pour toutes les instances devant partager le budget.

Après un arrêt non interceptable (SIGKILL, panne électrique), aucun `finally` ne
peut s'exécuter. Vérifier les sessions avec la CLI officielle et arrêter la session
`cb-…` explicitement. Après vérification qu'aucun processus de job ne tourne,
retirer uniquement le dossier vide `colab-units.json.lock` éventuellement laissé,
puis utiliser `buddy colab stop <cb-session>` pour fermer et solder la réservation.
Une panne réseau persistante peut empêcher la destruction : le runner ne prétend
jamais qu'elle est confirmée. Il ne ferme pas les sessions étrangères en bloc.

Le modèle d'exemple `google/ddpm-cat-256` est déclaré Apache-2.0 par sa
[fiche Google](https://huggingface.co/google/ddpm-cat-256), révision épinglée
`82ca0d5db4a5ec6ff0e9be8d86852490bc18a3d9`. Ce petit modèle inconditionnel produit
quatre aperçus de chats 256×256 ; sa qualité visuelle est limitée.
