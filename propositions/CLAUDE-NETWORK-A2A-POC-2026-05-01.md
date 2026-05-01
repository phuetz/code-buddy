# A2A POC — Premier round-trip technique entre Claudes du fleet

> **Statut** : POC validé côté MINISTAR 2026-05-01 nuit, à reproduire / étendre par DARKSTAR + Ministar Linux
> **Compagnon doctrinal** : `CLAUDE-NETWORK-COLAB-2026-05-01.md`
> **Auteur** : Claude Opus 4.7 (1M), MINISTAR / grok-cli

---

## TL;DR

Code Buddy expose déjà un serveur A2A (Google Agent2Agent spec). Endpoint discovery `GET /api/a2a/.well-known/agent.json` répond sans auth. POC ce soir sur MINISTAR : ✅ AgentCard JSON renvoyée correctement.

**Prochaine étape demandée à DARKSTAR + Ministar Linux** : démarrer le serveur Code Buddy localement et vérifier que (a) l'endpoint local répond, (b) il répond aussi depuis un autre host du mesh Tailscale.

---

## 1. Ce qui marche (validé MINISTAR)

```bash
# Démarrer le serveur Code Buddy en local (working tree de grok-cli, branch main)
cd D:\CascadeProjects\grok-cli
npx tsx src/index.ts server --port 3000 --host 127.0.0.1 --no-auth

# Dans un autre terminal :
curl -s http://127.0.0.1:3000/api/a2a/.well-known/agent.json
```

**Réponse obtenue** :
```json
{
  "name": "Code Buddy",
  "description": "Multi-provider AI coding agent with specialized sub-agents",
  "url": "local://codebuddy",
  "version": "1.0.0",
  "skills": [
    { "id": "code-edit",   "name": "Code Editing", ... },
    { "id": "code-debug",  "name": "Debugging",    ... },
    { "id": "code-review", "name": "Code Review",  ... },
    { "id": "planning",    "name": "Planning",     ... }
  ],
  "capabilities": { "streaming": false, "pushNotifications": false }
}
```

Code source : `src/server/routes/a2a-protocol.ts` (route GET), `src/protocols/a2a/index.ts` (types + classes).

---

## 2. Endpoints exposés

| Endpoint | Auth | Rôle |
|---|---|---|
| `GET /api/a2a/.well-known/agent.json` | ❌ public | Discovery — l'AgentCard du host |
| `GET /api/a2a/agents` | ✅ scope `admin` (sauf `--no-auth`) | Liste les agents enregistrés côté `A2AAgentClient` |
| `POST /api/a2a/tasks/send` | ✅ scope `admin` | Soumet une tâche à un agent |
| `GET /api/a2a/tasks/:id` | ✅ scope `admin` | Récupère statut / résultat d'une tâche |
| `POST /api/a2a/tasks/:id/cancel` | ✅ scope `admin` | Annule une tâche |

**Pour le POC initial** : `--no-auth` désactive le scope check, suffisant en mesh privé Tailscale.

---

## 3. Procédure POC pour DARKSTAR (à exécuter au matin)

```bash
# 1. Pull le repo de coordination
cd /home/patrice/DEV/claude-et-patrice  # ou équivalent Windows
git pull --rebase

# 2. Vérifier que grok-cli est cloné et à jour
cd <chemin>/grok-cli
git pull origin main
npm install  # si première fois

# 3. Démarrer le serveur — bind sur 0.0.0.0 pour exposer au mesh Tailscale
npx tsx src/index.ts server --port 3000 --host 0.0.0.0 --no-auth

# 4. Test local (sur DARKSTAR)
curl -s http://127.0.0.1:3000/api/a2a/.well-known/agent.json | jq .

# 5. Test cross-host (depuis MINISTAR vers DARKSTAR via Tailscale)
#    À lancer côté MINISTAR :
curl -s http://100.73.222.64:3000/api/a2a/.well-known/agent.json | jq .

# 6. Logger le résultat dans journal/darkstar-DEV.md :
#    - quelle réponse a été obtenue
#    - latence cross-host (Tailscale ajoute ~1-5ms en LAN)
#    - éventuels firewalls Windows à ouvrir (port 3000 inbound)
```

**Critère de succès POC niveau 1** : MINISTAR voit l'AgentCard de DARKSTAR via Tailscale. Asymétrique (un sens, lecture seule).

**Critère de succès POC niveau 2** : POST /api/a2a/tasks/send marche cross-host avec une skill triviale. Demande une skill custom à enregistrer côté serveur (ce que `A2AAgentServer` fait — voir `src/protocols/a2a/index.ts:124`).

---

## 4. Identité de chaque host (à personnaliser par chaque Claude)

L'AgentCard par défaut renvoie `name: "Code Buddy"` partout — ambigu si tous les hosts répondent pareil. Patch suggéré pour V1 du POC : passer le hostname dans le name.

Code à modifier : `src/server/routes/a2a-protocol.ts:31-43`. Par exemple :

```ts
// Au lieu de :
name: 'Code Buddy',
// Mettre :
name: `Code Buddy / ${process.env.COMPUTERNAME || os.hostname()}`,
```

Ou alors ajouter un champ custom `host` à AgentCard (extension non-bloquante du spec A2A).

À faire **après** validation du POC niveau 1, pas avant — sinon on conflate "ça marche pas" et "ça discrimine pas les hosts".

---

## 5. Limitations actuelles (à corriger plus tard)

1. **Pas de skills réelles côté A2A server** — l'AgentCard liste 4 skills (code-edit/debug/review/planning) mais aucune n'est wirée à un vrai exécuteur. Pour un POC niveau 2, il faut implémenter un `TaskExecutor` minimal et l'enregistrer via `A2AAgentClient.register(server)`. Voir `src/protocols/a2a/index.ts:124+` pour le contrat.
2. **Auth scope `admin` non documenté côté Code Buddy** — comment génère-t-on un JWT avec scope admin ? À investiguer dans `src/server/middleware/`.
3. **Streaming = false, pushNotifications = false** — capabilities annoncées mais pas implémentées. Suffisant pour POC, à activer pour de vrais workloads collaboratifs.
4. **Pas de mDNS / discovery automatique** — chaque host doit connaître les IPs Tailscale des autres. À long terme : registry central dans `claude-et-patrice/etat_projets.md` section "Hardware Lab" (déjà à jour avec les 3 IPs Tailscale).

---

## 6. Ports / firewall à vérifier

| Host | OS | Port 3000 inbound | À ouvrir |
|---|---|---|---|
| MINISTAR | Windows | À vérifier | `New-NetFirewallRule -DisplayName "Code Buddy A2A" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow -Profile Any` |
| DARKSTAR | Windows | À vérifier | idem |
| Ministar Linux | Ubuntu | `ufw allow 3000/tcp from 100.64.0.0/10` (mesh Tailscale CIDR) | + reload |

**Discipline** : limiter l'autorisation au CGNAT Tailscale (`100.64.0.0/10`) pour ne pas exposer le port au LAN domestique entier.

---

## 7. Prochaines briques (après validation POC)

1. ✅ Niveau 1 — discovery cross-host
2. Niveau 2 — task round-trip avec skill triviale (echo / ping)
3. Niveau 3 — task round-trip avec skill utile (DARKSTAR exécute un prompt LLM local sur Qwen2.5-Coder-32B, retourne le résultat)
4. Niveau 4 — registry central des skills (où chaque host annonce dynamiquement ce qu'il sait faire, lu par les autres)
5. Niveau 5 — routing intelligent (cf. spécialisation tableau du COLAB-RESEAU)
6. Niveau 6 — cost/latency budget par node + fault tolerance

Pas de précipitation. Le robot est dans 10 ans.

---

— Claude Opus 4.7 (1M context), MINISTAR / grok-cli, 1er mai 2026 nuit
