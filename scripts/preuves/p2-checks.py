#!/usr/bin/env python3
"""Contrôles explicites des sorties de la campagne P2."""

import csv
import json
import sys
from pathlib import Path


def tools_checked(data):
    candidates = [cycle for cycle in data["cycles"] if cycle.get("selectedScenarioId")]
    if not candidates:
        return False
    for cycle in candidates:
        gate = cycle.get("gate")
        if not gate or gate.get("visibleTotal") != 2:
            return False
        if gate.get("accepted"):
            if not (cycle.get("applied") and gate.get("visiblePassed") == 2
                    and gate.get("heldOutTotal", 0) >= 2
                    and gate.get("heldOutPassed") == gate["heldOutTotal"]):
                return False
        elif cycle.get("applied") or gate.get("visiblePassed") != 0:
            return False
    return True


def skills_checked(data):
    candidates = [cycle for cycle in data["cycles"] if cycle.get("selectedScenarioId")]
    if not candidates:
        return False
    for cycle in candidates:
        gate = cycle.get("gate")
        behavior = cycle.get("behavior")
        if not gate or not behavior or behavior.get("tested", 0) < 2:
            return False
        if gate.get("accepted"):
            if not (cycle.get("applied") and behavior.get("accepted")
                    and behavior.get("wins", 0) > 0):
                return False
        elif cycle.get("applied") or behavior.get("accepted") or behavior.get("wins") != 0:
            return False
    return True


def verify(run):
    def load(label):
        raw = (run / "logs" / f"{label}.log").read_text()
        return json.loads(raw[raw.index("{"):raw.rindex("}") + 1])

    checks = {
        "verifier": lambda x: x["oracleCount"] == 1 and x["result"]["metadata"]["verdict"] == "CONFIRMED",
        "lessons": lambda x: x["gate"]["accepted"] and x["gate"]["delta"] == 1 and x["gate"]["rolledBack"],
        "lessons-apply": lambda x: x["gate"]["accepted"] and x["gate"]["delta"] == 1 and x["applied"] and x["scoreAfter"]["covered"] == 1,
        "tools": tools_checked,
        "tool-authoring": lambda x: x["created"]["success"] and x["created"]["data"]["visiblePassed"] == 2 and x["created"]["data"]["robustnessPassed"] == 2 and x["invoked"]["output"].strip() == "encore-un-test",
        "skills": skills_checked,
        "skill-authoring": lambda x: x["created"]["success"] and x["registered"] and x["savedBytes"] > 0,
        "strategies": lambda x: x["cycle"]["gate"]["accepted"] and x["cycle"]["gate"]["paired"]["wins"] == 6 and not x["cycle"]["applied"],
        "strategies-apply": lambda x: x["cycle"]["gate"]["accepted"] and x["cycle"]["applied"] and x["cycle"]["gate"]["paired"]["wins"] == 6,
        "skill-firewall": lambda x: x["report"]["total"] == 2 and len(x["report"]["imported"]) == 1 and len(x["report"]["quarantined"]) == 1,
        "command-validator": lambda x: not x["result"]["success"],
        "secret-guard": lambda x: x["result"]["success"] and "Found 1 potential secret" in x["result"]["output"] and not x["rawValueExposed"],
        "deployment-guard": lambda x: not x["result"]["success"] and not x["fakeDeployExecuted"],
        "output-sanitizer": lambda x: x["visible"] == "avantVISIBLEFIN" and x["removedChars"] == 60,
        "output-sanitizer-cli": lambda x: x["markerInjected"] and x["outputEqualsOriginal"] and not x["outputHasThink"] and not x["outputHasInst"] and not x["outputHasInvisible"],
        "transcript-repair": lambda x: x["orphanRemoved"] and x["syntheticAdded"],
        "transcript-resume-cli": lambda x: x["repairObserved"] and x["assistantResponded"],
        "security-audit": lambda x: not x["passed"] and any(f["checkId"] == "config.plaintext_secret" for f in x["findings"]),
    }
    failed = []
    for label, check in checks.items():
        try:
            ok = bool(check(load(label)))
        except (OSError, ValueError, KeyError, TypeError, IndexError) as error:
            ok = False
            print(f"CHECK {label}: ERROR {error}")
        print(f'CHECK {label}: {"PASS" if ok else "FAIL"}')
        if not ok:
            failed.append(label)

    with (run / "measure.csv").open(newline="") as source:
        exits = {label: int(exit_code) for label, _, _, exit_code in csv.reader(source)}
    for label, code in exits.items():
        expected = 1 if label == "security-audit" else 0
        if code != expected:
            failed.append(f"{label}: exit {code}, expected {expected}")
    if failed:
        raise SystemExit("Proof checks failed: " + ", ".join(failed))
    print(f"CHECK total: {len(checks)} surfaces/executions validated")


if __name__ == "__main__":
    verify(Path(sys.argv[1]))
