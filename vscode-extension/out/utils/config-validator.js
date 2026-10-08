"use strict";
/**
 * Configuration Validator
 * Validates extension settings and API keys
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateAIConfig = validateAIConfig;
exports.getApiKey = getApiKey;
exports.getDefaultModel = getDefaultModel;
exports.getDefaultBaseUrl = getDefaultBaseUrl;
exports.showConfigurationWizard = showConfigurationWizard;
exports.validateStartupConfig = validateStartupConfig;
const vscode = __importStar(require("vscode"));
const logger_1 = require("./logger");
/**
 * Validate AI provider configuration
 */
function validateAIConfig(config) {
    const errors = [];
    const warnings = [];
    // Validate provider
    const validProviders = ['grok', 'claude', 'openai', 'ollama'];
    if (!validProviders.includes(config.provider)) {
        errors.push(`Invalid provider: ${config.provider}. Valid options: ${validProviders.join(', ')}`);
    }
    // Validate API key (except for Ollama)
    if (config.provider !== 'ollama' && !config.apiKey) {
        errors.push(`API key is required for ${config.provider} provider`);
    }
    // Validate API key format
    if (config.apiKey && config.provider !== 'ollama') {
        if (config.provider === 'grok' && !config.apiKey.startsWith('xai-')) {
            warnings.push('Grok API keys typically start with "xai-"');
        }
        if (config.provider === 'openai' && !config.apiKey.startsWith('sk-')) {
            warnings.push('OpenAI API keys typically start with "sk-"');
        }
    }
    // Validate model
    if (!config.model) {
        warnings.push('No model specified, using default');
    }
    // Validate base URL if provided
    if (config.baseUrl) {
        try {
            new URL(config.baseUrl);
        }
        catch {
            errors.push(`Invalid base URL: ${config.baseUrl}`);
        }
    }
    // Validate maxTokens
    if (config.maxTokens !== undefined) {
        if (config.maxTokens < 1 || config.maxTokens > 128000) {
            warnings.push(`maxTokens should be between 1 and 128000, got ${config.maxTokens}`);
        }
    }
    return {
        valid: errors.length === 0,
        errors,
        warnings,
    };
}
/**
 * Get API key from environment or settings
 */
function getApiKey(provider) {
    const config = vscode.workspace.getConfiguration('codebuddy');
    const settingsKey = config.get('apiKey');
    if (settingsKey) {
        return settingsKey;
    }
    // Try environment variables
    const envVars = {
        grok: 'GROK_API_KEY',
        claude: 'ANTHROPIC_API_KEY',
        openai: 'OPENAI_API_KEY',
    };
    const envVar = envVars[provider];
    if (envVar && process.env[envVar]) {
        return process.env[envVar];
    }
    return '';
}
/**
 * Get default model for provider
 */
function getDefaultModel(provider) {
    const defaults = {
        grok: 'grok-3-latest',
        claude: 'claude-sonnet-5-5',
        openai: 'gpt-4o',
        ollama: 'llama3.2',
    };
    return defaults[provider] || 'grok-3-latest';
}
/**
 * Get default base URL for provider
 */
function getDefaultBaseUrl(provider) {
    const defaults = {
        grok: 'https://api.x.ai/v1',
        claude: 'https://api.anthropic.com/v1',
        openai: 'https://api.openai.com/v1',
        ollama: 'http://localhost:11434/v1',
    };
    return defaults[provider] || 'https://api.x.ai/v1';
}
/**
 * Show configuration wizard if not properly configured
 */
async function showConfigurationWizard() {
    const config = vscode.workspace.getConfiguration('codebuddy');
    // Check if API key is set
    const provider = config.get('provider') || 'grok';
    const apiKey = getApiKey(provider);
    if (!apiKey && provider !== 'ollama') {
        const action = await vscode.window.showWarningMessage(`Code Buddy needs an API key for ${provider}. Would you like to configure it now?`, 'Configure', 'Use Environment Variable', 'Switch Provider', 'Later');
        if (action === 'Configure') {
            const key = await vscode.window.showInputBox({
                prompt: `Enter your ${provider} API key`,
                password: true,
                placeHolder: provider === 'grok' ? 'xai-...' : 'sk-...',
            });
            if (key) {
                await config.update('apiKey', key, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage('API key saved successfully!');
                return true;
            }
        }
        else if (action === 'Use Environment Variable') {
            const envVars = {
                grok: 'GROK_API_KEY',
                claude: 'ANTHROPIC_API_KEY',
                openai: 'OPENAI_API_KEY',
            };
            vscode.window.showInformationMessage(`Set the ${envVars[provider]} environment variable and restart VS Code`);
        }
        else if (action === 'Switch Provider') {
            const newProvider = await vscode.window.showQuickPick(['grok', 'claude', 'openai', 'ollama'], { placeHolder: 'Select AI provider' });
            if (newProvider) {
                await config.update('provider', newProvider, vscode.ConfigurationTarget.Global);
                return showConfigurationWizard();
            }
        }
        return false;
    }
    return true;
}
/**
 * Validate and log configuration on startup
 */
function validateStartupConfig() {
    const config = vscode.workspace.getConfiguration('codebuddy');
    const aiConfig = {
        provider: config.get('provider') || 'grok',
        apiKey: getApiKey(config.get('provider') || 'grok'),
        model: config.get('model') || getDefaultModel(config.get('provider') || 'grok'),
        baseUrl: config.get('baseUrl'),
        maxTokens: config.get('maxTokens'),
    };
    const result = validateAIConfig(aiConfig);
    // Log results
    if (result.errors.length > 0) {
        logger_1.logger.error(`Configuration errors: ${result.errors.join(', ')}`, undefined, 'ConfigValidator');
    }
    if (result.warnings.length > 0) {
        logger_1.logger.warn(`Configuration warnings: ${result.warnings.join(', ')}`, 'ConfigValidator');
    }
    if (result.valid) {
        logger_1.logger.info(`Configuration valid for provider: ${aiConfig.provider}`, 'ConfigValidator');
    }
    return result;
}
//# sourceMappingURL=config-validator.js.map