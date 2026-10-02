import { describe, it, expect } from "vitest";
import { CodeBuddyAgent } from "../../src/agent/codebuddy-agent.js";
import { resolveMaxToolRounds } from "../../src/cli/max-tool-rounds-resolver.js";
import { readFileSync } from 'node:fs';

describe("CLI max-tool-rounds option resolution", () => {
  it('documents the actual default and YOLO limit', () => {
    const commands = readFileSync(new URL('../../docs/commands.md', import.meta.url), 'utf8');
    expect(commands).toContain('| `--max-tool-rounds <n>` | | Max tool execution rounds | 50 (400 in YOLO mode) |');
  });
  it("option absente -> undefined", () => {
    expect(resolveMaxToolRounds(undefined)).toBeUndefined();
  });

  it("\"30\" -> 30", () => {
    expect(resolveMaxToolRounds("30")).toBe(30);
  });

  it("\"abc\" ou \"0\" -> undefined", () => {
    expect(resolveMaxToolRounds("abc")).toBeUndefined();
    expect(resolveMaxToolRounds("0")).toBeUndefined();
    expect(resolveMaxToolRounds("-2")).toBeUndefined();
    expect(resolveMaxToolRounds("30junk")).toBeUndefined();
    expect(resolveMaxToolRounds("1.5")).toBeUndefined();
  });

  it("CodeBuddyAgent avec undefined donne 50 hors YOLO et 400 en YOLO", async () => {
    // Par défaut le resolveur de la classe CodeBuddyAgent lit `resolveSessionLimits` qui donne HISTORICAL_MAX_TOOL_ROUNDS
    const a1 = new CodeBuddyAgent("k", "http://127.0.0.1:9/v1", "m", undefined, true);
    // On force l'initialisation des middlewares limits qui définit .maxToolRounds en fonction de yolo=true (a1) et yolo=false (a2)
    a1['yoloMode'] = true;
    a1['applySessionLimits'](true);
    expect(a1['maxToolRounds']).toBe(400);

    const a2 = new CodeBuddyAgent("k", "http://127.0.0.1:9/v1", "m", undefined, false);
    a2['yoloMode'] = false;
    a2['applySessionLimits'](false);
    expect(a2['maxToolRounds']).toBe(50);
  });
});
