# Comparaison honnête / Honest comparison

**Lecture datée, hors validation du candidat.** Les descriptions Code Buddy ci-dessous portent sur les interfaces visées ; seuls les [statuts et traces du catalogue](FONCTIONNALITES-PROUVEES.md) font référence pour les résultats exécutés. Les offres externes n’ont pas été revérifiées ici.

Cette lecture compare les interfaces annoncées par Code Buddy, Claude Code,
Codex CLI, Aider et Gemini CLI. Pour Code Buddy, une interface déclarée n'établit
pas le résultat d'une tâche exécutée : lire le catalogue avant tout essai.

Cette matrice a été vérifiée le **23 août 2026** à partir des documentations
officielles liées plus bas. Les offres et quotas changent : vérifiez les pages
tarifaires avant de choisir un abonnement.

## Matrice

Légende : ✅ natif ; ◐ partiel, séparé ou conditionnel ; ❌ non proposé
nativement dans la documentation publique. Un « non » décrit une capacité, pas
la qualité générale du produit.

| Critère                                          | Code Buddy                                                                | Claude Code                                                              | Codex CLI                                                             | Aider                                                                                       | Gemini CLI                                                            |
| :----------------------------------------------- | :------------------------------------------------------------------------ | :----------------------------------------------------------------------- | :-------------------------------------------------------------------- | :------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------- |
| Plusieurs fournisseurs de modèles                | Visé : routage et repli ; non prouvé ici                                      | ❌ modèles Claude uniquement, avec plusieurs backends d'hébergement      | ◐ OpenAI, providers compatibles configurables et modèles locaux OSS   | ✅ nombreux fournisseurs via LiteLLM et APIs compatibles                                    | ❌ modèles Gemini via Google AI ou Vertex AI                          |
| Forfait existant, sans facture API marginale     | Visé : connexions par forfait ; non prouvé ici                     | ✅ Claude Pro, Max, Team ou Enterprise ; limites du forfait              | ✅ connexion ChatGPT ; limites du forfait                             | ◐ forfait GitHub Copilot possible ; les forfaits ChatGPT/Claude ne remplacent pas leurs API | ✅ compte Google gratuit ; quotas supérieurs avec Google AI Pro/Ultra |
| Inférence locale / hors ligne                    | Visé : Ollama et LM Studio ; non prouvé ici                                                    | ❌ connexion réseau requise pour le modèle                               | ✅ `--oss` avec Ollama ou LM Studio                                   | ✅ Ollama, LM Studio et endpoints locaux compatibles                                        | ❌ le CLI appelle les services Gemini                                 |
| MCP                                              | Visé : client et serveur ; non prouvé ici                                                  | ✅ client **et** serveur                                                 | ✅ client **et** serveur                                              | ❌ pas de prise en charge MCP native documentée                                             | ✅ client MCP                                                         |
| Fleet de pairs sur plusieurs machines et modèles | Visé : appels entre pairs ; non prouvé ici | ❌ Agent Teams existe, mais ce n'est pas un mesh de pairs multi-provider | ❌ les sous-agents existent, mais pas un mesh de pairs multi-provider | ❌                                                                                          | ❌ un sous-agent d'exploration existe, pas une fleet réseau           |
| Interface graphique                              | Visé : Cowork Electron ; non prouvé ici                                           | ✅ Claude Code Desktop sur macOS et Windows                              | ✅ application desktop séparée du CLI                                 | ◐ interface navigateur expérimentale                                                        | ❌ terminal-first                                                     |

### Ce que les critères veulent dire

- **Plusieurs fournisseurs** : le produit peut piloter des modèles de plusieurs
  éditeurs, pas seulement héberger le même modèle sur plusieurs clouds.
- **Sans facture API marginale** : l'authentification réutilise un forfait ou un
  quota déjà disponible. Ce n'est pas « gratuit » : le prix du forfait et ses
  limites restent applicables.
- **Local / hors ligne** : l'inférence peut rester sur la machine après le
  téléchargement et la configuration du modèle. Un CLI installé localement qui
  appelle une API distante ne compte pas comme hors ligne.
- **Fleet** : des instances distantes peuvent se découvrir, échanger des
  événements et invoquer des modèles ou outils entre pairs. Des sous-agents dans
  une même session ne sont pas une fleet au sens de cette ligne.
- **Interface graphique** : une interface graphique maintenue par le projet ou
  le fournisseur compte, même lorsqu'elle est distribuée séparément du CLI.

## Quand choisir quoi ?

- **Code Buddy** si vous voulez combiner modèles locaux et cloud, changer de
  fournisseur, exposer ou consommer MCP, utiliser une application desktop et
  relier plusieurs agents sur votre propre infrastructure.
- **Claude Code** si vous voulez l'intégration Claude la plus directe, ses modes
  Agent Teams et une expérience desktop ou cloud gérée par Anthropic.
- **Codex CLI** si vous utilisez surtout les modèles OpenAI et ChatGPT, tout en
  gardant la possibilité de lancer un modèle OSS local et de passer à
  l'application desktop ou au cloud Codex.
- **Aider** si vous préférez un outil Git ciblé et léger, avec une
  compatibilité de modèles documentée.
- **Gemini CLI** si vous cherchez le chemin terminal officiel vers Gemini, un
  quota Google décrit dans sa documentation et un client MCP sans couche multi-provider.

## Ce que Code Buddy n'est pas

Code Buddy ne développe pas son propre modèle de fondation et ne fournit pas un
cloud managé mondial équivalent aux offres hébergées d'Anthropic, OpenAI ou
Google. Chaque interface a ses propres prérequis et nécessite de la configuration. Les performances d'un modèle local
dépendent du matériel et du modèle choisis ; elles ne sont pas mesurées ici.

## Sources

### Code Buddy

- [Fournisseurs et connexions](providers.md)
- [Fleet multi-AI](fleet-guide.md)
- [Cowork desktop](cowork.md)
- [Commandes MCP](commands.md)

### Claude Code

- [Configuration des modèles et backends](https://code.claude.com/docs/en/model-config)
- [Claude Code Desktop](https://code.claude.com/docs/en/desktop)
- [Sous-agents, Agent Teams et worktrees](https://code.claude.com/docs/en/agents)
- [MCP dans Claude Code](https://code.claude.com/docs/en/mcp)
- [Installation et connexion réseau requise](https://code.claude.com/docs/en/setup)

### Codex CLI

- [Codex avec un forfait ChatGPT](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan)
- [Référence CLI : `--oss`, Ollama, LM Studio et MCP](https://learn.chatgpt.com/docs/developer-commands?surface=cli)
- [MCP dans Codex](https://learn.chatgpt.com/docs/extend/mcp)
- [Sous-agents Codex](https://learn.chatgpt.com/docs/agent-configuration/subagents)

### Aider

- [Fournisseurs et modèles locaux](https://aider.chat/docs/llms.html)
- [Utiliser un forfait GitHub Copilot](https://aider.chat/docs/llms/github.html)
- [Interface navigateur expérimentale](https://aider.chat/docs/usage/browser.html)
- [Index des fonctionnalités documentées](https://aider.chat/docs/)

### Gemini CLI

- [Authentification et forfaits Google AI](https://google-gemini.github.io/gemini-cli/docs/get-started/authentication.html)
- [Quotas et tarification](https://google-gemini.github.io/gemini-cli/docs/quota-and-pricing.html)
- [Client MCP](https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html)
- [Présentation terminal-first](https://google-gemini.github.io/gemini-cli/)
