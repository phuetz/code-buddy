import { ChatEntry } from "../../agent/codebuddy-agent.js";
import { getBranchManager } from "../../persistence/conversation-branches.js";

export interface CommandHandlerResult {
  handled: boolean;
  entry?: ChatEntry;
  passToAI?: boolean;
  prompt?: string;
  compactionRequested?: boolean;
}

// ─── Helper: resolve a branch by ID or name prefix ────────────────────────────

function resolveBranch(idOrName: string): string | null {
  const mgr = getBranchManager();
  const branches = mgr.getAllBranches();

  // Exact ID match
  const exact = branches.find(b => b.id === idOrName);
  if (exact) return exact.id;

  // Exact name match (case-insensitive)
  const byName = branches.find(b => b.name.toLowerCase() === idOrName.toLowerCase());
  if (byName) return byName.id;

  // ID prefix match
  const byPrefix = branches.filter(b => b.id.startsWith(idOrName));
  if (byPrefix.length === 1 && byPrefix[0]) return byPrefix[0].id;

  // Name prefix match (case-insensitive)
  const byNamePrefix = branches.filter(b => b.name.toLowerCase().startsWith(idOrName.toLowerCase()));
  if (byNamePrefix.length === 1 && byNamePrefix[0]) return byNamePrefix[0].id;

  return null;
}

function makeResult(content: string): CommandHandlerResult {
  return {
    handled: true,
    entry: { type: "assistant", content, timestamp: new Date() },
  };
}

// ─── /fork ────────────────────────────────────────────────────────────────────

/**
 * Fork - Create conversation branch from current position
 */
export function handleFork(args: string[]): CommandHandlerResult {
  const branchManager = getBranchManager();
  const branchName = args.join(" ") || `branch-${Date.now()}`;

  const branch = branchManager.fork(branchName);

  return makeResult(
    `Created branch: ${branch.name}\n\n` +
    `ID: ${branch.id}\n` +
    `Messages: ${branch.messages.length}\n` +
    `Parent: ${branch.parentId ?? "none"}\n\n` +
    `Use /branches to see all branches\n` +
    `Use /checkout <id> to switch branches`
  );
}

// ─── /branches ────────────────────────────────────────────────────────────────

/**
 * Branches - List conversation branches
 */
export function handleBranches(): CommandHandlerResult {
  const branchManager = getBranchManager();
  const branches = branchManager.getAllBranches();
  const currentId = branchManager.getCurrentBranchId();

  if (branches.length === 0) {
    return makeResult("No branches found.");
  }

  let content = `Conversation Branches\n${"=".repeat(50)}\n\n`;

  for (const branch of branches) {
    const isCurrent = branch.id === currentId;
    const marker = isCurrent ? "* " : "  ";
    const currentLabel = isCurrent ? " (current)" : "";
    const parent = branch.parentId ? ` <- ${branch.parentId.slice(0, 12)}` : "";

    content += `${marker}${branch.name}${currentLabel}\n`;
    content += `    ID: ${branch.id}${parent}\n`;
    content += `    Messages: ${branch.messages.length} | Updated: ${new Date(branch.updatedAt).toLocaleString()}\n\n`;
  }

  content += `\nCommands:\n`;
  content += `  /fork <name>       - Create new branch\n`;
  content += `  /checkout <id>     - Switch branch\n`;
  content += `  /merge <id>        - Merge branch into current\n`;
  content += `  /branch delete <id> - Delete a branch\n`;
  content += `  /branch diff <id>  - Compare branch with current\n`;
  content += `  /branch tree       - Show branch tree`;

  return makeResult(content);
}

// ─── /checkout ────────────────────────────────────────────────────────────────

/**
 * Checkout - Switch to a branch by ID or name
 */
export function handleCheckout(args: string[]): CommandHandlerResult {
  const branchManager = getBranchManager();
  const branchRef = args[0];

  if (!branchRef) {
    return makeResult(
      `Usage: /checkout <branch-id-or-name>\n\n` +
      `Use /branches to see available branches`
    );
  }

  const resolvedId = resolveBranch(branchRef);
  if (!resolvedId) {
    return makeResult(`Branch not found: ${branchRef}\n\nUse /branches to see available branches`);
  }

  const result = branchManager.checkout(resolvedId);

  if (result) {
    return makeResult(
      `Switched to branch: ${result.name}\n\n` +
      `ID: ${result.id}\n` +
      `Messages: ${result.messages.length}`
    );
  }

  return makeResult(`Branch not found: ${branchRef}`);
}

// ─── /merge ───────────────────────────────────────────────────────────────────

/**
 * Merge - Merge a branch into the current branch
 */
export function handleMerge(args: string[]): CommandHandlerResult {
  const branchManager = getBranchManager();
  const branchRef = args[0];

  if (!branchRef) {
    return makeResult(`Usage: /merge <branch-id-or-name>`);
  }

  const resolvedId = resolveBranch(branchRef);
  if (!resolvedId) {
    return makeResult(`Branch not found: ${branchRef}\n\nUse /branches to see available branches`);
  }

  const currentBranch = branchManager.getCurrentBranch();
  if (resolvedId === currentBranch.id) {
    return makeResult(`Cannot merge a branch into itself.`);
  }

  const sourceBranch = branchManager.getAllBranches().find(b => b.id === resolvedId);
  const result = branchManager.merge(resolvedId);

  if (result) {
    const updatedBranch = branchManager.getCurrentBranch();
    return makeResult(
      `Merged branch "${sourceBranch?.name ?? resolvedId}" into "${currentBranch.name}"\n\n` +
      `Current branch now has ${updatedBranch.messages.length} messages`
    );
  }

  return makeResult(`Merge failed: Branch not found or same as current`);
}

// ─── /branch (unified) ───────────────────────────────────────────────────────

/**
 * Branch - Unified branch management command
 *
 * Subcommands:
 *   /branch                     - List all branches (same as /branches)
 *   /branch create [name]       - Create a new branch (same as /fork)
 *   /branch switch <id|name>    - Switch to a branch (same as /checkout)
 *   /branch list                - List all branches
 *   /branch tree                - Show branch tree
 *   /branch merge <id|name>     - Merge branch into current
 *   /branch diff <id|name>      - Compare a branch with current
 *   /branch delete <id|name>    - Delete a branch
 *   /branch rename <id> <name>  - Rename a branch
 *   /branch history [id]        - Show branch ancestry
 */
export function handleBranch(args: string[]): CommandHandlerResult {
  const action = args[0]?.toLowerCase();

  // No args or "list" => list branches
  if (!action || action === "list") {
    return handleBranches();
  }

  switch (action) {
    case "create":
      return handleBranchCreate(args.slice(1));
    case "switch":
      return handleCheckout(args.slice(1));
    case "merge":
      return handleMerge(args.slice(1));
    case "diff":
      return handleBranchDiff(args.slice(1));
    case "delete":
      return handleBranchDelete(args.slice(1));
    case "rename":
      return handleBranchRename(args.slice(1));
    case "tree":
      return handleBranchTree();
    case "history":
      return handleBranchHistory(args.slice(1));
    case "help":
      return handleBranchHelp();
    default:
      return handleBranchHelp();
  }
}

// ─── Subcommand implementations ───────────────────────────────────────────────

function handleBranchCreate(args: string[]): CommandHandlerResult {
  return handleFork(args);
}

function handleBranchDiff(args: string[]): CommandHandlerResult {
  const branchManager = getBranchManager();
  const branchRef = args[0];

  if (!branchRef) {
    return makeResult(
      `Usage: /branch diff <branch-id-or-name>\n\n` +
      `Compares the specified branch with the current branch.`
    );
  }

  const resolvedId = resolveBranch(branchRef);
  if (!resolvedId) {
    return makeResult(`Branch not found: ${branchRef}\n\nUse /branches to see available branches`);
  }

  const currentBranch = branchManager.getCurrentBranch();
  const otherBranch = branchManager.getAllBranches().find(b => b.id === resolvedId);

  if (!otherBranch) {
    return makeResult(`Branch not found: ${branchRef}`);
  }

  if (resolvedId === currentBranch.id) {
    return makeResult(`Cannot diff a branch against itself.`);
  }

  // Build diff: find messages unique to each branch
  const currentMsgContents = new Set(currentBranch.messages.map(m =>
    `${m.role}:${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`
  ));
  const otherMsgContents = new Set(otherBranch.messages.map(m =>
    `${m.role}:${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`
  ));

  const onlyInCurrent: number[] = [];
  const onlyInOther: number[] = [];

  currentBranch.messages.forEach((m, i) => {
    const key = `${m.role}:${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`;
    if (!otherMsgContents.has(key)) onlyInCurrent.push(i);
  });

  otherBranch.messages.forEach((m, i) => {
    const key = `${m.role}:${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`;
    if (!currentMsgContents.has(key)) onlyInOther.push(i);
  });

  let content = `Branch Diff\n${"=".repeat(50)}\n\n`;
  content += `Current: "${currentBranch.name}" (${currentBranch.messages.length} msgs)\n`;
  content += `Compare: "${otherBranch.name}" (${otherBranch.messages.length} msgs)\n\n`;

  if (onlyInCurrent.length === 0 && onlyInOther.length === 0) {
    content += `Branches have identical message content.\n`;
  } else {
    if (onlyInCurrent.length > 0) {
      content += `Only in current ("${currentBranch.name}"): ${onlyInCurrent.length} message(s)\n`;
      for (const idx of onlyInCurrent.slice(0, 5)) {
        const msg = currentBranch.messages[idx];
        if (!msg) continue;
        const preview = (typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)).slice(0, 80);
        content += `  [${idx}] ${msg.role}: ${preview}${preview.length >= 80 ? "..." : ""}\n`;
      }
      if (onlyInCurrent.length > 5) {
        content += `  ... and ${onlyInCurrent.length - 5} more\n`;
      }
      content += `\n`;
    }

    if (onlyInOther.length > 0) {
      content += `Only in compare ("${otherBranch.name}"): ${onlyInOther.length} message(s)\n`;
      for (const idx of onlyInOther.slice(0, 5)) {
        const msg = otherBranch.messages[idx];
        if (!msg) continue;
        const preview = (typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)).slice(0, 80);
        content += `  [${idx}] ${msg.role}: ${preview}${preview.length >= 80 ? "..." : ""}\n`;
      }
      if (onlyInOther.length > 5) {
        content += `  ... and ${onlyInOther.length - 5} more\n`;
      }
    }
  }

  return makeResult(content);
}

function handleBranchDelete(args: string[]): CommandHandlerResult {
  const branchManager = getBranchManager();
  const branchRef = args[0];

  if (!branchRef) {
    return makeResult(
      `Usage: /branch delete <branch-id-or-name>\n\n` +
      `Cannot delete the main branch or the current branch.`
    );
  }

  const resolvedId = resolveBranch(branchRef);
  if (!resolvedId) {
    return makeResult(`Branch not found: ${branchRef}\n\nUse /branches to see available branches`);
  }

  if (resolvedId === "main") {
    return makeResult(`Cannot delete the main branch.`);
  }

  const currentId = branchManager.getCurrentBranchId();
  if (resolvedId === currentId) {
    return makeResult(
      `Cannot delete the current branch.\n\n` +
      `Switch to another branch first with /checkout <id>`
    );
  }

  const branch = branchManager.getAllBranches().find(b => b.id === resolvedId);
  const branchName = branch?.name ?? resolvedId;

  const deleted = branchManager.deleteBranch(resolvedId);

  if (deleted) {
    return makeResult(`Deleted branch: "${branchName}" (${resolvedId})`);
  }

  return makeResult(`Failed to delete branch: ${branchRef}`);
}

function handleBranchRename(args: string[]): CommandHandlerResult {
  const branchManager = getBranchManager();
  const branchRef = args[0];
  const newName = args.slice(1).join(" ");

  if (!branchRef || !newName) {
    return makeResult(`Usage: /branch rename <branch-id-or-name> <new-name>`);
  }

  const resolvedId = resolveBranch(branchRef);
  if (!resolvedId) {
    return makeResult(`Branch not found: ${branchRef}\n\nUse /branches to see available branches`);
  }

  const renamed = branchManager.renameBranch(resolvedId, newName);

  if (renamed) {
    return makeResult(`Renamed branch ${resolvedId} to "${newName}"`);
  }

  return makeResult(`Failed to rename branch: ${branchRef}`);
}

function handleBranchTree(): CommandHandlerResult {
  const branchManager = getBranchManager();
  return makeResult(branchManager.formatBranchTree());
}

function handleBranchHistory(args: string[]): CommandHandlerResult {
  const branchManager = getBranchManager();
  const branchRef = args[0];

  const targetId = branchRef
    ? resolveBranch(branchRef)
    : branchManager.getCurrentBranchId();

  if (!targetId) {
    return makeResult(`Branch not found: ${branchRef}\n\nUse /branches to see available branches`);
  }

  const history = branchManager.getBranchHistory(targetId);

  if (history.length === 0) {
    return makeResult(`No history found for branch: ${targetId}`);
  }

  let content = `Branch History\n${"=".repeat(50)}\n\n`;

  for (let i = 0; i < history.length; i++) {
    const branch = history[i];
    if (!branch) continue;
    const isCurrent = branch.id === branchManager.getCurrentBranchId();
    const marker = isCurrent ? "* " : "  ";
    const indent = "  ".repeat(i);
    const arrow = i > 0 ? "-> " : "";

    content += `${indent}${marker}${arrow}${branch.name} (${branch.id})\n`;
    content += `${indent}     Messages: ${branch.messages.length} | Created: ${new Date(branch.createdAt).toLocaleString()}\n`;
  }

  return makeResult(content);
}

function handleBranchHelp(): CommandHandlerResult {
  return makeResult(
    `Branch Management\n${"=".repeat(50)}\n\n` +
    `Usage: /branch <action> [args]\n\n` +
    `Actions:\n` +
    `  list                    - List all branches (default)\n` +
    `  create [name]           - Create a new branch from current position\n` +
    `  switch <id|name>        - Switch to a branch\n` +
    `  merge <id|name>         - Merge a branch into current\n` +
    `  diff <id|name>          - Compare a branch with current\n` +
    `  delete <id|name>        - Delete a branch\n` +
    `  rename <id|name> <name> - Rename a branch\n` +
    `  tree                    - Show branch tree structure\n` +
    `  history [id|name]       - Show branch ancestry\n` +
    `  help                    - Show this help\n\n` +
    `Shortcuts:\n` +
    `  /fork <name>            - Same as /branch create <name>\n` +
    `  /branches               - Same as /branch list\n` +
    `  /checkout <id|name>     - Same as /branch switch <id|name>\n` +
    `  /merge <id|name>        - Same as /branch merge <id|name>\n\n` +
    `Branch references can be IDs, names, or unique prefixes.`
  );
}
