# Import MCP Hermes / OpenClaw

`buddy mcp import <fichier.json|yaml> --from hermes|openclaw --dry-run` montre un plan assaini. Sans `--dry-run`, il écrit `.codebuddy/mcp.json` en mode0600, préserve les noms existants et ne démarre aucun serveur. `--output` choisit un autre fichier. La migration `buddy hermes claw migrate` normalise aussi les serveurs avant fusion dans les paramètres.

Les valeurs littérales sensibles des env/headers/arguments sont remplacées par `${MCP_IMPORT_...}` à fournir dans l’environnement Buddy. Les références existantes sont conservées. Une référence manquante fait échouer la connexion ; aucune tentative anonyme de repli. Les configurations OAuth ne sont pas transférées : serveur importé désactivé et action manuelle signalée. Cette garantie concerne le nouvel import MCP ; les archives des autres catégories du migrateur existant restent inchangées.

Les transports normalisés sont stdio (avec cwd), streamable_http et vrai SSE SDK. Une URL seule signifie streamable_http chez Hermes et SSE chez OpenClaw ; ces défauts sont vérifiés sur les sources épinglées release Hermes345cd2b et OpenClaw3a9d69d. Aucun repli HTTP→SSE automatique Hermes n’est émulé. Le type `sse_sdk` est un alias explicite de `sse`. L’ancien HTTP maison `/rpc` reste disponible sous `legacy_rpc`, ou sous `http` avec avertissement ; ce dernier n’est pas du MCP HTTP standard.

Les nouveaux imports stdio utilisent l’environnement minimal du SDK et les seules variables déclarées ; ils n’héritent pas de tous les secrets du processus Buddy. Cela ne constitue pas un sandbox du processus : un serveur stdio reste un programme choisi par l’opérateur. Les configurations stdio historiques gardent leur comportement d’environnement pour éviter une rupture implicite.

Les filtres portent sur les noms natifs avant préfixe `mcp__serveur__` : noms exacts et `*`, exclusions prioritaires. Les motifs fnmatch `?`/classes et les formes inconnues sont refusés. Un include Hermes vide interdit tous les outils ; un include OpenClaw vide reste non restrictif conformément à sa sémantique. L’outil exclu n’est ni découvert ni appelable directement par le manager.

Recette native : baseline d17a21cba échoue en SSE par POST /rpc→404 ; version corrigée ouvre le flux GET /sse, échange initialize/list/call via /messages et reçoit REAL_SSE_TOOL_OK. Serveurs SDK loopback SSE/StreamableHTTP, processus stdio réel, headers synthétiques, filtrage et mode0600 vérifiés. Ce sont des tests du protocole MCP et du format importé, pas une installation ou une preuve de fonctionnement universel des applications Hermes/OpenClaw. Aucun code concurrent copié ; fichiers de licence MIT consultés et sources exactes conservées avec empreintes dans le rapport.

Les URL résolues depuis l’environnement subissent les mêmes contrôles que les URL littérales : pas de credentials, query ou fragment. Aucun transport HTTP ne suit de redirection, y compris legacy_rpc.
