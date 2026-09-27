# Code Buddy 2.3 — version candidate

**Un agent de programmation utilisable avec un modèle local, dont les actions peuvent être examinées dans un journal d’exécution.**

Cette page accompagne le [README principal](README.md). Le dépôt prépare la **2.3.0**, mais `package.json` indique encore **2.2.0** : le paquet npm peut être en retard sur ce candidat. Vérifiez `buddy --version` et le [changelog](CHANGELOG.md) avant d’attribuer une fonction à la version installée. Les preuves ci-dessous viennent d’un HOME Linux isolé, le 27 septembre 2026 ; elles valent pour leurs scénarios précis.

## Installer

Avec Node.js 20 ou plus :

```bash
npm install -g @phuetz/code-buddy
```

Pour utiliser exactement ce candidat avant la publication npm 2.3.0, suivez l’[installation depuis les sources](docs/getting-started.md). L’application de bureau Cowork suit une [installation distincte](docs/cowork.md).

## Essayer en 60 secondes

Avec [Ollama](https://ollama.com/) déjà lancé et `qwen3:4b-instruct` déjà téléchargé, créez un dossier jetable puis demandez à l’agent de lire un fichier. Le téléchargement initial du modèle n’est pas compris dans cette minute.

```bash
mkdir -p /tmp/buddy-first-run
printf '{"name":"demo","version":"1.0.0"}\n' > /tmp/buddy-first-run/package.json
OLLAMA_HOST=127.0.0.1:11434 buddy --directory /tmp/buddy-first-run --model qwen3:4b-instruct --compact --enabled-tools read_file --permission-mode dontAsk --max-tool-rounds 3 --output-format json -p 'Read package.json with the read_file tool and answer with only its version.'
```

Dans le JSON, vérifiez l’appel de `read_file` et la réponse finale `1.0.0`. Le même parcours a renvoyé `7.3.1` sur notre fichier factice : [trace du tour](docs/preuves/inventaire-agent-loop.log) et [enregistrement du terminal](docs/assets/demos/agent.cast). Une réponse finale seule ne prouve pas que l’outil a été appelé. `buddy run list` puis `buddy run replay <id>` permettent d’examiner une exécution enregistrée : [preuve du rejeu](docs/preuves/vitrine-cli-run.log).

## Fonctionnalités vérifiées dans ce candidat

Le [catalogue](docs/catalog/README.md) suit **91 capacités explicites** : **45 ont une trace d’exécution locale actuelle**, 46 n’en ont pas. « Raccordée » désigne un chemin de code vérifié statiquement, pas un fonctionnement complet. Dix parcours représentatifs :

| Capacité | Ce que la preuve montre |
|---|---|
| [Agent Ollama local](docs/preuves/inventaire-provider-ollama.log) | `qwen3:4b-instruct` a appelé `read_file` et donné la version du fichier factice. |
| [Rejeu des exécutions](docs/preuves/vitrine-cli-run.log) | Une lecture `read_file` enregistrée a été rejouée après correction d’un défaut du rejoueur. |
| [Chat HTTP](docs/preuves/inventaire-http-chat.log) | Une requête locale à `/api/chat` a reçu une réponse Ollama. |
| [Sessions et mémoire HTTP](docs/preuves/inventaire-http-sessions.log) | Une session factice a été créée puis listée ; une [entrée mémoire factice](docs/preuves/inventaire-http-memory.log) a été écrite puis relue. |
| [Audit de sécurité](docs/preuves/vitrine-cli-security.log) | L’audit JSON a été exécuté sur un profil et un projet jetables, sans correction appliquée. |
| [Contrôle des politiques](docs/preuves/vitrine-cli-policy.log) | Le diagnostic en lecture seule a affiché les domaines évalués. |
| [Profil des outils](docs/preuves/vitrine-cli-tools.log) | La liste effective des outils autorisés a été affichée ; cette commande n’a exécuté aucun outil. |
| [Préparation base/authentification](docs/preuves/vitrine-cli-provision.log) | Une simulation a prévu 14 fichiers pour la cible locale ; aucun fichier n’a été appliqué. |
| [Jeton JWT](docs/preuves/vitrine-cli-token.log) | Signature HMAC, sujet et durée d’un jeton factice vérifiés indépendamment. |
| [État du catalogue](docs/preuves/vitrine-catalog-status-rejeu.log) | Les 91 entrées explicites sont revenues dans la sortie structurée. |

[Cinq courtes captures asciinema](docs/assets/demos/README.md) montrent de vraies commandes, avec chemins locaux expurgés. Les [tableaux complets en français](docs/FONCTIONNALITES.md) et [en anglais](docs/FEATURES.md) lient chaque capacité à son niveau de preuve.

## Comparaison et limites

Le [tableau comparatif sourcé du README principal](README.md#comparison-with-scope) couvre Claude Code, Aider, OpenCode, Codex CLI et Gemini CLI. Il n’existe pas ici de banc comparatif de qualité ou de vitesse. Pour ce lancement, Code Buddy a une couverture de preuve plus étroite que les parcours décrits par ces produits : Cowork, un second pair de flotte, l’authentification de fournisseurs hébergés et un déploiement réel n’ont pas été exécutés dans cette campagne.

La démo autonome `buddy try` a [échoué avec le modèle local 4B](docs/preuves/vitrine-buddy-try-echec.log) : le test FizzBuzz attendu n’a pas été produit. Cela ne contredit pas la lecture de fichier réussie ; ces tâches n’ont pas la même portée. Les essais de cette campagne ne certifient ni Windows ni macOS.

## Documentation, contribution et licence

- [Démarrage](docs/getting-started.md), [commandes](docs/commands.md), [sécurité](docs/security.md), [flotte](docs/fleet-guide.md), [Cowork](docs/cowork.md)
- [Mécanismes de mémoire et d’apprentissage](docs/learning-mechanisms.md) : documentation thématique, distincte des preuves d’exécution de cette vitrine
- [Guide de contribution](CONTRIBUTING.md), [tickets](https://github.com/phuetz/code-buddy/issues) et [discussions](https://github.com/phuetz/code-buddy/discussions)

[Business Source License 1.1](LICENSE) : les usages personnels, non commerciaux et auto-hébergés suivent ses termes ; fournir Code Buddy comme service commercial à des tiers est restreint. Conversion en Apache 2.0 prévue le 31 août 2030. Les skills embarqués peuvent porter leur propre licence dans `SKILL.md`.
