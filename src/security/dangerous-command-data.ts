/**
 * Shared command safety data.
 * Names are classified as dangerous for confirmation, routing and policy rules.
 * Full-command patterns block execution in both terminal validators.
 */
export const DANGEROUS_COMMANDS: ReadonlySet<string> = new Set([
  // Destructive file operations
  'rm', 'shred', 'wipefs', 'rmdir',
  // Disk operations
  'mkfs', 'fdisk', 'parted', 'dd',
  // Permission changes
  'chmod', 'chown', 'chgrp',
  // Privilege escalation
  'sudo', 'su', 'doas',
  // Network tools (dangerous modes)
  'nc', 'netcat', 'ncat', 'socat',
  // Insecure protocols
  'telnet', 'ftp',
  // Port scanning / packet capture
  'nmap', 'masscan', 'tcpdump', 'wireshark', 'tshark',
  // Process tracing / debugging
  'strace', 'ltrace', 'ptrace', 'gdb', 'lldb',
  // System control
  'reboot', 'shutdown', 'poweroff', 'halt',
  'init', 'systemctl', 'service',
  // Firewall
  'iptables', 'ip6tables', 'nft', 'firewall-cmd',
  // Mount operations
  'mount', 'umount',
  // Kernel modules
  'insmod', 'rmmod', 'modprobe', 'sysctl',
  // Scheduled tasks
  'crontab', 'at',
  // User management
  'useradd', 'userdel', 'usermod', 'groupadd',
  'passwd', 'chpasswd', 'visudo',
  // SSH / GPG / certs
  'ssh-keygen', 'ssh-add', 'gpg', 'openssl',
  // Kill (process control)
  'kill', 'killall', 'pkill',
  // Windows command names present in confirmation and amendment policies
  'del', 'format',
]);

/** Exact union of the former SandboxManager and SandboxedTerminal blocking expressions. */
export const DANGEROUS_COMMAND_BLOCK_PATTERNS: ReadonlyArray<RegExp> = [
  // SandboxManager patterns (formerly strings compiled with the i flag)
  new RegExp('\\brm\\s+-[^\\s]*r[^\\s]*f[^\\s]*\\s+/(?:\\s*)$', 'i'),
  new RegExp('\\brm\\s+-[^\\s]*r[^\\s]*f[^\\s]*\\s+/\\*(?:\\s*)$', 'i'),
  new RegExp('dd if=', 'i'),
  new RegExp('mkfs', 'i'),
  new RegExp(':(){ :|:& };:', 'i'),
  new RegExp('chmod -R 777 /', 'i'),
  new RegExp('chown -R', 'i'),
  new RegExp('> /dev/sda', 'i'),
  new RegExp('\\bwget\\b.*\\|\\s*(?:ba)?sh\\b', 'i'),
  new RegExp('\\bcurl\\b.*\\|\\s*(?:ba)?sh\\b', 'i'),
  new RegExp('sudo rm', 'i'),
  new RegExp('sudo dd', 'i'),
  // SandboxedTerminal patterns
  /rm\s+(-rf?|--recursive)\s+[/~]/i,
  /dd\s+.*of=\/dev/i,
  /mkfs/i,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,  // Fork bomb - escape parens and braces
  /chmod\s+-R\s+777\s+\//i,
  />\s*\/dev\/sd[a-z]/i,
  /wget.*\|\s*(ba)?sh/i,
  /curl.*\|\s*(ba)?sh/i,
  /eval\s+\$\(/i,
];
