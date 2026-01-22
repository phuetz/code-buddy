/**
 * Error Formatter Module
 *
 * Structured error output with suggestions and documentation links.
 * Designed for accessibility and clear communication.
 *
 * Features:
 * - User-friendly error messages in plain language
 * - Actionable suggestions for each error type
 * - Readable stack trace formatting
 * - Quick actions for common fixes
 */

import { logger } from "../utils/logger.js";
import { EXIT_CODES, ExitCode, getExitCodeDescription } from "./exit-codes.js";

// ═══════════════════════════════════════════════════════════════════════════════
// SYSTEME DE CATEGORIES D'ERREURS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Categories d'erreurs pour une meilleure organisation et filtrage
 */
export enum ErrorCategory {
  API = "API",
  AUTHENTICATION = "AUTH",
  FILE_SYSTEM = "FS",
  GIT = "GIT",
  NETWORK = "NET",
  CONFIGURATION = "CONFIG",
  SECURITY = "SEC",
  RESOURCE = "RES",
  VALIDATION = "VAL",
  RUNTIME = "RUN",
  PLUGIN = "PLUGIN",
  MCP = "MCP",
  SESSION = "SESSION",
  UNKNOWN = "UNK",
}

/**
 * Severite des erreurs pour le tri et l'affichage
 */
export enum ErrorSeverity {
  /** Erreur critique - arret immediat */
  CRITICAL = "critical",
  /** Erreur bloquante - operation impossible */
  ERROR = "error",
  /** Avertissement - operation continue avec precautions */
  WARNING = "warning",
  /** Information - notification sans blocage */
  INFO = "info",
}

/**
 * Mapping des codes d'erreur vers leurs categories
 */
export const ERROR_CATEGORIES: Record<string, ErrorCategory> = {
  // API
  API_KEY_MISSING: ErrorCategory.AUTHENTICATION,
  API_KEY_INVALID: ErrorCategory.AUTHENTICATION,
  RATE_LIMITED: ErrorCategory.API,
  API_QUOTA_EXCEEDED: ErrorCategory.API,
  API_SERVER_ERROR: ErrorCategory.API,
  API_OVERLOADED: ErrorCategory.API,
  API_INVALID_RESPONSE: ErrorCategory.API,
  API_CONTENT_FILTERED: ErrorCategory.API,

  // Network
  NETWORK_ERROR: ErrorCategory.NETWORK,
  TIMEOUT: ErrorCategory.NETWORK,

  // File System
  FILE_NOT_FOUND: ErrorCategory.FILE_SYSTEM,
  PERMISSION_DENIED: ErrorCategory.FILE_SYSTEM,
  FILE_TOO_LARGE: ErrorCategory.FILE_SYSTEM,
  FILE_LOCKED: ErrorCategory.FILE_SYSTEM,
  FILE_ENCODING_ERROR: ErrorCategory.FILE_SYSTEM,
  DISK_FULL: ErrorCategory.FILE_SYSTEM,
  PATH_TRAVERSAL: ErrorCategory.SECURITY,

  // Git
  GIT_CONFLICT: ErrorCategory.GIT,
  GIT_NOT_INITIALIZED: ErrorCategory.GIT,
  GIT_UNCOMMITTED_CHANGES: ErrorCategory.GIT,
  GIT_BRANCH_EXISTS: ErrorCategory.GIT,
  GIT_PUSH_REJECTED: ErrorCategory.GIT,
  GIT_MERGE_FAILED: ErrorCategory.GIT,

  // Configuration
  CONFIG_INVALID: ErrorCategory.CONFIGURATION,
  MODEL_NOT_FOUND: ErrorCategory.CONFIGURATION,
  WORKSPACE_NOT_FOUND: ErrorCategory.CONFIGURATION,
  PROJECT_NOT_NODE: ErrorCategory.CONFIGURATION,

  // Security
  SANDBOX_VIOLATION: ErrorCategory.SECURITY,
  UNSAFE_COMMAND_BLOCKED: ErrorCategory.SECURITY,
  SECRETS_DETECTED: ErrorCategory.SECURITY,

  // Resources
  COST_LIMIT: ErrorCategory.RESOURCE,
  MEMORY_LIMIT: ErrorCategory.RESOURCE,
  CONTEXT_TOO_LARGE: ErrorCategory.RESOURCE,
  PROCESS_KILLED: ErrorCategory.RESOURCE,

  // Validation
  VALIDATION_ERROR: ErrorCategory.VALIDATION,
  JSON_PARSE_ERROR: ErrorCategory.VALIDATION,
  TYPESCRIPT_ERROR: ErrorCategory.VALIDATION,
  LINT_ERROR: ErrorCategory.VALIDATION,
  SCRIPT_SYNTAX_ERROR: ErrorCategory.VALIDATION,
  BUILD_FAILED: ErrorCategory.VALIDATION,

  // Runtime
  TOOL_FAILED: ErrorCategory.RUNTIME,
  COMMAND_NOT_FOUND: ErrorCategory.RUNTIME,
  DEPENDENCY_MISSING: ErrorCategory.RUNTIME,
  PACKAGE_INSTALL_FAILED: ErrorCategory.RUNTIME,

  // Plugins
  PLUGIN_NOT_FOUND: ErrorCategory.PLUGIN,
  PLUGIN_LOAD_ERROR: ErrorCategory.PLUGIN,
  PLUGIN_VERSION_MISMATCH: ErrorCategory.PLUGIN,

  // MCP
  MCP_CONNECTION_FAILED: ErrorCategory.MCP,

  // Session
  SESSION_EXPIRED: ErrorCategory.SESSION,
  CHECKPOINT_NOT_FOUND: ErrorCategory.SESSION,

  // Docker
  DOCKER_NOT_RUNNING: ErrorCategory.RUNTIME,
};

/**
 * Mapping des codes d'erreur vers leur severite
 */
export const ERROR_SEVERITIES: Record<string, ErrorSeverity> = {
  // Critical - arrêt immédiat requis
  API_KEY_MISSING: ErrorSeverity.CRITICAL,
  API_KEY_INVALID: ErrorSeverity.CRITICAL,
  DISK_FULL: ErrorSeverity.CRITICAL,
  MEMORY_LIMIT: ErrorSeverity.CRITICAL,

  // Error - opération impossible
  RATE_LIMITED: ErrorSeverity.ERROR,
  API_QUOTA_EXCEEDED: ErrorSeverity.ERROR,
  API_SERVER_ERROR: ErrorSeverity.ERROR,
  NETWORK_ERROR: ErrorSeverity.ERROR,
  TIMEOUT: ErrorSeverity.ERROR,
  FILE_NOT_FOUND: ErrorSeverity.ERROR,
  PERMISSION_DENIED: ErrorSeverity.ERROR,
  CONFIG_INVALID: ErrorSeverity.ERROR,
  GIT_CONFLICT: ErrorSeverity.ERROR,
  COST_LIMIT: ErrorSeverity.ERROR,
  CONTEXT_TOO_LARGE: ErrorSeverity.ERROR,
  SANDBOX_VIOLATION: ErrorSeverity.ERROR,
  BUILD_FAILED: ErrorSeverity.ERROR,

  // Warning - peut continuer avec précautions
  API_OVERLOADED: ErrorSeverity.WARNING,
  FILE_TOO_LARGE: ErrorSeverity.WARNING,
  FILE_LOCKED: ErrorSeverity.WARNING,
  GIT_UNCOMMITTED_CHANGES: ErrorSeverity.WARNING,
  SECRETS_DETECTED: ErrorSeverity.WARNING,
  PLUGIN_VERSION_MISMATCH: ErrorSeverity.WARNING,
  LINT_ERROR: ErrorSeverity.WARNING,

  // Info - notification simple
  GIT_BRANCH_EXISTS: ErrorSeverity.INFO,
  CHECKPOINT_NOT_FOUND: ErrorSeverity.INFO,
};

/**
 * Obtient la categorie d'une erreur par son code
 */
export function getErrorCategory(code: string): ErrorCategory {
  return ERROR_CATEGORIES[code] || ErrorCategory.UNKNOWN;
}

/**
 * Obtient la severite d'une erreur par son code
 */
export function getErrorSeverity(code: string): ErrorSeverity {
  return ERROR_SEVERITIES[code] || ErrorSeverity.ERROR;
}

/**
 * Quick action that can be executed to fix an error
 */
export interface QuickAction {
  /** Label describing the action */
  label: string;
  /** Command to run (for display purposes) */
  command?: string;
  /** Description of what the action does */
  description: string;
}

/**
 * Error context for structured output
 */
export interface ErrorContext {
  /** Error code identifier */
  code: string;

  /** Human-readable error message */
  message: string;

  /** Additional details about the error */
  details?: string;

  /** Actionable suggestion to fix the error */
  suggestion?: string;

  /** Link to documentation */
  docUrl?: string;

  /** Related error (cause) */
  cause?: Error;

  /** Exit code for CLI */
  exitCode?: ExitCode;

  /** Quick actions the user can take */
  quickActions?: QuickAction[];

  /** File path related to the error (for file errors) */
  filePath?: string;

  /** Whether to show the stack trace */
  showStackTrace?: boolean;
}

/**
 * Common error templates with user-friendly messages
 */
export const ERROR_TEMPLATES = {
  API_KEY_MISSING: {
    code: "API_KEY_MISSING",
    message: "La cle API n'est pas configuree",
    suggestion: "Configurez votre cle API pour utiliser Code Buddy",
    docUrl: "https://github.com/phuetz/code-buddy#configuration",
    exitCode: EXIT_CODES.AUTHENTICATION_ERROR,
    quickActions: [
      {
        label: "Configurer la cle API",
        command: "grok config --set-api-key VOTRE_CLE",
        description: "Configure la cle API de maniere interactive",
      },
      {
        label: "Utiliser une variable d'environnement",
        command: "export GROK_API_KEY=votre_cle",
        description: "Definit la cle via l'environnement",
      },
    ],
  },

  API_KEY_INVALID: {
    code: "API_KEY_INVALID",
    message: "La cle API est invalide ou a expire",
    suggestion: "Verifiez que votre cle API est correcte et active sur console.x.ai",
    docUrl: "https://github.com/phuetz/code-buddy#configuration",
    exitCode: EXIT_CODES.AUTHENTICATION_ERROR,
    quickActions: [
      {
        label: "Verifier la cle sur x.ai",
        command: "open https://console.x.ai/api-keys",
        description: "Ouvre la console xAI pour verifier votre cle",
      },
      {
        label: "Mettre a jour la cle",
        command: "grok config --set-api-key",
        description: "Configure une nouvelle cle API",
      },
    ],
  },

  RATE_LIMITED: {
    code: "RATE_LIMITED",
    message: "Limite de requetes API atteinte",
    suggestion: "L'API a recu trop de requetes. Attendez quelques minutes avant de reessayer.",
    exitCode: EXIT_CODES.API_ERROR,
    quickActions: [
      {
        label: "Attendre et reessayer",
        description: "Patientez 1-2 minutes puis relancez votre commande",
      },
      {
        label: "Verifier votre forfait",
        command: "open https://console.x.ai/billing",
        description: "Consultez et augmentez eventuellement votre limite",
      },
    ],
  },

  NETWORK_ERROR: {
    code: "NETWORK_ERROR",
    message: "Connexion a l'API echouee",
    suggestion: "Verifiez votre connexion internet et que l'API est accessible",
    exitCode: EXIT_CODES.NETWORK_ERROR,
    quickActions: [
      {
        label: "Verifier la connexion",
        command: "ping api.x.ai",
        description: "Teste la connectivite reseau vers l'API",
      },
      {
        label: "Verifier le proxy",
        description: "Assurez-vous que votre proxy/VPN n'interfere pas",
      },
    ],
  },

  TIMEOUT: {
    code: "TIMEOUT",
    message: "La requete a expire (timeout)",
    suggestion: "Le serveur met trop de temps a repondre. Essayez avec une demande plus simple.",
    exitCode: EXIT_CODES.TIMEOUT,
    quickActions: [
      {
        label: "Reessayer",
        description: "Relancez la meme commande",
      },
      {
        label: "Simplifier la requete",
        description: "Divisez votre demande en parties plus petites",
      },
      {
        label: "Augmenter le timeout",
        command: "export GROK_TIMEOUT=120000",
        description: "Augmente le delai d'attente a 2 minutes",
      },
    ],
  },

  FILE_NOT_FOUND: {
    code: "FILE_NOT_FOUND",
    message: "Fichier ou dossier introuvable",
    suggestion: "Le chemin specifie n'existe pas. Verifiez l'orthographe et le chemin.",
    exitCode: EXIT_CODES.FILE_NOT_FOUND,
    quickActions: [
      {
        label: "Lister les fichiers",
        command: "ls -la",
        description: "Affiche les fichiers du repertoire courant",
      },
      {
        label: "Rechercher le fichier",
        command: "find . -name 'nom_fichier'",
        description: "Recherche le fichier dans le projet",
      },
      {
        label: "Creer le fichier",
        description: "Voulez-vous creer ce fichier?",
      },
    ],
  },

  PERMISSION_DENIED: {
    code: "PERMISSION_DENIED",
    message: "Permission refusee",
    suggestion: "Vous n'avez pas les droits necessaires pour cette operation",
    exitCode: EXIT_CODES.PERMISSION_DENIED,
    quickActions: [
      {
        label: "Verifier les permissions",
        command: "ls -la chemin/fichier",
        description: "Affiche les permissions du fichier",
      },
      {
        label: "Modifier les permissions",
        command: "chmod u+rw chemin/fichier",
        description: "Ajoute les droits de lecture/ecriture",
      },
      {
        label: "Executer en sudo",
        command: "sudo grok ...",
        description: "Execute avec les privileges administrateur (attention!)",
      },
    ],
  },

  COST_LIMIT: {
    code: "COST_LIMIT",
    message: "Limite de cout de session atteinte",
    suggestion: "La session a atteint le plafond de depenses configure pour eviter les surprises",
    docUrl: "https://github.com/phuetz/code-buddy#cost-management",
    exitCode: EXIT_CODES.COST_LIMIT_EXCEEDED,
    quickActions: [
      {
        label: "Augmenter la limite",
        command: "export MAX_COST=20",
        description: "Augmente la limite a $20 pour cette session",
      },
      {
        label: "Nouvelle session",
        command: "grok",
        description: "Demarre une nouvelle session avec le budget remis a zero",
      },
      {
        label: "Voir les couts",
        command: "/cost",
        description: "Affiche le detail des couts de la session",
      },
    ],
  },

  MODEL_NOT_FOUND: {
    code: "MODEL_NOT_FOUND",
    message: "Modele non disponible",
    suggestion: "Le modele demande n'existe pas ou n'est pas accessible avec votre cle API",
    exitCode: EXIT_CODES.MODEL_NOT_AVAILABLE,
    quickActions: [
      {
        label: "Voir les modeles disponibles",
        command: "/model",
        description: "Liste tous les modeles accessibles",
      },
      {
        label: "Utiliser le modele par defaut",
        command: "grok config --reset-model",
        description: "Revient au modele par defaut",
      },
    ],
  },

  CONFIG_INVALID: {
    code: "CONFIG_INVALID",
    message: "Fichier de configuration invalide",
    suggestion: "Le fichier de configuration contient des erreurs de syntaxe ou de format",
    docUrl: "https://github.com/phuetz/code-buddy#configuration",
    exitCode: EXIT_CODES.CONFIG_ERROR,
    quickActions: [
      {
        label: "Voir la configuration",
        command: "grok config --show",
        description: "Affiche la configuration actuelle",
      },
      {
        label: "Reinitialiser la config",
        command: "grok config --reset",
        description: "Remet la configuration par defaut",
      },
      {
        label: "Editer manuellement",
        command: "code ~/.config/grok/config.json",
        description: "Ouvre le fichier de configuration dans l'editeur",
      },
    ],
  },

  MCP_CONNECTION_FAILED: {
    code: "MCP_CONNECTION_FAILED",
    message: "Connexion au serveur MCP echouee",
    suggestion: "Le serveur MCP ne repond pas. Verifiez qu'il est demarre et configure correctement.",
    docUrl: "https://github.com/phuetz/code-buddy#mcp-servers",
    exitCode: EXIT_CODES.MCP_ERROR,
    quickActions: [
      {
        label: "Verifier les serveurs MCP",
        command: "/mcp status",
        description: "Affiche l'etat des serveurs MCP configures",
      },
      {
        label: "Redemarrer le serveur",
        command: "/mcp restart",
        description: "Tente de redemarrer le serveur MCP",
      },
      {
        label: "Voir la configuration MCP",
        command: "cat ~/.config/grok/mcp.json",
        description: "Affiche la configuration des serveurs MCP",
      },
    ],
  },

  TOOL_FAILED: {
    code: "TOOL_FAILED",
    message: "L'execution de l'outil a echoue",
    suggestion: "L'outil n'a pas pu s'executer correctement. Verifiez les parametres.",
    exitCode: EXIT_CODES.TOOL_EXECUTION_FAILED,
    quickActions: [
      {
        label: "Voir l'aide de l'outil",
        command: "/tools",
        description: "Liste les outils disponibles et leur usage",
      },
      {
        label: "Reessayer",
        description: "Relancez avec des parametres differents",
      },
    ],
  },

  PATH_TRAVERSAL: {
    code: "PATH_TRAVERSAL",
    message: "Acces bloque: tentative de sortie du repertoire projet",
    suggestion: "Pour des raisons de securite, les chemins doivent rester dans le projet",
    exitCode: EXIT_CODES.SECURITY_ERROR,
    quickActions: [
      {
        label: "Utiliser un chemin relatif",
        description: "Utilisez des chemins relatifs au projet (ex: ./src/fichier.ts)",
      },
      {
        label: "Changer de repertoire de travail",
        command: "cd /chemin/vers/projet && grok",
        description: "Lancez grok depuis le repertoire souhaite",
      },
    ],
  },

  VALIDATION_ERROR: {
    code: "VALIDATION_ERROR",
    message: "Donnees invalides",
    suggestion: "Les donnees fournies ne respectent pas le format attendu",
    exitCode: EXIT_CODES.VALIDATION_ERROR,
    quickActions: [
      {
        label: "Voir le format attendu",
        description: "Consultez la documentation pour le format correct",
      },
    ],
  },

  SESSION_EXPIRED: {
    code: "SESSION_EXPIRED",
    message: "La session a expire",
    suggestion: "Votre session n'est plus active. Demarrez une nouvelle session.",
    exitCode: EXIT_CODES.SESSION_ERROR,
    quickActions: [
      {
        label: "Nouvelle session",
        command: "grok",
        description: "Demarre une nouvelle session interactive",
      },
      {
        label: "Reprendre une session",
        command: "grok --resume",
        description: "Tente de reprendre la derniere session",
      },
    ],
  },

  CHECKPOINT_NOT_FOUND: {
    code: "CHECKPOINT_NOT_FOUND",
    message: "Point de restauration introuvable",
    suggestion: "Le checkpoint demande n'existe pas ou a ete supprime",
    exitCode: EXIT_CODES.CHECKPOINT_ERROR,
    quickActions: [
      {
        label: "Voir les checkpoints",
        command: "/checkpoints",
        description: "Liste tous les points de restauration disponibles",
      },
      {
        label: "Creer un checkpoint",
        command: "/checkpoint create",
        description: "Cree un nouveau point de restauration",
      },
    ],
  },

  MEMORY_LIMIT: {
    code: "MEMORY_LIMIT",
    message: "Limite de memoire atteinte",
    suggestion: "L'operation utilise trop de memoire. Essayez avec moins de donnees.",
    exitCode: EXIT_CODES.RESOURCE_ERROR,
    quickActions: [
      {
        label: "Traiter par lots",
        description: "Divisez l'operation en parties plus petites",
      },
      {
        label: "Fermer d'autres applications",
        description: "Liberez de la memoire en fermant d'autres programmes",
      },
      {
        label: "Augmenter la limite Node.js",
        command: "export NODE_OPTIONS='--max-old-space-size=4096'",
        description: "Augmente la memoire disponible pour Node.js",
      },
    ],
  },

  DEPENDENCY_MISSING: {
    code: "DEPENDENCY_MISSING",
    message: "Dependance manquante",
    suggestion: "Une bibliotheque requise n'est pas installee",
    exitCode: EXIT_CODES.DEPENDENCY_ERROR,
    quickActions: [
      {
        label: "Installer les dependances",
        command: "npm install",
        description: "Installe toutes les dependances du projet",
      },
      {
        label: "Reinstaller",
        command: "rm -rf node_modules && npm install",
        description: "Reinstallation complete des dependances",
      },
    ],
  },

  SANDBOX_VIOLATION: {
    code: "SANDBOX_VIOLATION",
    message: "Operation bloquee par le mode securise",
    suggestion: "Cette commande necessite des permissions supplementaires pour s'executer",
    docUrl: "https://github.com/phuetz/code-buddy#security-modes",
    exitCode: EXIT_CODES.SECURITY_ERROR,
    quickActions: [
      {
        label: "Autoriser cette fois",
        description: "Approuvez l'operation lorsque demande",
      },
      {
        label: "Passer en mode auto-edit",
        command: "/security auto-edit",
        description: "Autorise les modifications de fichiers sans confirmation",
      },
      {
        label: "Mode full-auto (attention!)",
        command: "/security full-auto",
        description: "Desactive toutes les confirmations - utilisez avec precaution",
      },
    ],
  },

  CONTEXT_TOO_LARGE: {
    code: "CONTEXT_TOO_LARGE",
    message: "Contexte trop volumineux",
    suggestion: "Le contexte depasse la capacite du modele. Reduisez la quantite de donnees.",
    exitCode: EXIT_CODES.CONTEXT_ERROR,
    quickActions: [
      {
        label: "Compacter le contexte",
        command: "/compact",
        description: "Resume et compresse le contexte de conversation",
      },
      {
        label: "Nouvelle conversation",
        command: "/clear",
        description: "Demarre une nouvelle conversation sans historique",
      },
      {
        label: "Exclure des fichiers",
        description: "Specifiez moins de fichiers dans votre demande",
      },
    ],
  },

  GIT_CONFLICT: {
    code: "GIT_CONFLICT",
    message: "Conflit Git detecte",
    suggestion: "Des conflits empechent l'operation Git. Resolvez-les avant de continuer.",
    exitCode: EXIT_CODES.TOOL_EXECUTION_FAILED,
    quickActions: [
      {
        label: "Voir les conflits",
        command: "git status",
        description: "Liste les fichiers en conflit",
      },
      {
        label: "Annuler l'operation",
        command: "git merge --abort",
        description: "Annule le merge en cours",
      },
    ],
  },

  DOCKER_NOT_RUNNING: {
    code: "DOCKER_NOT_RUNNING",
    message: "Docker n'est pas disponible",
    suggestion: "Le daemon Docker n'est pas demarre ou n'est pas installe",
    exitCode: EXIT_CODES.DEPENDENCY_ERROR,
    quickActions: [
      {
        label: "Demarrer Docker",
        command: "sudo systemctl start docker",
        description: "Demarre le service Docker",
      },
      {
        label: "Verifier Docker",
        command: "docker info",
        description: "Affiche les informations Docker",
      },
    ],
  },

  JSON_PARSE_ERROR: {
    code: "JSON_PARSE_ERROR",
    message: "Erreur de parsing JSON",
    suggestion: "Le fichier JSON contient des erreurs de syntaxe",
    exitCode: EXIT_CODES.VALIDATION_ERROR,
    quickActions: [
      {
        label: "Valider le JSON",
        command: "cat fichier.json | jq .",
        description: "Verifie et formate le JSON",
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ERREURS API AVANCEES
  // ═══════════════════════════════════════════════════════════════════════════

  API_QUOTA_EXCEEDED: {
    code: "API_QUOTA_EXCEEDED",
    message: "Quota API mensuel depasse",
    suggestion: "Votre forfait API a atteint sa limite mensuelle. Attendez le renouvellement ou passez au forfait superieur.",
    docUrl: "https://console.x.ai/billing",
    exitCode: EXIT_CODES.API_ERROR,
    quickActions: [
      {
        label: "Voir votre consommation",
        command: "open https://console.x.ai/usage",
        description: "Consulte les statistiques d'utilisation de votre compte",
      },
      {
        label: "Mettre a niveau le forfait",
        command: "open https://console.x.ai/billing/upgrade",
        description: "Augmente votre limite mensuelle",
      },
      {
        label: "Utiliser un modele plus economique",
        command: "/model grok-2-mini",
        description: "Le modele mini consomme moins de quota",
      },
    ],
  },

  API_SERVER_ERROR: {
    code: "API_SERVER_ERROR",
    message: "Erreur interne du serveur API (5xx)",
    suggestion: "Le serveur xAI rencontre des problemes temporaires. Ce n'est pas de votre faute!",
    exitCode: EXIT_CODES.API_ERROR,
    quickActions: [
      {
        label: "Verifier le statut xAI",
        command: "open https://status.x.ai",
        description: "Consulte l'etat des services xAI",
      },
      {
        label: "Reessayer dans quelques minutes",
        description: "Les erreurs serveur sont generalement temporaires",
      },
      {
        label: "Utiliser un endpoint alternatif",
        command: "export GROK_BASE_URL=https://api.x.ai/v2",
        description: "Tente d'utiliser un endpoint de secours",
      },
    ],
  },

  API_OVERLOADED: {
    code: "API_OVERLOADED",
    message: "API surchargee (503)",
    suggestion: "L'API est momentanement surchargee. Reessayez dans quelques instants.",
    exitCode: EXIT_CODES.API_ERROR,
    quickActions: [
      {
        label: "Attendre et reessayer",
        description: "Patientez 30 secondes puis relancez",
      },
      {
        label: "Activer le mode retry automatique",
        command: "export GROK_AUTO_RETRY=true",
        description: "Active les tentatives automatiques avec backoff",
      },
    ],
  },

  API_INVALID_RESPONSE: {
    code: "API_INVALID_RESPONSE",
    message: "Reponse API invalide ou corrompue",
    suggestion: "L'API a renvoye une reponse inattendue. Cela peut indiquer un probleme temporaire.",
    exitCode: EXIT_CODES.API_ERROR,
    quickActions: [
      {
        label: "Reessayer la requete",
        description: "Relancez votre demande",
      },
      {
        label: "Verifier les logs",
        command: "cat ~/.config/grok/logs/latest.log | tail -50",
        description: "Examine les logs recents pour plus de details",
      },
      {
        label: "Signaler le probleme",
        command: "open https://github.com/phuetz/code-buddy/issues/new",
        description: "Creez un rapport de bug si le probleme persiste",
      },
    ],
  },

  API_CONTENT_FILTERED: {
    code: "API_CONTENT_FILTERED",
    message: "Contenu filtre par la moderation",
    suggestion: "Votre demande a ete bloquee par les filtres de securite de l'API.",
    exitCode: EXIT_CODES.API_ERROR,
    quickActions: [
      {
        label: "Reformuler la demande",
        description: "Essayez de formuler votre requete differemment",
      },
      {
        label: "Diviser la requete",
        description: "Si vous traitez un fichier, divisez-le en parties plus petites",
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ERREURS TYPESCRIPT / COMPILATION
  // ═══════════════════════════════════════════════════════════════════════════

  TYPESCRIPT_ERROR: {
    code: "TYPESCRIPT_ERROR",
    message: "Erreur de compilation TypeScript",
    suggestion: "Le code contient des erreurs TypeScript qui empechent la compilation.",
    exitCode: EXIT_CODES.VALIDATION_ERROR,
    quickActions: [
      {
        label: "Voir les erreurs detaillees",
        command: "npm run typecheck",
        description: "Lance la verification de types",
      },
      {
        label: "Corriger automatiquement",
        description: "Demandez a Code Buddy de corriger les erreurs TypeScript",
      },
      {
        label: "Ignorer temporairement",
        command: "// @ts-ignore",
        description: "Ajoute un commentaire pour ignorer l'erreur (deconseille)",
      },
    ],
  },

  BUILD_FAILED: {
    code: "BUILD_FAILED",
    message: "Echec de la compilation du projet",
    suggestion: "Le build a echoue. Verifiez les erreurs ci-dessus et corrigez-les.",
    exitCode: EXIT_CODES.TOOL_EXECUTION_FAILED,
    quickActions: [
      {
        label: "Voir le build verbose",
        command: "npm run build -- --verbose",
        description: "Affiche plus de details sur l'echec",
      },
      {
        label: "Nettoyer et rebuilder",
        command: "rm -rf dist && npm run build",
        description: "Supprime le cache et rebuild",
      },
      {
        label: "Verifier les dependances",
        command: "npm ls",
        description: "Liste les dependances et leurs versions",
      },
    ],
  },

  LINT_ERROR: {
    code: "LINT_ERROR",
    message: "Erreurs de linting detectees",
    suggestion: "Le code ne respecte pas les regles de style configurees.",
    exitCode: EXIT_CODES.VALIDATION_ERROR,
    quickActions: [
      {
        label: "Corriger automatiquement",
        command: "npm run lint -- --fix",
        description: "Corrige automatiquement les erreurs corrigeables",
      },
      {
        label: "Voir les regles violees",
        command: "npm run lint",
        description: "Affiche toutes les erreurs de linting",
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ERREURS GIT AVANCEES
  // ═══════════════════════════════════════════════════════════════════════════

  GIT_NOT_INITIALIZED: {
    code: "GIT_NOT_INITIALIZED",
    message: "Ce repertoire n'est pas un depot Git",
    suggestion: "Initialisez Git ou naviguez vers un repertoire contenant un projet Git.",
    exitCode: EXIT_CODES.TOOL_EXECUTION_FAILED,
    quickActions: [
      {
        label: "Initialiser Git",
        command: "git init",
        description: "Cree un nouveau depot Git dans ce repertoire",
      },
      {
        label: "Cloner un depot",
        command: "git clone <url>",
        description: "Clone un depot existant",
      },
    ],
  },

  GIT_UNCOMMITTED_CHANGES: {
    code: "GIT_UNCOMMITTED_CHANGES",
    message: "Modifications non commitees detectees",
    suggestion: "Vous avez des changements locaux. Commitez ou stashez-les avant de continuer.",
    exitCode: EXIT_CODES.TOOL_EXECUTION_FAILED,
    quickActions: [
      {
        label: "Voir les changements",
        command: "git status",
        description: "Affiche les fichiers modifies",
      },
      {
        label: "Stasher temporairement",
        command: "git stash",
        description: "Met de cote les changements temporairement",
      },
      {
        label: "Commiter les changements",
        command: "git add -A && git commit -m 'WIP'",
        description: "Sauvegarde les changements dans un commit",
      },
    ],
  },

  GIT_BRANCH_EXISTS: {
    code: "GIT_BRANCH_EXISTS",
    message: "La branche existe deja",
    suggestion: "Une branche avec ce nom existe deja. Choisissez un autre nom ou supprimez l'existante.",
    exitCode: EXIT_CODES.TOOL_EXECUTION_FAILED,
    quickActions: [
      {
        label: "Lister les branches",
        command: "git branch -a",
        description: "Affiche toutes les branches",
      },
      {
        label: "Basculer sur la branche",
        command: "git checkout nom-branche",
        description: "Bascule sur la branche existante",
      },
      {
        label: "Supprimer la branche",
        command: "git branch -d nom-branche",
        description: "Supprime la branche (attention!)",
      },
    ],
  },

  GIT_PUSH_REJECTED: {
    code: "GIT_PUSH_REJECTED",
    message: "Push rejete par le serveur distant",
    suggestion: "Le serveur a rejete votre push. Cela arrive souvent quand la branche distante a des commits que vous n'avez pas.",
    exitCode: EXIT_CODES.TOOL_EXECUTION_FAILED,
    quickActions: [
      {
        label: "Pull puis push",
        command: "git pull --rebase && git push",
        description: "Integre les changements distants puis pousse",
      },
      {
        label: "Voir les differences",
        command: "git fetch && git log HEAD..origin/main",
        description: "Compare votre branche avec la distante",
      },
    ],
  },

  GIT_MERGE_FAILED: {
    code: "GIT_MERGE_FAILED",
    message: "Echec du merge",
    suggestion: "Le merge automatique a echoue. Des conflits necessitent une resolution manuelle.",
    exitCode: EXIT_CODES.TOOL_EXECUTION_FAILED,
    quickActions: [
      {
        label: "Voir les fichiers en conflit",
        command: "git diff --name-only --diff-filter=U",
        description: "Liste les fichiers avec conflits",
      },
      {
        label: "Annuler le merge",
        command: "git merge --abort",
        description: "Revient a l'etat avant le merge",
      },
      {
        label: "Resoudre avec l'editeur",
        description: "Ouvrez les fichiers en conflit et resolvez manuellement",
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ERREURS WORKSPACE / PROJET
  // ═══════════════════════════════════════════════════════════════════════════

  WORKSPACE_NOT_FOUND: {
    code: "WORKSPACE_NOT_FOUND",
    message: "Workspace introuvable",
    suggestion: "Le workspace specifie n'existe pas ou n'est plus accessible.",
    exitCode: EXIT_CODES.FILE_NOT_FOUND,
    quickActions: [
      {
        label: "Lister les workspaces",
        command: "/workspace list",
        description: "Affiche tous les workspaces disponibles",
      },
      {
        label: "Creer un workspace",
        command: "/workspace create nom",
        description: "Cree un nouveau workspace",
      },
    ],
  },

  PROJECT_NOT_NODE: {
    code: "PROJECT_NOT_NODE",
    message: "Ce n'est pas un projet Node.js",
    suggestion: "Aucun fichier package.json trouve. Initialisez un projet Node.js ou naviguez vers un projet existant.",
    exitCode: EXIT_CODES.VALIDATION_ERROR,
    quickActions: [
      {
        label: "Initialiser npm",
        command: "npm init -y",
        description: "Cree un package.json minimal",
      },
      {
        label: "Chercher package.json",
        command: "find . -name 'package.json' -not -path '*/node_modules/*'",
        description: "Recherche un package.json dans les sous-dossiers",
      },
    ],
  },

  PACKAGE_INSTALL_FAILED: {
    code: "PACKAGE_INSTALL_FAILED",
    message: "Echec de l'installation des packages",
    suggestion: "npm install a echoue. Verifiez votre connexion et les erreurs ci-dessus.",
    exitCode: EXIT_CODES.DEPENDENCY_ERROR,
    quickActions: [
      {
        label: "Nettoyer le cache npm",
        command: "npm cache clean --force",
        description: "Vide le cache npm qui peut etre corrompu",
      },
      {
        label: "Supprimer node_modules",
        command: "rm -rf node_modules package-lock.json && npm install",
        description: "Reinstallation complete depuis zero",
      },
      {
        label: "Verifier le registre npm",
        command: "npm config get registry",
        description: "S'assure que le registre npm est accessible",
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ERREURS FICHIERS AVANCEES
  // ═══════════════════════════════════════════════════════════════════════════

  FILE_TOO_LARGE: {
    code: "FILE_TOO_LARGE",
    message: "Fichier trop volumineux",
    suggestion: "Le fichier depasse la taille maximale supportee pour cette operation.",
    exitCode: EXIT_CODES.RESOURCE_ERROR,
    quickActions: [
      {
        label: "Voir la taille",
        command: "ls -lh fichier",
        description: "Affiche la taille du fichier",
      },
      {
        label: "Traiter par parties",
        description: "Divisez le fichier en parties plus petites",
      },
      {
        label: "Compresser d'abord",
        command: "gzip fichier",
        description: "Compresse le fichier avant traitement",
      },
    ],
  },

  FILE_LOCKED: {
    code: "FILE_LOCKED",
    message: "Fichier verrouille par un autre processus",
    suggestion: "Un autre programme utilise ce fichier. Fermez-le ou attendez qu'il soit libere.",
    exitCode: EXIT_CODES.PERMISSION_DENIED,
    quickActions: [
      {
        label: "Trouver le processus",
        command: "lsof fichier",
        description: "Identifie quel processus verrouille le fichier",
      },
      {
        label: "Attendre et reessayer",
        description: "Patientez quelques secondes puis relancez",
      },
    ],
  },

  FILE_ENCODING_ERROR: {
    code: "FILE_ENCODING_ERROR",
    message: "Erreur d'encodage du fichier",
    suggestion: "Le fichier n'est pas en UTF-8 ou contient des caracteres invalides.",
    exitCode: EXIT_CODES.VALIDATION_ERROR,
    quickActions: [
      {
        label: "Detecter l'encodage",
        command: "file -i fichier",
        description: "Identifie l'encodage actuel du fichier",
      },
      {
        label: "Convertir en UTF-8",
        command: "iconv -f ENCODAGE_SOURCE -t UTF-8 fichier > fichier.utf8",
        description: "Convertit le fichier en UTF-8",
      },
    ],
  },

  DISK_FULL: {
    code: "DISK_FULL",
    message: "Espace disque insuffisant",
    suggestion: "Le disque est plein ou n'a pas assez d'espace pour cette operation.",
    exitCode: EXIT_CODES.RESOURCE_ERROR,
    quickActions: [
      {
        label: "Voir l'espace disque",
        command: "df -h",
        description: "Affiche l'utilisation de l'espace disque",
      },
      {
        label: "Trouver les gros fichiers",
        command: "du -sh * | sort -rh | head -20",
        description: "Liste les 20 plus gros elements",
      },
      {
        label: "Vider le cache npm",
        command: "npm cache clean --force",
        description: "Libere l'espace utilise par le cache npm",
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ERREURS SECURITE
  // ═══════════════════════════════════════════════════════════════════════════

  UNSAFE_COMMAND_BLOCKED: {
    code: "UNSAFE_COMMAND_BLOCKED",
    message: "Commande potentiellement dangereuse bloquee",
    suggestion: "Cette commande a ete bloquee car elle pourrait causer des dommages irreversibles.",
    docUrl: "https://github.com/phuetz/code-buddy#security-modes",
    exitCode: EXIT_CODES.SECURITY_ERROR,
    quickActions: [
      {
        label: "Comprendre le risque",
        description: "La commande pourrait supprimer des fichiers ou modifier le systeme",
      },
      {
        label: "Executer manuellement",
        description: "Si vous etes sur, executez la commande directement dans votre terminal",
      },
      {
        label: "Activer YOLO mode",
        command: "/yolo on",
        description: "Desactive les protections (utilisez avec precaution!)",
      },
    ],
  },

  SECRETS_DETECTED: {
    code: "SECRETS_DETECTED",
    message: "Secrets ou credentials detectes dans le code",
    suggestion: "Des cles API, mots de passe ou tokens semblent etre presents dans le code.",
    exitCode: EXIT_CODES.SECURITY_ERROR,
    quickActions: [
      {
        label: "Scanner les secrets",
        command: "git secrets --scan",
        description: "Recherche les secrets dans le code",
      },
      {
        label: "Utiliser des variables d'env",
        description: "Deplacez les secrets vers des variables d'environnement",
      },
      {
        label: "Ajouter au .gitignore",
        command: "echo 'fichier_secret' >> .gitignore",
        description: "Exclut le fichier du depot Git",
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ERREURS EXECUTION / RUNTIME
  // ═══════════════════════════════════════════════════════════════════════════

  PROCESS_KILLED: {
    code: "PROCESS_KILLED",
    message: "Processus termine de force",
    suggestion: "Le processus a ete tue, probablement par manque de memoire ou timeout.",
    exitCode: EXIT_CODES.RESOURCE_ERROR,
    quickActions: [
      {
        label: "Verifier la memoire",
        command: "free -h",
        description: "Affiche la memoire disponible",
      },
      {
        label: "Augmenter la memoire Node.js",
        command: "export NODE_OPTIONS='--max-old-space-size=4096'",
        description: "Alloue plus de memoire au processus",
      },
    ],
  },

  COMMAND_NOT_FOUND: {
    code: "COMMAND_NOT_FOUND",
    message: "Commande introuvable",
    suggestion: "La commande n'existe pas ou n'est pas dans votre PATH.",
    exitCode: EXIT_CODES.DEPENDENCY_ERROR,
    quickActions: [
      {
        label: "Verifier l'installation",
        command: "which nom_commande",
        description: "Verifie si la commande est installee",
      },
      {
        label: "Installer via npm",
        command: "npm install -g nom_package",
        description: "Installe globalement le package",
      },
      {
        label: "Verifier le PATH",
        command: "echo $PATH",
        description: "Affiche les repertoires dans le PATH",
      },
    ],
  },

  SCRIPT_SYNTAX_ERROR: {
    code: "SCRIPT_SYNTAX_ERROR",
    message: "Erreur de syntaxe dans le script",
    suggestion: "Le script contient une erreur de syntaxe qui empeche son execution.",
    exitCode: EXIT_CODES.VALIDATION_ERROR,
    quickActions: [
      {
        label: "Verifier la syntaxe",
        description: "Consultez le numero de ligne indique dans l'erreur",
      },
      {
        label: "Linter le fichier",
        command: "npx eslint fichier.js",
        description: "Analyse le fichier pour trouver les erreurs",
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ERREURS PLUGINS / EXTENSIONS
  // ═══════════════════════════════════════════════════════════════════════════

  PLUGIN_NOT_FOUND: {
    code: "PLUGIN_NOT_FOUND",
    message: "Plugin introuvable",
    suggestion: "Le plugin demande n'est pas installe ou n'existe pas dans le registre.",
    exitCode: EXIT_CODES.DEPENDENCY_ERROR,
    quickActions: [
      {
        label: "Lister les plugins",
        command: "/plugins list",
        description: "Affiche tous les plugins installes",
      },
      {
        label: "Rechercher dans le marketplace",
        command: "/plugins search nom",
        description: "Recherche un plugin dans le marketplace",
      },
      {
        label: "Installer le plugin",
        command: "/plugins install nom",
        description: "Installe le plugin depuis le marketplace",
      },
    ],
  },

  PLUGIN_LOAD_ERROR: {
    code: "PLUGIN_LOAD_ERROR",
    message: "Erreur de chargement du plugin",
    suggestion: "Le plugin n'a pas pu etre charge. Il peut etre corrompu ou incompatible.",
    exitCode: EXIT_CODES.DEPENDENCY_ERROR,
    quickActions: [
      {
        label: "Reinstaller le plugin",
        command: "/plugins reinstall nom",
        description: "Desinstalle et reinstalle le plugin",
      },
      {
        label: "Voir les logs du plugin",
        command: "cat ~/.config/grok/plugins/nom/error.log",
        description: "Consulte les logs d'erreur du plugin",
      },
      {
        label: "Desactiver le plugin",
        command: "/plugins disable nom",
        description: "Desactive temporairement le plugin",
      },
    ],
  },

  PLUGIN_VERSION_MISMATCH: {
    code: "PLUGIN_VERSION_MISMATCH",
    message: "Version du plugin incompatible",
    suggestion: "Le plugin n'est pas compatible avec cette version de Code Buddy.",
    exitCode: EXIT_CODES.DEPENDENCY_ERROR,
    quickActions: [
      {
        label: "Mettre a jour le plugin",
        command: "/plugins update nom",
        description: "Met a jour vers la derniere version compatible",
      },
      {
        label: "Mettre a jour Code Buddy",
        command: "npm update -g @phuetz/grok",
        description: "Met a jour Code Buddy vers la derniere version",
      },
    ],
  },
} as const;

/**
 * Get package version for error reports
 */
function getVersion(): string {
  try {
    // This will be resolved at runtime
    return process.env.npm_package_version || "1.0.0";
  } catch {
    return "unknown";
  }
}

/**
 * Format a stack trace for readability
 * Cleans up and simplifies stack traces for user-friendly display
 */
export function formatStackTrace(error: Error, maxLines = 5): string[] {
  if (!error.stack) return [];

  const lines = error.stack.split("\n");
  const formattedLines: string[] = [];

  // Skip the first line (it's the error message)
  const stackLines = lines.slice(1);

  for (let i = 0; i < Math.min(stackLines.length, maxLines); i++) {
    const line = stackLines[i].trim();

    // Parse the stack frame
    const match = line.match(/at\s+(?:(.+?)\s+)?\(?((?:file:|https?:|\/)[^)]+):(\d+):(\d+)\)?/);

    if (match) {
      const [, fnName, filePath, lineNum, colNum] = match;
      // Simplify the path - show only the last 2-3 segments
      const pathParts = filePath.split("/");
      const shortPath = pathParts.slice(-3).join("/");

      if (fnName) {
        formattedLines.push(`  ${i + 1}. ${fnName} (${shortPath}:${lineNum})`);
      } else {
        formattedLines.push(`  ${i + 1}. ${shortPath}:${lineNum}:${colNum}`);
      }
    } else if (line.startsWith("at ")) {
      // Fallback for non-standard format
      formattedLines.push(`  ${i + 1}. ${line.replace("at ", "")}`);
    }
  }

  if (stackLines.length > maxLines) {
    formattedLines.push(`  ... et ${stackLines.length - maxLines} autres lignes`);
  }

  return formattedLines;
}

/**
 * Format quick actions for display
 */
function formatQuickActions(actions: QuickAction[]): string[] {
  const lines: string[] = [];
  lines.push("Actions possibles:");

  actions.forEach((action, index) => {
    lines.push(`  ${index + 1}. ${action.label}`);
    if (action.command) {
      lines.push(`     $ ${action.command}`);
    }
    lines.push(`     ${action.description}`);
  });

  return lines;
}

/**
 * Format error for terminal output with improved UX
 */
export function formatError(ctx: ErrorContext): string {
  const lines: string[] = [];

  // Error header with clear visual separator
  lines.push("━".repeat(50));
  lines.push(`❌ Erreur: ${ctx.message}`);
  lines.push("━".repeat(50));
  lines.push("");

  // File path if relevant
  if (ctx.filePath) {
    lines.push(`📁 Fichier: ${ctx.filePath}`);
    lines.push("");
  }

  // Details in a more readable format
  if (ctx.details) {
    lines.push("Details:");
    // Split details into multiple lines if too long
    const detailLines = ctx.details.split("\n");
    detailLines.forEach((line) => {
      lines.push(`  ${line}`);
    });
    lines.push("");
  }

  // Cause with simplified message
  if (ctx.cause && ctx.cause.message !== ctx.message) {
    lines.push(`Cause: ${ctx.cause.message}`);
    lines.push("");
  }

  // Stack trace (optional, simplified)
  if (ctx.showStackTrace && ctx.cause) {
    const stackLines = formatStackTrace(ctx.cause);
    if (stackLines.length > 0) {
      lines.push("Stack trace:");
      lines.push(...stackLines);
      lines.push("");
    }
  }

  // Suggestion in a prominent way
  if (ctx.suggestion) {
    lines.push(`💡 ${ctx.suggestion}`);
    lines.push("");
  }

  // Quick actions
  if (ctx.quickActions && ctx.quickActions.length > 0) {
    lines.push(...formatQuickActions(ctx.quickActions));
    lines.push("");
  }

  // Documentation link
  if (ctx.docUrl) {
    lines.push(`📚 Documentation: ${ctx.docUrl}`);
    lines.push("");
  }

  // Footer with technical info (smaller, less prominent)
  lines.push("─".repeat(30));
  lines.push(`Code: ${ctx.code} | Version: ${getVersion()}`);

  if (ctx.exitCode !== undefined) {
    lines.push(`Exit: ${ctx.exitCode} (${getExitCodeDescription(ctx.exitCode)})`);
  }

  return lines.join("\n");
}

/**
 * Format error as JSON for machine consumption
 */
export function formatErrorJson(ctx: ErrorContext): string {
  return JSON.stringify(
    {
      error: {
        code: ctx.code,
        message: ctx.message,
        details: ctx.details,
        suggestion: ctx.suggestion,
        documentation: ctx.docUrl,
        cause: ctx.cause?.message,
        exitCode: ctx.exitCode,
        version: getVersion(),
        timestamp: new Date().toISOString(),
      },
    },
    null,
    2
  );
}

/**
 * Regles de detection automatique des erreurs
 * Chaque regle contient des patterns a matcher et le template correspondant
 */
const ERROR_DETECTION_RULES: Array<{
  patterns: RegExp[];
  template: keyof typeof ERROR_TEMPLATES;
}> = [
  // ═══════════════════════════════════════════════════════════════════════════
  // AUTHENTIFICATION & API KEY
  // ═══════════════════════════════════════════════════════════════════════════
  {
    patterns: [/api.?key.*missing/i, /missing.*api.?key/i, /no.*api.?key/i],
    template: "API_KEY_MISSING",
  },
  {
    patterns: [/unauthorized/i, /\b401\b/, /invalid.*key/i, /key.*invalid/i, /authentication.*failed/i],
    template: "API_KEY_INVALID",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // RATE LIMITING & QUOTAS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    patterns: [/rate.?limit/i, /too.?many.?requests/i, /\b429\b/],
    template: "RATE_LIMITED",
  },
  {
    patterns: [/quota.*exceeded/i, /exceeded.*quota/i, /monthly.*limit/i, /usage.*limit/i],
    template: "API_QUOTA_EXCEEDED",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ERREURS SERVEUR API
  // ═══════════════════════════════════════════════════════════════════════════
  {
    patterns: [/\b50[0-4]\b/, /internal.*server.*error/i, /server.*error/i],
    template: "API_SERVER_ERROR",
  },
  {
    patterns: [/\b503\b/, /service.*unavailable/i, /overloaded/i, /capacity/i],
    template: "API_OVERLOADED",
  },
  {
    patterns: [/invalid.*response/i, /malformed.*response/i, /unexpected.*response/i, /json.*parse.*error.*api/i],
    template: "API_INVALID_RESPONSE",
  },
  {
    patterns: [/content.*filter/i, /moderation/i, /blocked.*safety/i, /flagged/i],
    template: "API_CONTENT_FILTERED",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // RESEAU & CONNEXION
  // ═══════════════════════════════════════════════════════════════════════════
  {
    patterns: [/timeout/i, /timed?.?out/i, /deadline.*exceeded/i],
    template: "TIMEOUT",
  },
  {
    patterns: [
      /econnrefused/i, /econnreset/i, /network/i, /fetch.*failed/i,
      /unable.*connect/i, /connection.*refused/i, /dns/i, /enotfound/i
    ],
    template: "NETWORK_ERROR",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FICHIERS & SYSTEME DE FICHIERS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    patterns: [/enoent/i, /no.*such.*file/i, /file.*not.*found/i, /path.*not.*exist/i],
    template: "FILE_NOT_FOUND",
  },
  {
    patterns: [/eacces/i, /permission.*denied/i, /access.*denied/i, /not.*permitted/i, /eperm/i],
    template: "PERMISSION_DENIED",
  },
  {
    patterns: [/file.*too.*large/i, /payload.*too.*large/i, /entity.*too.*large/i, /\b413\b/],
    template: "FILE_TOO_LARGE",
  },
  {
    patterns: [/ebusy/i, /file.*locked/i, /resource.*busy/i, /being.*used/i],
    template: "FILE_LOCKED",
  },
  {
    patterns: [/encoding/i, /invalid.*character/i, /utf-?8/i, /charset/i, /decode/i],
    template: "FILE_ENCODING_ERROR",
  },
  {
    patterns: [/enospc/i, /no.*space/i, /disk.*full/i, /quota.*exceeded.*disk/i],
    template: "DISK_FULL",
  },
  {
    patterns: [/path.*traversal/i, /directory.*traversal/i, /\.\.\/.*security/i],
    template: "PATH_TRAVERSAL",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // GIT
  // ═══════════════════════════════════════════════════════════════════════════
  {
    patterns: [/not.*git.*repository/i, /fatal.*not.*git/i, /git.*init/i],
    template: "GIT_NOT_INITIALIZED",
  },
  {
    patterns: [/conflict/i, /merge.*conflict/i, /unmerged/i],
    template: "GIT_CONFLICT",
  },
  {
    patterns: [/uncommitted.*changes/i, /working.*tree.*clean/i, /unstaged.*changes/i],
    template: "GIT_UNCOMMITTED_CHANGES",
  },
  {
    patterns: [/branch.*already.*exists/i, /fatal.*branch.*exists/i],
    template: "GIT_BRANCH_EXISTS",
  },
  {
    patterns: [/push.*rejected/i, /non-fast-forward/i, /failed.*push/i],
    template: "GIT_PUSH_REJECTED",
  },
  {
    patterns: [/merge.*failed/i, /automatic.*merge.*failed/i],
    template: "GIT_MERGE_FAILED",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CONFIGURATION & MODELES
  // ═══════════════════════════════════════════════════════════════════════════
  {
    patterns: [/config.*invalid/i, /invalid.*config/i, /configuration.*error/i],
    template: "CONFIG_INVALID",
  },
  {
    patterns: [/model.*not.*found/i, /model.*not.*available/i, /unknown.*model/i, /invalid.*model/i],
    template: "MODEL_NOT_FOUND",
  },
  {
    patterns: [/workspace.*not.*found/i, /workspace.*not.*exist/i],
    template: "WORKSPACE_NOT_FOUND",
  },
  {
    patterns: [/package\.json.*not.*found/i, /not.*node.*project/i, /npm.*init/i],
    template: "PROJECT_NOT_NODE",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SECURITE
  // ═══════════════════════════════════════════════════════════════════════════
  {
    patterns: [/sandbox/i, /violation/i, /blocked.*security/i],
    template: "SANDBOX_VIOLATION",
  },
  {
    patterns: [/unsafe.*command/i, /dangerous.*command/i, /command.*blocked/i],
    template: "UNSAFE_COMMAND_BLOCKED",
  },
  {
    patterns: [/secret.*detected/i, /credential.*found/i, /api.?key.*code/i, /password.*found/i],
    template: "SECRETS_DETECTED",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // RESSOURCES
  // ═══════════════════════════════════════════════════════════════════════════
  {
    patterns: [/cost.*limit/i, /spending.*limit/i, /budget.*exceeded/i],
    template: "COST_LIMIT",
  },
  {
    patterns: [/memory.*limit/i, /out.*of.*memory/i, /heap.*out/i, /enomem/i, /javascript.*heap/i],
    template: "MEMORY_LIMIT",
  },
  {
    patterns: [/context.*too.*large/i, /token.*limit/i, /max.*tokens/i, /context.*length/i],
    template: "CONTEXT_TOO_LARGE",
  },
  {
    patterns: [/killed/i, /sigkill/i, /sigterm/i, /process.*terminated/i],
    template: "PROCESS_KILLED",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // VALIDATION & BUILD
  // ═══════════════════════════════════════════════════════════════════════════
  {
    patterns: [/json.*parse/i, /unexpected.*token/i, /invalid.*json/i, /json.*syntax/i],
    template: "JSON_PARSE_ERROR",
  },
  {
    patterns: [/typescript.*error/i, /ts\d{4}/i, /type.*error/i, /cannot.*find.*module/i],
    template: "TYPESCRIPT_ERROR",
  },
  {
    patterns: [/build.*failed/i, /compilation.*failed/i, /compile.*error/i],
    template: "BUILD_FAILED",
  },
  {
    patterns: [/lint.*error/i, /eslint/i, /prettier/i, /formatting.*error/i],
    template: "LINT_ERROR",
  },
  {
    patterns: [/syntax.*error/i, /unexpected.*end/i, /unexpected.*identifier/i],
    template: "SCRIPT_SYNTAX_ERROR",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // RUNTIME & DEPENDANCES
  // ═══════════════════════════════════════════════════════════════════════════
  {
    patterns: [/command.*not.*found/i, /is.*not.*recognized/i, /unknown.*command/i],
    template: "COMMAND_NOT_FOUND",
  },
  {
    patterns: [/dependency.*missing/i, /module.*not.*found/i, /cannot.*resolve/i, /peer.*dep/i],
    template: "DEPENDENCY_MISSING",
  },
  {
    patterns: [/npm.*install.*failed/i, /npm.*err/i, /package.*install/i],
    template: "PACKAGE_INSTALL_FAILED",
  },
  {
    patterns: [/tool.*failed/i, /tool.*execution/i, /tool.*error/i],
    template: "TOOL_FAILED",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PLUGINS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    patterns: [/plugin.*not.*found/i, /plugin.*not.*installed/i],
    template: "PLUGIN_NOT_FOUND",
  },
  {
    patterns: [/plugin.*load.*error/i, /failed.*load.*plugin/i, /plugin.*corrupt/i],
    template: "PLUGIN_LOAD_ERROR",
  },
  {
    patterns: [/plugin.*version/i, /incompatible.*plugin/i, /plugin.*mismatch/i],
    template: "PLUGIN_VERSION_MISMATCH",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // MCP & SESSIONS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    patterns: [/mcp.*connection/i, /mcp.*failed/i, /mcp.*error/i],
    template: "MCP_CONNECTION_FAILED",
  },
  {
    patterns: [/session.*expired/i, /session.*invalid/i, /session.*timeout/i],
    template: "SESSION_EXPIRED",
  },
  {
    patterns: [/checkpoint.*not.*found/i, /checkpoint.*missing/i],
    template: "CHECKPOINT_NOT_FOUND",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DOCKER
  // ═══════════════════════════════════════════════════════════════════════════
  {
    patterns: [/docker.*not.*running/i, /docker.*daemon/i, /cannot.*connect.*docker/i],
    template: "DOCKER_NOT_RUNNING",
  },
];

/**
 * Create error context from an Error object
 * Utilise la detection automatique avancee pour trouver le meilleur template
 */
export function createErrorContext(
  error: Error,
  template?: keyof typeof ERROR_TEMPLATES
): ErrorContext {
  // Si un template est specifie explicitement, l'utiliser
  if (template && ERROR_TEMPLATES[template]) {
    const base = ERROR_TEMPLATES[template] as {
      code: string;
      message: string;
      suggestion?: string;
      docUrl?: string;
      exitCode?: ExitCode;
      quickActions?: readonly QuickAction[];
    };
    return {
      code: base.code,
      message: base.message,
      suggestion: base.suggestion,
      docUrl: base.docUrl,
      exitCode: base.exitCode,
      quickActions: base.quickActions ? [...base.quickActions] : undefined,
      details: error.message,
      cause: error,
    };
  }

  // Detection automatique basee sur les regles
  const message = error.message;

  for (const rule of ERROR_DETECTION_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(message)) {
        const base = ERROR_TEMPLATES[rule.template] as {
          code: string;
          message: string;
          suggestion?: string;
          docUrl?: string;
          exitCode?: ExitCode;
          quickActions?: readonly QuickAction[];
        };
        return {
          code: base.code,
          message: base.message,
          suggestion: base.suggestion,
          docUrl: base.docUrl,
          exitCode: base.exitCode,
          quickActions: base.quickActions ? [...base.quickActions] : undefined,
          details: error.message,
          cause: error,
        };
      }
    }
  }

  // Erreur generique si aucun pattern ne correspond
  return {
    code: "UNKNOWN_ERROR",
    message: translateTechnicalError(error.message),
    details: error.message,
    exitCode: EXIT_CODES.GENERAL_ERROR,
    cause: error,
    suggestion: "Si le probleme persiste, consultez les logs ou contactez le support.",
    quickActions: [
      {
        label: "Voir les logs detailles",
        command: "cat ~/.config/grok/logs/latest.log | tail -100",
        description: "Affiche les dernieres lignes du journal",
      },
      {
        label: "Signaler un bug",
        command: "open https://github.com/phuetz/code-buddy/issues/new",
        description: "Ouvrir une issue sur GitHub",
      },
    ],
  };
}

/**
 * Traduit les messages d'erreur techniques en langage utilisateur
 */
export function translateTechnicalError(message: string): string {
  const translations: Array<{ pattern: RegExp; translation: string }> = [
    { pattern: /ENOENT/i, translation: "Fichier ou dossier introuvable" },
    { pattern: /EACCES/i, translation: "Permission refusee" },
    { pattern: /EPERM/i, translation: "Operation non permise" },
    { pattern: /ECONNREFUSED/i, translation: "Connexion refusee par le serveur" },
    { pattern: /ECONNRESET/i, translation: "Connexion interrompue" },
    { pattern: /ETIMEDOUT/i, translation: "Delai d'attente depasse" },
    { pattern: /ENOTFOUND/i, translation: "Adresse introuvable (verifiez l'URL)" },
    { pattern: /ENOSPC/i, translation: "Espace disque insuffisant" },
    { pattern: /ENOMEM/i, translation: "Memoire insuffisante" },
    { pattern: /EBUSY/i, translation: "Ressource occupee" },
    { pattern: /EMFILE/i, translation: "Trop de fichiers ouverts" },
    { pattern: /ENFILE/i, translation: "Limite systeme de fichiers atteinte" },
    { pattern: /EISDIR/i, translation: "Impossible: c'est un dossier, pas un fichier" },
    { pattern: /ENOTDIR/i, translation: "Impossible: ce n'est pas un dossier" },
    { pattern: /EEXIST/i, translation: "Le fichier ou dossier existe deja" },
    { pattern: /ENOTEMPTY/i, translation: "Le dossier n'est pas vide" },
    { pattern: /SIGKILL/i, translation: "Processus arrete de force" },
    { pattern: /SIGTERM/i, translation: "Processus interrompu" },
    { pattern: /ERR_INVALID_ARG/i, translation: "Argument invalide" },
    { pattern: /ERR_ASSERTION/i, translation: "Erreur interne (assertion echouee)" },
    { pattern: /Cannot read propert/i, translation: "Valeur manquante ou incorrecte" },
    { pattern: /is not defined/i, translation: "Variable ou fonction non definie" },
    { pattern: /is not a function/i, translation: "Tentative d'appel sur une non-fonction" },
    { pattern: /Maximum call stack/i, translation: "Boucle infinie detectee (stack overflow)" },
  ];

  for (const { pattern, translation } of translations) {
    if (pattern.test(message)) {
      return translation;
    }
  }

  // Si pas de traduction, retourner le message original (nettoye)
  return message
    .replace(/Error:\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 200); // Limiter la longueur
}

/**
 * Print formatted error to stderr
 */
export function printError(ctx: ErrorContext): void {
  logger.error(formatError(ctx));
}

/**
 * Print formatted error as JSON to stderr
 */
export function printErrorJson(ctx: ErrorContext): void {
  logger.error(formatErrorJson(ctx));
}

/**
 * Format a warning message
 */
export function formatWarning(message: string, suggestion?: string): string {
  const lines = [`⚠️  Warning: ${message}`];

  if (suggestion) {
    lines.push(`   💡 ${suggestion}`);
  }

  return lines.join("\n");
}

/**
 * Format a success message
 */
export function formatSuccess(message: string, details?: string[]): string {
  const lines = [`✓ ${message}`];

  if (details) {
    for (const detail of details) {
      lines.push(`  • ${detail}`);
    }
  }

  return lines.join("\n");
}

/**
 * Format an info message
 */
export function formatInfo(message: string): string {
  return `ℹ️  ${message}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FONCTIONS DE DIAGNOSTIC AVANCEES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Interface pour les informations de diagnostic
 */
export interface DiagnosticInfo {
  /** Code d'erreur */
  code: string;
  /** Categorie de l'erreur */
  category: ErrorCategory;
  /** Severite de l'erreur */
  severity: ErrorSeverity;
  /** Message traduit */
  translatedMessage: string;
  /** Message original */
  originalMessage: string;
  /** Timestamp de l'erreur */
  timestamp: string;
  /** Stack trace formatee */
  stackTrace: string[];
  /** Suggestions de resolution */
  suggestions: string[];
  /** Environnement systeme */
  environment: {
    nodeVersion: string;
    platform: string;
    arch: string;
    cwd: string;
  };
}

/**
 * Genere un rapport de diagnostic complet pour une erreur
 */
export function generateDiagnosticReport(error: Error, template?: keyof typeof ERROR_TEMPLATES): DiagnosticInfo {
  const ctx = createErrorContext(error, template);

  return {
    code: ctx.code,
    category: getErrorCategory(ctx.code),
    severity: getErrorSeverity(ctx.code),
    translatedMessage: ctx.message,
    originalMessage: error.message,
    timestamp: new Date().toISOString(),
    stackTrace: formatStackTrace(error, 10),
    suggestions: ctx.quickActions?.map(a => a.description) || [],
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      cwd: process.cwd(),
    },
  };
}

/**
 * Formate un rapport de diagnostic pour l'affichage
 */
export function formatDiagnosticReport(diagnostic: DiagnosticInfo): string {
  const lines: string[] = [];

  lines.push("═".repeat(60));
  lines.push("  RAPPORT DE DIAGNOSTIC");
  lines.push("═".repeat(60));
  lines.push("");

  lines.push(`📋 Code d'erreur: ${diagnostic.code}`);
  lines.push(`📁 Categorie: ${diagnostic.category}`);
  lines.push(`⚡ Severite: ${diagnostic.severity}`);
  lines.push(`🕐 Timestamp: ${diagnostic.timestamp}`);
  lines.push("");

  lines.push("─".repeat(40));
  lines.push("MESSAGE");
  lines.push("─".repeat(40));
  lines.push(`  ${diagnostic.translatedMessage}`);
  if (diagnostic.originalMessage !== diagnostic.translatedMessage) {
    lines.push("");
    lines.push("  Message technique:");
    lines.push(`  ${diagnostic.originalMessage}`);
  }
  lines.push("");

  if (diagnostic.suggestions.length > 0) {
    lines.push("─".repeat(40));
    lines.push("SUGGESTIONS");
    lines.push("─".repeat(40));
    diagnostic.suggestions.forEach((suggestion, i) => {
      lines.push(`  ${i + 1}. ${suggestion}`);
    });
    lines.push("");
  }

  if (diagnostic.stackTrace.length > 0) {
    lines.push("─".repeat(40));
    lines.push("STACK TRACE");
    lines.push("─".repeat(40));
    lines.push(...diagnostic.stackTrace);
    lines.push("");
  }

  lines.push("─".repeat(40));
  lines.push("ENVIRONNEMENT");
  lines.push("─".repeat(40));
  lines.push(`  Node.js: ${diagnostic.environment.nodeVersion}`);
  lines.push(`  Plateforme: ${diagnostic.environment.platform}`);
  lines.push(`  Architecture: ${diagnostic.environment.arch}`);
  lines.push(`  Repertoire: ${diagnostic.environment.cwd}`);
  lines.push("");

  lines.push("═".repeat(60));

  return lines.join("\n");
}

/**
 * Verifie si une erreur est recuperable (peut etre retentee)
 */
export function isRecoverableError(error: Error): boolean {
  const ctx = createErrorContext(error);
  const recoverableCodes = [
    "RATE_LIMITED",
    "API_OVERLOADED",
    "API_SERVER_ERROR",
    "TIMEOUT",
    "NETWORK_ERROR",
    "FILE_LOCKED",
    "API_INVALID_RESPONSE",
  ];
  return recoverableCodes.includes(ctx.code);
}

/**
 * Calcule le delai de retry recommande pour une erreur recuperable (en ms)
 */
export function getRetryDelay(error: Error, attempt: number = 1): number {
  const ctx = createErrorContext(error);
  const baseDelays: Record<string, number> = {
    RATE_LIMITED: 60000, // 1 minute
    API_OVERLOADED: 30000, // 30 secondes
    API_SERVER_ERROR: 10000, // 10 secondes
    TIMEOUT: 5000, // 5 secondes
    NETWORK_ERROR: 5000, // 5 secondes
    FILE_LOCKED: 2000, // 2 secondes
    API_INVALID_RESPONSE: 3000, // 3 secondes
  };

  const baseDelay = baseDelays[ctx.code] || 5000;
  // Backoff exponentiel avec jitter
  const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
  const jitter = Math.random() * 1000;

  return Math.min(exponentialDelay + jitter, 300000); // Max 5 minutes
}

/**
 * Groupe les erreurs par categorie pour un rapport resume
 */
export function groupErrorsByCategory(errors: Error[]): Map<ErrorCategory, ErrorContext[]> {
  const grouped = new Map<ErrorCategory, ErrorContext[]>();

  for (const error of errors) {
    const ctx = createErrorContext(error);
    const category = getErrorCategory(ctx.code);

    if (!grouped.has(category)) {
      grouped.set(category, []);
    }
    grouped.get(category)!.push(ctx);
  }

  return grouped;
}

/**
 * Cree un resume des erreurs pour l'affichage
 */
export function createErrorSummary(errors: Error[]): string {
  if (errors.length === 0) {
    return formatSuccess("Aucune erreur detectee");
  }

  const grouped = groupErrorsByCategory(errors);
  const lines: string[] = [];

  lines.push("═".repeat(50));
  lines.push(`  RESUME DES ERREURS (${errors.length} au total)`);
  lines.push("═".repeat(50));
  lines.push("");

  grouped.forEach((contexts, category) => {
    const severities = contexts.map(c => getErrorSeverity(c.code));
    const hasCritical = severities.includes(ErrorSeverity.CRITICAL);
    const hasError = severities.includes(ErrorSeverity.ERROR);

    const icon = hasCritical ? "🔴" : hasError ? "🟠" : "🟡";
    lines.push(`${icon} ${category}: ${contexts.length} erreur(s)`);

    // Lister les codes uniques
    const uniqueCodes = Array.from(new Set(contexts.map(c => c.code)));
    uniqueCodes.forEach(code => {
      const count = contexts.filter(c => c.code === code).length;
      lines.push(`   - ${code} (${count}x)`);
    });
    lines.push("");
  });

  // Ajouter des conseils generaux
  const allContexts: ErrorContext[] = [];
  grouped.forEach(contexts => allContexts.push(...contexts));
  const hasRecoverable = allContexts.some(c => {
    const err = c.cause || new Error(c.message);
    return isRecoverableError(err);
  });

  if (hasRecoverable) {
    lines.push("💡 Certaines erreurs peuvent etre resolues en reessayant.");
  }

  return lines.join("\n");
}

/**
 * Extrait le chemin de fichier d'un message d'erreur si present
 */
export function extractFilePath(message: string): string | null {
  // Patterns courants pour les chemins de fichiers
  const patterns = [
    /(?:at|in|file)\s+['"]?([/\\]?(?:[\w.-]+[/\\])*[\w.-]+\.\w+)['"]?/i,
    /(?:ENOENT|EACCES)[^']*['"]([^'"]+)['"]/i,
    /(?:reading|writing|opening)\s+['"]?([/\\]?(?:[\w.-]+[/\\])*[\w.-]+\.\w+)['"]?/i,
    /^([/\\]?(?:[\w.-]+[/\\])*[\w.-]+\.\w+):/m,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

/**
 * Cree un contexte d'erreur enrichi avec extraction automatique du chemin
 */
export function createEnrichedErrorContext(
  error: Error,
  template?: keyof typeof ERROR_TEMPLATES
): ErrorContext {
  const ctx = createErrorContext(error, template);

  // Tenter d'extraire le chemin de fichier si non present
  if (!ctx.filePath) {
    const extractedPath = extractFilePath(error.message);
    if (extractedPath) {
      ctx.filePath = extractedPath;
    }
  }

  return ctx;
}

export default {
  // Formatage
  formatError,
  formatErrorJson,
  formatWarning,
  formatSuccess,
  formatInfo,
  formatStackTrace,
  formatDiagnosticReport,

  // Creation de contexte
  createErrorContext,
  createEnrichedErrorContext,
  translateTechnicalError,

  // Affichage
  printError,
  printErrorJson,

  // Diagnostic
  generateDiagnosticReport,
  isRecoverableError,
  getRetryDelay,
  groupErrorsByCategory,
  createErrorSummary,
  extractFilePath,

  // Categories et severites
  getErrorCategory,
  getErrorSeverity,
  ErrorCategory,
  ErrorSeverity,

  // Templates et constantes
  ERROR_TEMPLATES,
  ERROR_CATEGORIES,
  ERROR_SEVERITIES,
};
