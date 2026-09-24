/**
 * Schéma Zod de la configuration TOML écrite par l'utilisateur,
 * et schéma d'environnement dérivé de ENV_SCHEMA.
 *
 * Le schéma strict sert au refus des clés inconnues, à l'export JSON
 * et à l'exemple commenté. Le schéma permissif sert à relire un fichier
 * déjà présent : une clé historique qui n'est plus proposée à l'écriture
 * (model_id répété par un fichier généré) ne bloque pas une autre clé.
 * Les clés retirées du catalogue ne sont pas des clés d'écriture :
 * mode replace, rôles autres que primary, cache de fenêtre, model_id.
 */

import { z, type ZodTypeAny } from 'zod';

import { ENV_SCHEMA, type EnvVarDef } from './env-schema.js';

/** Valeur sentinelle : retirer une clé au lieu de l'écrire. */
export const USER_CONFIG_DELETE = Symbol('user-config-delete');

const capability = z.enum(['companion', 'film', 'sensory', 'robot', 'vision_train']);

type ObjectMode = 'strict' | 'passthrough';

function asObject(shape: Record<string, ZodTypeAny>, mode: ObjectMode): ZodTypeAny {
  const schema = z.object(shape);
  return mode === 'strict' ? schema.strict() : schema.passthrough();
}

function providerShape(): Record<string, ZodTypeAny> {
  return {
    base_url: z.string().optional().describe('URL de base du fournisseur'),
    api_key_env: z.string().optional().describe('Nom de la variable qui porte la clé, jamais la clé elle-même'),
    type: z.enum(['openai', 'anthropic', 'google', 'xai', 'custom']).optional().describe('Protocole du fournisseur'),
    enabled: z.boolean().optional().describe('Fournisseur utilisable'),
  };
}

function modelShape(): Record<string, ZodTypeAny> {
  return {
    provider: z.string().optional().describe('Colonne historique. Elle ne choisit pas le fournisseur de la session'),
    description: z.string().optional().describe('Libellé affiché'),
    max_context_tokens: z.number().nonnegative().optional().describe('Fenêtre de contexte déclarée'),
    context_window: z.number().nonnegative().optional().describe('Alias de la fenêtre de contexte'),
    max_tokens: z.number().nonnegative().optional().describe('Plafond de sortie'),
    max_output_tokens: z.number().nonnegative().optional().describe('Alias du plafond de sortie'),
    price_per_m_input: z.number().nonnegative().optional().describe('Prix d\'un million de jetons entrants. À écrire avec le prix sortant'),
    price_per_m_output: z.number().nonnegative().optional().describe('Prix d\'un million de jetons sortants. À écrire avec le prix entrant'),
    reasoning: z.boolean().optional().describe('Le modèle raisonne'),
    vision: z.boolean().optional().describe('Le modèle accepte une image. Si cette clé est absente, input peut la déduire'),
    tools: z.boolean().optional().describe('Le modèle appelle des outils'),
    input: z.array(z.enum(['text', 'image'])).optional().describe('Modalités d\'entrée : text et image'),
  };
}

function toolShape(): Record<string, ZodTypeAny> {
  return {
    permission: z.enum(['always', 'ask', 'never']).optional().describe('Niveau d\'autorisation'),
    timeout: z.number().nonnegative().optional().describe('Délai en secondes'),
    allowlist: z.array(z.string()).optional().describe('Motifs autorisés'),
    denylist: z.array(z.string()).optional().describe('Motifs refusés'),
    settings: z.record(z.unknown()).optional().describe('Réglages propres à l\'outil'),
  };
}

function middlewareShape(): Record<string, ZodTypeAny> {
  return {
    max_turns: z.number().default(100).describe('Tours maximum'),
    turn_warning_threshold: z.number().default(0.8).describe('Seuil d\'avertissement des tours, entre 0 et 1'),
    max_cost: z.number().default(10).describe('Plafond de coût de session'),
    cost_warning_threshold: z.number().default(0.8).describe('Seuil d\'avertissement du coût, entre 0 et 1'),
    auto_compact_threshold: z.number().default(80000).describe('Seuil de compactage automatique, en jetons'),
    context_warning_percentage: z.number().default(0.7).describe('Seuil d\'avertissement du contexte, entre 0 et 1'),
  };
}

function uiShape(): Record<string, ZodTypeAny> {
  return {
    vim_keybindings: z.boolean().default(false).describe('Raccourcis vim'),
    theme: z.string().default('default').describe('Nom du thème'),
    show_tokens: z.boolean().default(true).describe('Afficher le compteur de jetons'),
    show_cost: z.boolean().default(true).describe('Afficher le coût'),
    streaming: z.boolean().default(true).describe('Réponse en flux'),
    sound_effects: z.boolean().default(false).describe('Sons d\'interface'),
  };
}

function agentShape(): Record<string, ZodTypeAny> {
  return {
    yolo_mode: z.boolean().default(false).describe('Autonomie élargie'),
    parallel_tools: z.boolean().default(false).describe('Outils en parallèle'),
    rag_tool_selection: z.boolean().default(true).describe('Sélection d\'outils par similarité'),
    self_healing: z.boolean().default(true).describe('Réparation proposée après une erreur'),
    default_prompt: z.string().default('default').describe('Identifiant du prompt système'),
    architect_model: z.string().optional().describe('Modèle de planification'),
    editor_model: z.string().optional().describe('Modèle d\'édition'),
  };
}

function integrationsShape(): Record<string, ZodTypeAny> {
  return {
    rtk_enabled: z.boolean().default(false).describe('Compression des sorties de commandes, désactivée par défaut'),
    rtk_min_output_length: z.number().default(500).describe('Longueur minimale avant compression'),
    icm_enabled: z.boolean().default(true).describe('Mémoire de contexte persistante'),
  };
}

function surfaceShape(): Record<string, ZodTypeAny> {
  return {
    hidden_capabilities: z.array(capability).default([]).describe('Domaines masqués de la surface'),
  };
}

function modelPairsShape(): Record<string, ZodTypeAny> {
  return {
    architect: z.string().optional().describe('Modèle qui planifie'),
    editor: z.string().optional().describe('Modèle qui modifie'),
  };
}

function llmShape(): Record<string, ZodTypeAny> {
  return {
    enabled: z.boolean().default(false).describe('Repli automatique entre fournisseurs'),
    order: z.enum(['resilience', 'free-first', 'manual']).optional().describe('Ordre du repli'),
    manualOrder: z.array(z.string()).optional().describe('Ordre manuel des fournisseurs'),
    local_only: z.boolean().optional().describe('Limiter le repli aux exécutions locales'),
    together_strategy: z.enum(['ensemble', 'consensus', 'fastest', 'cascade']).optional().describe('Stratégie collective'),
  };
}

function agentParamsShape(): Record<string, ZodTypeAny> {
  return {
    temperature: z.number().optional().describe('Température'),
    maxTokens: z.number().optional().describe('Jetons de sortie'),
    model: z.string().optional().describe('Modèle de cet agent'),
  };
}

function agentDefaultsShape(mode: ObjectMode): Record<string, ZodTypeAny> {
  return {
    imageGenerationModel: z.string().optional().describe('Modèle de génération d\'image'),
    agents: z.record(asObject(agentParamsShape(), mode)).optional().describe('Réglages par agent'),
  };
}

function advisorShape(): Record<string, ZodTypeAny> {
  return {
    enabled: z.boolean().optional().describe('Second avis activé'),
    model: z.string().optional().describe('Modèle du second avis'),
    api_key_env: z.string().optional().describe('Variable de la clé du second avis, jamais la clé'),
    base_url: z.string().optional().describe('URL du second avis'),
  };
}

function lspCompletionShape(): Record<string, ZodTypeAny> {
  return {
    enabled: z.boolean().optional().describe('Complétions inline'),
    debounceMs: z.number().optional().describe('Délai avant une demande, en millisecondes'),
    maxSuggestions: z.number().optional().describe('Nombre de suggestions'),
    maxTokens: z.number().optional().describe('Jetons par suggestion'),
    model: z.string().optional().describe('Modèle des complétions'),
  };
}

function lspShape(mode: ObjectMode): Record<string, ZodTypeAny> {
  return {
    aiCompletion: asObject(lspCompletionShape(), mode).optional().describe('Complétions'),
  };
}

function heartbeatShape(): Record<string, ZodTypeAny> {
  return {
    enabled: z.boolean().default(false).describe('Battement périodique'),
    interval_minutes: z.number().default(30).describe('Intervalle en minutes'),
    active_hours_start: z.number().default(8).describe('Heure de début, 0 à 23'),
    active_hours_end: z.number().default(22).describe('Heure de fin, 0 à 23'),
    heartbeat_file: z.string().default('.codebuddy/HEARTBEAT.md').describe('Liste de contrôle'),
    suppression_keyword: z.string().default('HEARTBEAT_OK').describe('Mot qui évite une relance'),
    max_consecutive_suppressions: z.number().default(5).describe('Relances silencieuses avant une revue'),
  };
}

function fleetShape(): Record<string, ZodTypeAny> {
  return {
    enabled: z.boolean().default(false).describe('Battement autonome de flotte'),
    repo_path: z.string().optional().describe('Dépôt qui sert de bus'),
    host: z.string().optional().describe('Nom d\'hôte annoncé'),
    interval_minutes: z.number().default(30).describe('Intervalle en minutes'),
    max_task_ms: z.number().default(600000).describe('Durée maximale d\'une tâche, en millisecondes'),
    priority_threshold: z.enum(['high', 'medium', 'low']).default('high').describe('Priorité la plus basse acceptée'),
    llm_provider: z.enum(['cloud', 'auto', 'ollama', 'grok', 'anthropic', 'gemini', 'openai']).default('cloud').describe('Fournisseur des tâches autonomes'),
  };
}

function dailyResetShape(): Record<string, ZodTypeAny> {
  return {
    enabled: z.boolean().default(false).describe('Remise à zéro quotidienne'),
    reset_hour: z.number().default(4).describe('Heure, 0 à 23'),
    reset_minute: z.number().default(0).describe('Minute, 0 à 59'),
    timezone: z.string().optional().describe('Fuseau horaire'),
    post_summary: z.boolean().default(true).describe('Publier un résumé'),
    idle_minutes: z.number().default(0).describe('Inactivité avant remise à zéro, 0 pour désactiver'),
  };
}

function teamSessionShape(): Record<string, ZodTypeAny> {
  return {
    enabled: z.boolean().default(false).describe('Sessions d\'équipe'),
    server_url: z.string().optional().describe('URL de synchronisation'),
    enable_encryption: z.boolean().default(true).describe('Chiffrer les sessions'),
    encryption_key: z.string().optional().describe('Référence de la clé de chiffrement, jamais la clé en clair'),
    auto_reconnect: z.boolean().default(true).describe('Reconnexion automatique'),
    reconnect_interval: z.number().default(5000).describe('Délai de reconnexion, en millisecondes'),
    heartbeat_interval: z.number().default(30000).describe('Intervalle de battement, en millisecondes'),
    max_reconnect_attempts: z.number().default(10).describe('Tentatives de reconnexion'),
  };
}

function coordinationShape(): Record<string, ZodTypeAny> {
  return {
    enabled: z.boolean().default(false).describe('Coordinateur avancé'),
    enable_adaptive_allocation: z.boolean().default(true).describe('Répartition adaptative'),
    min_assignment_confidence: z.number().default(0.6).describe('Confiance minimale'),
    max_parallel_per_agent: z.number().default(2).describe('Tâches parallèles par agent'),
    enable_conflict_resolution: z.boolean().default(true).describe('Détection de conflits'),
    conflict_timeout: z.number().default(30000).describe('Délai de conflit, en millisecondes'),
    enable_learning: z.boolean().default(true).describe('Apprentissage de la répartition'),
    history_size: z.number().default(50).describe('Taille de l\'historique'),
    checkpoint_interval: z.number().default(5).describe('Tâches entre deux points de reprise'),
    auto_resolve_enabled: z.boolean().default(false).describe('Résolution automatique des conflits'),
    auto_resolve_strategy: z.enum(['prefer-reviewer', 'none']).default('none').describe('Stratégie de résolution'),
    enable_persistence: z.boolean().default(false).describe('Conserver les métriques'),
    metrics_ttl_days: z.number().default(30).describe('Jours avant qu\'une métrique soit périmée'),
    max_concurrent_workflows: z.number().default(1).describe('Flux simultanés'),
    queue_policy: z.enum(['queue', 'reject']).default('queue').describe('File pleine'),
    enable_per_workflow_stop: z.boolean().default(false).describe('Arrêt d\'un seul flux'),
  };
}

function sessionsShape(): Record<string, ZodTypeAny> {
  return {
    enabled: z.boolean().default(false).describe('Registre de sessions'),
    max_sessions: z.number().default(1000).describe('Sessions conservées'),
    idle_timeout_minutes: z.number().default(30).describe('Inactivité avant nettoyage'),
    enable_persistence: z.boolean().default(true).describe('Écrire les sessions'),
    max_per_workflow: z.number().default(10).describe('Sous-agents par flux'),
    require_confirmation_for_send: z.boolean().default(false).describe('Confirmer un envoi'),
    require_confirmation_for_spawn: z.boolean().default(false).describe('Confirmer une création'),
    max_spawn_per_minute: z.number().default(0).describe('Créations par minute, 0 pour désactiver'),
  };
}

function flagShape(mode: ObjectMode): ZodTypeAny {
  return asObject({
    enabled: z.boolean().optional().describe('Module activé'),
  }, mode);
}

function enterpriseShape(mode: ObjectMode): Record<string, ZodTypeAny> {
  return {
    enabled: z.boolean().default(false).describe('Interrupteur des modules'),
    tool_policy_engine: flagShape(mode).optional().describe('Moteur de politique d\'outils, inactif par défaut'),
    tool_lifecycle_hooks: flagShape(mode).optional().describe('Crochets de cycle de vie, inactifs par défaut'),
    smart_compaction_engine: flagShape(mode).optional().describe('Compactage supplémentaire, inactif par défaut'),
    retry_fallback_engine: flagShape(mode).optional().describe('Repli de nouvelle tentative, inactif par défaut'),
    semantic_memory_search: flagShape(mode).optional().describe('Recherche sémantique supplémentaire, inactive par défaut'),
    plugin_conflict_detector: flagShape(mode).optional().describe('Détecteur de conflit de greffons'),
  };
}

function multiAgentShape(mode: ObjectMode): Record<string, ZodTypeAny> {
  return {
    enabled: z.boolean().default(false).describe('Système multi-agent'),
    default_strategy: z.enum(['sequential', 'parallel', 'hierarchical', 'peer_review', 'iterative']).default('hierarchical').describe('Stratégie'),
    parallel_agents: z.number().default(3).describe('Agents en parallèle'),
    timeout_ms: z.number().default(600000).describe('Délai d\'un flux, en millisecondes'),
    max_iterations: z.number().default(5).describe('Itérations'),
    coordination: asObject(coordinationShape(), mode).optional().describe('Coordinateur'),
    sessions: asObject(sessionsShape(), mode).optional().describe('Registre de sessions'),
    max_workflow_cost_usd: z.number().default(0).describe('Plafond de coût, 0 pour désactiver'),
    cost_warning_threshold_percent: z.number().default(0.8).describe('Seuil d\'avertissement du coût'),
    graceful_cost_overflow: z.boolean().default(true).describe('Arrêt propre au plafond'),
  };
}

function catalogueShape(): Record<string, ZodTypeAny> {
  return {
    mode: z.enum(['merge']).default('merge').describe('Seul mode accepté. Une entrée ne remplace que les champs qu\'elle écrit'),
  };
}

function modelRolesShape(): Record<string, ZodTypeAny> {
  return {
    primary: z.string().optional().describe('Modèle principal de la session'),
  };
}

function aliasValueSchema(): ZodTypeAny {
  return z.union([
    z.string().describe('Nom de modèle, ou un autre alias'),
    z.object({
      model: z.string().describe('Nom de modèle, ou un autre alias'),
      provider: z.string().optional().describe('Fournisseur réellement utilisé par la session. Absent : le fournisseur détecté reste'),
      base_url: z.string().optional().describe('URL réellement utilisée par la session. Absente : celle du fournisseur, ou l\'URL détectée'),
    }).strict().describe('Alias avec modèle, fournisseur et URL'),
  ]).describe('Cible d\'un alias');
}

function gatewayShape(): Record<string, ZodTypeAny> {
  return {
    bind: z.enum(['loopback', 'lan']).optional().describe('Écoute. lan est plus ouvert que loopback'),
    port: z.number().int().min(1).max(65535).optional().describe('Port de la passerelle'),
    auth_mode: z.enum(['token', 'none']).optional().describe('Authentification. none est plus ouvert que token'),
  };
}

function channelEntryShape(): Record<string, ZodTypeAny> {
  return {
    enabled: z.boolean().optional().describe('Canal utilisable'),
    group_policy: z.enum(['open', 'allowlist']).optional().describe('Accueil des groupes. allowlist est plus fermé que open'),
    dm_policy: z.enum(['open', 'allowlist', 'disabled']).optional().describe('Messages privés. disabled est plus fermé'),
  };
}

function mcpShape(): Record<string, ZodTypeAny> {
  return {
    allow_write: z.boolean().optional().describe('Écriture via les serveurs. false retire une autorisation'),
    enabled_servers: z.array(z.string()).optional().describe('Serveurs que la configuration active'),
  };
}

function sandboxShape(): Record<string, ZodTypeAny> {
  return {
    mode: z.enum(['off', 'non-main', 'all']).optional().describe('Posture du bac à sable. all est plus fermé que off'),
    backend: z.enum(['bwrap', 'docker', 'landlock', 'seatbelt', 'ssh']).optional().describe('Moteur d\'isolation choisi'),
  };
}

function execShape(): Record<string, ZodTypeAny> {
  return {
    approvals: z.enum(['off', 'ask', 'always']).optional().describe('Approbation des commandes. always est plus fermé que off'),
    allow_commands: z.array(z.string()).optional().describe('Commandes pré-autorisées. Une politique ne peut pas en ajouter'),
    deny_commands: z.array(z.string()).optional().describe('Fragments de commande refusés'),
  };
}

function sectionShape(mode: ObjectMode): Record<string, ZodTypeAny> {
  return {
    active_model: z.string().optional().describe('Modèle du profil, ou modèle actif à la racine'),
    catalogue: asObject(catalogueShape(), mode).optional().describe('Mode du catalogue'),
    model_roles: asObject(modelRolesShape(), mode).optional().describe('Rôles. Seul primary est lu'),
    model_aliases: z.record(aliasValueSchema()).optional().describe('Alias résolus avant le catalogue. Chaîne, ou table model, provider et base_url'),
    providers: z.record(asObject(providerShape(), mode)).optional().describe('Fournisseurs'),
    models: z.record(asObject(modelShape(), mode)).optional().describe('Modèles déclarés'),
    tool_config: z.record(asObject(toolShape(), mode)).optional().describe('Outils'),
    middleware: asObject(middlewareShape(), mode).optional().describe('Limites de session'),
    ui: asObject(uiShape(), mode).optional().describe('Interface'),
    agent: asObject(agentShape(), mode).optional().describe('Comportement de l\'agent'),
    integrations: asObject(integrationsShape(), mode).optional().describe('Intégrations'),
    surface: asObject(surfaceShape(), mode).optional().describe('Surface visible'),
    model_pairs: asObject(modelPairsShape(), mode).optional().describe('Paire architecte et éditeur'),
    llm: asObject(llmShape(), mode).optional().describe('Repli de fournisseur'),
    agent_defaults: asObject(agentDefaultsShape(mode), mode).optional().describe('Réglages par agent'),
    advisor: asObject(advisorShape(), mode).optional().describe('Second avis'),
    lsp: asObject(lspShape(mode), mode).optional().describe('Serveur de langage'),
    heartbeat: asObject(heartbeatShape(), mode).optional().describe('Battement'),
    autonomous_fleet: asObject(fleetShape(), mode).optional().describe('Flotte autonome'),
    daily_reset: asObject(dailyResetShape(), mode).optional().describe('Remise à zéro quotidienne'),
    team_session: asObject(teamSessionShape(), mode).optional().describe('Session d\'équipe'),
    multi_agent_system: asObject(multiAgentShape(mode), mode).optional().describe('Système multi-agent'),
    enterprise_modules: asObject(enterpriseShape(mode), mode).optional().describe('Modules d\'entreprise'),
    gateway: asObject(gatewayShape(), mode).optional().describe('Passerelle'),
    channels: z.record(asObject(channelEntryShape(), mode)).optional().describe('Canaux de messagerie'),
    mcp: asObject(mcpShape(), mode).optional().describe('Serveurs MCP'),
    sandbox: asObject(sandboxShape(), mode).optional().describe('Bac à sable'),
    exec: asObject(execShape(), mode).optional().describe('Approbations d\'exécution'),
  };
}

function buildTomlSchema(mode: ObjectMode): ZodTypeAny {
  return asObject({
    ...sectionShape(mode),
    active_model: z.string().default('grok-code-fast').describe('Modèle actif. La valeur du fichier généré ne masque pas le fournisseur détecté'),
    profiles: z.record(asObject(sectionShape(mode), mode)).optional().describe('Profils nommés, activés avec --profile'),
  }, mode);
}

/** Clés qu'une commande d'écriture a le droit de créer ou de modifier. */
export const writableTomlSchema = buildTomlSchema('strict');

/** Relecture d'un fichier déjà là : les clés inconnues déjà présentes restent. */
export const onDiskTomlSchema = buildTomlSchema('passthrough');

function envField(def: EnvVarDef): ZodTypeAny {
  let field: ZodTypeAny;
  if (def.type === 'number') {
    let numberField = z.number();
    if (def.min !== undefined) numberField = numberField.min(def.min);
    if (def.max !== undefined) numberField = numberField.max(def.max);
    field = numberField;
  } else if (def.type === 'boolean') {
    field = z.boolean();
  } else if (def.pattern) {
    field = z.string().regex(def.pattern);
  } else {
    field = z.string();
  }
  const described = field.describe(def.description);
  if (def.default === undefined) return described.optional();
  if (def.type === 'number') {
    let numberField = z.number();
    if (def.min !== undefined) numberField = numberField.min(def.min);
    if (def.max !== undefined) numberField = numberField.max(def.max);
    return numberField.describe(def.description).default(Number(def.default));
  }
  if (def.type === 'boolean') {
    return z.boolean().describe(def.description).default(def.default === 'true');
  }
  return z.string().describe(def.description).default(def.default);
}

const envShape: Record<string, ZodTypeAny> = {};
for (const def of ENV_SCHEMA) {
  envShape[def.name] = envField(def);
}

/** Schéma d'environnement : une propriété par entrée de ENV_SCHEMA, sans liste recopiée. */
export const envConfigSchema = z.object(envShape).passthrough();

export type WritableTomlDocument = z.infer<typeof writableTomlSchema>;

/** Un enregistrement accepterait n'importe quel segment : ces trois noms restent interdits. */
const FORBIDDEN_CONFIG_SEGMENTS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

export function configSegmentError(keyPath: string, segment: string): string | null {
  if (!FORBIDDEN_CONFIG_SEGMENTS.has(segment)) return null;
  return `Clé refusée « ${keyPath} ». Le segment « ${segment} » n'est pas une clé de configuration.`;
}

export interface OwnPathRead {
  ok: boolean;
  message: string;
  value?: unknown;
}

/** Lecture : segment interdit ou propriété héritée, jamais la valeur du prototype. */
export function readOwnPath(root: unknown, keyPath: string): OwnPathRead {
  if (keyPath.trim() === '' || keyPath.split('.').some((part) => part.length === 0)) {
    return { ok: false, message: 'Empty key path' };
  }
  const parts = keyPath.split('.');
  let current: unknown = root;
  for (const part of parts) {
    const denied = configSegmentError(keyPath, part);
    if (denied) return { ok: false, message: denied };
    if (current === null || typeof current !== 'object' || Array.isArray(current)) {
      return { ok: false, message: `Clé inconnue « ${keyPath} ».` };
    }
    const record = current as Record<string, unknown>;
    if (!Object.hasOwn(record, part)) {
      return { ok: false, message: `Clé inconnue « ${keyPath} ».` };
    }
    current = record[part];
  }
  return { ok: true, message: '', value: current };
}

function defRecord(schema: ZodTypeAny): Record<string, unknown> | null {
  if (schema === null || schema === undefined || typeof schema !== 'object') return null;
  const def = (schema as { _def?: unknown })._def;
  if (!def || typeof def !== 'object') return null;
  return def as Record<string, unknown>;
}

function typeName(schema: ZodTypeAny): string {
  const def = defRecord(schema);
  if (!def || !Object.hasOwn(def, 'typeName')) return 'undefined';
  const name = def.typeName;
  return name === undefined || name === null ? 'undefined' : String(name);
}

function unwrap(schema: ZodTypeAny): ZodTypeAny {
  let current = schema;
  for (let guard = 0; guard < 8; guard += 1) {
    const name = typeName(current);
    const def = defRecord(current);
    if (!def) return current;
    if (name === 'ZodOptional' || name === 'ZodDefault' || name === 'ZodNullable') {
      const inner = def.innerType;
      if (!inner || typeof inner !== 'object') return current;
      current = inner as ZodTypeAny;
      continue;
    }
    if (name === 'ZodEffects') {
      const inner = def.schema;
      if (!inner || typeof inner !== 'object') return current;
      current = inner as ZodTypeAny;
      continue;
    }
    return current;
  }
  return current;
}

function ownSchemaChild(shape: Record<string, ZodTypeAny>, part: string): ZodTypeAny | undefined {
  if (FORBIDDEN_CONFIG_SEGMENTS.has(part) || !Object.hasOwn(shape, part)) return undefined;
  return shape[part];
}

function unionOptions(schema: ZodTypeAny): ZodTypeAny[] {
  const options = schema._def.options;
  return Array.isArray(options) ? options as ZodTypeAny[] : [];
}

/** Branche objet d'une union chaîne | table, pour écrire model, provider ou base_url. */
function unionObject(schema: ZodTypeAny): ZodTypeAny | null {
  for (const option of unionOptions(schema)) {
    const inner = unwrap(option);
    if (typeName(inner) === 'ZodObject') return inner;
  }
  return null;
}

function descriptionOf(schema: ZodTypeAny | null): string | undefined {
  if (!schema) return undefined;
  const own = schema._def.description as string | undefined;
  if (own) return own;
  const inner = unwrap(schema);
  return inner._def.description as string | undefined;
}

function defaultOf(schema: ZodTypeAny | null): unknown {
  if (!schema) return undefined;
  if (typeName(schema) === 'ZodDefault') return schema._def.defaultValue();
  if (typeName(schema) === 'ZodOptional') return defaultOf(schema._def.innerType as ZodTypeAny);
  return undefined;
}

export interface ConfigPathVerdict {
  ok: boolean;
  kind: 'ok' | 'empty' | 'unknown' | 'through-scalar';
  message: string;
}

function acceptedKeys(schema: ZodTypeAny): string {
  const node = unwrap(schema);
  if (typeName(node) !== 'ZodObject') return '';
  const shape = node._def.shape() as Record<string, ZodTypeAny>;
  return Object.keys(shape).sort().join(', ');
}

/**
 * Dit si un chemin pointé peut être écrit.
 * Un segment après une feuille reprend le message historique du mutateur.
 */
export function classifyConfigPath(keyPath: string, schema: ZodTypeAny = writableTomlSchema): ConfigPathVerdict {
  if (keyPath.trim() === '' || keyPath.split('.').some((part) => part.length === 0)) {
    return { ok: false, kind: 'empty', message: 'Empty key path' };
  }
  const parts = keyPath.split('.');
  let node = schema;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] ?? '';
    const denied = configSegmentError(keyPath, part);
    if (denied) return { ok: false, kind: 'unknown', message: denied };
    node = unwrap(node);
    if (typeName(node) === 'ZodUnion') {
      const branch = unionObject(node);
      if (!branch) {
        const stopped = parts.slice(0, index).join('.');
        return {
          ok: false,
          kind: 'through-scalar',
          message: `Cannot navigate through non-object at "${stopped}" (type: string)`,
        };
      }
      node = branch;
    }
    const name = typeName(node);
    if (name === 'ZodObject') {
      const shape = node._def.shape() as Record<string, ZodTypeAny>;
      const child = ownSchemaChild(shape, part);
      if (!child) {
        if (part === 'model_id' && parts[0] === 'models') {
          return {
            ok: false,
            kind: 'unknown',
            message: `Clé refusée « ${keyPath} ». model_id n'est pas une clé d'écriture du catalogue : le nom envoyé reste l'identifiant intégré. Retirez model_id.`,
          };
        }
        const parent = parts.slice(0, index).join('.') || 'racine';
        const known = acceptedKeys(node);
        return {
          ok: false,
          kind: 'unknown',
          message: `Clé inconnue « ${keyPath} ». Sous « ${parent} », les clés acceptées sont : ${known}.`,
        };
      }
      node = child;
      continue;
    }
    if (name === 'ZodRecord') {
      node = node._def.valueType as ZodTypeAny;
      continue;
    }
    const stopped = parts.slice(0, index).join('.');
    const kind = name === 'ZodNumber' ? 'number' : name === 'ZodBoolean' ? 'boolean' : 'string';
    return {
      ok: false,
      kind: 'through-scalar',
      message: `Cannot navigate through non-object at "${stopped}" (type: ${kind})`,
    };
  }
  return { ok: true, kind: 'ok', message: '' };
}

function schemaAt(keyPath: string, schema: ZodTypeAny = writableTomlSchema): ZodTypeAny | null {
  if (!classifyConfigPath(keyPath, schema).ok) return null;
  const parts = keyPath.split('.');
  let node = schema;
  for (const part of parts) {
    if (configSegmentError(keyPath, part)) return null;
    node = unwrap(node);
    if (typeName(node) === 'ZodUnion') {
      const branch = unionObject(node);
      if (!branch) return null;
      node = branch;
    }
    const name = typeName(node);
    if (name === 'ZodObject') {
      const shape = node._def.shape() as Record<string, ZodTypeAny>;
      const child = ownSchemaChild(shape, part);
      if (!child) return null;
      node = child;
      continue;
    }
    if (name === 'ZodRecord') {
      node = node._def.valueType as ZodTypeAny;
      continue;
    }
    return null;
  }
  return node;
}

function coerceForSchema(schema: ZodTypeAny, value: unknown): unknown {
  const node = unwrap(schema);
  const name = typeName(node);
  if (name === 'ZodNumber' && typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (name === 'ZodBoolean' && (value === 'true' || value === 'false')) {
    return value === 'true';
  }
  return value;
}

/** Contrôle la valeur d'une clé déjà reconnue. `null` si elle est acceptable. */
export function validateConfigValue(keyPath: string, value: unknown): string | null {
  if (keyPath === 'catalogue.mode' && value !== 'merge') {
    return `mode « ${String(value)} » n'est pas pris en charge. Écrivez merge : une entrée ne remplace que les champs qu'elle écrit.`;
  }
  const node = schemaAt(keyPath);
  if (!node) return `Clé inconnue « ${keyPath} ».`;
  const coerced = coerceForSchema(node, value);
  const parsed = unwrap(node).safeParse(coerced);
  if (parsed.success) return null;
  const issue = parsed.error.issues[0];
  const expected = typeName(unwrap(node)) === 'ZodNumber'
    ? 'number'
    : typeName(unwrap(node)) === 'ZodBoolean'
      ? 'boolean'
      : typeName(unwrap(node)) === 'ZodString' || typeName(unwrap(node)) === 'ZodEnum'
        ? 'string'
        : 'valeur attendue';
  return `Type mismatch for "${keyPath}": Expected ${expected}, got ${issue?.message ?? typeof value}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Première erreur de forme sur un document déjà parsé. Les clés inconnues restent. */
export function validateOnDiskDocument(parsed: Record<string, unknown>): string | null {
  const catalogue = parsed.catalogue;
  if (catalogue !== undefined && !isPlainRecord(catalogue)) {
    return 'la section [catalogue] doit être une table.';
  }
  if (isPlainRecord(catalogue)) {
    const mode = catalogue.mode;
    if (mode !== undefined && mode !== 'merge') {
      return `mode « ${String(mode)} » n'est pas pris en charge. Écrivez merge : une entrée ne remplace que les champs qu'elle écrit.`;
    }
    for (const key of Object.keys(catalogue)) {
      if (key !== 'mode') {
        return `clé « ${key} » inconnue dans [catalogue]. Cette version ne lit que mode = "merge". Retirez la clé.`;
      }
    }
  }
  const roles = parsed.model_roles;
  if (roles !== undefined && !isPlainRecord(roles)) {
    return 'la section [model_roles] doit être une table.';
  }
  if (isPlainRecord(roles)) {
    for (const key of Object.keys(roles)) {
      if (key !== 'primary') {
        return `le rôle « ${key} » n'est pas pris en charge. Seul primary choisit le modèle de la session. Retirez cette clé.`;
      }
    }
  }
  const result = onDiskTomlSchema.safeParse(parsed);
  if (result.success) return null;
  const issue = result.error.issues[0];
  const where = issue?.path.join('.') || 'racine';
  return `Valeur refusée pour « ${where} » : ${issue?.message ?? 'invalide'}`;
}

function collectPaths(schema: ZodTypeAny, prefix: string, into: string[]): void {
  const node = unwrap(schema);
  const name = typeName(node);
  if (name === 'ZodObject') {
    if (prefix) into.push(prefix);
    const shape = node._def.shape() as Record<string, ZodTypeAny>;
    for (const key of Object.keys(shape).sort()) {
      const child = shape[key];
      if (!child) continue;
      collectPaths(child, prefix ? `${prefix}.${key}` : key, into);
    }
    return;
  }
  if (name === 'ZodRecord') {
    if (prefix) into.push(prefix);
    const star = prefix ? `${prefix}.*` : '*';
    collectPaths(node._def.valueType as ZodTypeAny, star, into);
    return;
  }
  if (name === 'ZodUnion') {
    if (prefix) into.push(prefix);
    const branch = unionObject(node);
    if (!branch) return;
    const shape = branch._def.shape() as Record<string, ZodTypeAny>;
    for (const key of Object.keys(shape).sort()) {
      const child = shape[key];
      if (!child) continue;
      collectPaths(child, prefix ? `${prefix}.${key}` : key, into);
    }
    return;
  }
  if (name === 'ZodIntersection' || name === 'ZodAnd') {
    // settings : objet ouvert. Le chemin settings est une clé, ses enfants sont libres.
    if (prefix) into.push(prefix);
    return;
  }
  if (prefix) into.push(prefix);
}

/** Toutes les clés d'écriture, y compris les nœuds et les segments `*`. */
export function listWritableConfigPaths(schema: ZodTypeAny = writableTomlSchema): string[] {
  const into: string[] = [];
  collectPaths(schema, '', into);
  return into;
}

function sampleToml(path: string, schema: ZodTypeAny | null): string {
  const node = schema ? unwrap(schema) : null;
  const name = node ? typeName(node) : '';
  if (path.endsWith('base_url') || path.endsWith('server_url')) return '"https://example.invalid/v1"';
  if (path.endsWith('.port')) return '3000';
  if (path.endsWith('api_key_env')) return '"EXAMPLE_API_KEY"';
  if (path.endsWith('hidden_capabilities')) return '["film"]';
  if (path.endsWith('input')) return '["text"]';
  if (path.endsWith('manualOrder')) return '["exemple"]';
  if (name === 'ZodArray') return '["exemple"]';
  if (name === 'ZodBoolean') {
    const fallback = defaultOf(schema);
    return fallback === true ? 'true' : 'false';
  }
  if (name === 'ZodNumber') {
    const fallback = defaultOf(schema);
    return typeof fallback === 'number' ? String(fallback) : '0';
  }
  if (name === 'ZodEnum') {
    const values = node?._def.values as string[] | undefined;
    const first = values?.[0] ?? 'exemple';
    return `"${first}"`;
  }
  const fallback = defaultOf(schema);
  if (typeof fallback === 'string' && fallback.length > 0) return `"${fallback}"`;
  return '"exemple"';
}

function isBranch(schema: ZodTypeAny | null): boolean {
  if (!schema) return false;
  const name = typeName(unwrap(schema));
  return name === 'ZodObject' || name === 'ZodRecord';
}

/**
 * Exemple commenté. Chaque clé de `listWritableConfigPaths` a une ligne
 * `# cle: <chemin>`. Le défaut est sur la ligne suivante.
 */
export function renderTomlExample(): string {
  const lines = [
    '# Exemple de configuration Code Buddy',
    '# Généré depuis le schéma TOML. Chaque clé d\'écriture a un marqueur « cle: ».',
    '# Le défaut est indiqué en commentaire. Une clé absente du fichier réel n\'est pas inventée à l\'écriture.',
    '# Les adresses d\'exemple ne sont pas des services. Aucune clé secrète n\'est écrite ici.',
    '# model_id, mode replace, les rôles autres que primary et le cache de fenêtre ne sont pas des clés d\'écriture.',
    '',
  ];
  for (const path of listWritableConfigPaths()) {
    const node = schemaAt(path);
    lines.push(`# cle: ${path}`);
    const fallback = defaultOf(node);
    lines.push(`# défaut : ${fallback === undefined ? 'absent' : String(fallback)}`);
    const description = descriptionOf(node);
    if (description) lines.push(`# ${description}`);
    if (!isBranch(node)) {
      const concrete = path.replace(/\.(\*)/g, '.exemple');
      const parts = concrete.split('.');
      const key = parts[parts.length - 1] ?? concrete;
      const header = parts.slice(0, -1).join('.');
      if (header) lines.push(`[${header}]`);
      lines.push(`${key} = ${sampleToml(path, node)}`);
    }
    lines.push('');
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}`;
}

export interface JsonSchemaDocument {
  $schema: string;
  title: string;
  toml: Record<string, unknown>;
  env: Record<string, unknown>;
}

function jsonSchemaOf(schema: ZodTypeAny): Record<string, unknown> {
  const name = typeName(schema);
  if (name === 'ZodDefault') {
    const inner = jsonSchemaOf(schema._def.innerType as ZodTypeAny);
    inner.default = schema._def.defaultValue();
    const description = schema._def.description as string | undefined;
    if (description && inner.description === undefined) inner.description = description;
    return inner;
  }
  if (name === 'ZodOptional' || name === 'ZodNullable') {
    const inner = jsonSchemaOf(schema._def.innerType as ZodTypeAny);
    const description = schema._def.description as string | undefined;
    if (description && inner.description === undefined) inner.description = description;
    return inner;
  }
  if (name === 'ZodEffects') return jsonSchemaOf(schema._def.schema as ZodTypeAny);
  if (name === 'ZodIntersection') {
    const left = jsonSchemaOf(schema._def.left as ZodTypeAny);
    const right = jsonSchemaOf(schema._def.right as ZodTypeAny);
    return { allOf: [left, right] };
  }
  const description = schema._def.description as string | undefined;
  const withDescription = (value: Record<string, unknown>): Record<string, unknown> => {
    if (description) value.description = description;
    return value;
  };
  if (name === 'ZodString') return withDescription({ type: 'string' });
  if (name === 'ZodNumber') return withDescription({ type: 'number' });
  if (name === 'ZodBoolean') return withDescription({ type: 'boolean' });
  if (name === 'ZodEnum') return withDescription({ type: 'string', enum: schema._def.values });
  if (name === 'ZodArray') {
    return withDescription({ type: 'array', items: jsonSchemaOf(schema._def.type as ZodTypeAny) });
  }
  if (name === 'ZodRecord') {
    return withDescription({
      type: 'object',
      additionalProperties: jsonSchemaOf(schema._def.valueType as ZodTypeAny),
    });
  }
  if (name === 'ZodUnion') {
    return withDescription({ anyOf: unionOptions(schema).map((option) => jsonSchemaOf(option)) });
  }
  if (name === 'ZodObject') {
    const shape = schema._def.shape() as Record<string, ZodTypeAny>;
    const properties: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(shape)) {
      properties[key] = jsonSchemaOf(child);
    }
    return withDescription({
      type: 'object',
      properties,
      additionalProperties: schema._def.unknownKeys !== 'strict',
    });
  }
  if (name === 'ZodUnknown' || name === 'ZodAny') return withDescription({});
  return withDescription({});
}

/** Document JSON Schema : TOML écrivable et variables d'environnement. */
export function exportConfigSchema(): JsonSchemaDocument {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Code Buddy configuration',
    toml: jsonSchemaOf(writableTomlSchema),
    env: jsonSchemaOf(envConfigSchema),
  };
}
