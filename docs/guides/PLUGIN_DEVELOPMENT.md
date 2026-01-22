# Guide de Développement de Plugins

Code Buddy dispose d'un système de plugins dynamique puissant qui vous permet d'étendre ses fonctionnalités sans modifier le cœur de l'application. Ce guide vous expliquera comment créer vos propres plugins.

## 📚 Structure d'un Plugin

Les plugins sont chargés depuis le répertoire `.codebuddy/plugins/` (soit dans votre projet courant, soit dans votre répertoire personnel).

Chaque plugin doit avoir son propre dossier contenant au minimum deux fichiers :
1.  `manifest.json` : Les métadonnées du plugin.
2.  `index.js` (ou le fichier pointé par `main` dans le manifest) : Le code du plugin.

### Structure de fichiers recommandée

```text
.codebuddy/
  └── plugins/
      └── mon-super-plugin/
          ├── manifest.json
          ├── index.js
          ├── README.md       (optionnel)
          └── data/           (optionnel, pour vos données)
```

## 📝 Le Manifeste (`manifest.json`)

Ce fichier JSON décrit votre plugin.

```json
{
  "id": "mon-super-plugin",
  "name": "Mon Super Plugin",
  "version": "1.0.0",
  "description": "Ajoute des fonctionnalités incroyables à Code Buddy",
  "author": "Votre Nom",
  "permissions": {
    "shell": false,
    "network": true
  }
}
```

*   **id** : Identifiant unique (kebab-case recommandé). Doit correspondre au nom du dossier.
*   **name** : Nom d'affichage lisible.
*   **version** : Version semver.
*   **permissions** : (Futur) Permissions demandées par le plugin.

## 💻 Le Code du Plugin (`index.js`)

Votre plugin doit exporter par défaut une classe qui implémente l'interface `Plugin`.

```javascript
export default class MonPlugin {
  /**
   * Appelé lorsque le plugin est activé
   * @param {PluginContext} context - L'API pour interagir avec Code Buddy
   */
  activate(context) {
    context.logger.info('Mon plugin est activé !');
    
    // Votre code d'initialisation ici
  }

  /**
   * Appelé lorsque le plugin est désactivé ou que l'application s'arrête
   */
  deactivate() {
    console.log('Nettoyage...');
  }
}
```

## 🛠️ API du Plugin (`PluginContext`)

L'objet `context` passé à la méthode `activate` expose les fonctionnalités suivantes :

### 1. Logging (`context.logger`)
Un logger scopé à votre plugin. Utilisez-le au lieu de `console.log`.
```javascript
context.logger.info('Info message');
context.logger.warn('Attention');
context.logger.error('Erreur critique', errorObj);
context.logger.debug('Détails techniques');
```

### 2. Enregistrer une Commande (`context.registerCommand`)
Ajoute une nouvelle commande slash (ex: `/macommande`) accessible dans le chat.

```javascript
context.registerCommand({
  name: 'bonjour',
  description: 'Dit bonjour',
  prompt: 'Réponds "Bonjour !" à l\'utilisateur de manière enthousiaste.',
  // Optionnel : arguments
  arguments: [
    { name: 'nom', description: 'Nom de la personne', required: false }
  ]
});
```
L'utilisateur pourra taper `/bonjour` ou `/bonjour Patrice`. Le `prompt` sera envoyé au LLM. Vous pouvez utiliser `$1`, `$2` pour injecter les arguments dans le prompt.

### 3. Enregistrer un Outil (`context.registerTool`)
Ajoute un outil que le LLM peut appeler pour effectuer des actions (lire des fichiers, faire des requêtes, etc.).

```javascript
context.registerTool({
  name: 'get_weather',
  description: 'Récupère la météo pour une ville donnée',
  
  // Fonction factory qui retourne l'instance de l'outil
  factory: () => ({
    name: 'get_weather',
    description: 'Récupère la météo',
    execute: async ({ city }) => {
      // Logique de l'outil
      return {
        success: true,
        output: `Il fait beau à ${city} !`
      };
    }
  }),
  
  defaultPermission: 'always', // 'always' | 'ask' | 'never'
  readOnly: true // true si l'outil ne modifie pas l'état (permet l'exécution parallèle)
});
```

### 4. Configuration et Données
*   `context.config`: Accès à la configuration du plugin (non implémenté pour l'instant).
*   `context.dataDir`: Chemin vers un répertoire dédié où vous pouvez stocker des fichiers persistants.

## 🚀 Exemple Complet : "Hello World"

Voici l'exemple complet du plugin "Hello World" inclus par défaut pour les tests.

**`manifest.json`**
```json
{
  "id": "hello-world",
  "name": "Hello World Plugin",
  "version": "1.0.0",
  "description": "A simple plugin that adds a hello world command and tool"
}
```

**`index.js`**
```javascript
export default class HelloWorldPlugin {
  activate(context) {
    context.logger.info('Hello World plugin activated!');

    // 1. Commande Slash : /hello
    context.registerCommand({
      name: 'hello',
      description: 'Say hello',
      prompt: 'Say hello to the user in a friendly way.',
      filePath: '',
      isBuiltin: false
    });

    // 2. Outil : say_hello
    context.registerTool({
      name: 'say_hello',
      description: 'Returns a hello message',
      factory: () => ({
        name: 'say_hello',
        description: 'Returns a hello message',
        execute: async ({ name }) => {
          return {
            success: true,
            output: `Hello ${name || 'World'} from the plugin!`
          };
        }
      }),
      defaultPermission: 'always',
      defaultTimeout: 5,
      readOnly: true
    });
  }

  deactivate() {
    console.log('Hello World plugin deactivated');
  }
}
```

## 📦 Installation et Test

1.  Créez le dossier `.codebuddy/plugins/mon-plugin`.
2.  Ajoutez vos fichiers `manifest.json` et `index.js`.
3.  Lancez Code Buddy. Le plugin sera détecté et chargé automatiquement.
4.  Vérifiez son statut avec `/plugins status`.
5.  Testez vos commandes !

## ⚠️ Bonnes Pratiques

1.  **Isolation** : Ne modifiez pas les fichiers globaux ou le prototype des objets natifs.
2.  **Erreurs** : Gérez vos erreurs dans `activate` et `execute` pour ne pas faire planter l'application principale.
3.  **Performance** : Évitez les opérations bloquantes lourdes au démarrage (`activate`).
4.  **Nommage** : Préfixez vos outils et commandes pour éviter les conflits (ex: `git_status` vs `svn_status`).
