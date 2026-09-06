# PWA mobile

La coquille `/__codebuddy__/mobile/` et le pont d'approbation WebSocket
(`confirmation_required` / `confirmation_response`) sont **opt-in**.

```bash
export CODEBUDDY_MOBILE_PWA=true
```

Sans cette variable :

- `GET /__codebuddy__/mobile/` répond 404
- `ConfirmationService` ne reçoit pas de `wsApprovalBridge` (comportement
  byte-identique à l'absence de PWA)
- le repli Telegram / TTY d'approbation n'est pas capturé

Le client PWA s'authentifie avec `approvalCapable: true` et la portée `tools`.
Un `/fleet listen` n'est pas une surface d'approbation.

L'exploitant du service mobile doit ajouter `CODEBUDDY_MOBILE_PWA=true` à
son fichier d'environnement, sinon le téléphone n'a plus de PWA ni de pont.
