# Rejeux P9 après relecture

Les preuves en situation utilisent les adaptateurs compilés de production, sans mocks.
Les tests unitaires des oracles sont une vérification distincte des captures réelles.

## CodeExplorer : CLI et outil MCP

Prérequis : Linux, Node ≥ 22, `dist/` construit avec `npm run build`, et le binaire
`code-explorer` sur PATH (version exécutée : 0.1.1). `CODE_EXPLORER_BIN` peut désigner
un autre emplacement du même binaire. Ce composant externe reste requis ; il n'est
pas distribué par cette preuve. Aucun service réseau ni modèle distant n'est utilisé.

```bash
node scripts/qa/run-p9-code-explorer-evidence.mjs
```

Ce harnais est celui de `cli-code-explorer` et `tool:code_explorer_ask`. Ces deux
preuves ne font pas partie des 131 scénarios de `run-p9-tool-evidence.mjs`.

Chaque lancement crée son projet neuf sous `_qa/preuves-p9/reprise-2/`, deux
fichiers sources avec un symbole unique et la configuration MCP stdio locale.
HOME reste `_qa/preuves-p9/home`. Il contrôle le statut non indexé, rejette une
requête avant indexation, puis exécute réellement :

```bash
code-explorer analyze <QA_PROJECT> --skip-git --no-docs --max-files 2
```

Il lance ensuite deux processus CLI froids et deux processus outils froids,
avec initialisation MCP et fermeture du transport. L'oracle exige les deux
définitions du symbole unique dans `sample.js` et `sample.ts`, ligne 1. Une
réponse « connected », un écho ou « no graph hits » ne suffit pas.

La fixture, la configuration, les commandes d'indexation, les sorties et les
contrôles sont enregistrés dans `reprise-2/raw/`. Le graphe reste un artefact
généré : aucun ancien index n'est nécessaire pour rejouer. Les groupes de
processus QA sont fermés à la sortie, y compris après un timeout borné.

## Catalogue : stdout brut et agrégats séparés

```bash
node scripts/qa/run-p9-catalog-evidence.mjs
```

`catalog-stdout.json` conserve intégralement les octets de stdout de
`node dist/cli-boot.js catalog status --json`. Le CLI renvoie le tableau
`features`, pas un champ agrégé `featureCount` ou `states`. Les compteurs sont
calculés séparément dans `catalog-measurement.json`, qui indique son fichier
source. Les IDs doivent être uniques et les avertissements vides.

## Autres scénarios utilisant un modèle local

Les deux harnais ci-dessus ne requièrent pas de LLM. Pour le harnais général
`run-p9-tool-evidence.mjs`, les scénarios LLM utilisent les variables du profil
QA, avec une URL complète (dont le suffixe `/v1`) :

```bash
export CODEBUDDY_PROVIDER=ollama
export GROK_API_KEY=ollama
export GROK_BASE_URL=http://127.0.0.1:11434/v1
export GROK_MODEL=qwen3:4b-instruct
```

Le résultat historique de `tool:reason` est un échec de calcul sous cette
configuration valide. Une erreur de configuration « Base URL must be a valid
URL » lors d'un autre rejeu est un échec de préparation distinct. La preuve
ne promet pas le même comportement du modèle sous tous les environnements.
