/**
 * Internationalization (i18n) Module
 *
 * Lightweight i18n system for Code Buddy.
 * Supports multiple languages with fallback to English.
 */

import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

/**
 * Supported locales
 */
export type Locale = 'en' | 'fr' | 'de' | 'es' | 'ja' | 'zh';

/**
 * Translation key categories
 */
export interface TranslationKeys {
  // Common
  common: {
    yes: string;
    no: string;
    cancel: string;
    confirm: string;
    error: string;
    warning: string;
    success: string;
    info: string;
    loading: string;
    processing: string;
    done: string;
    help: string;
    exit: string;
    back: string;
    next: string;
    save: string;
    delete: string;
    edit: string;
    create: string;
    search: string;
    filter: string;
    sort: string;
    refresh: string;
    settings: string;
    options: string;
  };

  // CLI Messages
  cli: {
    welcome: string;
    goodbye: string;
    inputPrompt: string;
    thinking: string;
    executing: string;
    toolUse: string;
    toolResult: string;
    noApiKey: string;
    invalidApiKey: string;
    rateLimited: string;
    networkError: string;
    timeout: string;
    sessionSaved: string;
    sessionLoaded: string;
    historyCleared: string;
    modelChanged: string;
    costWarning: string;
    costLimit: string;
  };

  // Tools
  tools: {
    readingFile: string;
    writingFile: string;
    creatingFile: string;
    deletingFile: string;
    executingCommand: string;
    searchingFiles: string;
    webSearching: string;
    fetchingUrl: string;
    analyzing: string;
    generating: string;
    fileNotFound: string;
    permissionDenied: string;
    commandFailed: string;
    confirmDelete: string;
    confirmOverwrite: string;
    confirmExecute: string;
  };

  // Errors
  errors: {
    unknown: string;
    notFound: string;
    invalidInput: string;
    unauthorized: string;
    forbidden: string;
    serverError: string;
    connectionFailed: string;
    parseError: string;
    validationFailed: string;
    operationCancelled: string;
    featureNotAvailable: string;
  };

  // Help
  help: {
    title: string;
    description: string;
    commands: string;
    examples: string;
    tips: string;
    moreInfo: string;
    version: string;
    usage: string;
  };
}

/**
 * Full translations object
 */
export type Translations = TranslationKeys;

// ============================================================================
// Default Translations (English)
// ============================================================================

const en: Translations = {
  common: {
    yes: 'Yes',
    no: 'No',
    cancel: 'Cancel',
    confirm: 'Confirm',
    error: 'Error',
    warning: 'Warning',
    success: 'Success',
    info: 'Info',
    loading: 'Loading...',
    processing: 'Processing...',
    done: 'Done',
    help: 'Help',
    exit: 'Exit',
    back: 'Back',
    next: 'Next',
    save: 'Save',
    delete: 'Delete',
    edit: 'Edit',
    create: 'Create',
    search: 'Search',
    filter: 'Filter',
    sort: 'Sort',
    refresh: 'Refresh',
    settings: 'Settings',
    options: 'Options',
  },
  cli: {
    welcome: 'Welcome to Code Buddy! Type your request or /help for commands.',
    goodbye: 'Goodbye! Session saved.',
    inputPrompt: 'Ask me anything...',
    thinking: 'Thinking...',
    executing: 'Executing...',
    toolUse: 'Using tool: {tool}',
    toolResult: 'Tool result: {result}',
    noApiKey: 'No API key found. Set GROK_API_KEY environment variable.',
    invalidApiKey: 'Invalid API key. Please check your credentials.',
    rateLimited: 'Rate limit exceeded. Please wait before retrying.',
    networkError: 'Network error. Check your connection.',
    timeout: 'Request timed out. Please try again.',
    sessionSaved: 'Session saved successfully.',
    sessionLoaded: 'Session loaded: {name}',
    historyCleared: 'History cleared.',
    modelChanged: 'Model changed to: {model}',
    costWarning: 'Warning: Session cost ${cost} approaching limit.',
    costLimit: 'Cost limit reached (${cost}). Session paused.',
  },
  tools: {
    readingFile: 'Reading file: {path}',
    writingFile: 'Writing to file: {path}',
    creatingFile: 'Creating file: {path}',
    deletingFile: 'Deleting file: {path}',
    executingCommand: 'Executing: {command}',
    searchingFiles: 'Searching files: {pattern}',
    webSearching: 'Searching web: {query}',
    fetchingUrl: 'Fetching URL: {url}',
    analyzing: 'Analyzing...',
    generating: 'Generating...',
    fileNotFound: 'File not found: {path}',
    permissionDenied: 'Permission denied: {path}',
    commandFailed: 'Command failed: {error}',
    confirmDelete: 'Delete {path}? This cannot be undone.',
    confirmOverwrite: 'File exists. Overwrite {path}?',
    confirmExecute: 'Execute command: {command}?',
  },
  errors: {
    unknown: 'An unknown error occurred.',
    notFound: 'Resource not found.',
    invalidInput: 'Invalid input provided.',
    unauthorized: 'Authentication required.',
    forbidden: 'Access denied.',
    serverError: 'Server error. Please try again.',
    connectionFailed: 'Connection failed.',
    parseError: 'Failed to parse response.',
    validationFailed: 'Validation failed: {details}',
    operationCancelled: 'Operation cancelled.',
    featureNotAvailable: 'Feature not available in this version.',
  },
  help: {
    title: 'Code Buddy Help',
    description: 'AI-powered terminal assistant for coding tasks.',
    commands: 'Available commands:',
    examples: 'Examples:',
    tips: 'Tips:',
    moreInfo: 'For more information, visit: {url}',
    version: 'Version: {version}',
    usage: 'Usage: {usage}',
  },
};

// ============================================================================
// French Translations
// ============================================================================

const fr: Translations = {
  common: {
    yes: 'Oui',
    no: 'Non',
    cancel: 'Annuler',
    confirm: 'Confirmer',
    error: 'Erreur',
    warning: 'Attention',
    success: 'Succès',
    info: 'Info',
    loading: 'Chargement...',
    processing: 'Traitement...',
    done: 'Terminé',
    help: 'Aide',
    exit: 'Quitter',
    back: 'Retour',
    next: 'Suivant',
    save: 'Enregistrer',
    delete: 'Supprimer',
    edit: 'Modifier',
    create: 'Créer',
    search: 'Rechercher',
    filter: 'Filtrer',
    sort: 'Trier',
    refresh: 'Actualiser',
    settings: 'Paramètres',
    options: 'Options',
  },
  cli: {
    welcome: 'Bienvenue sur Code Buddy ! Tapez votre requête ou /help pour les commandes.',
    goodbye: 'Au revoir ! Session sauvegardée.',
    inputPrompt: 'Posez-moi une question...',
    thinking: 'Réflexion...',
    executing: 'Exécution...',
    toolUse: "Utilisation de l'outil : {tool}",
    toolResult: "Résultat de l'outil : {result}",
    noApiKey: 'Clé API non trouvée. Définissez la variable GROK_API_KEY.',
    invalidApiKey: 'Clé API invalide. Vérifiez vos identifiants.',
    rateLimited: 'Limite de débit dépassée. Veuillez patienter.',
    networkError: 'Erreur réseau. Vérifiez votre connexion.',
    timeout: "Délai d'attente dépassé. Veuillez réessayer.",
    sessionSaved: 'Session enregistrée avec succès.',
    sessionLoaded: 'Session chargée : {name}',
    historyCleared: 'Historique effacé.',
    modelChanged: 'Modèle changé pour : {model}',
    costWarning: 'Attention : Coût de session {cost}$ proche de la limite.',
    costLimit: 'Limite de coût atteinte ({cost}$). Session en pause.',
  },
  tools: {
    readingFile: 'Lecture du fichier : {path}',
    writingFile: 'Écriture dans le fichier : {path}',
    creatingFile: 'Création du fichier : {path}',
    deletingFile: 'Suppression du fichier : {path}',
    executingCommand: 'Exécution : {command}',
    searchingFiles: 'Recherche de fichiers : {pattern}',
    webSearching: 'Recherche web : {query}',
    fetchingUrl: "Récupération de l'URL : {url}",
    analyzing: 'Analyse en cours...',
    generating: 'Génération en cours...',
    fileNotFound: 'Fichier non trouvé : {path}',
    permissionDenied: 'Permission refusée : {path}',
    commandFailed: 'Commande échouée : {error}',
    confirmDelete: 'Supprimer {path} ? Cette action est irréversible.',
    confirmOverwrite: 'Le fichier existe. Écraser {path} ?',
    confirmExecute: 'Exécuter la commande : {command} ?',
  },
  errors: {
    unknown: "Une erreur inconnue s'est produite.",
    notFound: 'Ressource non trouvée.',
    invalidInput: 'Entrée invalide.',
    unauthorized: 'Authentification requise.',
    forbidden: 'Accès refusé.',
    serverError: 'Erreur serveur. Veuillez réessayer.',
    connectionFailed: 'Échec de la connexion.',
    parseError: "Échec de l'analyse de la réponse.",
    validationFailed: 'Validation échouée : {details}',
    operationCancelled: 'Opération annulée.',
    featureNotAvailable: 'Fonctionnalité non disponible dans cette version.',
  },
  help: {
    title: 'Aide Code Buddy',
    description: 'Assistant terminal alimenté par IA pour les tâches de codage.',
    commands: 'Commandes disponibles :',
    examples: 'Exemples :',
    tips: 'Conseils :',
    moreInfo: "Pour plus d'informations, visitez : {url}",
    version: 'Version : {version}',
    usage: 'Utilisation : {usage}',
  },
};

// ============================================================================
// German Translations
// ============================================================================

const de: Translations = {
  common: {
    yes: 'Ja',
    no: 'Nein',
    cancel: 'Abbrechen',
    confirm: 'Bestätigen',
    error: 'Fehler',
    warning: 'Warnung',
    success: 'Erfolg',
    info: 'Info',
    loading: 'Laden...',
    processing: 'Verarbeitung...',
    done: 'Fertig',
    help: 'Hilfe',
    exit: 'Beenden',
    back: 'Zurück',
    next: 'Weiter',
    save: 'Speichern',
    delete: 'Löschen',
    edit: 'Bearbeiten',
    create: 'Erstellen',
    search: 'Suchen',
    filter: 'Filtern',
    sort: 'Sortieren',
    refresh: 'Aktualisieren',
    settings: 'Einstellungen',
    options: 'Optionen',
  },
  cli: {
    welcome: 'Willkommen bei Code Buddy! Geben Sie Ihre Anfrage ein oder /help für Befehle.',
    goodbye: 'Auf Wiedersehen! Sitzung gespeichert.',
    inputPrompt: 'Stellen Sie mir eine Frage...',
    thinking: 'Nachdenken...',
    executing: 'Ausführen...',
    toolUse: 'Werkzeug verwenden: {tool}',
    toolResult: 'Werkzeugergebnis: {result}',
    noApiKey: 'Kein API-Schlüssel gefunden. Setzen Sie die Variable GROK_API_KEY.',
    invalidApiKey: 'Ungültiger API-Schlüssel. Überprüfen Sie Ihre Anmeldeinformationen.',
    rateLimited: 'Ratenlimit überschritten. Bitte warten Sie vor dem Wiederholen.',
    networkError: 'Netzwerkfehler. Überprüfen Sie Ihre Verbindung.',
    timeout: 'Anfrage-Timeout. Bitte erneut versuchen.',
    sessionSaved: 'Sitzung erfolgreich gespeichert.',
    sessionLoaded: 'Sitzung geladen: {name}',
    historyCleared: 'Verlauf gelöscht.',
    modelChanged: 'Modell geändert zu: {model}',
    costWarning: 'Warnung: Sitzungskosten ${cost} nähern sich dem Limit.',
    costLimit: 'Kostenlimit erreicht (${cost}). Sitzung pausiert.',
  },
  tools: {
    readingFile: 'Datei lesen: {path}',
    writingFile: 'In Datei schreiben: {path}',
    creatingFile: 'Datei erstellen: {path}',
    deletingFile: 'Datei löschen: {path}',
    executingCommand: 'Ausführen: {command}',
    searchingFiles: 'Dateien suchen: {pattern}',
    webSearching: 'Web suchen: {query}',
    fetchingUrl: 'URL abrufen: {url}',
    analyzing: 'Analysieren...',
    generating: 'Generieren...',
    fileNotFound: 'Datei nicht gefunden: {path}',
    permissionDenied: 'Zugriff verweigert: {path}',
    commandFailed: 'Befehl fehlgeschlagen: {error}',
    confirmDelete: '{path} löschen? Dies kann nicht rückgängig gemacht werden.',
    confirmOverwrite: 'Datei existiert bereits. {path} überschreiben?',
    confirmExecute: 'Befehl ausführen: {command}?',
  },
  errors: {
    unknown: 'Ein unbekannter Fehler ist aufgetreten.',
    notFound: 'Ressource nicht gefunden.',
    invalidInput: 'Ungültige Eingabe.',
    unauthorized: 'Authentifizierung erforderlich.',
    forbidden: 'Zugriff verweigert.',
    serverError: 'Serverfehler. Bitte erneut versuchen.',
    connectionFailed: 'Verbindung fehlgeschlagen.',
    parseError: 'Antwort konnte nicht geparst werden.',
    validationFailed: 'Validierung fehlgeschlagen: {details}',
    operationCancelled: 'Vorgang abgebrochen.',
    featureNotAvailable: 'Funktion in dieser Version nicht verfügbar.',
  },
  help: {
    title: 'Code Buddy Hilfe',
    description: 'KI-gestützter Terminal-Assistent für Coding-Aufgaben.',
    commands: 'Verfügbare Befehle:',
    examples: 'Beispiele:',
    tips: 'Tipps:',
    moreInfo: 'Weitere Informationen finden Sie unter: {url}',
    version: 'Version: {version}',
    usage: 'Verwendung: {usage}',
  },
};

// ============================================================================
// Spanish Translations
// ============================================================================

const es: Translations = {
  common: {
    yes: 'Sí',
    no: 'No',
    cancel: 'Cancelar',
    confirm: 'Confirmar',
    error: 'Error',
    warning: 'Advertencia',
    success: 'Éxito',
    info: 'Info',
    loading: 'Cargando...',
    processing: 'Procesando...',
    done: 'Listo',
    help: 'Ayuda',
    exit: 'Salir',
    back: 'Atrás',
    next: 'Siguiente',
    save: 'Guardar',
    delete: 'Eliminar',
    edit: 'Editar',
    create: 'Crear',
    search: 'Buscar',
    filter: 'Filtrar',
    sort: 'Ordenar',
    refresh: 'Actualizar',
    settings: 'Configuración',
    options: 'Opciones',
  },
  cli: {
    welcome: '¡Bienvenido a Code Buddy! Escribe tu solicitud o /help para los comandos.',
    goodbye: '¡Hasta luego! Sesión guardada.',
    inputPrompt: 'Hazme una pregunta...',
    thinking: 'Pensando...',
    executing: 'Ejecutando...',
    toolUse: 'Usando herramienta: {tool}',
    toolResult: 'Resultado de herramienta: {result}',
    noApiKey: 'No se encontró clave API. Configure la variable GROK_API_KEY.',
    invalidApiKey: 'Clave API inválida. Verifique sus credenciales.',
    rateLimited: 'Límite de velocidad excedido. Espere antes de reintentar.',
    networkError: 'Error de red. Verifique su conexión.',
    timeout: 'Tiempo de espera agotado. Inténtelo de nuevo.',
    sessionSaved: 'Sesión guardada correctamente.',
    sessionLoaded: 'Sesión cargada: {name}',
    historyCleared: 'Historial borrado.',
    modelChanged: 'Modelo cambiado a: {model}',
    costWarning: 'Advertencia: Costo de sesión ${cost} cerca del límite.',
    costLimit: 'Límite de costo alcanzado (${cost}). Sesión pausada.',
  },
  tools: {
    readingFile: 'Leyendo archivo: {path}',
    writingFile: 'Escribiendo en archivo: {path}',
    creatingFile: 'Creando archivo: {path}',
    deletingFile: 'Eliminando archivo: {path}',
    executingCommand: 'Ejecutando: {command}',
    searchingFiles: 'Buscando archivos: {pattern}',
    webSearching: 'Buscando en web: {query}',
    fetchingUrl: 'Obteniendo URL: {url}',
    analyzing: 'Analizando...',
    generating: 'Generando...',
    fileNotFound: 'Archivo no encontrado: {path}',
    permissionDenied: 'Permiso denegado: {path}',
    commandFailed: 'Comando fallido: {error}',
    confirmDelete: '¿Eliminar {path}? Esto no se puede deshacer.',
    confirmOverwrite: 'El archivo existe. ¿Sobreescribir {path}?',
    confirmExecute: '¿Ejecutar comando: {command}?',
  },
  errors: {
    unknown: 'Ocurrió un error desconocido.',
    notFound: 'Recurso no encontrado.',
    invalidInput: 'Entrada inválida.',
    unauthorized: 'Autenticación requerida.',
    forbidden: 'Acceso denegado.',
    serverError: 'Error del servidor. Inténtelo de nuevo.',
    connectionFailed: 'Conexión fallida.',
    parseError: 'Error al analizar la respuesta.',
    validationFailed: 'Validación fallida: {details}',
    operationCancelled: 'Operación cancelada.',
    featureNotAvailable: 'Función no disponible en esta versión.',
  },
  help: {
    title: 'Ayuda de Code Buddy',
    description: 'Asistente de terminal impulsado por IA para tareas de programación.',
    commands: 'Comandos disponibles:',
    examples: 'Ejemplos:',
    tips: 'Consejos:',
    moreInfo: 'Para más información, visita: {url}',
    version: 'Versión: {version}',
    usage: 'Uso: {usage}',
  },
};

// ============================================================================
// Japanese Translations
// ============================================================================

const ja: Translations = {
  common: {
    yes: 'はい',
    no: 'いいえ',
    cancel: 'キャンセル',
    confirm: '確認',
    error: 'エラー',
    warning: '警告',
    success: '成功',
    info: '情報',
    loading: '読み込み中...',
    processing: '処理中...',
    done: '完了',
    help: 'ヘルプ',
    exit: '終了',
    back: '戻る',
    next: '次へ',
    save: '保存',
    delete: '削除',
    edit: '編集',
    create: '作成',
    search: '検索',
    filter: 'フィルター',
    sort: '並び替え',
    refresh: '更新',
    settings: '設定',
    options: 'オプション',
  },
  cli: {
    welcome: 'Code Buddyへようこそ！リクエストを入力するか、/helpでコマンドを確認してください。',
    goodbye: 'さようなら！セッションを保存しました。',
    inputPrompt: '何でも聞いてください...',
    thinking: '考え中...',
    executing: '実行中...',
    toolUse: 'ツールを使用中: {tool}',
    toolResult: 'ツール結果: {result}',
    noApiKey: 'APIキーが見つかりません。GROK_API_KEY環境変数を設定してください。',
    invalidApiKey: '無効なAPIキーです。認証情報を確認してください。',
    rateLimited: 'レート制限を超えました。しばらく待ってから再試行してください。',
    networkError: 'ネットワークエラーです。接続を確認してください。',
    timeout: 'リクエストがタイムアウトしました。もう一度お試しください。',
    sessionSaved: 'セッションを正常に保存しました。',
    sessionLoaded: 'セッションを読み込みました: {name}',
    historyCleared: '履歴をクリアしました。',
    modelChanged: 'モデルを変更しました: {model}',
    costWarning: '警告: セッションコスト${cost}が上限に近づいています。',
    costLimit: 'コスト制限に達しました (${cost})。セッションを一時停止しました。',
  },
  tools: {
    readingFile: 'ファイルを読み込み中: {path}',
    writingFile: 'ファイルに書き込み中: {path}',
    creatingFile: 'ファイルを作成中: {path}',
    deletingFile: 'ファイルを削除中: {path}',
    executingCommand: '実行中: {command}',
    searchingFiles: 'ファイルを検索中: {pattern}',
    webSearching: 'ウェブ検索中: {query}',
    fetchingUrl: 'URLを取得中: {url}',
    analyzing: '分析中...',
    generating: '生成中...',
    fileNotFound: 'ファイルが見つかりません: {path}',
    permissionDenied: 'アクセスが拒否されました: {path}',
    commandFailed: 'コマンドが失敗しました: {error}',
    confirmDelete: '{path}を削除しますか？この操作は元に戻せません。',
    confirmOverwrite: 'ファイルが存在します。{path}を上書きしますか？',
    confirmExecute: 'コマンドを実行しますか: {command}？',
  },
  errors: {
    unknown: '不明なエラーが発生しました。',
    notFound: 'リソースが見つかりません。',
    invalidInput: '無効な入力です。',
    unauthorized: '認証が必要です。',
    forbidden: 'アクセスが拒否されました。',
    serverError: 'サーバーエラーです。もう一度お試しください。',
    connectionFailed: '接続に失敗しました。',
    parseError: 'レスポンスの解析に失敗しました。',
    validationFailed: '検証に失敗しました: {details}',
    operationCancelled: '操作がキャンセルされました。',
    featureNotAvailable: 'このバージョンでは利用できません。',
  },
  help: {
    title: 'Code Buddyヘルプ',
    description: 'コーディングタスクのためのAI搭載ターミナルアシスタント。',
    commands: '利用可能なコマンド:',
    examples: '例:',
    tips: 'ヒント:',
    moreInfo: '詳細については、{url}をご覧ください。',
    version: 'バージョン: {version}',
    usage: '使い方: {usage}',
  },
};

// ============================================================================
// Chinese (Simplified) Translations
// ============================================================================

const zh: Translations = {
  common: {
    yes: '是',
    no: '否',
    cancel: '取消',
    confirm: '确认',
    error: '错误',
    warning: '警告',
    success: '成功',
    info: '信息',
    loading: '加载中...',
    processing: '处理中...',
    done: '完成',
    help: '帮助',
    exit: '退出',
    back: '返回',
    next: '下一步',
    save: '保存',
    delete: '删除',
    edit: '编辑',
    create: '创建',
    search: '搜索',
    filter: '筛选',
    sort: '排序',
    refresh: '刷新',
    settings: '设置',
    options: '选项',
  },
  cli: {
    welcome: '欢迎使用 Code Buddy！输入您的请求或 /help 查看命令。',
    goodbye: '再见！会话已保存。',
    inputPrompt: '请输入您的问题...',
    thinking: '思考中...',
    executing: '执行中...',
    toolUse: '正在使用工具: {tool}',
    toolResult: '工具结果: {result}',
    noApiKey: '未找到 API 密钥。请设置 GROK_API_KEY 环境变量。',
    invalidApiKey: 'API 密钥无效。请检查您的凭据。',
    rateLimited: '超出速率限制。请稍后重试。',
    networkError: '网络错误。请检查您的连接。',
    timeout: '请求超时。请重试。',
    sessionSaved: '会话保存成功。',
    sessionLoaded: '已加载会话: {name}',
    historyCleared: '历史记录已清除。',
    modelChanged: '模型已更改为: {model}',
    costWarning: '警告：会话费用 ${cost} 接近上限。',
    costLimit: '已达费用上限 (${cost})。会话已暂停。',
  },
  tools: {
    readingFile: '正在读取文件: {path}',
    writingFile: '正在写入文件: {path}',
    creatingFile: '正在创建文件: {path}',
    deletingFile: '正在删除文件: {path}',
    executingCommand: '正在执行: {command}',
    searchingFiles: '正在搜索文件: {pattern}',
    webSearching: '正在搜索网页: {query}',
    fetchingUrl: '正在获取 URL: {url}',
    analyzing: '分析中...',
    generating: '生成中...',
    fileNotFound: '文件未找到: {path}',
    permissionDenied: '权限被拒绝: {path}',
    commandFailed: '命令执行失败: {error}',
    confirmDelete: '删除 {path}？此操作无法撤销。',
    confirmOverwrite: '文件已存在。覆盖 {path}？',
    confirmExecute: '执行命令: {command}？',
  },
  errors: {
    unknown: '发生未知错误。',
    notFound: '资源未找到。',
    invalidInput: '输入无效。',
    unauthorized: '需要身份验证。',
    forbidden: '访问被拒绝。',
    serverError: '服务器错误。请重试。',
    connectionFailed: '连接失败。',
    parseError: '解析响应失败。',
    validationFailed: '验证失败: {details}',
    operationCancelled: '操作已取消。',
    featureNotAvailable: '此版本不支持该功能。',
  },
  help: {
    title: 'Code Buddy 帮助',
    description: '用于编码任务的 AI 终端助手。',
    commands: '可用命令:',
    examples: '示例:',
    tips: '提示:',
    moreInfo: '更多信息请访问: {url}',
    version: '版本: {version}',
    usage: '用法: {usage}',
  },
};

// ============================================================================
// Translation Registry
// ============================================================================

const translations: Record<Locale, Translations> = {
  en,
  fr,
  de,
  es,
  ja,
  zh,
};

// ============================================================================
// I18n Manager
// ============================================================================

/**
 * Internationalization manager
 */
class I18nManager extends EventEmitter {
  private currentLocale: Locale = 'en';
  private fallbackLocale: Locale = 'en';

  constructor() {
    super();
    this.detectLocale();
  }

  /**
   * Detect locale from environment
   */
  private detectLocale(): void {
    const envLocale = process.env.LANG || process.env.LC_ALL || process.env.LANGUAGE || '';
    const localeCode = envLocale.split('.')[0].split('_')[0].toLowerCase() as Locale;

    if (localeCode && translations[localeCode]) {
      this.currentLocale = localeCode;
    }
  }

  /**
   * Get current locale
   */
  getLocale(): Locale {
    return this.currentLocale;
  }

  /**
   * Set locale
   */
  setLocale(locale: Locale): void {
    if (translations[locale]) {
      this.currentLocale = locale;
      this.emit('localeChanged', locale);
    }
  }

  /**
   * Get available locales
   */
  getAvailableLocales(): Locale[] {
    return Object.keys(translations) as Locale[];
  }

  /**
   * Get translation for a key path
   * @param keyPath - Dot-separated key path (e.g., 'cli.welcome')
   * @param params - Optional parameters for interpolation
   */
  t(keyPath: string, params?: Record<string, string | number>): string {
    const keys = keyPath.split('.');
    let value: unknown = translations[this.currentLocale];

    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = (value as Record<string, unknown>)[key];
      } else {
        // Try fallback locale
        value = translations[this.fallbackLocale];
        for (const k of keys) {
          if (value && typeof value === 'object' && k in value) {
            value = (value as Record<string, unknown>)[k];
          } else {
            return keyPath; // Return key if not found
          }
        }
        break;
      }
    }

    if (typeof value !== 'string') {
      return keyPath;
    }

    // Interpolate parameters
    if (params) {
      return value.replace(/\{(\w+)\}/g, (_, key) => {
        return params[key]?.toString() ?? '{' + key + '}';
      });
    }

    return value;
  }

  /**
   * Get all translations for a category
   */
  getCategory<K extends keyof Translations>(category: K): Translations[K] {
    return translations[this.currentLocale][category];
  }
}

// ============================================================================
// Singleton
// ============================================================================

let i18nInstance: I18nManager | null = null;

/**
 * Get or create I18n manager singleton
 */
export function getI18n(): I18nManager {
  if (!i18nInstance) {
    i18nInstance = new I18nManager();
  }
  return i18nInstance;
}

/**
 * Shorthand for translation
 */
export function t(keyPath: string, params?: Record<string, string | number>): string {
  return getI18n().t(keyPath, params);
}

/**
 * Reset I18n manager (for testing)
 */
export function resetI18n(): void {
  i18nInstance = null;
}

// Export translations for extension
export { en, fr, de, es, ja, zh, translations };
export default I18nManager;
