"""Heartbeat tick — wrapper autonome pour le fleet de Claudes.

Pattern : un script à exécuter périodiquement (cron / Task Scheduler) qui :
1. Pull --rebase claude-et-patrice
2. Lit .codebuddy/HEARTBEAT.md (FLEET_PAUSE check)
3. Lit .codebuddy/colab-tasks.json — picke la 1ère tâche open + libre par priority
4. Claim atomique (commit + push), abort si conflict
5. Invoke `claude --print --dangerously-skip-permissions <prompt>`
6. Parse JSON output, append worklog, mark task completed
7. Commit + push
8. Exit (max 1 task per tick)

Cf. doctrine : claude-et-patrice/propositions/AUTONOMOUS-FLEET-PROTOCOL-2026-05-02.md v0.1
"""
from __future__ import annotations
import argparse
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

PRIORITY_RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3}


def log(msg: str, log_file: Path | None = None) -> None:
    line = f"[{dt.datetime.utcnow().isoformat(timespec='seconds')}Z] {msg}"
    print(line, flush=True)
    if log_file is not None:
        try:
            with open(log_file, "a", encoding="utf-8") as f:
                f.write(line + "\n")
        except OSError:
            pass


def run(cmd: list[str], cwd: Path, check: bool = True, timeout: float | None = None,
        capture: bool = True) -> subprocess.CompletedProcess:
    """Run a command, capture output. Raise on failure if check=True."""
    return subprocess.run(
        cmd, cwd=str(cwd), check=check, timeout=timeout,
        capture_output=capture, text=True,
    )


def git(args: list[str], cwd: Path, check: bool = True) -> subprocess.CompletedProcess:
    return run(["git", *args], cwd=cwd, check=check)


def now_iso() -> str:
    return dt.datetime.utcnow().isoformat(timespec="seconds") + "Z"


def load_tasks(path: Path) -> dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data: dict[str, Any]) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def pick_task(tasks: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Pick first open + free task, sorted by priority."""
    candidates = [t for t in tasks if t.get("status") == "open" and not t.get("claimedBy")]
    if not candidates:
        return None
    candidates.sort(key=lambda t: PRIORITY_RANK.get(t.get("priority", "low"), 99))
    return candidates[0]


def fleet_paused(heartbeat_md: Path) -> bool:
    """Detect FLEET_PAUSE — must be the first non-empty, non-comment line of the file.

    This avoids false positives from documentation that mentions the keyword.
    A 'comment' line is anything starting with '#' (markdown heading) or '>' (blockquote).
    """
    if not heartbeat_md.exists():
        return False
    with open(heartbeat_md, "r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line:
                continue
            if line.startswith("#") or line.startswith(">"):
                continue
            return line == "FLEET_PAUSE"
    return False


def build_claude_prompt(host: str, task: dict[str, Any]) -> str:
    files_listing = ", ".join(task.get("filesToModify", [])) or "(aucun listé)"
    criteria = "\n".join(f"  - {c}" for c in task.get("acceptanceCriteria", [])) or "  - (aucun)"
    return f"""Tu es Claude/{host} dans le fleet autonome (cf. claude-et-patrice/propositions/AUTONOMOUS-FLEET-PROTOCOL-2026-05-02.md).
Tu viens de claimer la tâche {task['id']} :

TITRE : {task.get('title', '(sans titre)')}

DESCRIPTION :
{task.get('description', '(vide)')}

FILES AUTORISÉS À MODIFIER : {files_listing}

ACCEPTANCE CRITERIA :
{criteria}

Action :
1. Exécute la tâche en respectant strictement la liste des fichiers autorisés.
2. Ne modifie AUCUN autre fichier.
3. Ne fais AUCUN commit ni push (le wrapper s'en charge).
4. À la toute fin de ta réponse, sur la DERNIÈRE LIGNE, output un objet JSON conforme :
{{"summary": "...", "files_modified": [{{"file": "...", "changes": "..."}}], "issues": [], "next_steps": []}}

Aucun texte après ce JSON. Le wrapper parse strictement la dernière ligne.
"""


def parse_claude_output(stdout: str) -> dict[str, Any] | None:
    """Try to extract a JSON object from the last lines of claude output."""
    if not stdout:
        return None
    lines = [l.rstrip() for l in stdout.strip().splitlines() if l.strip()]
    # Try last line first
    for line in reversed(lines[-5:]):
        try:
            obj = json.loads(line)
            if isinstance(obj, dict) and "summary" in obj:
                return obj
        except json.JSONDecodeError:
            continue
    # Fallback: regex find first JSON-like {} block in the trailing 4KB
    tail = stdout[-4000:]
    m = re.search(r"\{[^{}]*\"summary\".*?\}", tail, re.DOTALL)
    if m:
        try:
            obj = json.loads(m.group(0))
            if isinstance(obj, dict):
                return obj
        except json.JSONDecodeError:
            pass
    return None


def append_worklog(worklog_path: Path, entry: dict[str, Any]) -> None:
    with open(worklog_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    data.setdefault("entries", []).append(entry)
    save_json(worklog_path, data)


def update_presence(presence_path: Path, host: str, current_task: str | None) -> None:
    if not presence_path.exists():
        data: dict[str, Any] = {"version": "0.1", "agents": {}}
    else:
        with open(presence_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    data.setdefault("agents", {})
    data["agents"][host] = {
        "host": host,
        "lastSeen": now_iso(),
        "status": "active",
        "currentTask": current_task,
    }
    save_json(presence_path, data)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--repo", default=str(Path(__file__).resolve().parents[1]),
                   help="Path to the claude-et-patrice repo (default: parent of this file's parent)")
    p.add_argument("--host", required=True, help="Host identifier, e.g. 'darkstar/grok-cli'")
    p.add_argument("--claude-bin", default=shutil.which("claude") or "claude",
                   help="Path to the claude executable")
    p.add_argument("--dry-run", action="store_true",
                   help="No mutations, just show what would happen")
    p.add_argument("--max-task-seconds", type=int, default=600,
                   help="Hard timeout for the claude --print invocation")
    args = p.parse_args()

    repo = Path(args.repo).resolve()
    if not (repo / ".git").exists():
        print(f"FATAL: {repo} is not a git repo", file=sys.stderr)
        return 2

    log_file = repo / ".codebuddy" / "heartbeat.log"
    log(f"=== heartbeat tick start: host={args.host} dry_run={args.dry_run}", log_file)

    # 1. Pre-flight
    status = git(["status", "--porcelain"], repo, check=False)
    if status.stdout.strip():
        log(f"WARN: dirty repo, aborting tick:\n{status.stdout}", log_file)
        return 3

    if not Path(args.claude_bin).exists() and shutil.which(args.claude_bin) is None:
        log(f"FATAL: claude binary '{args.claude_bin}' not found", log_file)
        return 4

    # 2. Pull
    pull = git(["pull", "--rebase"], repo, check=False)
    if pull.returncode != 0:
        log(f"FAIL: git pull --rebase: {pull.stderr.strip()}", log_file)
        return 5
    log(f"git pull --rebase: {pull.stdout.strip().splitlines()[-1] if pull.stdout.strip() else 'up to date'}", log_file)

    # 3. FLEET_PAUSE check
    heartbeat_md = repo / ".codebuddy" / "HEARTBEAT.md"
    if fleet_paused(heartbeat_md):
        log("FLEET_PAUSE detected — exiting cleanly", log_file)
        return 0

    # 4. Pick task
    tasks_path = repo / ".codebuddy" / "colab-tasks.json"
    tasks_doc = load_tasks(tasks_path)
    task = pick_task(tasks_doc.get("tasks", []))
    if task is None:
        log("HEARTBEAT_OK (no open task)", log_file)
        update_presence(repo / ".codebuddy" / "presence.json", args.host, None)
        if not args.dry_run:
            git(["add", ".codebuddy/presence.json"], repo, check=False)
            commit = git(["commit", "-m", f"presence: {args.host} heartbeat (no task)"], repo, check=False)
            if commit.returncode == 0:
                git(["push"], repo, check=False)
        return 0

    log(f"picked task: {task['id']} ({task.get('priority', 'low')}) — {task.get('title', '')}", log_file)
    if args.dry_run:
        log("DRY RUN — would claim, invoke claude, log, commit. Exiting.", log_file)
        return 0

    # 5. Claim atomically
    task["status"] = "in_progress"
    task["claimedBy"] = args.host
    task["claimedAt"] = now_iso()
    save_json(tasks_path, tasks_doc)
    git(["add", ".codebuddy/colab-tasks.json"], repo)
    git(["commit", "-m", f"claim: {task['id']} by {args.host}"], repo)
    push = git(["push"], repo, check=False)
    if push.returncode != 0:
        log(f"FAIL: push claim rejected, another host beat us — pulling, aborting tick: {push.stderr}", log_file)
        git(["pull", "--rebase"], repo, check=False)
        return 6
    log(f"claimed {task['id']}, push OK", log_file)

    # 6. Invoke claude
    prompt = build_claude_prompt(args.host, task)
    log(f"invoking {args.claude_bin} --print --dangerously-skip-permissions ... (timeout {args.max_task_seconds}s)", log_file)
    t0 = time.time()
    try:
        proc = subprocess.run(
            [args.claude_bin, "--print", "--dangerously-skip-permissions", prompt],
            cwd=str(repo), capture_output=True, text=True,
            timeout=args.max_task_seconds,
            env={**os.environ},
        )
    except subprocess.TimeoutExpired:
        log(f"TIMEOUT: claude exceeded {args.max_task_seconds}s — marking blocked", log_file)
        task["status"] = "blocked"
        task["completedAt"] = now_iso()
        save_json(tasks_path, tasks_doc)
        append_worklog(repo / ".codebuddy" / "colab-worklog.json", {
            "id": f"wl-{task['id']}-{int(time.time())}",
            "date": now_iso(),
            "agent": args.host,
            "taskId": task["id"],
            "summary": "TIMEOUT — claude --print > {}s".format(args.max_task_seconds),
            "filesModified": [],
            "issues": ["timeout exceeded"],
            "nextSteps": ["investigate, retry with longer timeout, or split task"],
        })
        git(["add", ".codebuddy/"], repo)
        git(["commit", "-m", f"timeout: {task['id']} by {args.host}"], repo)
        git(["push"], repo, check=False)
        return 7

    elapsed = time.time() - t0
    log(f"claude --print finished in {elapsed:.1f}s, exit={proc.returncode}", log_file)
    out_blob = (proc.stdout or "") + ("\n" + proc.stderr if proc.stderr else "")
    parsed = parse_claude_output(proc.stdout)

    # 7. Validate scope
    diff = git(["diff", "--name-only"], repo, check=False)
    modified_files = [l for l in diff.stdout.splitlines() if l.strip()]
    allowed = set(task.get("filesToModify") or [])
    out_of_scope = [f for f in modified_files if allowed and f not in allowed]
    if out_of_scope:
        log(f"OUT-OF-SCOPE: claude modified files not authorized: {out_of_scope} — rolling back", log_file)
        git(["checkout", "--", "."], repo, check=False)
        task["status"] = "blocked"
        task["completedAt"] = now_iso()
        save_json(tasks_path, tasks_doc)
        append_worklog(repo / ".codebuddy" / "colab-worklog.json", {
            "id": f"wl-{task['id']}-{int(time.time())}",
            "date": now_iso(),
            "agent": args.host,
            "taskId": task["id"],
            "summary": "BLOCKED — claude wrote outside scope",
            "filesModified": modified_files,
            "issues": [f"out_of_scope: {out_of_scope}"],
            "nextSteps": ["redéfinir filesToModify ou tighter le prompt"],
        })
        git(["add", ".codebuddy/"], repo)
        git(["commit", "-m", f"blocked: {task['id']} out-of-scope"], repo)
        git(["push"], repo, check=False)
        return 8

    # 8. Append worklog + mark completed
    summary = (parsed or {}).get("summary") or "(claude returned non-JSON; output saved in heartbeat.log)"
    files_modified = (parsed or {}).get("files_modified") or [{"file": f, "changes": "(unknown)"} for f in modified_files]
    issues = (parsed or {}).get("issues") or ([] if parsed else ["no JSON parsed from claude output"])
    next_steps = (parsed or {}).get("next_steps") or []

    if not parsed:
        # Save the raw output for debug
        debug_path = repo / ".codebuddy" / f"debug-{task['id']}-{int(time.time())}.txt"
        try:
            with open(debug_path, "w", encoding="utf-8") as f:
                f.write(out_blob)
        except OSError:
            pass

    append_worklog(repo / ".codebuddy" / "colab-worklog.json", {
        "id": f"wl-{task['id']}-{int(time.time())}",
        "date": now_iso(),
        "agent": args.host,
        "taskId": task["id"],
        "summary": summary,
        "filesModified": files_modified,
        "issues": issues,
        "nextSteps": next_steps,
        "elapsedSeconds": round(elapsed, 1),
    })

    task["status"] = "completed"
    task["completedAt"] = now_iso()
    save_json(tasks_path, tasks_doc)
    update_presence(repo / ".codebuddy" / "presence.json", args.host, None)

    git(["add", "."], repo)
    git(["commit", "-m", f"complete: {task['id']} by {args.host}"], repo)
    push = git(["push"], repo, check=False)
    if push.returncode != 0:
        log(f"WARN: final push failed — {push.stderr.strip()}", log_file)
        return 9
    log(f"=== tick OK: {task['id']} completed in {elapsed:.1f}s ===", log_file)
    return 0


if __name__ == "__main__":
    sys.exit(main())
