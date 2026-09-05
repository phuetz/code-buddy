/**
 * Shell Completion Script Generator
 *
 * Generates completion scripts for bash, zsh, and fish shells.
 * Provides autocompletion for:
 * - CLI commands and flags
 * - Slash commands
 * - File paths
 * - Model names
 */

import { findRuntimeProvider } from '../providers/provider-catalog.js';

// ============================================================================
// Types
// ============================================================================

export type ShellType = 'bash' | 'zsh' | 'fish' | 'powershell';

export interface CompletionOption {
  name: string;
  description: string;
  hasArg?: boolean;
}

// ============================================================================
// CLI Options and Commands
// ============================================================================

const CLI_OPTIONS: CompletionOption[] = [
  { name: '-h', description: 'Show help' },
  { name: '--help', description: 'Show help' },
  { name: '-v', description: 'Show version' },
  { name: '--version', description: 'Show version' },
  { name: '-d', description: 'Working directory', hasArg: true },
  { name: '--dir', description: 'Working directory', hasArg: true },
  { name: '-m', description: 'Model to use', hasArg: true },
  { name: '--model', description: 'Model to use', hasArg: true },
  { name: '--yolo', description: 'Full autonomy mode' },
  { name: '--plain', description: 'Plain text output (minimal formatting)' },
  { name: '--no-color', description: 'Disable colors' },
  { name: '--no-emoji', description: 'Disable emojis' },
  { name: '--debug', description: 'Enable debug mode' },
  { name: '-c', description: 'Continue last session' },
  { name: '--continue', description: 'Continue last session' },
  { name: '--resume', description: 'Resume specific session', hasArg: true },
  { name: '--print', description: 'Print mode (non-interactive)', hasArg: true },
];

const SLASH_COMMANDS: CompletionOption[] = [
  { name: '/help', description: 'Show help' },
  { name: '/clear', description: 'Clear chat history' },
  { name: '/exit', description: 'Exit CLI' },
  { name: '/quit', description: 'Quit CLI' },
  { name: '/model', description: 'Change model' },
  { name: '/mode', description: 'Change approval mode' },
  { name: '/cost', description: 'Show session costs' },
  { name: '/history', description: 'Show chat history' },
  { name: '/compact', description: 'Toggle compact mode' },
  { name: '/undo', description: 'Undo last change' },
  { name: '/redo', description: 'Redo last change' },
  { name: '/checkpoints', description: 'List checkpoints' },
  { name: '/restore', description: 'Restore checkpoint' },
  { name: '/theme', description: 'Change theme' },
  { name: '/config', description: 'Show configuration' },
  { name: '/tools', description: 'List available tools' },
  { name: '/status', description: 'Show status' },
  { name: '/think', description: 'Enable thinking mode' },
];

const MODELS = findRuntimeProvider('grok')?.models ?? [];

const APPROVAL_MODES = ['read-only', 'auto', 'full-access'];

const THEMES = ['dark', 'light', 'dracula', 'monokai', 'nord', 'solarized'];

// ============================================================================
// Bash Completion
// ============================================================================

function generateBashCompletion(): string {
  const options = CLI_OPTIONS.map((o) => o.name).join(' ');
  const slashCommands = SLASH_COMMANDS.map((c) => c.name).join(' ');
  const models = MODELS.join(' ');
  const modes = APPROVAL_MODES.join(' ');
  const themes = THEMES.join(' ');

  return `#!/bin/bash
# Code Buddy Bash Completion
# Source this file or add to ~/.bashrc

_codebuddy_completions() {
    local cur prev opts
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"

    # CLI options
    opts="${options}"

    # Handle option arguments
    case "\${prev}" in
        -d|--dir)
            # Complete directories
            COMPREPLY=( $(compgen -d -- "\${cur}") )
            return 0
            ;;
        -m|--model)
            # Complete models
            local models="${models}"
            COMPREPLY=( $(compgen -W "\${models}" -- "\${cur}") )
            return 0
            ;;
        --resume)
            # Complete session files
            if [ -d ".codebuddy/sessions" ]; then
                local sessions=$(ls .codebuddy/sessions/*.json 2>/dev/null | xargs -n1 basename 2>/dev/null)
                COMPREPLY=( $(compgen -W "\${sessions}" -- "\${cur}") )
            fi
            return 0
            ;;
    esac

    # Handle slash commands (when in interactive mode context)
    if [[ "\${cur}" == /* ]]; then
        local slash_commands="${slashCommands}"
        COMPREPLY=( $(compgen -W "\${slash_commands}" -- "\${cur}") )
        return 0
    fi

    # Default to options
    if [[ "\${cur}" == -* ]]; then
        COMPREPLY=( $(compgen -W "\${opts}" -- "\${cur}") )
        return 0
    fi

    # Complete files by default
    COMPREPLY=( $(compgen -f -- "\${cur}") )
}

# Register completion
complete -F _codebuddy_completions buddy

# Mode completion helper
_codebuddy_mode_completions() {
    local modes="${modes}"
    COMPREPLY=( $(compgen -W "\${modes}" -- "\${COMP_WORDS[COMP_CWORD]}") )
}

# Theme completion helper
_codebuddy_theme_completions() {
    local themes="${themes}"
    COMPREPLY=( $(compgen -W "\${themes}" -- "\${COMP_WORDS[COMP_CWORD]}") )
}

echo "Code Buddy bash completions loaded"
`;
}

// ============================================================================
// Zsh Completion
// ============================================================================

function generateZshCompletion(): string {
  const optionLines = CLI_OPTIONS.map((o) => {
    const desc = o.description.replace(/'/g, "''");
    if (o.hasArg) {
      return `    '${o.name}[${desc}]:arg:'`;
    }
    return `    '${o.name}[${desc}]'`;
  }).join(' \\\n');

  const slashCommandLines = SLASH_COMMANDS.map((c) => {
    const desc = c.description.replace(/'/g, "''");
    return `      '${c.name}:${desc}'`;
  }).join(' \\\n');

  const models = MODELS.join(' ');
  const modes = APPROVAL_MODES.join(' ');
  const themes = THEMES.join(' ');

  return `#compdef buddy
# Code Buddy Zsh Completion
# Save to ~/.zsh/completions/_codebuddy or /usr/local/share/zsh/site-functions/_codebuddy

_codebuddy() {
    local -a options
    local -a slash_commands
    local -a models
    local -a modes
    local -a themes

    options=(
${optionLines}
    )

    slash_commands=(
${slashCommandLines}
    )

    models=(${models})
    modes=(${modes})
    themes=(${themes})

    # Handle arguments
    case "\${words[CURRENT-1]}" in
        -d|--dir)
            _files -/
            return
            ;;
        -m|--model)
            _describe 'model' models
            return
            ;;
        --resume)
            _files -g '*.json' -W '.codebuddy/sessions'
            return
            ;;
    esac

    # Handle slash commands
    if [[ "\${words[CURRENT]}" == /* ]]; then
        _describe 'slash command' slash_commands
        return
    fi

    # Handle options
    if [[ "\${words[CURRENT]}" == -* ]]; then
        _describe 'option' options
        return
    fi

    # Default to files
    _files
}

_codebuddy "$@"
`;
}

// ============================================================================
// Fish Completion
// ============================================================================

function generateFishCompletion(): string {
  const optionCompletions = CLI_OPTIONS.map((o) => {
    const shortOpt = o.name.startsWith('--') ? '' : o.name.slice(1);
    const longOpt = o.name.startsWith('--') ? o.name.slice(2) : '';
    const desc = o.description.replace(/'/g, "\\'");

    let line = "complete -c buddy";
    if (shortOpt) line += ` -s ${shortOpt}`;
    if (longOpt) line += ` -l ${longOpt}`;
    line += ` -d '${desc}'`;

    if (o.name === '-d' || o.name === '--dir') {
      line += ' -r -a "(__fish_complete_directories)"';
    } else if (o.name === '-m' || o.name === '--model') {
      line += ` -r -a '${MODELS.join(' ')}'`;
    }

    return line;
  }).join('\n');

  const slashCompletions = SLASH_COMMANDS.map((c) => {
    const desc = c.description.replace(/'/g, "\\'");
    return `complete -c buddy -n '__fish_codebuddy_in_prompt' -a '${c.name}' -d '${desc}'`;
  }).join('\n');

  return `# Code Buddy Fish Completion
# Save to ~/.config/fish/completions/buddy.fish

# Helper function to detect if we're in the prompt context
function __fish_codebuddy_in_prompt
    # Check if current word starts with /
    set -l cmd (commandline -opc)
    set -l current (commandline -ct)
    string match -q '/*' -- "$current"
end

# Disable file completion by default for buddy
complete -c buddy -f

# CLI options
${optionCompletions}

# Slash commands (only in prompt context)
${slashCompletions}

# Model completion
complete -c buddy -n '__fish_seen_subcommand_from -m --model' -a '${MODELS.join(' ')}' -d 'Model'

# Mode completion
complete -c buddy -n '__fish_codebuddy_mode_arg' -a '${APPROVAL_MODES.join(' ')}' -d 'Mode'

# Theme completion
complete -c buddy -n '__fish_codebuddy_theme_arg' -a '${THEMES.join(' ')}' -d 'Theme'

# Default to file completion after options
complete -c buddy -n 'not __fish_codebuddy_in_prompt' -a '(__fish_complete_path)'
`;
}

// ============================================================================
// PowerShell Completion
// ============================================================================

function generatePowerShellCompletion(): string {
  const optionCompletions = CLI_OPTIONS.map((o) => {
    const desc = o.description.replace(/'/g, "''");
    return `        '${o.name}' { '${desc}' }`;
  }).join('\n');

  const slashCommandCompletions = SLASH_COMMANDS.map((c) => {
    const desc = c.description.replace(/'/g, "''");
    return `        '${c.name}' { '${desc}' }`;
  }).join('\n');

  const models = MODELS.map(m => `'${m}'`).join(', ');
  const modes = APPROVAL_MODES.map(m => `'${m}'`).join(', ');
  const themes = THEMES.map(t => `'${t}'`).join(', ');

  return `# Code Buddy PowerShell Completion
# Save to $PROFILE or run: buddy --completions powershell | Out-File -Append $PROFILE

$_codebuddyOptions = @(${CLI_OPTIONS.map(o => `'${o.name}'`).join(', ')})
$_codebuddySlashCommands = @(${SLASH_COMMANDS.map(c => `'${c.name}'`).join(', ')})
$_codebuddyModels = @(${models})
$_codebuddyModes = @(${modes})
$_codebuddyThemes = @(${themes})

function Get-CodeBuddyOptionDescription {
    param([string]$Option)
    switch ($Option) {
${optionCompletions}
        default { '' }
    }
}

function Get-CodeBuddySlashCommandDescription {
    param([string]$Command)
    switch ($Command) {
${slashCommandCompletions}
        default { '' }
    }
}

Register-ArgumentCompleter -Native -CommandName buddy -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)

    $tokens = $commandAst.CommandElements
    $prevToken = if ($tokens.Count -gt 1) { $tokens[-2].Extent.Text } else { '' }

    # Handle option arguments
    switch ($prevToken) {
        { $_ -in '-d', '--dir' } {
            Get-ChildItem -Directory -Name | Where-Object { $_ -like "$wordToComplete*" } |
                ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', 'Directory') }
            return
        }
        { $_ -in '-m', '--model' } {
            $_codebuddyModels | Where-Object { $_ -like "$wordToComplete*" } |
                ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', "Model: $_") }
            return
        }
        '--resume' {
            $sessionDir = Join-Path '.codebuddy' 'sessions'
            if (Test-Path $sessionDir) {
                Get-ChildItem -Path $sessionDir -Filter '*.json' -Name |
                    Where-Object { $_ -like "$wordToComplete*" } |
                    ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', "Session: $_") }
            }
            return
        }
    }

    # Handle slash commands
    if ($wordToComplete -like '/*') {
        $_codebuddySlashCommands | Where-Object { $_ -like "$wordToComplete*" } |
            ForEach-Object {
                $desc = Get-CodeBuddySlashCommandDescription $_
                [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $desc)
            }
        return
    }

    # Handle options
    if ($wordToComplete -like '-*') {
        $_codebuddyOptions | Where-Object { $_ -like "$wordToComplete*" } |
            ForEach-Object {
                $desc = Get-CodeBuddyOptionDescription $_
                [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $desc)
            }
        return
    }

    # Default to file completion
    Get-ChildItem -Name | Where-Object { $_ -like "$wordToComplete*" } |
        ForEach-Object {
            $type = if (Test-Path $_ -PathType Container) { 'ProviderContainer' } else { 'ProviderItem' }
            [System.Management.Automation.CompletionResult]::new($_, $_, $type, $_)
        }
}

Write-Host "Code Buddy PowerShell completions loaded" -ForegroundColor Green
`;
}

// ============================================================================
// Main Generator
// ============================================================================

/**
 * Generate shell completion script
 */
export function generateCompletion(shell: ShellType): string {
  switch (shell) {
    case 'bash':
      return generateBashCompletion();
    case 'zsh':
      return generateZshCompletion();
    case 'fish':
      return generateFishCompletion();
    case 'powershell':
      return generatePowerShellCompletion();
    default:
      throw new Error(`Unsupported shell: ${shell}`);
  }
}

/**
 * Get installation instructions
 */
export function getInstallInstructions(shell: ShellType): string {
  switch (shell) {
    case 'bash':
      return `
# Bash completion installation:

# Option 1: Add to ~/.bashrc
echo 'source <(buddy --completions bash)' >> ~/.bashrc

# Option 2: Save to completions directory
buddy --completions bash > /etc/bash_completion.d/buddy

# Apply immediately:
source ~/.bashrc
`.trim();

    case 'zsh':
      return `
# Zsh completion installation:

# Option 1: Add to ~/.zshrc
echo 'source <(buddy --completions zsh)' >> ~/.zshrc

# Option 2: Save to completions directory
mkdir -p ~/.zsh/completions
buddy --completions zsh > ~/.zsh/completions/_codebuddy
echo 'fpath=(~/.zsh/completions $fpath)' >> ~/.zshrc
echo 'autoload -Uz compinit && compinit' >> ~/.zshrc

# Apply immediately:
source ~/.zshrc
`.trim();

    case 'fish':
      return `
# Fish completion installation:

# Save to completions directory
mkdir -p ~/.config/fish/completions
buddy --completions fish > ~/.config/fish/completions/buddy.fish

# Apply immediately (or restart fish):
source ~/.config/fish/completions/buddy.fish
`.trim();

    case 'powershell':
      return `
# PowerShell completion installation:

# Option 1: Add to your PowerShell profile
buddy --completions powershell | Out-File -Append $PROFILE -Encoding UTF8

# Option 2: Save to a separate file and source it
$completionFile = Join-Path (Split-Path $PROFILE) "buddy-completions.ps1"
buddy --completions powershell | Out-File $completionFile -Encoding UTF8
Add-Content $PROFILE ". '$completionFile'"

# Apply immediately:
. $PROFILE

# Note: You may need to restart PowerShell or run:
# Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
`.trim();

    default:
      return `Unsupported shell: ${shell}`;
  }
}

/**
 * Print completion script to stdout
 */
export function printCompletion(shell: ShellType): void {
  console.log(generateCompletion(shell));
}

/**
 * Get all available slash commands for completion
 */
export function getSlashCommands(): CompletionOption[] {
  return [...SLASH_COMMANDS];
}

/**
 * Get all CLI options for completion
 */
export function getCliOptions(): CompletionOption[] {
  return [...CLI_OPTIONS];
}
