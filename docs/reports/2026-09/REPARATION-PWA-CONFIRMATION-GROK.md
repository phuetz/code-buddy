# REPARATION-PWA-CONFIRMATION-GROK — fermer A-1, B-1, B-2 du pont d'approbation WebSocket PWA

Date : 2026-09-06 (Europe/Paris)
Agent : Grok 4.6
Clone : `~/DEV/cb-secu-pwa-2026-09-06`
Branche : `fix/pwa-confirmation-2026-09-06`
HEAD au départ : `cd5f04650` (`docs(audit): relecture adverse de la release 05→06/09 (2 trous A, 7 trous B)`)
Original `~/code-buddy` : interdit
Vrai `~/.codebuddy` : interdit
Rapport créé **avant toute inspection** (ce fichier, commité).
HOME temporaire : `_qa/secu/home` (gitignoré). Aucune écriture dans le vrai `~/.codebuddy`.
Cahier : `docs/audits/2026-09-06-audit-release-opus.md` §A-1, §B-1, §B-2.

## Mission

Fermer trois trous du pont d'approbation WebSocket de la PWA mobile. Fail-closed. Un commit par point. Tests rouge avant, vert après.

1. **A-1** — `confirmation_response` accepté d'un client anonyme distant sous `--no-auth`. Étendre `WebSocketExtensionPrincipal` avec `anonymousRemote: boolean` ; refuser dans le pont comme `execute_tool`.
2. **B-2** — confirmation diffusée à tous, sans liaison. Portée `tools` obligatoire ; `scopeFilter` sur `confirmation_required` ; lier chaque id aux sockets destinataires ; le pont ne capture que si un destinataire `approvalCapable` est présent, sinon `null` → repli Telegram.
3. **B-1** — PWA + pont montés sans opt-in. Drapeau `CODEBUDDY_MOBILE_PWA=true` autour du montage HTTP et de `wsApprovalBridge`. Sans drapeau : 404, aucun pont, byte-identique.

## Garde-fous

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Vitest : `HOME=~/DEV/cb-secu-pwa-2026-09-06/_qa/secu/home` et `env -u FORCE_COLOR`.
- Ports de test ≥ 3600. ComfyUI 8188/8189 non touché.
- Jamais `/home/<user>` ni prénom ni secret dans les fichiers suivis.
- Chemins `~/…` uniquement.

## Exploitant (action humaine restante)

Le service mobile devra ajouter `CODEBUDDY_MOBILE_PWA=true` à son fichier d'environnement. Sans ce drapeau, la route `/__codebuddy__/mobile/` reste absente (404) et le pont d'approbation WebSocket n'est pas installé.

## Journal

### 2026-09-06 — création du rapport (avant inspection)

HEAD `cd5f04650`. Branche déjà extraite. Ce fichier est le premier artefact de la mission. L'audit et le code n'ont pas encore été lus.

## Bilan (à compléter)

- Fait :
- Prouvé :
- Ouvert :
