# Comparaison honnête / Honest comparison

Code Buddy, Claude Code, Codex CLI, Aider et Gemini CLI sont tous capables de
modifier un dépôt et d'exécuter des commandes. Le bon choix dépend surtout du
modèle économique, du besoin de rester local et du niveau d'orchestration
souhaité.

Cette matrice a été vérifiée le **23 août 2026** à partir des documentations
officielles liées plus bas. Les offres et quotas changent : vérifiez les pages
tarifaires avant de choisir un abonnement.

## Matrice

Légende : ✅ natif ; ◐ partiel, séparé ou conditionnel ; ❌ non proposé
nativement dans la documentation publique. Un « non » décrit une capacité, pas
la qualité générale du produit.

| Critère                                          | Code Buddy                                                                | Claude Code                                                              | Codex CLI                                                             | Aider                                                                                       | Gemini CLI                                                            |
| :----------------------------------------------- | :------------------------------------------------------------------------ | :----------------------------------------------------------------------- | :-------------------------------------------------------------------- | :------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------- |
| Plusieurs fournisseurs de modèles                | ✅ 64 intégrations, routage et repli                                      | ❌ modèles Claude uniquement, avec plusieurs backends d'hébergement      | ◐ OpenAI, providers compatibles configurables et modèles locaux OSS   | ✅ nombreux fournisseurs via LiteLLM et APIs compatibles                                    | ❌ modèles Gemini via Google AI ou Vertex AI                          |
| Forfait existant, sans facture API marginale     | ✅ ChatGPT Plus/Pro et SuperGrok ; limites du forfait                     | ✅ Claude Pro, Max, Team ou Enterprise ; limites du forfait              | ✅ connexion ChatGPT ; limites du forfait                             | ◐ forfait GitHub Copilot possible ; les forfaits ChatGPT/Claude ne remplacent pas leurs API | ✅ compte Google gratuit ; quotas supérieurs avec Google AI Pro/Ultra |
| Inférence locale / hors ligne                    | ✅ Ollama et LM Studio                                                    | ❌ connexion réseau requise pour le modèle                               | ✅ `--oss` avec Ollama ou LM Studio                                   | ✅ Ollama, LM Studio et endpoints locaux compatibles                                        | ❌ le CLI appelle les services Gemini                                 |
| MCP                                              | ✅ client **et** serveur                                                  | ✅ client **et** serveur                                                 | ✅ client **et** serveur                                              | ❌ pas de prise en charge MCP native documentée                                             | ✅ client MCP                                                         |
| Fleet de pairs sur plusieurs machines et modèles | ✅ événements live, appels de modèles et outils distants en lecture seule | ❌ Agent Teams existe, mais ce n'est pas un mesh de pairs multi-provider | ❌ les sous-agents existent, mais pas un mesh de pairs multi-provider | ❌                                                                                          | ❌ un sous-agent d'exploration existe, pas une fleet réseau           |
| Interface graphique                              | ✅ Cowork, application Electron                                           | ✅ Claude Code Desktop sur macOS et Windows                              | ✅ application desktop séparée du CLI                                 | ◐ interface navigateur expérimentale                                                        | ❌ terminal-first                                                     |

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
- **Aider** si vous préférez un outil Git ciblé et léger, avec une très large
  compatibilité de modèles et une boucle d'édition éprouvée.
- **Gemini CLI** si vous cherchez le chemin terminal officiel vers Gemini, un
  quota Google généreux et un client MCP sans couche multi-provider.

## Ce que Code Buddy n'est pas

Code Buddy ne développe pas son propre modèle de fondation et ne fournit pas un
cloud managé mondial équivalent aux offres hébergées d'Anthropic, OpenAI ou
Google. Son périmètre plus large implique aussi davantage de configuration et
une communauté bien plus petite que celles des outils établis. Enfin, pouvoir
exécuter un modèle local à `$0` ne garantit ni la vitesse ni la qualité d'un
modèle frontier hébergé : cela dépend du matériel et du modèle choisis.

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
