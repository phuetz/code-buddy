# Rapport : Test End-to-End PWA Mobile

## Ce qui est prouvé
L'application PWA mobile est fonctionnelle de bout en bout, avec les comportements suivants démontrés par le test Playwright headless (`tests/e2e/mobile-pwa-e2e.test.ts`) :
- L'activation correcte du pont WebSocket d'approbation et du routage PWA sous le drapeau `CODEBUDDY_MOBILE_PWA=true`.
- La connexion par URL contenant un paramètre JWT (`/#token=...`) authentifie avec succès la PWA sans passage par l'écran de login.
- Le viewport mobile via l'appareil `Pixel 5` configuré dans Playwright permet de vérifier l'adéquation de la PWA aux contraintes mobiles.
- Le routage fonctionnel vers un sous-agent (`Agent`) au lieu du compagnon par défaut, garantissant que l'envoi de texte depuis le champ de saisie (`#message-input`) vers le serveur via WebSocket fonctionne sans accroc de protocole spécifique au compagnon, en utilisant un serveur factice Ollama.
- La réception de message depuis le serveur LLM factice (le fameux 'Stub Reply') fonctionne et s'affiche dans l'interface de conversation côté client avec la classe "assistant".
- La résilience de reconnexion au redémarrage : après une déconnexion inopinée (redémarrage du backend Code Buddy sur le même port), le client PWA identifie la perte de connexion (mise à jour de la présence à hors ligne ou reconnexion) et réussit à rétablir une connexion WebSocket fonctionnelle une fois le backend de retour, permettant l'envoi et la réception de nouveaux messages (vérifié par un 2e ping réussi sur le nouveau serveur).

### Sorties brutes du banc d'essai
```
Running 1 test using 1 worker

  ✓  1 tests/e2e/mobile-pwa-e2e.test.ts:86:3 › Mobile PWA E2E › authenticates, sends chat, receives reply, and reconnects (28.3s)

  1 passed (53.0s)
```

## Le mutant (Preuve d'exactitude de la vérification)
Si l'on modifie dans `src/server/mobile/assets/app.js` la logique de reconnexion en désactivant le délai ou en omettant l'appel à `connectWs` :
```javascript
<<<<<<< SEARCH
  function scheduleReconnect() {
    if (state.reconnectTimer || state.manualClose || !state.token) return;
    var delay = reconnectDelayMs();
    state.reconnectAttempt += 1;
    setPresence('reconnecting');
    state.reconnectTimer = setTimeout(function () {
      state.reconnectTimer = 0;
      connectWs();
    }, delay);
  }
=======
  function scheduleReconnect() {
    if (state.reconnectTimer || state.manualClose || !state.token) return;
    setPresence('reconnecting');
    // DISABLED RECONNECT
  }
>>>>>>> REPLACE
```
Le test échouera à la ligne :
```
await expect(page.locator('#presence-line')).toHaveText('en ligne', { timeout: 15000 });
```
ce qui prouve que le test capte bien et nécessite une reconnexion websocket fonctionnelle.

## Ce que je n'ai pas pu vérifier
- **Rendu visuel réel sur smartphone** : Playwright simule fidèlement le viewport d'un Pixel 5 et sa résolution d'écran, mais ne permet pas de vérifier l'ergonomie fine sur un terminal physique ou les limitations exactes de WebKit/Blink sur des composants d'UI natifs.
